import { QobuzError } from "./types.js"

export function isAllowedStreamUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol !== "https:") return false
  if (parsed.username || parsed.password) return false
  if (parsed.port && parsed.port !== "443") return false

  const host = parsed.hostname.toLowerCase()
  if (host === "qobuz.com" || host.endsWith(".qobuz.com")) return true
  if (host.endsWith(".akamaized.net") && host.includes("qobuz")) return true

  return false
}

export function assertAllowedStreamUrl(url: string): void {
  if (!isAllowedStreamUrl(url)) {
    throw new QobuzError("Stream URL rejected — unexpected CDN host", { kind: "unknown" })
  }
}
