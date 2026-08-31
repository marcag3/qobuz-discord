import { createHash } from "node:crypto"
import { fetchAppId } from "@kud/qobuz"
import type { AppConfig } from "../config.js"
import { QOBUZ_BASE_URL, QOBUZ_USER_AGENT } from "./constants.js"
import { toQobuzError } from "./auth.js"
import { QobuzError, type QobuzCredentials, type StreamInfo } from "./types.js"

export function signTrackFileUrl(
  formatId: number,
  trackId: number,
  requestTs: string,
  appSecret: string
): string {
  const input = `trackgetFileUrlformat_id${formatId}intentstreamtrack_id${trackId}${requestTs}${appSecret}`
  return createHash("md5").update(input).digest("hex")
}

export function deriveSecretsFromBundle(bundle: string): Array<{ tz: string; secret: string }> {
  const seeds: Record<string, string[]> = {}
  for (const match of bundle.matchAll(
    /[a-z]\.initialSeed\("([^"]+)",window\.utimezone\.([a-z]+)\)/g
  )) {
    seeds[match[2]] = [match[1]]
  }

  const timezones = Object.keys(seeds)
  if (timezones.length < 2) return []

  const ordered = [...timezones]
  const second = ordered.splice(1, 1)[0]
  ordered.unshift(second)

  const tzPattern = ordered.map((tz) => tz.charAt(0).toUpperCase() + tz.slice(1)).join("|")
  const infoExtrasRe = new RegExp(
    `name:"\\w+/(${tzPattern})",info:"([^"]+)",extras:"([^"]+)"`,
    "g"
  )

  for (const match of bundle.matchAll(infoExtrasRe)) {
    const tz = match[1].toLowerCase()
    if (seeds[tz]) seeds[tz].push(match[2], match[3])
  }

  const derived: Array<{ tz: string; secret: string }> = []
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

export async function resolveAppCredentials(
  config: AppConfig,
  probeTrackId = 54091881
): Promise<{ appId: string; appSecret: string }> {
  if (config.qobuzAppId && config.qobuzAppSecret) {
    return { appId: config.qobuzAppId, appSecret: config.qobuzAppSecret }
  }

  const { appId, bundlePath } = await fetchAppId()
  const res = await fetch(`https://play.qobuz.com${bundlePath}`, {
    headers: { "User-Agent": QOBUZ_USER_AGENT },
  })
  if (!res.ok) {
    throw toQobuzError(new Error(`bundle fetch failed (${res.status})`), "Failed to fetch Qobuz bundle")
  }

  const bundle = await res.text()
  const derived = deriveSecretsFromBundle(bundle)
  if (derived.length === 0) {
    throw toQobuzError(
      new Error("could not derive app_secret"),
      "Could not derive app_secret — set QOBUZ_APP_SECRET in .env"
    )
  }

  for (const { secret } of derived) {
    try {
      await fetchStreamUrl({
        appId,
        appSecret: secret,
        token: config.qobuzUserToken,
        trackId: probeTrackId,
        formatId: 5,
      })
      return { appId, appSecret: secret }
    } catch {
      // try next secret
    }
  }

  throw toQobuzError(
    new Error("no secret worked"),
    "No derived app_secret worked — refresh QOBUZ_USER_TOKEN from browser"
  )
}

export async function fetchStreamUrl(
  creds: QobuzCredentials & { trackId: number; formatId: number }
): Promise<StreamInfo> {
  const requestTs = String(Math.floor(Date.now() / 1000))
  const requestSig = signTrackFileUrl(creds.formatId, creds.trackId, requestTs, creds.appSecret)

  const params = new URLSearchParams({
    app_id: creds.appId,
    track_id: String(creds.trackId),
    format_id: String(creds.formatId),
    intent: "stream",
    request_ts: requestTs,
    request_sig: requestSig,
  })

  let res: Response
  try {
    res = await fetch(`${QOBUZ_BASE_URL}/track/getFileUrl?${params}`, {
      headers: {
        "User-Agent": QOBUZ_USER_AGENT,
        "X-App-Id": creds.appId,
        "X-User-Auth-Token": creds.token,
      },
    })
  } catch (err) {
    throw toQobuzError(err, "Network error fetching stream URL")
  }

  const body = await res.text()
  if (!res.ok) {
    const kind = res.status === 401 ? "auth" : "unknown"
    throw new QobuzError(`getFileUrl failed (${res.status}): ${body.slice(0, 200)}`, {
      status: res.status,
      kind,
    })
  }

  const parsed = JSON.parse(body) as { url?: string; mime_type?: string }
  if (!parsed.url) {
    throw toQobuzError(new Error("no url"), "Qobuz returned no stream URL")
  }

  return {
    url: parsed.url,
    mimeType: parsed.mime_type,
    formatId: creds.formatId,
  }
}
