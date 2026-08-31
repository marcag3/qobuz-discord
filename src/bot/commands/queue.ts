import { ChatInputCommandInteraction } from "discord.js"
import type { GuildPlayerManager } from "../../player/guild-manager.js"
import { buildQueueEmbed } from "../messages.js"

export async function handleQueue(
  interaction: ChatInputCommandInteraction,
  player: GuildPlayerManager
): Promise<void> {
  const current = player.getCurrentTrack(interaction.guildId!)
  const upcoming = player.getUpcomingTracks(interaction.guildId!)
  const embed = buildQueueEmbed(upcoming, current)
  await interaction.reply({ embeds: [embed] })
}
