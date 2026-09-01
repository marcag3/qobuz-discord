import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js"
import type { Track } from "../qobuz/types.js"
import { loopModeLabel, type PlaybackState } from "../player/playback-state.js"

export const CONTROL_IDS = {
  pause: "np:pause",
  skip: "np:skip",
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
    .setTitle("Now Playing")
    .setDescription(`**${track.title}**\n${track.artistName}`)

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
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CONTROL_IDS.pause)
      .setLabel(state.paused ? "Resume" : "Pause")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CONTROL_IDS.skip).setLabel("Skip").setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(CONTROL_IDS.shuffle)
      .setLabel(state.shuffle ? "Shuffle On" : "Shuffle")
      .setStyle(state.shuffle ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(CONTROL_IDS.loop)
      .setLabel(loopModeLabel(state.loopMode))
      .setStyle(state.loopMode !== "off" ? ButtonStyle.Success : ButtonStyle.Secondary)
  )

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CONTROL_IDS.queue).setLabel("Queue").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CONTROL_IDS.stop).setLabel("Stop").setStyle(ButtonStyle.Danger)
  )

  return [row1, row2]
}

/** @deprecated Use buildControlRows instead */
export function buildControlRow(): ActionRowBuilder<ButtonBuilder> {
  return buildControlRows({ loopMode: "off", shuffle: false, paused: false })[0]
}

export function buildQueueEmbed(tracks: Track[], current?: Track | null): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("Queue")

  if (current) {
    embed.addFields({
      name: "Now Playing",
      value: `${current.title} — ${current.artistName}`,
    })
  }

  if (tracks.length === 0) {
    embed.setDescription("No upcoming tracks.")
    return embed
  }

  const lines = tracks.slice(0, 10).map((t, i) => `${i + 1}. ${t.title} — ${t.artistName}`)
  embed.setDescription(lines.join("\n"))
  if (tracks.length > 10) embed.setFooter({ text: `+${tracks.length - 10} more` })

  return embed
}

export function formatTrackList(tracks: Track[]): string {
  if (tracks.length === 0) return "Queue is empty."
  return tracks
    .slice(0, 10)
    .map((t, i) => `${i + 1}. ${t.title} — ${t.artistName}`)
    .join("\n")
}
