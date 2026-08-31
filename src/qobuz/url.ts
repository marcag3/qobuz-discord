const QOBUZ_URL_RE =
  /^https?:\/\/(?:open\.qobuz\.com|www\.qobuz\.com|play\.qobuz\.com)\/(track|album|artist|playlist)\/(\d+)/i

const TYPE_MAP = {
  track: "tracks",
  album: "albums",
  artist: "artists",
  playlist: "playlists",
} as const

export function isQobuzUrl(input: string): boolean {
  return QOBUZ_URL_RE.test(input.trim())
}

export function parseQobuzUrl(input: string): { type: "tracks" | "albums" | "artists" | "playlists"; id: number } | null {
  const match = input.trim().match(QOBUZ_URL_RE)
  if (!match) return null

  const segment = match[1].toLowerCase() as keyof typeof TYPE_MAP
  const type = TYPE_MAP[segment]
  const id = Number(match[2])
  if (!type || Number.isNaN(id)) return null

  return { type, id }
}
