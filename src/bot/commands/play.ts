import {
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags,
} from "discord.js"
import { isQobuzUrl } from "../../qobuz/url.js"
import type { GuildPlayerManager } from "../../player/guild-manager.js"
import type { QobuzService } from "../../qobuz/client.js"
import { userFacingError } from "../errors.js"

async function resolveQueryToTracks(qobuz: QobuzService, query: string) {
  const result = await qobuz.search(query)
  const top = result.mostPopular[0]
  if (!top) return []
  return qobuz.expandToTracks(top)
}

export async function handlePlay(
  interaction: ChatInputCommandInteraction,
  qobuz: QobuzService,
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
    const tracks = isQobuzUrl(query)
      ? await qobuz.expandFromUrl(query)
      : await resolveQueryToTracks(qobuz, query)

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
