import { GuildPlayerManager } from "../player/guild-manager.js"
import type { GuildMember } from "discord.js"
import { canControlPlayback, playbackDeniedMessage } from "./errors.js"

export function getBotVoiceChannelId(player: GuildPlayerManager, guildId: string): string | null {
  return player.getVoiceChannelId(guildId)
}

export function assertPlaybackControl(
  member: GuildMember,
  player: GuildPlayerManager,
  guildId: string
): string | null {
  const botChannelId = getBotVoiceChannelId(player, guildId)
  if (!canControlPlayback(member, botChannelId)) {
    return playbackDeniedMessage()
  }
  return null
}
