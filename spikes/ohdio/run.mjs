import {
  decodeSeconds,
  fetchEpisode,
  fetchPlaybackItems,
  fmtDuration,
  parseEpisodeUrl,
  probeHls,
  uniqueMediaIds,
  validateMedia,
} from "./lib.mjs"

/**
 * Catch-up playback spike (not live).
 *
 * Known (do not re-prove):
 * - GraphQL BFF https://services.radio-canada.ca/bff/audio/graphql, no account
 * - MediaNet validation/v2 → Akamai HLS
 * - Podcast test: tokenId null, no DRM
 *
 * This run: episode URL → cues + unique mediaIds + HLS + ffmpeg.
 * Premiere hours share one mediaId across several cues (use mediaSeekTime).
 */

const DEFAULT_URL =
  "https://ici.radio-canada.ca/ohdio/musique/emissions/cosmopolite/episodes/1173568/vendredi-21-aout-2026"

const pageUrl = process.argv[2] ?? DEFAULT_URL

const parsed = parseEpisodeUrl(pageUrl)
console.log("Ohdio catch-up spike (GraphQL → MediaNet HLS → ffmpeg)")
console.log(`date: ${new Date().toISOString().slice(0, 10)}`)
console.log(`url:  ${pageUrl}`)
if (!parsed) {
  console.error("FAIL: URL is not /ohdio/{network}/emissions/{show}/episodes/{id}/...")
  process.exit(1)
}
const { episodeId } = parsed
console.log(`parse: network=${parsed.network} show=${parsed.show} episodeId=${episodeId}`)
console.log("scope: catch-up only (live is a separate script: node live.mjs)")
console.log()

const episode = await fetchEpisode(episodeId)
if (episode.message || episode.__typename?.endsWith("Error")) {
  console.error("FAIL: episodeById", episode.__typename, episode.message)
  process.exit(1)
}

const header = episode.header ?? {}
console.log("=".repeat(70))
console.log(`type:       ${episode.__typename}`)
console.log(`show:       ${header.kicker ?? "?"}`)
console.log(`title:      ${header.title ?? "?"}`)
console.log(`playable:   ${header.isPlayable}`)
console.log(`duration:   ${fmtDuration(episode.duration?.durationInSeconds)}`)
console.log(`canonical:  ${episode.canonicalUrl ?? "?"}`)
console.log(`media2.id:  ${header.media2?.id ?? "(none)"}`)
console.log(`playlistItemId.mediaId: ${header.playlistItemId?.mediaId ?? "null"}`)
console.log("=".repeat(70))

const playback = await fetchPlaybackItems(episodeId)
if (playback.message || playback.__typename?.endsWith("Error")) {
  console.error("FAIL: playbackListByGlobalId", playback.__typename, playback.message)
  process.exit(1)
}

const items = playback.items ?? []
console.log()
console.log(`playback: ${playback.__typename}  cues=${items.length}`)
if (!items.length) {
  console.error("FAIL: no playback items")
  process.exit(1)
}

const results = []
for (const item of items) {
  const mediaId = item.mediaPlaybackItem?.mediaId
  const seek = item.mediaPlaybackItem?.mediaSeekTime ?? 0
  const appCode = item.appCode || "medianet"
  console.log()
  console.log("-".repeat(70))
  console.log(
    `item[${item.playlistItemIndex}] ${item.__typename}  ${item.title}  (${fmtDuration(item.duration?.durationInSeconds)})`
  )
  console.log(`  audioType=${item.audioType}  appCode=${appCode}  mediaId=${mediaId}  seek=${seek}s`)
  if (!mediaId) {
    console.log("  FAIL: missing mediaId")
    results.push({ mediaId: null, probe: { ok: false }, decode: { ok: false } })
    continue
  }

  const v = await validateMedia(mediaId, appCode)
  console.log(
    `  validation errorCode=${v.errorCode} tokenId=${v.tokenId} type=${v.mediaType} akamaiTtl=${v.akamaiTtl ?? "?"}s`
  )
  if (!v.hlsUrl) {
    console.log(`  FAIL: no HLS url (${v.message})`)
    results.push({ mediaId, tokenId: v.tokenId, probe: { ok: false }, decode: { ok: false } })
    continue
  }
  console.log(`  hls: ${new URL(v.hlsUrl).host}${new URL(v.hlsUrl).pathname}`)

  const probe = await probeHls(v.hlsUrl)
  console.log(
    `  ffprobe: ${probe.ok ? "PASS" : "FAIL"}  format=${probe.format}  ${fmtDuration(probe.duration)}  ${probe.codec} ${probe.sampleRate}Hz ${probe.channels}ch`
  )
  if (probe.err) console.log(`  ffprobe err: ${probe.err}`)

  const decode = await decodeSeconds(v.hlsUrl, 3)
  console.log(`  ffmpeg -t 3: ${decode.ok ? "PASS" : "FAIL"}  ${decode.lastTime ?? ""} exit=${decode.code}`)
  if (decode.errors.length) console.log(`  ffmpeg: ${decode.errors.join(" | ")}`)

  results.push({ mediaId, tokenId: v.tokenId, akamaiTtl: v.akamaiTtl, seek, probe, decode, hlsUrl: v.hlsUrl })
}

const files = uniqueMediaIds(items)
console.log()
console.log("=".repeat(70))
console.log("UNIQUE FILES (queue these, not every cue)")
for (const [i, f] of files.entries()) {
  const cueList = f.cues
    .map((c) => `seek=${c.mediaPlaybackItem?.mediaSeekTime ?? 0}s ${c.title}`)
    .join(" | ")
  console.log(`  [${i}] mediaId=${f.mediaId}  cues=${f.cues.length}  ${cueList}`)
}

const seekCue = items.find((it) => (it.mediaPlaybackItem?.mediaSeekTime ?? 0) > 0)
if (seekCue) {
  const mediaId = seekCue.mediaPlaybackItem.mediaId
  const seek = seekCue.mediaPlaybackItem.mediaSeekTime
  const row = results.find((r) => r.mediaId === mediaId && r.hlsUrl)
  if (row?.hlsUrl) {
    const seeked = await decodeSeconds(row.hlsUrl, 2, seek)
    console.log()
    console.log(
      `cue seek probe: ffmpeg -ss ${seek} -t 2 mediaId=${mediaId}: ${seeked.ok ? "PASS" : "FAIL"}  ${seeked.lastTime ?? ""}`
    )
    if (seeked.errors.length) console.log(`  ffmpeg: ${seeked.errors.join(" | ")}`)
  }
}

const ok = results.filter((r) => r.probe.ok && r.decode.ok).length
console.log()
console.log("=".repeat(70))
console.log("SUMMARY")
console.log(`  GraphQL episodeById:     PASS (${episode.__typename})`)
console.log(`  GraphQL playback list:   ${items.length} cue(s), ${files.length} unique mediaId(s)`)
console.log(`  HLS + ffmpeg:            ${ok}/${results.length} cues`)
console.log(
  `  DRM:                     tokenId=${[...new Set(results.map((r) => r.tokenId))].join(",") || "?"} (null = none, 1 = Akamai hdnea not Widevine)`
)
console.log(`  Fetch URL just-in-time:  Akamai hdnea TTL ~${results[0]?.akamaiTtl ?? "?"}s`)
console.log("=".repeat(70))

if (ok !== results.length) process.exit(1)
