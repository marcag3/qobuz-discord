import { ChatInputCommandInteraction, GuildMember, MessageFlags } from "discord.js"
import type { GuildPlayerManager } from "../../player/guild-manager.js"
import { assertPlaybackControl } from "../permissions.js"

export async function handleSkip(
  interaction: ChatInputCommandInteraction,
  player: GuildPlayerManager
): Promise<void> {
  if (!player.isPlaying(interaction.guildId!)) {
    await interaction.reply({ content: "Nothing is playing.", flags: MessageFlags.Ephemeral })
    return
  }

  const member = interaction.member as GuildMember
  const denied = assertPlaybackControl(member, player, interaction.guildId!)
  if (denied) {
    await interaction.reply({ content: denied, flags: MessageFlags.Ephemeral })
    return
  }

  await player.skip(interaction.guildId!)
  await interaction.reply("Skipped.")
}
