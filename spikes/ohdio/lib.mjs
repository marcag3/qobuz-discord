import { spawn } from "child_process"

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

export const GRAPHQL = "https://services.radio-canada.ca/bff/audio/graphql"
export const VALIDATION = "https://services.radio-canada.ca/media/validation/v2/"
export const EPISODE_CONTENT_TYPE_ID = 18
export const DEFAULT_REGION_ID = 8 // Montréal — liveSchedules call sign cbf

export const OHDIO_EPISODE =
  /^https?:\/\/(?:ici\.)?radio-canada\.ca\/ohdio\/([^/]+)\/emissions\/([^/]+)\/episodes\/(\d+)\//i

export function graphqlHeaders(operationName) {
  return {
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
    Accept: "application/json",
    Origin: "https://ici.radio-canada.ca",
    Referer: "https://ici.radio-canada.ca/",
    "x-apollo-operation-name": operationName,
  }
}

export async function graphql(operationName, query, variables) {
  const res = await fetch(GRAPHQL, {
    method: "POST",
    headers: graphqlHeaders(operationName),
    body: JSON.stringify({ query, variables, operationName }),
  })
  const json = await res.json()
  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message).join("; ")
    throw new Error(`GraphQL ${operationName}: ${msg}`)
  }
  return json.data
}

export async function fetchEpisode(episodeId) {
  const data = await graphql(
    "EpisodeById",
    `query EpisodeById($params: EpisodeByIdInput!) {
      episodeById(params: $params) {
        __typename
        ... on EpisodeMusique {
          canonicalUrl
          header {
            title
            kicker
            isPlayable
            media2 { id title }
            playlistItemId { mediaId }
          }
          duration { durationInSeconds }
        }
        ... on EpisodePremiere {
          canonicalUrl
          header {
            title
            kicker
            isPlayable
            media2 { id title }
            playlistItemId { mediaId }
          }
          duration { durationInSeconds }
        }
        ... on EpisodeBalado {
          canonicalUrl
          header {
            title
            kicker
            isPlayable
            media2 { id title }
            playlistItemId { mediaId }
          }
          duration { durationInSeconds }
        }
        ... on NotFoundError { message }
      }
    }`,
    { params: { id: episodeId, forceWithoutCueSheet: true } }
  )
  return data.episodeById
}

export async function fetchPlaybackItems(episodeId) {
  const data = await graphql(
    "PlaybackListByGlobalId",
    `query PlaybackListByGlobalId($params: PlaybackListByGlobalIdInput!) {
      playbackListByGlobalId(params: $params) {
        __typename
        ... on PlaybackListEpisodeMusique {
          currentIndex
          items {
            __typename
            ... on PlaybackListItem {
              title
              subtitle
              productTitle
              appCode
              audioType
              playlistItemIndex
              mediaPlaybackItem { mediaId mediaSeekTime }
            }
            ... on PlaybackListItemEpisodeMusiqueClip { duration { durationInSeconds } }
            ... on PlaybackListItemEpisodeMusiqueCue { duration { durationInSeconds } }
            ... on PlaybackListItemEpisodeMusiqueMedia { duration { durationInSeconds } }
          }
        }
        ... on PlaybackListEpisodePremiere {
          currentIndex
          items {
            __typename
            ... on PlaybackListItem {
              title
              subtitle
              productTitle
              appCode
              audioType
              playlistItemIndex
              mediaPlaybackItem { mediaId mediaSeekTime }
            }
            ... on PlaybackListItemEpisodePremiereClip { duration { durationInSeconds } }
            ... on PlaybackListItemEpisodePremiereCue { duration { durationInSeconds } }
            ... on PlaybackListItemEpisodePremiereMedia { duration { durationInSeconds } }
          }
        }
        ... on PlaybackListEpisodeBalado {
          currentIndex
          items {
            __typename
            ... on PlaybackListItem {
              title
              subtitle
              productTitle
              appCode
              audioType
              playlistItemIndex
              mediaPlaybackItem { mediaId mediaSeekTime }
            }
            ... on PlaybackListItemEpisodeBalado { duration { durationInSeconds } }
          }
        }
        ... on NotFoundError { message }
        ... on InvalidArgumentError { message }
      }
    }`,
    {
      params: {
        contentTypeId: EPISODE_CONTENT_TYPE_ID,
        id: String(episodeId),
        needNext: true,
        needPrevious: false,
        nextLimit: 30,
      },
    }
  )
  return data.playbackListByGlobalId
}

export async function fetchLiveSchedules(regionId = DEFAULT_REGION_ID) {
  const data = await graphql(
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
      }
    }`,
    { params: { regionId } }
  )
  return data.liveSchedules
}

export async function validateMedia(mediaId, appCode = "medianet") {
  const url = new URL(VALIDATION)
  url.searchParams.set("appCode", appCode)
  url.searchParams.set("connectionType", "hd")
  url.searchParams.set("deviceType", "ipad")
  url.searchParams.set("idMedia", String(mediaId))
  url.searchParams.set("multibitrate", "true")
  url.searchParams.set("output", "json")
  url.searchParams.set("tech", "hls")

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  })
  const json = await res.json()
  const params = Object.fromEntries((json.params ?? []).map((p) => [p.name, p.value]))
  const hdnea = json.url ? new URL(json.url).searchParams.get("hdnea") : null
  let akamaiTtl = null
  if (hdnea) {
    const st = Number((hdnea.match(/st=(\d+)/) || [])[1])
    const exp = Number((hdnea.match(/exp=(\d+)/) || [])[1])
    if (st && exp) akamaiTtl = exp - st
  }
  return {
    errorCode: json.errorCode,
    message: json.message,
    hlsUrl: json.url,
    tokenId: params.tokenId ?? null,
    mediaType: params.mediaType ?? null,
    bitrates: json.bitrates ?? [],
    akamaiTtl,
  }
}

export function uniqueMediaIds(items) {
  const out = []
  for (const item of items) {
    const mediaId = item.mediaPlaybackItem?.mediaId
    if (!mediaId) continue
    if (out.at(-1)?.mediaId === mediaId) {
      out.at(-1).cues.push(item)
      continue
    }
    out.push({ mediaId, appCode: item.appCode || "medianet", cues: [item] })
  }
  return out
}

export function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d) => {
      stdout += d
    })
    child.stderr.on("data", (d) => {
      stderr += d
    })
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })
}

export async function probeHls(hlsUrl) {
  const { code, stdout, stderr } = await run("ffprobe", [
    "-hide_banner",
    "-v",
    "error",
    "-show_entries",
    "format=format_name,duration:stream=codec_name,codec_type,sample_rate,channels",
    "-of",
    "json",
    hlsUrl,
  ])
  let info = null
  try {
    info = JSON.parse(stdout)
  } catch {
    info = null
  }
  const audio = (info?.streams ?? []).find((s) => s.codec_type === "audio")
  return {
    ok: code === 0 && Boolean(audio),
    code,
    format: info?.format?.format_name,
    duration: Number(info?.format?.duration) || null,
    codec: audio?.codec_name ?? null,
    sampleRate: audio?.sample_rate ?? null,
    channels: audio?.channels ?? null,
    err: stderr.trim().slice(0, 300),
  }
}

export async function decodeSeconds(hlsUrl, seconds = 3, seekSeconds = 0) {
  const args = ["-hide_banner", "-y"]
  if (seekSeconds > 0) args.push("-ss", String(seekSeconds))
  args.push("-t", String(seconds), "-i", hlsUrl, "-f", "null", "-")
  const { code, stderr } = await run("ffmpeg", args)
  const lastTime = (stderr.match(/time=(\S+)/g) || []).at(-1) ?? null
  const errors = stderr
    .split("\n")
    .filter((l) => /error|fail/i.test(l) && !/Output file is empty/i.test(l))
  return { ok: code === 0, code, lastTime, errors }
}

export function createPcmStream(url, { seekSeconds = 0 } = {}) {
  const args = ["-hide_banner", "-loglevel", "error", "-re"]
  if (seekSeconds > 0) args.push("-ss", String(seekSeconds))
  args.push("-i", url, "-analyzeduration", "0", "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1")
  return spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] })
}

export function fmtDuration(seconds) {
  if (seconds == null) return "?"
  const s = Math.round(seconds)
  const m = Math.floor(s / 60)
  return `${m}m${String(s % 60).padStart(2, "0")}s (${s}s)`
}

export function parseEpisodeUrl(pageUrl) {
  const parsed = pageUrl.match(OHDIO_EPISODE)
  if (!parsed) return null
  return { network: parsed[1], show: parsed[2], episodeId: Number(parsed[3]) }
}
