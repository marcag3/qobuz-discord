import type { Client, TextChannel } from "discord.js"
import type { Track } from "../qobuz/types.js"
import type { PlaybackState } from "../player/playback-state.js"
import { buildControlRows, buildNowPlayingEmbed } from "./messages.js"

export type NowPlayingEntry = { channelId: string; messageId: string }
export type NowPlayingRegistry = Map<string, NowPlayingEntry>

export async function updateNowPlaying(
  client: Client,
  registry: NowPlayingRegistry,
  guildId: string,
  track: Track,
  state: PlaybackState,
  textChannelId: string | null
): Promise<void> {
  if (!textChannelId) return

  const channel = await client.channels.fetch(textChannelId).catch(() => null)
  if (!channel?.isTextBased()) return

  const embed = buildNowPlayingEmbed(track)
  const rows = buildControlRows(state)
  const existing = registry.get(guildId)
  const textChannel = channel as TextChannel

  if (existing && existing.channelId === textChannelId) {
    const message = await textChannel.messages.fetch(existing.messageId).catch(() => null)
    if (message) {
      await message.edit({ embeds: [embed], components: rows }).catch(() => undefined)
      return
    }
  }

  if (existing) {
    const prevChannel = await client.channels.fetch(existing.channelId).catch(() => null)
    if (prevChannel?.isTextBased()) {
      await prevChannel.messages.delete(existing.messageId).catch(() => undefined)
    }
  }

  const message = await textChannel.send({ embeds: [embed], components: rows })
  registry.set(guildId, { channelId: textChannelId, messageId: message.id })
}

export async function clearNowPlaying(
  client: Client,
  registry: NowPlayingRegistry,
  guildId: string
): Promise<void> {
  const entry = registry.get(guildId)
  if (!entry) return

  const channel = await client.channels.fetch(entry.channelId).catch(() => null)
  if (channel?.isTextBased()) {
    await channel.messages.delete(entry.messageId).catch(() => undefined)
  }
  registry.delete(guildId)
}
