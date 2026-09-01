import { ChatInputCommandInteraction } from "discord.js"
import type { GuildPlayerManager } from "../../player/guild-manager.js"
import { buildQueueEmbed } from "../messages.js"
import { ensureCanControl } from "../control-guard.js"

export async function handleQueue(
  interaction: ChatInputCommandInteraction,
  player: GuildPlayerManager
): Promise<void> {
  const guildId = interaction.guildId!

  if (player.isPlaying(guildId)) {
    if (!(await ensureCanControl(interaction, player, { requirePlaying: false }))) return
  }

  const current = player.getCurrentTrack(guildId)
  const upcoming = player.getUpcomingTracks(guildId)
  const embed = buildQueueEmbed(upcoming, current)
  await interaction.reply({ embeds: [embed] })
}
