import { spawn, type ChildProcess } from "node:child_process"
import { resolveFfmpegPath } from "../ffmpeg.js"
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
import type { QobuzClient, Track } from "../qobuz/types.js"
import {
  createPlaybackState,
  cycleLoopMode,
  toggleShuffle,
  type LoopMode,
  type PlaybackState,
} from "./playback-state.js"
import { QueueManager } from "./queue.js"

const MAX_HISTORY_SIZE = 50

export type PlaybackCallbacks = {
  onTrackStart?: (guildId: string, track: Track, textChannelId: string | null) => void | Promise<void>
  onTrackEnd?: (guildId: string, track: Track) => void | Promise<void>
  onIdle?: (guildId: string, textChannelId: string | null) => void | Promise<void>
  onError?: (guildId: string, error: Error) => void | Promise<void>
  onPlaybackStateChange?: (
    guildId: string,
    track: Track,
    textChannelId: string | null,
    state: PlaybackState
  ) => void | Promise<void>
}

type GuildSession = {
  connection: VoiceConnection
  player: AudioPlayer
  ffmpeg: ChildProcess | null
  currentTrack: Track | null
  textChannelId: string | null
  loopMode: LoopMode
  shuffle: boolean
  loopSnapshot: Track[]
  history: Track[]
  paused: boolean
  advanceRequested: boolean
  backRequested: boolean
}

export class GuildPlayerManager {
  private readonly qobuz: QobuzClient
  private readonly queueManager: QueueManager
  private readonly sessions = new Map<string, GuildSession>()
  private readonly callbacks: PlaybackCallbacks

  constructor(
    qobuz: QobuzClient,
    queueManager: QueueManager,
    callbacks: PlaybackCallbacks = {}
  ) {
    this.qobuz = qobuz
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
      shuffleTracks(batch)
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
    this.queueManager.clearGuild(guildId)

    if (session) {
      const textChannelId = session.textChannelId
      session.loopSnapshot = []
      session.history = []
      this.killFfmpeg(session)
      session.player.stop(true)
      session.connection.destroy()
      this.sessions.delete(guildId)
      await this.callbacks.onIdle?.(guildId, textChannelId)
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
      session.currentTrack,
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
        session.currentTrack,
        session.textChannelId,
        this.getPlaybackState(guildId)
      )
    }

    return session.loopMode
  }

  async toggleShuffle(guildId: string): Promise<boolean> {
    const session = this.sessions.get(guildId)
    if (!session) return false

    session.shuffle = toggleShuffle(session.shuffle)
    if (session.shuffle) {
      this.queueManager.forGuild(guildId).shuffle()
    }

    if (session.currentTrack) {
      await this.callbacks.onPlaybackStateChange?.(
        guildId,
        session.currentTrack,
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

    const player = createAudioPlayer()
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
        void this.onTrackFinished(guildId)
      }
    })

    player.on("error", (err) => {
      void this.callbacks.onError?.(guildId, err)
      void this.playNext(guildId)
    })

    session = {
      connection,
      player,
      ffmpeg: null,
      currentTrack: null,
      textChannelId: null,
      loopMode: "off",
      shuffle: false,
      loopSnapshot: [],
      history: [],
      paused: false,
      advanceRequested: false,
      backRequested: false,
    }
    this.sessions.set(guildId, session)

    await entersState(connection, VoiceConnectionStatus.Ready, 30_000)
    return session
  }

  private async onTrackFinished(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId)
    if (session?.currentTrack) {
      await this.callbacks.onTrackEnd?.(guildId, session.currentTrack)
    }
    await this.playNext(guildId)
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
      if (session.loopMode === "queue" && session.loopSnapshot.length > 0) {
        queue.replaceAll([...session.loopSnapshot])
        return queue.dequeue() ?? null
      }
      if (session.loopMode === "track" && session.currentTrack) {
        return session.currentTrack
      }
      return null
    }

    if (session.loopMode === "track" && session.currentTrack && queue.isEmpty()) {
      return session.currentTrack
    }

    let next = queue.dequeue()
    if (!next && session.loopMode === "queue" && session.loopSnapshot.length > 0) {
      queue.replaceAll([...session.loopSnapshot])
      next = queue.dequeue()
    }
    return next ?? null
  }

  private async playNext(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId)
    if (!session) return

    const previousTrack = session.currentTrack
    const wasGoingBack = session.backRequested
    const wasSkipping = session.advanceRequested
    const next = this.resolveNextTrack(guildId, session)
    if (!next) {
      const textChannelId = session.textChannelId
      session.currentTrack = null
      this.killFfmpeg(session)
      session.connection.destroy()
      this.sessions.delete(guildId)
      await this.callbacks.onIdle?.(guildId, textChannelId)
      return
    }

    if (previousTrack && !wasGoingBack && (wasSkipping || previousTrack.id !== next.id)) {
      this.pushHistory(session, previousTrack)
    }

    this.killFfmpeg(session)
    session.paused = false

    try {
      const stream = await this.qobuz.getStreamUrl(next.id)
      const ffmpeg = this.createFfmpegStream(stream.url)
      session.ffmpeg = ffmpeg
      session.currentTrack = next

      ffmpeg.stderr?.on("data", (chunk) => {
        const msg = chunk.toString().trim()
        if (msg) console.error(`ffmpeg[${guildId}]: ${msg}`)
      })

      const resource = createAudioResource(ffmpeg.stdout!, {
        inputType: StreamType.Raw,
      })

      session.player.play(resource)
      await entersState(session.player, AudioPlayerStatus.Playing, 15_000)
      await this.callbacks.onTrackStart?.(guildId, next, session.textChannelId)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      await this.callbacks.onError?.(guildId, error)
      await this.playNext(guildId)
    }
  }

  private createFfmpegStream(url: string): ChildProcess {
    const ffmpeg = resolveFfmpegPath()
    const proc = spawn(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-re",
        "-i",
        url,
        "-analyzeduration",
        "0",
        "-f",
        "s16le",
        "-ar",
        "48000",
        "-ac",
        "2",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    )

    proc.on("error", (err) => {
      console.error(`ffmpeg spawn error (${ffmpeg}):`, err.message)
    })
    proc.on("close", (code, signal) => {
      if (code !== 0 || signal) {
        console.error(`ffmpeg exited code=${code ?? "null"} signal=${signal ?? "null"}`)
      }
    })

    return proc
  }

  private killFfmpeg(session: GuildSession): void {
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

function shuffleTracks(tracks: Track[]): void {
  for (let i = tracks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[tracks[i], tracks[j]] = [tracks[j], tracks[i]]
  }
}
