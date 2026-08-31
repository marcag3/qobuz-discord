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
import { QueueManager } from "./queue.js"

export type PlaybackCallbacks = {
  onTrackStart?: (guildId: string, track: Track) => void | Promise<void>
  onTrackEnd?: (guildId: string, track: Track) => void | Promise<void>
  onIdle?: (guildId: string) => void | Promise<void>
  onError?: (guildId: string, error: Error) => void | Promise<void>
}

type GuildSession = {
  connection: VoiceConnection
  player: AudioPlayer
  ffmpeg: ChildProcess | null
  currentTrack: Track | null
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

  async enqueueAndPlay(guildId: string, channel: VoiceBasedChannel, tracks: Track[]): Promise<void> {
    const queue = this.queueManager.forGuild(guildId)
    queue.enqueue(tracks)

    const session = this.sessions.get(guildId)
    if (session?.player.state.status === AudioPlayerStatus.Playing) {
      return
    }

    await this.ensureConnection(guildId, channel)
    await this.playNext(guildId)
  }

  async skip(guildId: string): Promise<boolean> {
    const session = this.sessions.get(guildId)
    if (!session) return false

    this.killFfmpeg(session)
    session.player.stop(true)
    return true
  }

  async stop(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId)
    this.queueManager.clearGuild(guildId)

    if (session) {
      this.killFfmpeg(session)
      session.player.stop(true)
      session.connection.destroy()
      this.sessions.delete(guildId)
    }
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

    session = { connection, player, ffmpeg: null, currentTrack: null }
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

  private async playNext(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId)
    if (!session) return

    const queue = this.queueManager.forGuild(guildId)
    const next = queue.dequeue()
    if (!next) {
      session.currentTrack = null
      this.killFfmpeg(session)
      session.connection.destroy()
      this.sessions.delete(guildId)
      await this.callbacks.onIdle?.(guildId)
      return
    }

    this.killFfmpeg(session)

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
      await this.callbacks.onTrackStart?.(guildId, next)
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
}
