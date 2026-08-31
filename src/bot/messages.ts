import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js"
import type { Track } from "../qobuz/types.js"

export const CONTROL_IDS = {
  skip: "np:skip",
  stop: "np:stop",
  queue: "np:queue",
} as const

export function buildNowPlayingEmbed(track: Track): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x3a9bdc)
    .setTitle("Now Playing")
    .setDescription(`**${track.title}**\n${track.artistName}`)
    .setFooter({ text: track.albumTitle ?? "Qobuz" })
}

export function buildControlRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CONTROL_IDS.skip).setLabel("Skip").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(CONTROL_IDS.stop).setLabel("Stop").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(CONTROL_IDS.queue).setLabel("Queue").setStyle(ButtonStyle.Secondary)
  )
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
