import { APP_CODE, CONTENT_TYPE, OHDIO_ORIGIN } from "./constants.js"

export type OhdioKind = "episode" | "programme" | "clip" | "audiobook" | "live" | "playlist"

export type ParsedOhdio = {
  kind: OhdioKind
  id: string
}

export type OhdioCard = {
  __typename?: string
  title?: string | null
  url?: string | null
  isPlayable?: boolean | null
  mediaId?: string | null
  kicker?: string | null
  subtitle?: string | null
  contentGlobalId?: {
    id: string
    contentType: { id: number; name?: string | null }
  } | null
}

export type PlaybackCue = {
  __typename?: string
  title?: string | null
  subtitle?: string | null
  productTitle?: string | null
  appCode?: string | null
  audioType?: string | null
  playlistItemIndex?: number | null
  mediaPlaybackItem?: {
    mediaId?: string | null
    mediaSeekTime?: number | null
  } | null
  picture?: { url?: string | null } | null
}

export type OhdioSearchItem = {
  kind: OhdioKind
  id: string
  title: string
  subtitle?: string
  url?: string
  mediaId?: string
  contentTypeId?: number
}

export type LiveStation = {
  callSign: string
  networkId: number
  networkTitle: string
  onAir?: { title: string; url?: string; startTime: string; endTime: string }
}

export type UniqueMediaFile = {
  mediaId: string
  appCode: string
  cues: PlaybackCue[]
}

export function stripHtml(value?: string | null): string | undefined {
  if (!value) return undefined
  const text = value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
  return text || undefined
}

export function ohdioPageUrl(path?: string | null): string | undefined {
  if (!path) return undefined
  if (/^https?:\/\//i.test(path)) return path
  const normalized = path.startsWith("/") ? path : `/${path}`
  if (normalized.startsWith("/ohdio/")) return `${OHDIO_ORIGIN}${normalized}`
  return `${OHDIO_ORIGIN}/ohdio${normalized}`
}

export function contentTypeToKind(contentTypeId: number): OhdioKind | null {
  switch (contentTypeId) {
    case CONTENT_TYPE.episode:
      return "episode"
    case CONTENT_TYPE.programme:
      return "programme"
    case CONTENT_TYPE.clip:
      return "clip"
    case CONTENT_TYPE.audiobook:
      return "audiobook"
    default:
      return null
  }
}

export function kindAppCode(kind: OhdioKind): string {
  return kind === "live" ? APP_CODE.live : APP_CODE.catchup
}
