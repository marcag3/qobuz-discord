import { ChatInputCommandInteraction } from "discord.js"
import type { GuildPlayerManager } from "../../player/guild-manager.js"
import { ensureCanControl } from "../control-guard.js"

export async function handleSkip(
  interaction: ChatInputCommandInteraction,
  player: GuildPlayerManager
): Promise<void> {
  if (!(await ensureCanControl(interaction, player))) return

  await player.skip(interaction.guildId!)
  await interaction.reply("Skipped.")
}
