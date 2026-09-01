import {
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags,
  type ButtonInteraction,
} from "discord.js"
import type { GuildPlayerManager } from "../player/guild-manager.js"

const PLAYBACK_DENIED = "Join the bot's voice channel to control playback."

type ControlOptions = {
  requirePlaying?: boolean
  notPlayingMessage?: string
}

function canControlPlayback(member: GuildMember, botVoiceChannelId: string | null): boolean {
  if (!botVoiceChannelId) return true
  return member.voice.channelId === botVoiceChannelId
}

async function replyEphemeral(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  content: string
): Promise<void> {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral })
}

export async function ensureCanControl(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  player: GuildPlayerManager,
  options: ControlOptions = {}
): Promise<boolean> {
  const guildId = interaction.guildId!
  const { requirePlaying = true, notPlayingMessage = "Nothing is playing." } = options

  if (requirePlaying && !player.isPlaying(guildId)) {
    await replyEphemeral(interaction, notPlayingMessage)
    return false
  }

  const member = interaction.member
  if (!(member instanceof GuildMember)) return false

  if (!canControlPlayback(member, player.getVoiceChannelId(guildId))) {
    await replyEphemeral(interaction, PLAYBACK_DENIED)
    return false
  }

  return true
}
