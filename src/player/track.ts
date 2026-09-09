export type TrackSource = "qobuz" | "ohdio"

export type Track = {
  id: string
  source: TrackSource
  title: string
  artistName: string
  albumTitle?: string
  durationSeconds?: number
  albumCoverUrl?: string
  url?: string
  infinite?: boolean
  seekSeconds?: number
  appCode?: string
}

export function qobuzTrack(
  id: number | string,
  fields: Omit<Track, "id" | "source">
): Track {
  return {
    id: String(id),
    source: "qobuz",
    ...fields,
  }
}
