export type PopularItemType = "tracks" | "albums" | "artists" | "playlists"

export type PopularItem = {
  type: PopularItemType
  id: string | number
  title: string
  artistName?: string
}

export type Track = {
  id: number
  title: string
  artistName: string
  albumTitle?: string
  durationSeconds?: number
  albumCoverUrl?: string
}

export type StreamInfo = {
  url: string
  mimeType?: string
  formatId: number
}

export type SearchResult = {
  mostPopular: PopularItem[]
}

export type QobuzCredentials = {
  appId: string
  appSecret: string
  token: string
}

export class QobuzError extends Error {
  readonly status?: number
  readonly kind: "auth" | "network" | "unknown"

  constructor(message: string, options?: { status?: number; kind?: "auth" | "network" | "unknown" }) {
    super(message)
    this.name = "QobuzError"
    this.status = options?.status
    this.kind = options?.kind ?? "unknown"
  }

  static isAuthError(err: unknown): boolean {
    return err instanceof QobuzError && err.kind === "auth"
  }
}

export interface QobuzClient {
  search(query: string, limit?: number): Promise<SearchResult>
  expandToTracks(item: PopularItem): Promise<Track[]>
  getStreamUrl(trackId: number, formatId?: number): Promise<StreamInfo>
}

export type ParsedQobuzUrl =
  | { type: "tracks"; id: number }
  | { type: "albums"; id: number }
  | { type: "artists"; id: number }
  | { type: "playlists"; id: number }
