import type { AutocompleteInteraction } from "discord.js"
import type { PopularItem, PopularItemType } from "../qobuz/types.js"
import type { QobuzClient } from "../qobuz/types.js"
import { buildQobuzUrl } from "../qobuz/url.js"

const TYPE_LABEL: Record<PopularItemType, string> = {
  tracks: "Track",
  albums: "Album",
  artists: "Artist",
  playlists: "Playlist",
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1) + "…"
}

function qobuzUrl(item: PopularItem): string {
  return buildQobuzUrl(item.type, item.id)
}

function choiceName(item: PopularItem): string {
  const label = TYPE_LABEL[item.type]
  const artist = item.artistName ? ` — ${item.artistName}` : ""
  return truncate(`${label}: ${item.title}${artist}`, 100)
}

export async function handleAutocomplete(
  interaction: AutocompleteInteraction,
  qobuz: QobuzClient
): Promise<void> {
  const focused = interaction.options.getFocused()
  if (focused.trim().length < 2) {
    await interaction.respond([])
    return
  }

  try {
    const result = await qobuz.search(focused, 25)
    const choices = result.mostPopular.slice(0, 25).map((item) => ({
      name: choiceName(item),
      value: truncate(qobuzUrl(item), 100),
    }))
    await interaction.respond(choices)
  } catch {
    await interaction.respond([])
  }
}
