const QOBUZ_URL_RE =
  /^https?:\/\/(?:open\.qobuz\.com|www\.qobuz\.com|play\.qobuz\.com)\/(track|album|artist|playlist)\/([a-z0-9]+)/i

const TYPE_MAP = {
  track: "tracks",
  album: "albums",
  artist: "artists",
  playlist: "playlists",
} as const

const TYPE_URL_SEGMENT = {
  tracks: "track",
  albums: "album",
  artists: "artist",
  playlists: "playlist",
} as const

export function buildQobuzUrl(
  type: keyof typeof TYPE_URL_SEGMENT,
  id: number | string
): string {
  return `https://open.qobuz.com/${TYPE_URL_SEGMENT[type]}/${id}`
}

export function buildTrackUrl(trackId: number): string {
  return buildQobuzUrl("tracks", trackId)
}

export function isQobuzUrl(input: string): boolean {
  return QOBUZ_URL_RE.test(input.trim())
}

export function parseQobuzUrl(
  input: string
): { type: "tracks" | "albums" | "artists" | "playlists"; id: string | number } | null {
  const match = input.trim().match(QOBUZ_URL_RE)
  if (!match) return null

  const segment = match[1].toLowerCase() as keyof typeof TYPE_MAP
  const type = TYPE_MAP[segment]
  const rawId = match[2]
  if (!type || !rawId) return null

  const id = /^\d+$/.test(rawId) ? Number(rawId) : rawId
  return { type, id }
}
