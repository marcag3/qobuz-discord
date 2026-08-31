import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js"
import type { GuildPlayerManager } from "../../player/guild-manager.js"
import type { QobuzService } from "../../qobuz/client.js"
import type { PopularItem } from "../../qobuz/types.js"
import { userFacingError } from "../errors.js"
import { buildSearchSelectOptions, parseSearchSelection } from "../search-menu.js"

const pendingSelections = new Map<string, PopularItem[]>()

export async function handleSearch(
  interaction: ChatInputCommandInteraction,
  qobuz: QobuzService
): Promise<void> {
  const query = interaction.options.getString("query", true)
  await interaction.deferReply()

  try {
    const result = await qobuz.search(query)
    if (result.mostPopular.length === 0) {
      await interaction.editReply("No results found.")
      return
    }

    pendingSelections.set(interaction.user.id, result.mostPopular)

    const menu = new StringSelectMenuBuilder()
      .setCustomId("search:select")
      .setPlaceholder("Choose a result")
      .addOptions(buildSearchSelectOptions(result.mostPopular))

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)
    await interaction.editReply({ content: `Results for **${query}**:`, components: [row] })
  } catch (err) {
    await interaction.editReply(userFacingError(err))
  }
}

export async function handleSearchSelect(
  interaction: StringSelectMenuInteraction,
  qobuz: QobuzService,
  player: GuildPlayerManager
): Promise<void> {
  const items = pendingSelections.get(interaction.user.id)
  const selected = items ? parseSearchSelection(interaction.values[0], items) : null

  if (!selected) {
    await interaction.reply({ content: "Selection expired — run `/search` again.", flags: MessageFlags.Ephemeral })
    return
  }

  const member = interaction.member
  if (!member || !("voice" in member) || !member.voice.channel) {
    await interaction.reply({ content: "Join a voice channel first.", flags: MessageFlags.Ephemeral })
    return
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  try {
    const tracks = await qobuz.expandToTracks(selected)
    if (tracks.length === 0) {
      await interaction.editReply("No tracks found for that selection.")
      return
    }

    await player.enqueueAndPlay(interaction.guildId!, member.voice.channel, tracks)
    const first = tracks[0]
    const extra = tracks.length > 1 ? ` (+${tracks.length - 1} queued)` : ""
    await interaction.editReply(`Queued **${first.title}** — ${first.artistName}${extra}`)
  } catch (err) {
    await interaction.editReply(userFacingError(err))
  }
}

export function clearPendingSelection(userId: string): void {
  pendingSelections.delete(userId)
}
