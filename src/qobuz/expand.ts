import type { Transport } from "@kud/qobuz"
import { toQobuzError } from "./auth.js"
import { MAX_EXPANSION_TRACKS } from "./constants.js"
import type { PopularItem, Track } from "./types.js"
import { parseQobuzUrl } from "./url.js"

type RawAlbumImage = {
  large?: string
  medium?: string
  thumbnail?: string
}

type RawTrack = {
  id?: number
  title?: string
  performer?: { name?: string }
  artist?: { name?: string }
  album?: { title?: string; image?: RawAlbumImage }
  duration?: number
}

type RawTracksResponse = {
  tracks?: { items?: RawTrack[] } | RawTrack[]
}

function albumCoverUrl(album?: { image?: RawAlbumImage }): string | undefined {
  const image = album?.image
  if (!image) return undefined
  return image.large ?? image.medium ?? image.thumbnail
}

function mapTrack(raw: RawTrack): Track | null {
  if (!raw.id || !raw.title) return null
  const artistName = raw.performer?.name ?? raw.artist?.name ?? "Unknown Artist"
  return {
    id: raw.id,
    title: raw.title,
    artistName,
    albumTitle: raw.album?.title,
    durationSeconds: raw.duration,
    albumCoverUrl: albumCoverUrl(raw.album),
  }
}

function mapTracks(raw: RawTracksResponse): Track[] {
  const items = (Array.isArray(raw.tracks) ? raw.tracks : raw.tracks?.items) ?? []
  return items.map(mapTrack).filter((track): track is Track => track !== null)
}

async function expandTrackCollection(
  transport: Transport,
  endpoint: string,
  params: Record<string, string | number>,
  failMessage: string,
  emptyMessage: string
): Promise<Track[]> {
  try {
    const raw = (await transport.get(endpoint, params)) as RawTracksResponse
    const mapped = mapTracks(raw)
    if (mapped.length > 0) return mapped
  } catch (err) {
    throw toQobuzError(err, failMessage)
  }
  throw toQobuzError(new Error("empty collection"), emptyMessage)
}

export async function expandToTracks(transport: Transport, item: PopularItem): Promise<Track[]> {
  let tracks: Track[]
  switch (item.type) {
    case "tracks":
      tracks = await expandTrack(transport, item)
      break
    case "albums":
      tracks = await expandAlbum(transport, item)
      break
    case "artists":
      tracks = await expandArtist(transport, item)
      break
    case "playlists":
      tracks = await expandPlaylist(transport, item)
      break
    default:
      throw toQobuzError(new Error(`unsupported type ${item.type}`), "Unsupported search result type")
  }
  return tracks.slice(0, MAX_EXPANSION_TRACKS)
}

function fallbackTrack(item: PopularItem, trackId: number): Track[] {
  return [
    {
      id: trackId,
      title: item.title,
      artistName: item.artistName ?? "Unknown Artist",
    },
  ]
}

async function expandTrack(transport: Transport, item: PopularItem): Promise<Track[]> {
  const trackId = Number(item.id)
  try {
    const raw = await transport.get("track/get", { track_id: trackId })
    const track = mapTrack(raw as RawTrack)
    return track ? [track] : fallbackTrack(item, trackId)
  } catch {
    return fallbackTrack(item, trackId)
  }
}

async function expandAlbum(transport: Transport, item: PopularItem): Promise<Track[]> {
  return expandTrackCollection(
    transport,
    "album/get",
    { album_id: String(item.id) },
    `Failed to load album ${item.id}`,
    `Album ${item.id} has no tracks`
  )
}

async function expandArtist(transport: Transport, item: PopularItem): Promise<Track[]> {
  return expandTrackCollection(
    transport,
    "artist/get",
    { artist_id: String(item.id), extra: "tracks", limit: 50 },
    `Failed to load artist ${item.id}`,
    `Artist ${item.id} has no top tracks`
  )
}

async function expandPlaylist(transport: Transport, item: PopularItem): Promise<Track[]> {
  return expandTrackCollection(
    transport,
    "playlist/get",
    { playlist_id: String(item.id), extra: "tracks", limit: MAX_EXPANSION_TRACKS },
    `Failed to load playlist ${item.id}`,
    `Playlist ${item.id} has no tracks`
  )
}

export function popularItemFromUrl(parsed: {
  type: PopularItem["type"]
  id: string | number
  title?: string
}): PopularItem {
  return {
    type: parsed.type,
    id: parsed.id,
    title: parsed.title ?? `${parsed.type} ${parsed.id}`,
  }
}

export async function resolvePopularItemFromUrl(
  transport: Transport,
  url: string
): Promise<PopularItem | null> {
  const parsed = parseQobuzUrl(url)
  if (!parsed) return null

  const fallback = popularItemFromUrl(parsed)

  try {
    switch (parsed.type) {
      case "albums": {
        const raw = (await transport.get("album/get", {
          album_id: String(parsed.id),
        })) as { title?: string; artist?: { name?: string } }
        return {
          type: "albums",
          id: parsed.id,
          title: raw.title ?? fallback.title,
          artistName: raw.artist?.name,
        }
      }
      case "tracks": {
        const raw = (await transport.get("track/get", { track_id: Number(parsed.id) })) as RawTrack
        const track = mapTrack(raw)
        return track
          ? { type: "tracks", id: parsed.id, title: track.title, artistName: track.artistName }
          : fallback
      }
      case "artists": {
        const raw = (await transport.get("artist/get", {
          artist_id: String(parsed.id),
        })) as { name?: string }
        return {
          type: "artists",
          id: parsed.id,
          title: raw.name ?? fallback.title,
        }
      }
      case "playlists": {
        const raw = (await transport.get("playlist/get", {
          playlist_id: String(parsed.id),
        })) as { name?: string; owner?: { name?: string } }
        return {
          type: "playlists",
          id: parsed.id,
          title: raw.name ?? fallback.title,
          artistName: raw.owner?.name,
        }
      }
      default:
        return fallback
    }
  } catch {
    return fallback
  }
}
