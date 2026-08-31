import { ChatInputCommandInteraction, GuildMember, MessageFlags } from "discord.js"
import type { GuildPlayerManager } from "../../player/guild-manager.js"
import { assertPlaybackControl } from "../permissions.js"

export async function handleStop(
  interaction: ChatInputCommandInteraction,
  player: GuildPlayerManager
): Promise<void> {
  if (!player.isPlaying(interaction.guildId!)) {
    await interaction.reply({ content: "Not connected to a voice channel.", flags: MessageFlags.Ephemeral })
    return
  }

  const member = interaction.member as GuildMember
  const denied = assertPlaybackControl(member, player, interaction.guildId!)
  if (denied) {
    await interaction.reply({ content: denied, flags: MessageFlags.Ephemeral })
    return
  }

  await player.stop(interaction.guildId!)
  await interaction.reply("Stopped playback and cleared the queue.")
}
