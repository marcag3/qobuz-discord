import type { Track } from "../player/track.js"
import { APP_CODE, DEFAULT_REGION_ID, OHDIO_ORIGIN } from "./constants.js"
import { OhdioError } from "./errors.js"
import { graphql, isGraphqlError } from "./graphql.js"
import type { LiveStation } from "./types.js"
import { ohdioPageUrl } from "./types.js"

type LiveSchedulesData = {
  liveSchedules: {
    __typename?: string
    message?: string
    schedules?: Array<{
      broadcastingNetwork?: { id?: number; title?: string | null }
      broadcastingStationCallSign?: string | null
      broadcasts?: Array<{
        title?: string | null
        url?: string | null
        startTime?: string | null
        endTime?: string | null
      } | null> | null
    } | null> | null
  }
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
}

function currentBroadcast(
  broadcasts: NonNullable<NonNullable<LiveSchedulesData["liveSchedules"]["schedules"]>[number]>["broadcasts"],
  now = Date.now()
): LiveStation["onAir"] | undefined {
  for (const broadcast of broadcasts ?? []) {
    if (!broadcast?.title || !broadcast.startTime || !broadcast.endTime) continue
    const start = Date.parse(broadcast.startTime)
    const end = Date.parse(broadcast.endTime)
    if (Number.isNaN(start) || Number.isNaN(end)) continue
    if (start <= now && now < end) {
      return {
        title: broadcast.title,
        url: broadcast.url ?? undefined,
        startTime: broadcast.startTime,
        endTime: broadcast.endTime,
      }
    }
  }
  return undefined
}

function mapStations(data: LiveSchedulesData): LiveStation[] {
  const payload = data.liveSchedules
  if (!payload || isGraphqlError(payload) || !payload.schedules?.length) return []

  const stations: LiveStation[] = []
  for (const schedule of payload.schedules) {
    const callSign = schedule?.broadcastingStationCallSign
    const networkId = schedule?.broadcastingNetwork?.id
    const networkTitle = schedule?.broadcastingNetwork?.title
    if (!callSign || networkId == null || !networkTitle) continue
    stations.push({
      callSign,
      networkId,
      networkTitle,
      onAir: currentBroadcast(schedule.broadcasts),
    })
  }
  return stations
}

export async function fetchLiveStations(regionId = DEFAULT_REGION_ID): Promise<LiveStation[]> {
  const data = await graphql<LiveSchedulesData>(
    "LiveSchedules",
    `query LiveSchedules($params: LiveSchedulesInput!) {
      liveSchedules(params: $params) {
        __typename
        ... on LiveSchedules {
          schedules {
            broadcastingNetwork { id title }
            broadcastingStationCallSign: broadcastingStationCodeName
            broadcasts { title url startTime endTime }
          }
        }
        ... on PageError { message }
      }
    }`,
    { params: { regionId } }
  )
  return mapStations(data)
}

export function isStrongLiveMatch(station: LiveStation, query: string): boolean {
  const folded = fold(query)
  if (!folded) return false
  const title = fold(station.networkTitle)
  const words = title.split(/\s+/).filter(Boolean)
  return (
    fold(station.callSign) === folded ||
    title === folded ||
    title.endsWith(` ${folded}`) ||
    words.includes(folded)
  )
}

export function matchLiveStation(stations: LiveStation[], query: string): LiveStation | undefined {
  const folded = fold(query)
  if (!folded) return undefined

  const exactCall = stations.find((station) => fold(station.callSign) === folded)
  if (exactCall) return exactCall

  if (folded === "premiere" || folded === "ici premiere") {
    return stations.find((station) => fold(station.networkTitle) === "ici premiere")
  }
  if (folded === "musique" || folded === "ici musique") {
    return stations.find((station) => fold(station.networkTitle) === "ici musique")
  }

  if (folded.length >= 4) {
    return stations.find((station) => fold(station.networkTitle).includes(folded))
  }

  return undefined
}

export function liveTrackFromStation(station: LiveStation): Track {
  const slug = fold(station.networkTitle).includes("musique") && !fold(station.networkTitle).includes("premiere")
    ? fold(station.networkTitle) === "ici musique"
      ? "musique"
      : undefined
    : fold(station.networkTitle) === "ici premiere"
      ? "premiere"
      : undefined
  const path = slug ? `/${slug}` : undefined
  return {
    id: `live:${station.callSign}`,
    source: "ohdio",
    title: station.onAir?.title ?? station.networkTitle,
    artistName: station.networkTitle,
    albumTitle: "En direct",
    url: ohdioPageUrl(station.onAir?.url) ?? (path ? `${OHDIO_ORIGIN}/ohdio${path}` : undefined),
    infinite: true,
    appCode: APP_CODE.live,
  }
}

export async function resolveLiveStation(
  query: string,
  regionId = DEFAULT_REGION_ID
): Promise<LiveStation> {
  const stations = await fetchLiveStations(regionId)
  const station = matchLiveStation(stations, query)
  if (!station) {
    throw OhdioError.notFound(`No Ohdio live station matches "${query}"`)
  }
  return station
}
