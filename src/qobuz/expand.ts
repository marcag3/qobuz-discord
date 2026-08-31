import type { Transport } from "@kud/qobuz"
import { toQobuzError } from "./auth.js"
import type { PopularItem, Track } from "./types.js"

type RawTrack = {
  id?: number
  title?: string
  performer?: { name?: string }
  artist?: { name?: string }
  album?: { title?: string }
  duration?: number
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
  }
}

export async function expandToTracks(transport: Transport, item: PopularItem): Promise<Track[]> {
  switch (item.type) {
    case "tracks":
      return expandTrack(transport, item)
    case "albums":
      return expandAlbum(transport, item)
    case "artists":
      return expandArtist(transport, item)
    case "playlists":
      return expandPlaylist(transport, item)
    default:
      throw toQobuzError(new Error(`unsupported type ${item.type}`), "Unsupported search result type")
  }
}

async function expandTrack(transport: Transport, item: PopularItem): Promise<Track[]> {
  const trackId = Number(item.id)
  try {
    const raw = await transport.get("track/get", { track_id: trackId })
    const track = mapTrack(raw as RawTrack)
    if (!track) {
      return [
        {
          id: trackId,
          title: item.title,
          artistName: item.artistName ?? "Unknown Artist",
        },
      ]
    }
    return [track]
  } catch {
    return [
      {
        id: trackId,
        title: item.title,
        artistName: item.artistName ?? "Unknown Artist",
      },
    ]
  }
}

async function expandAlbum(transport: Transport, item: PopularItem): Promise<Track[]> {
  try {
    const raw = (await transport.get("album/get", { album_id: String(item.id) })) as {
      tracks?: { items?: RawTrack[] } | RawTrack[]
    }
    const tracks = (Array.isArray(raw.tracks) ? raw.tracks : raw.tracks?.items) ?? []
    const mapped = tracks.map(mapTrack).filter((t): t is Track => t !== null)
    if (mapped.length > 0) return mapped
  } catch (err) {
    throw toQobuzError(err, `Failed to load album ${item.id}`)
  }
  throw toQobuzError(new Error("empty album"), `Album ${item.id} has no tracks`)
}

async function expandArtist(transport: Transport, item: PopularItem): Promise<Track[]> {
  try {
    const raw = (await transport.get("artist/get", {
      artist_id: String(item.id),
      extra: "tracks",
      limit: 50,
    })) as {
      tracks?: { items?: RawTrack[] } | RawTrack[]
    }
    const tracks = (Array.isArray(raw.tracks) ? raw.tracks : raw.tracks?.items) ?? []
    const mapped = tracks.map(mapTrack).filter((t): t is Track => t !== null)
    if (mapped.length > 0) return mapped
  } catch (err) {
    throw toQobuzError(err, `Failed to load artist ${item.id}`)
  }
  throw toQobuzError(new Error("empty artist"), `Artist ${item.id} has no top tracks`)
}

async function expandPlaylist(transport: Transport, item: PopularItem): Promise<Track[]> {
  try {
    const raw = (await transport.get("playlist/get", {
      playlist_id: String(item.id),
      extra: "tracks",
      limit: 500,
    })) as {
      tracks?: { items?: RawTrack[] } | RawTrack[]
    }
    const tracks = (Array.isArray(raw.tracks) ? raw.tracks : raw.tracks?.items) ?? []
    const mapped = tracks.map(mapTrack).filter((t): t is Track => t !== null)
    if (mapped.length > 0) return mapped
  } catch (err) {
    throw toQobuzError(err, `Failed to load playlist ${item.id}`)
  }
  throw toQobuzError(new Error("empty playlist"), `Playlist ${item.id} has no tracks`)
}

export function popularItemFromUrl(parsed: { type: PopularItem["type"]; id: number; title?: string }): PopularItem {
  return {
    type: parsed.type,
    id: parsed.id,
    title: parsed.title ?? `${parsed.type} ${parsed.id}`,
  }
}
