import { decodeSeconds, fetchLiveSchedules, fmtDuration, probeHls, validateMedia } from "./lib.mjs"

/**
 * Live ICI Première / Ohdio spike.
 *
 * Catch-up uses appCode=medianet + numeric mediaId.
 * Live uses appCode=medianetlive + station call sign from liveSchedules
 * (regionId 8 = Montréal → cbf). Call signs fail on medianet (error 34 numeric).
 */

const regionId = Number(process.env.OHDIO_REGION_ID ?? 8)
const all = process.argv.includes("--all")
const only = process.argv.slice(2).find((a) => !a.startsWith("-")) ?? "premiere"

console.log("Ohdio live spike (liveSchedules → medianetlive → HLS → ffmpeg)")
console.log(`date: ${new Date().toISOString().slice(0, 10)}`)
console.log(`regionId: ${regionId}  filter: ${all ? "all networks" : only}`)
console.log()

const schedules = await fetchLiveSchedules(regionId)
if (schedules.__typename !== "LiveSchedules" || !schedules.schedules?.length) {
  console.error("FAIL: liveSchedules", schedules.__typename)
  process.exit(1)
}

function fold(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
}

const wanted = all
  ? schedules.schedules
  : schedules.schedules.filter((s) => {
      const f = fold(only)
      return (
        fold(s.broadcastingStationCallSign) === f ||
        String(s.broadcastingNetwork?.id) === only ||
        fold(s.broadcastingNetwork?.title).includes(f)
      )
    })

if (!wanted.length) {
  console.error(
    "FAIL: no matching network. Available:",
    schedules.schedules.map((s) => `${s.broadcastingNetwork.title} (${s.broadcastingStationCallSign})`).join(", ")
  )
  process.exit(1)
}

const results = []
for (const s of wanted) {
  const callSign = s.broadcastingStationCallSign
  const network = s.broadcastingNetwork
  const onAir = s.broadcasts?.[0]
  console.log("=".repeat(70))
  console.log(`network:  ${network.title} (id=${network.id})`)
  console.log(`callSign: ${callSign}`)
  console.log(`on air:   ${onAir?.title ?? "?"}  ${onAir?.url ?? ""}`)

  const wrongApp = await validateMedia(callSign, "medianet")
  console.log(
    `  medianet + callSign:        errorCode=${wrongApp.errorCode} ${wrongApp.message ?? ""}  (expect 34 numeric)`
  )

  const live = await validateMedia(callSign, "medianetlive")
  console.log(
    `  medianetlive + callSign:    errorCode=${live.errorCode} tokenId=${live.tokenId} type=${live.mediaType} akamaiTtl=${live.akamaiTtl ?? "none"}s`
  )
  if (!live.hlsUrl) {
    console.log(`  FAIL: no HLS (${live.message})`)
    results.push({ callSign, ok: false })
    continue
  }
  const u = new URL(live.hlsUrl)
  console.log(`  hls: ${u.host}${u.pathname}`)

  const probe = await probeHls(live.hlsUrl)
  console.log(
    `  ffprobe: ${probe.ok ? "PASS" : "FAIL"}  format=${probe.format}  ${fmtDuration(probe.duration)}  ${probe.codec} ${probe.sampleRate}Hz ${probe.channels}ch`
  )
  if (probe.err) console.log(`  ffprobe err: ${probe.err}`)

  const decode = await decodeSeconds(live.hlsUrl, 3)
  console.log(`  ffmpeg -t 3: ${decode.ok ? "PASS" : "FAIL"}  ${decode.lastTime ?? ""} exit=${decode.code}`)
  if (decode.errors.length) console.log(`  ffmpeg: ${decode.errors.join(" | ")}`)

  results.push({
    callSign,
    network: network.title,
    ok: probe.ok && decode.ok,
    tokenId: live.tokenId,
    host: u.host,
  })
}

const ok = results.filter((r) => r.ok).length
console.log()
console.log("=".repeat(70))
console.log("SUMMARY")
console.log(`  liveSchedules:     PASS (${schedules.schedules.length} networks, region ${regionId})`)
console.log(`  HLS + ffmpeg:      ${ok}/${results.length}`)
for (const r of results) {
  console.log(`    ${r.ok ? "PASS" : "FAIL"}  ${r.network}  callSign=${r.callSign}  tokenId=${r.tokenId ?? "?"}  ${r.host ?? ""}`)
}
console.log("  appCode:           medianetlive (medianet rejects call signs)")
console.log("  Fetch just-in-time: live playlist has no hdnea; still resolve at play time")
console.log("=".repeat(70))

if (ok !== results.length) process.exit(1)
