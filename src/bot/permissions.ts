import { GuildPlayerManager } from "../player/guild-manager.js"
import type { GuildMember } from "discord.js"
import { canControlPlayback, playbackDeniedMessage } from "./errors.js"

export function assertPlaybackControl(
  member: GuildMember,
  player: GuildPlayerManager,
  guildId: string
): string | null {
  if (!canControlPlayback(member, player.getVoiceChannelId(guildId))) {
    return playbackDeniedMessage()
  }
  return null
}
