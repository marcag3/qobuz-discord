import type { PopularItem } from "../qobuz/types.js"

const TYPE_LABELS: Record<PopularItem["type"], string> = {
  tracks: "Track",
  albums: "Album",
  artists: "Artist",
  playlists: "Playlist",
}

export function buildSearchSelectOptions(items: PopularItem[]) {
  return items.slice(0, 25).map((item, index) => {
    const label = `${TYPE_LABELS[item.type]}: ${truncate(item.title, 80)}`
    const description = item.artistName ? truncate(item.artistName, 100) : TYPE_LABELS[item.type]
    return {
      label,
      description,
      value: `${item.type}:${item.id}:${index}`,
    }
  })
}

export function parseSearchSelection(value: string, items: PopularItem[]): PopularItem | null {
  const [type, id] = value.split(":")
  const match = items.find((item) => String(item.type) === type && String(item.id) === id)
  return match ?? null
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
