import type { OhdioKind, ParsedOhdio } from "./types.js"

const TOKEN_RE = /^ohdio:(episode|programme|clip|audiobook|live|playlist):(.+)$/i

const RADIO_CANADA_HOST = /(?:^|\.)radio-canada\.ca$/i

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
}

export function parseOhdioToken(input: string): ParsedOhdio | null {
  const match = input.trim().match(TOKEN_RE)
  if (!match) return null
  return {
    kind: match[1].toLowerCase() as OhdioKind,
    id: match[2],
  }
}

export function formatOhdioToken(kind: OhdioKind, id: string): string {
  return `ohdio:${kind}:${id}`
}

export function matchLiveAlias(input: string): string | null {
  const folded = fold(input)
  if (folded === "premiere" || folded === "ici premiere") return "premiere"
  if (folded === "musique" || folded === "ici musique") return "musique"
  return null
}

function pathnameFromInput(input: string): string | null {
  const trimmed = input.trim()
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed)
      if (!RADIO_CANADA_HOST.test(url.hostname)) return null
      return url.pathname
    }
  } catch {
    return null
  }
  if (trimmed.startsWith("/")) return trimmed.split("?")[0]
  return null
}

function normalizePath(pathname: string): string {
  let path = pathname.replace(/\/+$/, "") || "/"
  path = path.replace(/^\/ohdio(?=\/|$)/i, "")
  path = path.replace(/^\/recherche\/produits(?=\/|$)/i, "")
  if (!path.startsWith("/")) path = `/${path}`
  return path
}

export function parseOhdioPath(pathname: string): ParsedOhdio | null {
  const path = normalizePath(pathname)
  const parts = path.split("/").filter(Boolean)
  if (parts.length === 0) return null

  if (parts.length === 1 && /^(premiere|musique)$/i.test(parts[0])) {
    return { kind: "live", id: parts[0].toLowerCase() }
  }

  if (parts[0] === "livres-audio" && parts[1] && /^\d+$/.test(parts[1])) {
    return { kind: "audiobook", id: parts[1] }
  }

  if (parts.some((part) => /listes?-d-?ecoute/i.test(part))) {
    const playlistId = parts.find((part) => /^\d+$/.test(part))
    if (playlistId) return { kind: "playlist", id: playlistId }
  }

  const segmentIndex = parts.indexOf("segments")
  if (segmentIndex >= 0) {
    const after = parts.slice(segmentIndex + 1)
    const clipId = after.find((part) => /^\d+$/.test(part))
    if (clipId) return { kind: "clip", id: clipId }
  }

  const episodeIndex = parts.indexOf("episodes")
  if (episodeIndex >= 0 && parts[episodeIndex + 1] && /^\d+$/.test(parts[episodeIndex + 1])) {
    return { kind: "episode", id: parts[episodeIndex + 1] }
  }

  if (parts[0] === "balados" && parts[1] && /^\d+$/.test(parts[1])) {
    if (parts[3] && /^\d+$/.test(parts[3])) {
      return { kind: "episode", id: parts[3] }
    }
    return { kind: "programme", id: parts[1] }
  }

  const emissionsIndex = parts.findIndex((part) => part === "emissions" || part === "grandes-series")
  if (emissionsIndex >= 0 && parts[emissionsIndex + 1]) {
    const next = parts[emissionsIndex + 1]
    if (/^\d+$/.test(next)) return { kind: "programme", id: next }
    return { kind: "programme", id: next }
  }

  return null
}

export function parseOhdioInput(input: string): ParsedOhdio | null {
  const trimmed = input.trim()
  const token = parseOhdioToken(trimmed)
  if (token) return token

  const alias = matchLiveAlias(trimmed)
  if (alias) return { kind: "live", id: alias }

  const pathname = pathnameFromInput(trimmed)
  if (!pathname) return null
  return parseOhdioPath(pathname)
}

export function isOhdioInput(input: string): boolean {
  return parseOhdioInput(input) !== null
}
