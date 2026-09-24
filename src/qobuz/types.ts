import type { Track } from "../player/track.js"

export type { Track }

export type PopularItemType = "tracks" | "albums" | "artists" | "playlists"

export type PopularItem = {
  type: PopularItemType
  id: string | number
  title: string
  artistName?: string
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

export type QobuzErrorKind =
  | "auth"
  | "signature"
  | "network"
  | "not_configured"
  | "unavailable"
  | "unknown"

export class QobuzError extends Error {
  readonly status?: number
  readonly kind: QobuzErrorKind

  constructor(message: string, options?: { status?: number; kind?: QobuzErrorKind }) {
    super(message)
    this.name = "QobuzError"
    this.status = options?.status
    this.kind = options?.kind ?? "unknown"
  }

  static isAuthError(err: unknown): boolean {
    return err instanceof QobuzError && err.kind === "auth"
  }

  static isSignatureError(err: unknown): boolean {
    return err instanceof QobuzError && err.kind === "signature"
  }

  static isNetworkError(err: unknown): boolean {
    return err instanceof QobuzError && err.kind === "network"
  }

  static isNotConfigured(err: unknown): boolean {
    return err instanceof QobuzError && err.kind === "not_configured"
  }

  static isUnavailable(err: unknown): boolean {
    return err instanceof QobuzError && err.kind === "unavailable"
  }
}

export type QobuzCredentialInput = {
  userToken?: string
  appId?: string
  appSecret?: string
}

export type QobuzStatus =
  | { state: "ready"; appId: string; secretSource: "configured" | "derived" }
  | { state: "not_configured" }
  | { state: "token_invalid"; detail: string }
  | { state: "secret_invalid"; detail: string }
  | { state: "unreachable"; detail: string }
  | { state: "error"; detail: string }

export interface QobuzClient {
  search(query: string, limit?: number): Promise<SearchResult>
  resolveUrlItem(url: string): Promise<PopularItem | null>
  expandToTracks(item: PopularItem): Promise<Track[]>
  getStreamUrl(trackId: number, formatId?: number): Promise<StreamInfo>
}

export type ParsedQobuzUrl =
  | { type: "tracks"; id: number }
  | { type: "albums"; id: string | number }
  | { type: "artists"; id: number }
  | { type: "playlists"; id: number }
