import { createHash } from "node:crypto"
import { fetchAppId } from "@kud/qobuz"
import { QOBUZ_BASE_URL, QOBUZ_USER_AGENT } from "./constants.js"
import { toQobuzError } from "./auth.js"
import { assertAllowedStreamUrl } from "./stream-url.js"
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

export type BundleInfo = { appId: string; bundlePath: string }

export type ResolvedAppCredentials = {
  appId: string
  appSecret: string
  secretSource: "configured" | "derived"
}

export type ResolveAppCredentialsOptions = {
  getBundleInfo?: () => Promise<BundleInfo>
  fetchBundle?: (bundlePath: string) => Promise<string>
  probe?: (creds: QobuzCredentials) => Promise<unknown>
}

// Must be a track that returns a stream URL for this account (54091881 is sample-restricted).
const PROBE_TRACK_ID = 39_696_138

export async function fetchBundleInfo(): Promise<BundleInfo> {
  try {
    return await fetchAppId()
  } catch (err) {
    throw toQobuzError(err, "Failed to load the Qobuz web player")
  }
}

async function fetchBundle(bundlePath: string): Promise<string> {
  let res: Response
  try {
    res = await fetch(`https://play.qobuz.com${bundlePath}`, {
      headers: { "User-Agent": QOBUZ_USER_AGENT },
    })
  } catch (err) {
    throw toQobuzError(err, "Network error fetching Qobuz bundle")
  }
  if (!res.ok) {
    throw new QobuzError(`Qobuz bundle fetch failed (${res.status})`, { status: res.status })
  }
  return res.text()
}

function probeSecret(creds: QobuzCredentials): Promise<StreamInfo> {
  return fetchStreamUrl({ ...creds, trackId: PROBE_TRACK_ID, formatId: 5 })
}

export async function resolveAppCredentials(
  input: { token: string; appId?: string; appSecret?: string },
  options: ResolveAppCredentialsOptions = {}
): Promise<ResolvedAppCredentials> {
  const getBundleInfo = options.getBundleInfo ?? fetchBundleInfo
  const loadBundle = options.fetchBundle ?? fetchBundle
  const probe = options.probe ?? probeSecret
  const { token } = input

  let configuredRejected = false
  if (input.appSecret) {
    const appId = input.appId ?? (await getBundleInfo()).appId
    try {
      await probe({ appId, appSecret: input.appSecret, token })
      return { appId, appSecret: input.appSecret, secretSource: "configured" }
    } catch (err) {
      const error = toQobuzError(err, "Configured Qobuz app secret failed")
      if (!QobuzError.isSignatureError(error)) throw error
      configuredRejected = true
      console.warn("Configured Qobuz app secret was rejected; trying secrets derived from the web bundle")
    }
  }

  const { appId, bundlePath } = await getBundleInfo()
  const derived = deriveSecretsFromBundle(await loadBundle(bundlePath))
  if (derived.length === 0) {
    throw new QobuzError("Could not derive an app secret from the Qobuz web bundle", {
      kind: "signature",
    })
  }

  let otherFailure: QobuzError | undefined
  for (const { secret } of derived) {
    try {
      await probe({ appId, appSecret: secret, token })
      return { appId, appSecret: secret, secretSource: "derived" }
    } catch (err) {
      const error = toQobuzError(err, "Qobuz stream probe failed")
      if (QobuzError.isAuthError(error) || QobuzError.isNetworkError(error)) throw error
      if (!QobuzError.isSignatureError(error)) otherFailure = error
    }
  }

  if (otherFailure) throw otherFailure
  throw new QobuzError(
    configuredRejected
      ? "Qobuz rejected the configured app secret and every secret derived from the web bundle"
      : "Qobuz rejected every app secret derived from the web bundle",
    { kind: "signature", status: 400 }
  )
}

export function isSignatureRejection(status: number, body: string): boolean {
  return status === 400 && /request_sig|signature/i.test(body)
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
    const kind =
      res.status === 401 ? "auth" : isSignatureRejection(res.status, body) ? "signature" : "unknown"
    console.error(`getFileUrl failed (${res.status}):`, body.slice(0, 200))
    throw new QobuzError("Failed to fetch stream URL", {
      status: res.status,
      kind,
    })
  }

  const parsed = JSON.parse(body) as {
    url?: string
    mime_type?: string
    restrictions?: Array<{ code?: string }>
  }
  if (!parsed.url) {
    const restricted = parsed.restrictions?.some((r) => r.code?.includes("Restricted"))
    throw new QobuzError(
      restricted ? "Track is not streamable for this account" : "Qobuz returned no stream URL",
      { status: res.status, kind: restricted ? "unknown" : "unknown" }
    )
  }

  assertAllowedStreamUrl(parsed.url)

  return {
    url: parsed.url,
    mimeType: parsed.mime_type,
    formatId: creds.formatId,
  }
}
