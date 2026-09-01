import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js"
import type { Track } from "../qobuz/types.js"
import { loopModeLabel, type PlaybackState } from "../player/playback-state.js"

const MAX_QUEUE_DISPLAY = 10

export const CONTROL_IDS = {
  previous: "np:previous",
  pause: "np:pause",
  next: "np:next",
  shuffle: "np:shuffle",
  loop: "np:loop",
  stop: "np:stop",
  queue: "np:queue",
} as const

function formatDuration(seconds?: number): string | undefined {
  if (seconds === undefined) return undefined
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function buildNowPlayingEmbed(track: Track): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x3a9bdc)
    .setAuthor({ name: "Now Playing" })
    .setTitle(track.title)
    .setDescription(track.artistName)

  if (track.albumCoverUrl) {
    embed.setThumbnail(track.albumCoverUrl)
  }

  const footerParts = [track.albumTitle ?? "Qobuz"]
  const duration = formatDuration(track.durationSeconds)
  if (duration) footerParts.push(duration)

  embed.setFooter({ text: footerParts.join(" · ") })
  return embed
}

export function buildControlRows(state: PlaybackState): ActionRowBuilder<ButtonBuilder>[] {
  const transport = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CONTROL_IDS.previous)
      .setLabel("⏮ Previous")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(CONTROL_IDS.pause)
      .setLabel(state.paused ? "▶ Resume" : "⏸ Pause")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(CONTROL_IDS.next)
      .setLabel("Next ⏭")
      .setStyle(ButtonStyle.Secondary)
  )

  const options = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CONTROL_IDS.shuffle)
      .setLabel(state.shuffle ? "🔀 Shuffle On" : "🔀 Shuffle")
      .setStyle(state.shuffle ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(CONTROL_IDS.loop)
      .setLabel(loopModeLabel(state.loopMode))
      .setStyle(state.loopMode !== "off" ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(CONTROL_IDS.queue)
      .setLabel("📋 Queue")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(CONTROL_IDS.stop)
      .setLabel("⏹ Stop")
      .setStyle(ButtonStyle.Danger)
  )

  return [transport, options]
}

function formatUpcomingList(tracks: Track[], emptyLabel: string): string {
  if (tracks.length === 0) return emptyLabel

  const lines = tracks.slice(0, MAX_QUEUE_DISPLAY).map((t, i) => `${i + 1}. ${t.title} — ${t.artistName}`)
  let text = lines.join("\n")
  if (tracks.length > MAX_QUEUE_DISPLAY) text += `\n+${tracks.length - MAX_QUEUE_DISPLAY} more`
  return text
}

export function formatQueueText(current: Track | null, upcoming: Track[]): string {
  const upcomingText = formatUpcomingList(upcoming, "Queue is empty.")
  if (!current) return upcomingText
  return `**Now playing:** ${current.title} — ${current.artistName}\n\n${upcomingText}`
}

export function buildQueueEmbed(tracks: Track[], current?: Track | null): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("Queue")

  if (current) {
    embed.addFields({
      name: "Now Playing",
      value: `${current.title} — ${current.artistName}`,
    })
  }

  embed.setDescription(formatUpcomingList(tracks, "No upcoming tracks."))
  return embed
}
