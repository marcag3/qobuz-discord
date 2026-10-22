import {
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags,
} from "discord.js"
import type { OhdioClient } from "../../ohdio/client.js"
import { resolvePlayQuery } from "../../catalog/resolve.js"
import type { GuildPlayerManager } from "../../player/guild-manager.js"
import type { QobuzService } from "../../qobuz/client.js"
import { ensureSameVoiceChannel } from "../control-guard.js"
import { userFacingError } from "../errors.js"

export async function handlePlay(
  interaction: ChatInputCommandInteraction,
  qobuz: QobuzService,
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

  if (!(await ensureSameVoiceChannel(interaction, player, channel.id))) return

  await interaction.deferReply()

  try {
    const tracks = await resolvePlayQuery(qobuz, ohdio, query)

    if (tracks.length === 0) {
      await interaction.editReply("No tracks found.")
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
