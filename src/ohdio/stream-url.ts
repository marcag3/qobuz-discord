import { OhdioError } from "./errors.js"

export function normalizeOhdioStreamUrl(url: string): string {
  const parsed = new URL(url)
  if (parsed.protocol === "http:") parsed.protocol = "https:"
  return parsed.toString()
}

export function isAllowedOhdioStreamUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(normalizeOhdioStreamUrl(url))
  } catch {
    return false
  }

  if (parsed.protocol !== "https:") return false
  if (parsed.username || parsed.password) return false
  if (parsed.port && parsed.port !== "443") return false

  const host = parsed.hostname.toLowerCase()
  if (host === "radio-canada.ca" || host.endsWith(".radio-canada.ca")) return true
  if (host.endsWith(".akamaized.net") && host.includes("rcav")) return true
  if (host.endsWith(".akamaihd.net") && (host.includes("rcav") || host.includes("rchds"))) return true

  return false
}

export function assertAllowedOhdioStreamUrl(url: string): void {
  if (!isAllowedOhdioStreamUrl(url)) {
    throw new OhdioError("Ohdio stream URL rejected — unexpected CDN host")
  }
}
