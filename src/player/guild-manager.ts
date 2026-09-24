import { spawn, type ChildProcess } from "node:child_process"
import { PassThrough } from "node:stream"
import {
  buildPlaybackFfmpegArgs,
  MAX_MISSED_FRAMES,
  PCM_BYTES_PER_SECOND,
  PCM_PREFETCH_SECONDS,
  resolveFfmpegPath,
} from "../ffmpeg.js"
import {
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  StreamType,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  type AudioPlayer,
  type VoiceConnection,
} from "@discordjs/voice"
import type { VoiceBasedChannel } from "discord.js"
import type { StreamResolver } from "./stream.js"
import type { Track } from "./track.js"
import {
  createPlaybackState,
  cycleLoopMode,
  type LoopMode,
  type PlaybackState,
} from "./playback-state.js"
import { QueueManager, shuffleInPlace } from "./queue.js"

const MAX_HISTORY_SIZE = 50

export type PlaybackCallbacks = {
  onTrackStart?: (guildId: string, track: Track, textChannelId: string | null) => void | Promise<void>
  onIdle?: (
    guildId: string,
    textChannelId: string | null,
    disconnected: boolean
  ) => void | Promise<void>
  onError?: (guildId: string, error: Error, textChannelId: string | null) => void | Promise<void>
  onPlaybackStateChange?: (
    guildId: string,
    textChannelId: string | null,
    state: PlaybackState
  ) => void | Promise<void>
}

type GuildSession = {
  connection: VoiceConnection
  player: AudioPlayer
  ffmpeg: ChildProcess | null
  pcmStream: PassThrough | null
  currentTrack: Track | null
  textChannelId: string | null
  loopMode: LoopMode
  shuffle: boolean
  loopSnapshot: Track[]
  history: Track[]
  paused: boolean
  advanceRequested: boolean
  backRequested: boolean
  liveRefresh: ReturnType<typeof setInterval> | null
}

const LIVE_REFRESH_MS = 45_000

export class GuildPlayerManager {
  private readonly streams: StreamResolver
  private readonly queueManager: QueueManager
  private readonly sessions = new Map<string, GuildSession>()
  private readonly callbacks: PlaybackCallbacks

  constructor(
    streams: StreamResolver,
    queueManager: QueueManager,
    callbacks: PlaybackCallbacks = {}
  ) {
    this.streams = streams
    this.queueManager = queueManager
    this.callbacks = callbacks
  }

  isPlaying(guildId: string): boolean {
    return this.sessions.has(guildId)
  }

  getCurrentTrack(guildId: string): Track | null {
    return this.sessions.get(guildId)?.currentTrack ?? null
  }

  getUpcomingTracks(guildId: string): Track[] {
    return this.queueManager.forGuild(guildId).list()
  }

  getVoiceChannelId(guildId: string): string | null {
    return this.sessions.get(guildId)?.connection.joinConfig.channelId ?? null
  }

  getPlaybackState(guildId: string): PlaybackState {
    const session = this.sessions.get(guildId)
    if (!session) return createPlaybackState()
    return {
      loopMode: session.loopMode,
      shuffle: session.shuffle,
      paused: session.paused,
    }
  }

  async enqueueAndPlay(
    guildId: string,
    channel: VoiceBasedChannel,
    tracks: Track[],
    textChannelId?: string | null
  ): Promise<void> {
    const existingSession = this.sessions.get(guildId)
    const queue = this.queueManager.forGuild(guildId)

    const batch = [...tracks]
    if (existingSession?.shuffle) {
      shuffleInPlace(batch)
    }

    queue.enqueue(batch)

    if (existingSession?.player.state.status === AudioPlayerStatus.Playing) {
      existingSession.loopSnapshot.push(...batch)
      if (textChannelId) {
        existingSession.textChannelId = textChannelId
      }
      return
    }

    const connected = await this.ensureConnection(guildId, channel)
    connected.loopSnapshot.push(...batch)
    if (textChannelId) {
      connected.textChannelId = textChannelId
    }
    await this.playNext(guildId)
  }

  async skip(guildId: string): Promise<boolean> {
    const session = this.sessions.get(guildId)
    if (!session) return false

    session.advanceRequested = true
    this.killFfmpeg(session)
    session.player.stop(true)
    return true
  }

  async previous(guildId: string): Promise<boolean> {
    const session = this.sessions.get(guildId)
    if (!session?.currentTrack || session.history.length === 0) return false

    session.backRequested = true
    this.killFfmpeg(session)
    session.player.stop(true)
    return true
  }

  async stop(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId)
    this.queueManager.removeGuild(guildId)

    if (session) {
      const textChannelId = session.textChannelId
      session.loopSnapshot = []
      session.history = []
      this.killFfmpeg(session)
      session.player.stop(true)
      session.connection.destroy()
      this.sessions.delete(guildId)
      await this.callbacks.onIdle?.(guildId, textChannelId, true)
    }
  }

  async togglePause(guildId: string): Promise<boolean> {
    const session = this.sessions.get(guildId)
    if (!session?.currentTrack) return false

    if (session.paused) {
      session.player.unpause()
      session.paused = false
    } else {
      session.player.pause()
      session.paused = true
    }

    await this.callbacks.onPlaybackStateChange?.(
      guildId,
      session.textChannelId,
      this.getPlaybackState(guildId)
    )
    return true
  }

  async cycleLoop(guildId: string): Promise<LoopMode> {
    const session = this.sessions.get(guildId)
    if (!session) return "off"

    session.loopMode = cycleLoopMode(session.loopMode)

    if (session.currentTrack) {
      await this.callbacks.onPlaybackStateChange?.(
        guildId,
        session.textChannelId,
        this.getPlaybackState(guildId)
      )
    }

    return session.loopMode
  }

  async toggleShuffle(guildId: string): Promise<boolean> {
    const session = this.sessions.get(guildId)
    if (!session) return false

    session.shuffle = !session.shuffle
    if (session.shuffle) {
      this.queueManager.forGuild(guildId).shuffle()
    }

    if (session.currentTrack) {
      await this.callbacks.onPlaybackStateChange?.(
        guildId,
        session.textChannelId,
        this.getPlaybackState(guildId)
      )
    }

    return session.shuffle
  }

  async shutdown(): Promise<void> {
    for (const guildId of [...this.sessions.keys()]) {
      await this.stop(guildId)
    }
  }

  private async ensureConnection(guildId: string, channel: VoiceBasedChannel): Promise<GuildSession> {
    let session = this.sessions.get(guildId)

    if (session) {
      if (session.connection.joinConfig.channelId !== channel.id) {
        session.connection.rejoin({
          channelId: channel.id,
          selfDeaf: false,
          selfMute: false,
        })
      }
      return session
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
    })

    const player = createAudioPlayer({
      behaviors: { maxMissedFrames: MAX_MISSED_FRAMES },
    })
    connection.subscribe(player)

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ])
      } catch {
        await this.stop(guildId)
      }
    })

    player.on("stateChange", (oldState, newState) => {
      if (oldState.status === AudioPlayerStatus.Playing && newState.status === AudioPlayerStatus.Idle) {
        void this.playNext(guildId)
      }
    })

    player.on("error", (err) => {
      void this.callbacks.onError?.(guildId, err, this.sessions.get(guildId)?.textChannelId ?? null)
      void this.playNext(guildId)
    })

    session = {
      connection,
      player,
      ffmpeg: null,
      pcmStream: null,
      currentTrack: null,
      textChannelId: null,
      loopMode: "off",
      shuffle: false,
      loopSnapshot: [],
      history: [],
      paused: false,
      advanceRequested: false,
      backRequested: false,
      liveRefresh: null,
    }
    this.sessions.set(guildId, session)

    await entersState(connection, VoiceConnectionStatus.Ready, 30_000)
    return session
  }

  private refillQueueFromLoop(guildId: string, session: GuildSession): Track | null {
    if (session.loopMode !== "queue" || session.loopSnapshot.length === 0) return null
    const queue = this.queueManager.forGuild(guildId)
    queue.replaceAll([...session.loopSnapshot])
    return queue.dequeue() ?? null
  }

  private resolveNextTrack(guildId: string, session: GuildSession): Track | null {
    const queue = this.queueManager.forGuild(guildId)

    if (session.backRequested) {
      session.backRequested = false
      const previous = session.history.pop()
      if (!previous) return null
      if (session.currentTrack) {
        queue.prepend(session.currentTrack)
      }
      return previous
    }

    if (session.advanceRequested) {
      session.advanceRequested = false
      const next = queue.dequeue()
      if (next) return next
      const looped = this.refillQueueFromLoop(guildId, session)
      if (looped) return looped
      if (session.loopMode === "track" && session.currentTrack) {
        return session.currentTrack
      }
      return null
    }

    if (session.loopMode === "track" && session.currentTrack && queue.isEmpty()) {
      return session.currentTrack
    }

    const next = queue.dequeue()
    if (next) return next
    return this.refillQueueFromLoop(guildId, session)
  }

  private async playNext(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId)
    if (!session) return

    if (
      session.currentTrack?.infinite &&
      !session.advanceRequested &&
      !session.backRequested
    ) {
      await this.startTrack(guildId, session, session.currentTrack)
      return
    }

    const previousTrack = session.currentTrack
    const wasGoingBack = session.backRequested
    const wasSkipping = session.advanceRequested
    const next = this.resolveNextTrack(guildId, session)
    if (!next) {
      const textChannelId = session.textChannelId
      session.currentTrack = null
      this.killFfmpeg(session)
      await this.callbacks.onIdle?.(guildId, textChannelId, false)
      return
    }

    if (previousTrack && !wasGoingBack && (wasSkipping || previousTrack.id !== next.id)) {
      this.pushHistory(session, previousTrack)
    }

    await this.startTrack(guildId, session, next)
  }

  private async startTrack(guildId: string, session: GuildSession, track: Track): Promise<void> {
    this.killFfmpeg(session)
    session.paused = false

    try {
      const stream = await this.streams.resolve(track)
      const { proc, pcm } = this.createFfmpegStream(
        stream.url,
        stream.seekSeconds ?? track.seekSeconds,
        stream.userAgent
      )
      session.ffmpeg = proc
      session.pcmStream = pcm
      session.currentTrack = track
      this.scheduleLiveRefresh(guildId, session, track)

      proc.stderr?.on("data", (chunk) => {
        const msg = chunk.toString().trim()
        if (msg) console.error(`ffmpeg[${guildId}]: ${msg}`)
      })

      const resource = createAudioResource(pcm, {
        inputType: StreamType.Raw,
      })

      session.player.play(resource)
      await entersState(session.player, AudioPlayerStatus.Playing, 15_000)
      await this.callbacks.onTrackStart?.(guildId, track, session.textChannelId)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      await this.callbacks.onError?.(guildId, error, session.textChannelId)
      session.currentTrack = null
      await this.playNext(guildId)
    }
  }

  private scheduleLiveRefresh(guildId: string, session: GuildSession, track: Track): void {
    this.clearLiveRefresh(session)
    if (!track.infinite || !this.streams.refresh) return

    session.liveRefresh = setInterval(() => {
      void this.refreshLiveTrack(guildId)
    }, LIVE_REFRESH_MS)
  }

  private async refreshLiveTrack(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId)
    const track = session?.currentTrack
    if (!session || !track?.infinite || !this.streams.refresh) return

    try {
      const updated = await this.streams.refresh(track)
      if (updated.title === track.title && updated.artistName === track.artistName) return
      session.currentTrack = updated
      await this.callbacks.onTrackStart?.(guildId, updated, session.textChannelId)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      console.error(`Live metadata refresh failed in ${guildId}:`, error.message)
    }
  }

  private createFfmpegStream(
    url: string,
    seekSeconds?: number,
    userAgent?: string
  ): { proc: ChildProcess; pcm: PassThrough } {
    const ffmpeg = resolveFfmpegPath()
    const args = buildPlaybackFfmpegArgs(url, { seekSeconds, userAgent })
    const proc = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] })
    const pcm = new PassThrough({
      highWaterMark: PCM_BYTES_PER_SECOND * PCM_PREFETCH_SECONDS,
    })

    proc.stdout?.on("error", () => undefined)
    pcm.on("error", () => undefined)
    proc.stdout?.pipe(pcm)

    proc.on("error", (err) => {
      console.error(`ffmpeg spawn error (${ffmpeg}):`, err.message)
    })
    proc.on("close", (code, signal) => {
      if (code !== 0 || signal) {
        console.error(`ffmpeg exited code=${code ?? "null"} signal=${signal ?? "null"}`)
      }
    })

    return { proc, pcm }
  }

  private clearLiveRefresh(session: GuildSession): void {
    if (session.liveRefresh) {
      clearInterval(session.liveRefresh)
      session.liveRefresh = null
    }
  }

  private killFfmpeg(session: GuildSession): void {
    this.clearLiveRefresh(session)
    if (session.pcmStream) {
      session.pcmStream.destroy()
      session.pcmStream = null
    }
    if (session.ffmpeg && !session.ffmpeg.killed) {
      session.ffmpeg.kill("SIGKILL")
    }
    session.ffmpeg = null
  }

  private pushHistory(session: GuildSession, track: Track): void {
    const last = session.history[session.history.length - 1]
    if (last?.id === track.id) return
    session.history.push(track)
    if (session.history.length > MAX_HISTORY_SIZE) {
      session.history.shift()
    }
  }
}
