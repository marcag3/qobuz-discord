import type { StreamInfo } from "../player/stream.js"
import type { Track } from "../player/track.js"
import {
  APP_CODE,
  CONTENT_TYPE,
  DEFAULT_REGION_ID,
  MAX_OHDIO_TRACKS,
  PROGRAMME_EPISODE_PAGE_SIZE,
} from "./constants.js"
import { OhdioError } from "./errors.js"
import { graphql, isGraphqlError } from "./graphql.js"
import { liveTrackFromStation, isStrongLiveMatch, resolveLiveStation } from "./live.js"
import { filesToTracks, uniqueMediaIds } from "./playback.js"
import { validateMedia } from "./stream.js"
import type { OhdioCard, OhdioKind, OhdioSearchItem, ParsedOhdio, PlaybackCue } from "./types.js"
import { contentTypeToKind, stripHtml } from "./types.js"
import { formatOhdioToken, parseOhdioInput } from "./url.js"

const CARD_SELECTION = `
  __typename
  ... on Card {
    title
    url
    isPlayable
    mediaId
    kicker
    subtitle
    contentGlobalId { id contentType { id name } }
  }
`

const PLAYBACK_ITEM_SELECTION = `
  __typename
  ... on PlaybackListItem {
    title
    subtitle
    productTitle
    appCode
    audioType
    playlistItemIndex
    mediaPlaybackItem { mediaId mediaSeekTime }
    picture { url }
  }
`

const PLAYBACK_LIST_SELECTION = `
  __typename
  ... on PlaybackListAudiobook { currentIndex items { ${PLAYBACK_ITEM_SELECTION} } }
  ... on PlaybackListClip { currentIndex items { ${PLAYBACK_ITEM_SELECTION} } }
  ... on PlaybackListEpisodeBalado { currentIndex items { ${PLAYBACK_ITEM_SELECTION} } }
  ... on PlaybackListEpisodeGrandesSeries { currentIndex items { ${PLAYBACK_ITEM_SELECTION} } }
  ... on PlaybackListEpisodeMusique { currentIndex items { ${PLAYBACK_ITEM_SELECTION} } }
  ... on PlaybackListEpisodePremiere { currentIndex items { ${PLAYBACK_ITEM_SELECTION} } }
  ... on PlaybackListEpisodeVideo { currentIndex items { ${PLAYBACK_ITEM_SELECTION} } }
  ... on PlaybackListWebradio { currentIndex items { ${PLAYBACK_ITEM_SELECTION} } }
  ... on NotFoundError { message }
  ... on InvalidArgumentError { message }
`

const PROGRAMME_SELECTION = `
  id
  canonicalUrl
  header { title kicker isPlayable picture { url } }
  content {
    contentDetail {
      items { ${CARD_SELECTION} }
    }
  }
`

const EPISODE_SELECTION = `
  canonicalUrl
  header {
    title
    kicker
    isPlayable
    picture { url }
    media2 { id title }
  }
`

type Header = {
  title?: string | null
  kicker?: string | null
  isPlayable?: boolean | null
  picture?: { url?: string | null } | null
  media2?: { id?: string | null; title?: string | null } | null
}

type ProgrammePayload = {
  __typename?: string
  message?: string
  id?: number
  canonicalUrl?: string | null
  header?: Header | null
  content?: { contentDetail?: { items?: OhdioCard[] | null } | null } | null
}

type EpisodePayload = {
  __typename?: string
  message?: string
  canonicalUrl?: string | null
  header?: Header | null
}

type PlaybackPayload = {
  __typename?: string
  message?: string
  items?: PlaybackCue[] | null
}

export type OhdioClientOptions = {
  regionId?: number
}

export class OhdioClient {
  private readonly regionId: number

  constructor(options: OhdioClientOptions = {}) {
    this.regionId = options.regionId ?? DEFAULT_REGION_ID
  }

  async expandFromQuery(query: string): Promise<Track[]> {
    const parsed = parseOhdioInput(query)
    if (parsed) return this.expandParsed(parsed)

    try {
      const station = await resolveLiveStation(query, this.regionId)
      if (isStrongLiveMatch(station, query)) {
        return [liveTrackFromStation(station)]
      }
    } catch {
      // fall through to catalog search
    }

    const results = await this.search(query)
    const top = results[0]
    if (top) return this.expandSearchItem(top)

    try {
      return [liveTrackFromStation(await resolveLiveStation(query, this.regionId))]
    } catch {
      return []
    }
  }

  async search(query: string, limit = 25): Promise<OhdioSearchItem[]> {
    const data = await graphql<{
      searchPage: {
        __typename?: string
        message?: string
        isEmptySearch?: boolean
        superLineup?: {
          lineups?: Array<{ title?: string | null; items?: OhdioCard[] | null } | null> | null
        } | null
      }
    }>(
      "SearchPage",
      `query SearchPage($params: SearchPageInput!) {
        searchPage(params: $params) {
          __typename
          ... on SearchPage {
            isEmptySearch
            superLineup {
              lineups {
                title
                items { ${CARD_SELECTION} }
              }
            }
          }
          ... on PageError { message }
        }
      }`,
      { params: { query, numProducts: limit, numEpisodes: limit } }
    )

    const page = data.searchPage
    if (!page || isGraphqlError(page) || page.isEmptySearch) return []

    const items: OhdioSearchItem[] = []
    for (const lineup of page.superLineup?.lineups ?? []) {
      for (const card of lineup?.items ?? []) {
        const mapped = cardToSearchItem(card)
        if (mapped) items.push(mapped)
        if (items.length >= limit) return items
      }
    }
    return items
  }

  async autocomplete(query: string): Promise<OhdioSearchItem[]> {
    const parsed = parseOhdioInput(query)
    if (parsed?.kind === "live" || parsed) {
      if (parsed.kind === "live") {
        const station = await resolveLiveStation(parsed.id, this.regionId)
        return [
          {
            kind: "live",
            id: station.callSign,
            title: station.networkTitle,
            subtitle: station.onAir?.title,
            url: station.onAir?.url ?? undefined,
          },
        ]
      }
      const tracks = await this.expandParsed(parsed)
      const first = tracks[0]
      if (!first) return []
      return [
        {
          kind: parsed.kind,
          id: parsed.id,
          title: first.title,
          subtitle: first.artistName,
          url: first.url,
        },
      ]
    }

    const results = await this.search(query, 20)
    const programmes = results.filter((item) => item.kind === "programme")
    const rest = results.filter((item) => item.kind !== "programme")
    const choices: OhdioSearchItem[] = [...programmes]

    try {
      const station = await resolveLiveStation(query, this.regionId)
      if (isStrongLiveMatch(station, query)) {
        const liveItem: OhdioSearchItem = {
          kind: "live",
          id: station.callSign,
          title: station.networkTitle,
          subtitle: station.onAir?.title,
          url: station.onAir?.url ?? undefined,
        }
        if (!choices.some((item) => item.kind === "live" && item.id === liveItem.id)) {
          choices.unshift(liveItem)
        }
      }
    } catch {
      // not a live station query
    }

    const programme = programmes[0]
    if (programme && choices.length < 25) {
      try {
        const episodes = await this.listProgrammeEpisodes(programme.id)
        for (const episode of episodes) {
          if (choices.some((item) => item.kind === episode.kind && item.id === episode.id)) continue
          choices.push(episode)
          if (choices.length >= 25) break
        }
      } catch {
        // show without a public episode list
      }
    }

    for (const item of rest) {
      if (choices.length >= 25) break
      if (choices.some((existing) => existing.kind === item.kind && existing.id === item.id)) continue
      choices.push(item)
    }
    return choices.slice(0, 25)
  }

  async expandSearchItem(item: OhdioSearchItem): Promise<Track[]> {
    return this.expandParsed({ kind: item.kind, id: item.id })
  }

  async getStreamUrl(track: Track): Promise<StreamInfo> {
    const appCode = track.appCode || (track.infinite ? APP_CODE.live : APP_CODE.catchup)
    const mediaId = track.infinite ? track.id.replace(/^live:/, "") : track.id
    const stream = await validateMedia(mediaId, appCode)
    return { ...stream, seekSeconds: track.seekSeconds }
  }

  async refreshTrack(track: Track): Promise<Track> {
    if (!track.infinite) return track
    const callSign = track.id.replace(/^live:/, "")
    const station = await resolveLiveStation(callSign, this.regionId)
    const next = liveTrackFromStation(station)
    return {
      ...track,
      title: next.title,
      artistName: next.artistName,
      url: next.url ?? track.url,
    }
  }

  private async expandParsed(parsed: ParsedOhdio): Promise<Track[]> {
    switch (parsed.kind) {
      case "live":
        return [liveTrackFromStation(await resolveLiveStation(parsed.id, this.regionId))]
      case "episode":
        return this.expandPlayback(parsed.id, CONTENT_TYPE.episode)
      case "clip":
        return this.expandPlayback(parsed.id, CONTENT_TYPE.clip)
      case "audiobook":
        return this.expandPlayback(parsed.id, CONTENT_TYPE.audiobook)
      case "programme":
        return this.expandProgramme(parsed.id)
      case "playlist":
        return this.expandPlaylist(parsed.id)
    }
  }

  private async expandPlaylist(id: string): Promise<Track[]> {
    const data = await graphql<{
      playlist: {
        __typename?: string
        message?: string
        cards?: OhdioCard[] | null
      }
    }>(
      "Playlist",
      `query Playlist($params: PlaylistInput) {
        playlist(params: $params) {
          __typename
          ... on Playlist {
            cards { ${CARD_SELECTION} }
          }
          ... on PageError { message }
        }
      }`,
      { params: { id } }
    )
    const playlist = unwrapPayload(data.playlist, "playlist")
    const tracks: Track[] = []
    for (const card of playlist.cards ?? []) {
      const item = cardToSearchItem(card)
      if (!item) continue
      try {
        const expanded =
          item.kind === "programme"
            ? await this.expandProgramme(item.id)
            : await this.expandPlayback(item.id, item.contentTypeId ?? CONTENT_TYPE.episode)
        tracks.push(...expanded)
      } catch {
        if (item.mediaId) {
          tracks.push(
            ...filesToTracks(
              [{ mediaId: item.mediaId, appCode: APP_CODE.catchup, cues: [{ title: item.title }] }],
              { title: item.title, show: item.subtitle }
            )
          )
        }
      }
      if (tracks.length >= MAX_OHDIO_TRACKS) break
    }
    if (tracks.length === 0) {
      throw OhdioError.notFound("No playable items on that Ohdio playlist")
    }
    return tracks.slice(0, MAX_OHDIO_TRACKS)
  }

  private async expandProgramme(idOrSlug: string): Promise<Track[]> {
    const programme = await this.fetchProgramme(idOrSlug)
    const episode = (programme.content?.contentDetail?.items ?? []).find((card) => {
      const typeId = card.contentGlobalId?.contentType.id
      return typeId === CONTENT_TYPE.episode && card.isPlayable !== false && card.contentGlobalId?.id
    })
    if (!episode?.contentGlobalId?.id) {
      throw OhdioError.notFound("No playable episode on that Ohdio show")
    }
    return this.expandPlayback(episode.contentGlobalId.id, CONTENT_TYPE.episode)
  }

  async listProgrammeEpisodes(idOrSlug: string): Promise<OhdioSearchItem[]> {
    const programme = await this.fetchProgramme(idOrSlug)
    const items: OhdioSearchItem[] = []
    for (const card of programme.content?.contentDetail?.items ?? []) {
      const mapped = cardToSearchItem(card)
      if (mapped?.kind === "episode") items.push(mapped)
    }
    return items
  }

  private async fetchProgramme(idOrSlug: string): Promise<ProgrammePayload> {
    if (/^\d+$/.test(idOrSlug)) {
      const data = await graphql<{ programmeById: ProgrammePayload }>(
        "ProgrammeById",
        `query ProgrammeById($params: ProgrammeByIdInput!) {
          programmeById(params: $params) {
            __typename
            ... on EmissionPremiere { ${PROGRAMME_SELECTION} }
            ... on EmissionMusique { ${PROGRAMME_SELECTION} }
            ... on EmissionBalado { ${PROGRAMME_SELECTION} }
            ... on EmissionGrandesSeries { ${PROGRAMME_SELECTION} }
            ... on NotFoundError { message }
          }
        }`,
        {
          params: {
            id: Number(idOrSlug),
            forceWithoutCueSheet: true,
            pageSize: PROGRAMME_EPISODE_PAGE_SIZE,
          },
        }
      )
      return unwrapPayload(data.programmeById, "show")
    }

    const data = await graphql<{ programmeBySlug: ProgrammePayload }>(
      "ProgrammeBySlug",
      `query ProgrammeBySlug($params: ProgrammeBySlugInput!) {
        programmeBySlug(params: $params) {
          __typename
          ... on EmissionPremiere { ${PROGRAMME_SELECTION} }
          ... on EmissionMusique { ${PROGRAMME_SELECTION} }
          ... on EmissionBalado { ${PROGRAMME_SELECTION} }
          ... on EmissionGrandesSeries { ${PROGRAMME_SELECTION} }
          ... on NotFoundError { message }
        }
      }`,
      { params: { slug: idOrSlug, pageSize: PROGRAMME_EPISODE_PAGE_SIZE } }
    )
    return unwrapPayload(data.programmeBySlug, "show")
  }

  private async expandPlayback(id: string, contentTypeId: number): Promise<Track[]> {
    const meta = await this.playbackMeta(id, contentTypeId)
    const data = await graphql<{ playbackListByGlobalId: PlaybackPayload }>(
      "PlaybackListByGlobalId",
      `query PlaybackListByGlobalId($params: PlaybackListByGlobalIdInput!) {
        playbackListByGlobalId(params: $params) {
          ${PLAYBACK_LIST_SELECTION}
        }
      }`,
      {
        params: {
          contentTypeId,
          id: String(id),
          needNext: true,
          needPrevious: false,
          nextLimit: MAX_PLAYBACK_ITEMS,
        },
      }
    )

    const playback = data.playbackListByGlobalId
    if (!playback || isGraphqlError(playback)) {
      if (meta.fallbackMediaId) {
        return filesToTracks(
          [{ mediaId: meta.fallbackMediaId, appCode: APP_CODE.catchup, cues: [] }],
          meta
        )
      }
      throw OhdioError.notFound("No playable Ohdio audio for that item")
    }

    const files = uniqueMediaIds(playback.items ?? [])
    if (files.length === 0) {
      throw OhdioError.notFound("No playable Ohdio audio for that item")
    }
    return filesToTracks(files, meta)
  }

  private async playbackMeta(
    id: string,
    contentTypeId: number
  ): Promise<{ title: string; show?: string; url?: string; coverUrl?: string; fallbackMediaId?: string }> {
    if (contentTypeId === CONTENT_TYPE.episode) {
      const data = await graphql<{ episodeById: EpisodePayload }>(
        "EpisodeById",
        `query EpisodeById($params: EpisodeByIdInput!) {
          episodeById(params: $params) {
            __typename
            ... on EpisodeMusique { ${EPISODE_SELECTION} }
            ... on EpisodePremiere { ${EPISODE_SELECTION} }
            ... on EpisodeBalado { ${EPISODE_SELECTION} }
            ... on EpisodeGrandesSeries { ${EPISODE_SELECTION} }
            ... on NotFoundError { message }
          }
        }`,
        { params: { id: Number(id), forceWithoutCueSheet: true } }
      )
      const episode = unwrapPayload(data.episodeById, "episode")
      return {
        title: stripHtml(episode.header?.title) || `Episode ${id}`,
        show: stripHtml(episode.header?.kicker) ?? undefined,
        url: episode.canonicalUrl ?? undefined,
        coverUrl: episode.header?.picture?.url ?? undefined,
        fallbackMediaId: episode.header?.media2?.id ?? undefined,
      }
    }

    if (contentTypeId === CONTENT_TYPE.audiobook) {
      const data = await graphql<{
        audioBookById: { __typename?: string; message?: string; header?: Header | null; canonicalUrl?: string | null }
      }>(
        "AudioBookById",
        `query AudioBookById($params: AudioBookByIdInput!) {
          audioBookById(params: $params) {
            __typename
            ... on AudioBook {
              canonicalUrl
              header { title kicker isPlayable picture { url } }
            }
            ... on PageError { message }
          }
        }`,
        { params: { id: Number(id) } }
      )
      const book = unwrapPayload(data.audioBookById, "audiobook")
      return {
        title: stripHtml(book.header?.title) || `Audiobook ${id}`,
        show: stripHtml(book.header?.kicker) ?? "Livre audio",
        url: book.canonicalUrl ?? undefined,
        coverUrl: book.header?.picture?.url ?? undefined,
      }
    }

    return { title: `Ohdio ${id}` }
  }
}

const MAX_PLAYBACK_ITEMS = 40

function unwrapPayload<T extends { __typename?: string; message?: string }>(
  payload: T | null | undefined,
  label: string
): T {
  if (!payload || isGraphqlError(payload)) {
    throw OhdioError.notFound(payload?.message || `Ohdio ${label} not found`)
  }
  return payload
}

export function cardToSearchItem(card: OhdioCard): OhdioSearchItem | null {
  const globalId = card.contentGlobalId
  if (!globalId?.id) return null
  const typeId = globalId.contentType.id
  const kind =
    contentTypeToKind(typeId) ??
    (card.__typename === "CardListeEcouteMusicale" ? "playlist" : card.mediaId ? "clip" : null)
  if (!kind) return null
  return {
    kind,
    id: globalId.id,
    title: stripHtml(card.title) || globalId.id,
    subtitle: stripHtml(card.kicker) ?? stripHtml(card.subtitle),
    url: card.url ?? undefined,
    mediaId: card.mediaId ?? undefined,
    contentTypeId: typeId,
  }
}

export function searchChoice(item: OhdioSearchItem): { name: string; value: string } {
  const label = kindLabel(item.kind)
  const extra = item.subtitle ? ` — ${item.subtitle}` : ""
  return {
    name: truncate(`${label}: ${item.title}${extra}`, 100),
    value: truncate(formatOhdioToken(item.kind, item.id), 100),
  }
}

function kindLabel(kind: OhdioKind): string {
  switch (kind) {
    case "episode":
      return "Episode"
    case "programme":
      return "Show"
    case "clip":
      return "Segment"
    case "audiobook":
      return "Audiobook"
    case "live":
      return "Live"
    case "playlist":
      return "Playlist"
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

export function createOhdioClient(options: OhdioClientOptions = {}): OhdioClient {
  return new OhdioClient(options)
}
