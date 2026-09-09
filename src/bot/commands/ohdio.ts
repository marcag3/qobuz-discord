import {
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags,
} from "discord.js"
import type { OhdioClient } from "../../ohdio/client.js"
import type { GuildPlayerManager } from "../../player/guild-manager.js"
import { userFacingError } from "../errors.js"

export async function handleOhdio(
  interaction: ChatInputCommandInteraction,
  ohdio: OhdioClient,
  player: GuildPlayerManager
): Promise<void> {
  const query = interaction.options.getString("query", true)
  const member = interaction.member as GuildMember
  const channel = member.voice.channel

  if (!channel) {
    await interaction.reply({
      content: "Join a voice channel first.",
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  await interaction.deferReply()

  try {
    const tracks = await ohdio.expandFromQuery(query)

    if (tracks.length === 0) {
      await interaction.editReply("No Ohdio audio found.")
      return
    }

    await player.enqueueAndPlay(interaction.guildId!, channel, tracks, interaction.channelId)

    const first = tracks[0]
    const extra = tracks.length > 1 ? ` (+${tracks.length - 1} queued)` : ""
    await interaction.editReply(`Queued **${first.title}** — ${first.artistName}${extra}`)
  } catch (err) {
    await interaction.editReply(userFacingError(err))
  }
}
