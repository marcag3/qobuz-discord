import { ChatInputCommandInteraction, GuildMember, MessageFlags } from "discord.js"
import type { GuildPlayerManager } from "../../player/guild-manager.js"
import { buildQueueEmbed } from "../messages.js"
import { assertPlaybackControl } from "../permissions.js"

export async function handleQueue(
  interaction: ChatInputCommandInteraction,
  player: GuildPlayerManager
): Promise<void> {
  const guildId = interaction.guildId!

  if (player.isPlaying(guildId)) {
    const member = interaction.member as GuildMember
    const denied = assertPlaybackControl(member, player, guildId)
    if (denied) {
      await interaction.reply({ content: denied, flags: MessageFlags.Ephemeral })
      return
    }
  }

  const current = player.getCurrentTrack(guildId)
  const upcoming = player.getUpcomingTracks(guildId)
  const embed = buildQueueEmbed(upcoming, current)
  await interaction.reply({ embeds: [embed] })
}
