import { createHash } from "crypto"
import { spawn } from "child_process"
import { config } from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { fetchAppId } from "@kud/qobuz"

const __dir = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dir, "../../.env") })

const QOBUZ_BASE_URL = "https://www.qobuz.com/api.json/0.2"
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

/** Tracks from search spike — known-good IDs */
const TRACKS = [
  { id: 54091881, label: "Queen – Bohemian Rhapsody" },
  { id: 33933680, label: "Radiohead – Creep" },
]

const FORMATS = [
  { id: 6, label: "FLAC 16/44.1" },
  { id: 5, label: "MP3 320" },
]

const token = process.env.QOBUZ_USER_TOKEN
if (!token) {
  console.error("Missing QOBUZ_USER_TOKEN in .env")
  process.exit(1)
}

function signTrackFileUrl(formatId, trackId, requestTs, appSecret) {
  const input = `trackgetFileUrlformat_id${formatId}intentstreamtrack_id${trackId}${requestTs}${appSecret}`
  return createHash("md5").update(input).digest("hex")
}

function deriveSecretsFromBundle(bundle) {
  const seeds = {}
  for (const m of bundle.matchAll(
    /[a-z]\.initialSeed\("([^"]+)",window\.utimezone\.([a-z]+)\)/g
  )) {
    seeds[m[2]] = [m[1]]
  }

  const timezones = Object.keys(seeds)
  if (timezones.length < 2) return []

  // Match onthespot ordering: move second timezone to front before pairing info/extras
  const ordered = [...timezones]
  const second = ordered.splice(1, 1)[0]
  ordered.unshift(second)

  const tzPattern = ordered.map((tz) => tz.charAt(0).toUpperCase() + tz.slice(1)).join("|")
  const infoExtrasRe = new RegExp(
    `name:"\\w+/(${tzPattern})",info:"([^"]+)",extras:"([^"]+)"`,
    "g"
  )

  for (const m of bundle.matchAll(infoExtrasRe)) {
    const tz = m[1].toLowerCase()
    if (seeds[tz]) seeds[tz].push(m[2], m[3])
  }

  const derived = []
  for (const [tz, parts] of Object.entries(seeds)) {
    if (parts.length < 3) continue
    try {
      const decoded = Buffer.from(parts.join("").slice(0, -44), "base64").toString("utf8")
      if (/^[0-9a-f]{32}$/.test(decoded)) derived.push({ tz, secret: decoded })
    } catch {
      // skip invalid derivation
    }
  }
  return derived
}

async function fetchAppCredentials() {
  if (process.env.QOBUZ_APP_ID && process.env.QOBUZ_APP_SECRET) {
    return {
      appId: process.env.QOBUZ_APP_ID,
      appSecret: process.env.QOBUZ_APP_SECRET,
      source: "env",
    }
  }

  const { appId, bundlePath } = await fetchAppId()
  const res = await fetch(`https://play.qobuz.com${bundlePath}`, {
    headers: { "User-Agent": USER_AGENT },
  })
  if (!res.ok) throw new Error(`bundle fetch failed (${res.status})`)
  const bundle = await res.text()

  const derived = deriveSecretsFromBundle(bundle)
  if (derived.length === 0) {
    throw new Error(
      "could not derive app_secret from bundle — set QOBUZ_APP_SECRET in .env"
    )
  }

  // Probe each derived secret; token is bound to the working app_id/secret pair
  const probeTrackId = TRACKS[0].id
  for (const { tz, secret } of derived) {
    try {
      await getFileUrl({
        appId,
        appSecret: secret,
        token,
        trackId: probeTrackId,
        formatId: 6,
      })
      return { appId, appSecret: secret, source: `bundle (${tz})` }
    } catch {
      // try next secret
    }
  }

  throw new Error(
    "no derived app_secret worked with current token — refresh QOBUZ_USER_TOKEN from browser"
  )
}

async function getFileUrl({ appId, appSecret, token, trackId, formatId }) {
  const requestTs = String(Math.floor(Date.now() / 1000))
  const requestSig = signTrackFileUrl(formatId, trackId, requestTs, appSecret)

  const params = new URLSearchParams({
    app_id: appId,
    track_id: String(trackId),
    format_id: String(formatId),
    intent: "stream",
    request_ts: requestTs,
    request_sig: requestSig,
  })

  const res = await fetch(`${QOBUZ_BASE_URL}/track/getFileUrl?${params}`, {
    headers: {
      "User-Agent": USER_AGENT,
      "X-App-Id": appId,
      "X-User-Auth-Token": token,
    },
  })

  const body = await res.text()
  if (!res.ok) {
    throw new Error(`getFileUrl failed (${res.status}): ${body.slice(0, 300)}`)
  }

  return JSON.parse(body)
}

function ffmpegProbe(url, seconds = 5) {
  return new Promise((resolve) => {
    const proc = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        url,
        "-t",
        String(seconds),
        "-f",
        "null",
        "-",
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    )

    let stderr = ""
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    proc.on("close", (code) => {
      resolve({ ok: code === 0, code, stderr: stderr.trim() })
    })
  })
}

console.log("Qobuz stream URL spike")
console.log(`date: ${new Date().toISOString()}`)
console.log()

const creds = await fetchAppCredentials()
console.log(`app_id: ${creds.appId} (from ${creds.source})`)
console.log(`app_secret: ${creds.appSecret.slice(0, 4)}…${creds.appSecret.slice(-4)} (32 chars)`)
console.log()
console.log("@kud/qobuz stream signing: no — custom MD5 signing required")
console.log()

const results = []

for (const track of TRACKS) {
  console.log("=".repeat(70))
  console.log(`TRACK: ${track.label} (id ${track.id})`)
  console.log()

  for (const format of FORMATS) {
    process.stdout.write(`  format ${format.id} (${format.label}): `)

    try {
      const file = await getFileUrl({
        ...creds,
        token,
        trackId: track.id,
        formatId: format.id,
      })

      const url = file.url
      if (!url) {
        console.log("FAIL — no url in response")
        results.push({ track: track.label, format: format.id, ok: false, error: "no url" })
        continue
      }

      const host = new URL(url).hostname
      const mime = file.mime_type ?? "?"
      const bitDepth = file.bit_depth ?? "?"
      const sampling = file.sampling_rate ?? "?"

      const probe = await ffmpegProbe(url)
      if (probe.ok) {
        console.log(`PASS — ${host}, ${mime}, ${bitDepth}-bit/${sampling}kHz, ffmpeg OK`)
        results.push({
          track: track.label,
          format: format.id,
          ok: true,
          host,
          mime,
          bitDepth,
          sampling,
        })
      } else {
        console.log(`FAIL — got URL but ffmpeg error (code ${probe.code})`)
        if (probe.stderr) console.log(`    ${probe.stderr.slice(0, 200)}`)
        results.push({
          track: track.label,
          format: format.id,
          ok: false,
          error: probe.stderr.slice(0, 200) || `ffmpeg exit ${probe.code}`,
        })
      }
    } catch (err) {
      console.log(`FAIL — ${err.message}`)
      results.push({ track: track.label, format: format.id, ok: false, error: err.message })
    }
  }

  console.log()
}

console.log("=".repeat(70))
console.log("STREAM SPIKE SUMMARY")
console.log()

const passed = results.filter((r) => r.ok)
const failed = results.filter((r) => !r.ok)

for (const r of results) {
  const status = r.ok ? "PASS" : "FAIL"
  const detail = r.ok
    ? `${r.mime}, ffmpeg OK`
    : r.error?.slice(0, 80) ?? "unknown"
  console.log(`  [${status}] ${r.track} / format ${r.format}: ${detail}`)
}

console.log()
console.log(`Total: ${passed.length}/${results.length} passed`)
console.log()
console.log("Recommendations for bot:")
console.log("  - Use format 5 (MP3 320) for Discord voice — less CPU than FLAC transcode")
console.log("  - Derive app_secret from bundle seeds (direct appSecret field does NOT work)")
console.log("  - Probe derived secrets at startup to find pair matching user token")
console.log("  - Fetch CDN URL immediately before playback (URLs expire)")
console.log("  - Implement signing in src/qobuz/stream.ts (~80 lines incl. secret derivation)")

if (failed.length > 0) process.exit(1)
