import { ChatInputCommandInteraction } from "discord.js"
import type { GuildPlayerManager } from "../../player/guild-manager.js"
import { ensureCanControl } from "../control-guard.js"

export async function handleStop(
  interaction: ChatInputCommandInteraction,
  player: GuildPlayerManager
): Promise<void> {
  if (
    !(await ensureCanControl(interaction, player, {
      notPlayingMessage: "Not connected to a voice channel.",
    }))
  ) {
    return
  }

  await player.stop(interaction.guildId!)
  await interaction.reply("Stopped playback and cleared the queue.")
}
