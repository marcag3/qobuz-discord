import { config } from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { connect, createMemoryStore, createTransport } from "@kud/qobuz"

const __dir = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dir, "../../.env") })

const token = process.env.QOBUZ_USER_TOKEN
if (!token) {
  console.error("Missing QOBUZ_USER_TOKEN in .env")
  process.exit(1)
}

/** Test cases from SPIKES.md + handoff.md */
const CASES = [
  {
    query: "lane 8",
    expected: { artist: "lane 8", titleHint: "disappear" },
    wrongAt1: "strobe",
    trackId: 424991621,
  },
  {
    query: "and we knew it was our time",
    expected: { artist: "lane 8", titleHint: "and we knew" },
    trackId: 424950499,
  },
  {
    query: "and we knew it was ",
    expected: { artist: "lane 8", titleHint: "and we knew" },
    trackId: 424950499,
  },
  {
    query: "bohemian rhapsody",
    expected: { artist: "queen", titleHint: "bohemian" },
    trackId: 54091881,
  },
  {
    query: "radiohead creep",
    expected: { artist: "radiohead", titleHint: "creep" },
    trackId: 33933680,
  },
]

function unwrapPopular(item) {
  if (!item) return null
  if (item.content) return { ...item.content, wrapperType: item.type }
  return item
}

function fmtRawTrack(t, i) {
  const artist = t.performer?.name ?? t.artist?.name ?? "?"
  return `${String(i + 1).padStart(2)}. ${t.title} — ${artist} (id: ${t.id})`
}

function fmtPopular(item, i) {
  const t = unwrapPopular(item)
  if (!t) return `${String(i + 1).padStart(2)}. (empty)`
  const type = item.type ?? t.type ?? "?"
  const artist = t.performer?.name ?? t.artist?.name ?? "?"
  const title = t.title ?? t.name ?? "?"
  return `${String(i + 1).padStart(2)}. [${type}] ${title} — ${artist} (id: ${t.id})`
}

function findTrackPosition(tracks, { artist, titleHint, trackId }) {
  const idx = tracks.findIndex((t) => {
    if (trackId && t.id === trackId) return true
    const a = (t.performer?.name ?? t.artist?.name ?? "").toLowerCase()
    const title = (t.title ?? "").toLowerCase()
    if (artist && !a.includes(artist.toLowerCase())) return false
    if (titleHint && !title.includes(titleHint.toLowerCase())) return false
    return artist || titleHint
  })
  return idx === -1 ? null : idx + 1
}

function firstPopularTrack(items) {
  for (const item of items) {
    const t = unwrapPopular(item)
    if ((item.type ?? t?.type) === "tracks" && t?.id) return t
  }
  return null
}

const store = createMemoryStore()
await connect({ token, store })
const creds = await store.load()
const transport = createTransport({ appId: creds.appId, token })

console.log("Qobuz search spike (tracks vs most_popular)")
console.log(`app_id: ${creds.appId}`)
console.log(`date: ${new Date().toISOString().slice(0, 10)}`)
console.log()
console.log("NOTE: @kud/qobuz search() only returns tracks/albums/artists — drops most_popular")
console.log()

const summary = []

for (const c of CASES) {
  console.log("=".repeat(70))
  console.log(`QUERY: ${c.query}`)
  console.log()

  const raw = await transport.get("catalog/search", { query: c.query, limit: 25 })
  const tracks = raw.tracks?.items ?? []
  const popular = raw.most_popular?.items ?? []

  console.log("most_popular (top 5):")
  popular.slice(0, 5).forEach((item, i) => console.log("  " + fmtPopular(item, i)))

  console.log()
  console.log("tracks (top 5):")
  tracks.slice(0, 5).forEach((t, i) => console.log("  " + fmtRawTrack(t, i)))

  const popularTrack = firstPopularTrack(popular)
  const posTracks = c.trackId
    ? tracks.findIndex((t) => t.id === c.trackId)
    : findTrackPosition(tracks, c.expected) - 1
  const posPopularTrack = c.trackId
    ? popular.findIndex((item) => unwrapPopular(item)?.id === c.trackId)
    : popular.findIndex(
        (item) =>
          (item.type ?? unwrapPopular(item)?.type) === "tracks" &&
          findTrackPosition([unwrapPopular(item)], c.expected)
      )

  console.log()
  if (popular[0]) {
    const top = unwrapPopular(popular[0])
    console.log(
      `#1 most_popular: [${popular[0].type}] ${top?.title ?? top?.name} — ${top?.performer?.name ?? top?.artist?.name ?? "?"}`
    )
  }
  if (popularTrack) {
    console.log(
      `First track in most_popular: ${popularTrack.title} — ${popularTrack.performer?.name ?? "?"} (id: ${popularTrack.id})`
    )
  }
  if (tracks[0]) {
    console.log(`#1 tracks: ${tracks[0].title} — ${tracks[0].performer?.name ?? "?"}`)
    if (c.wrongAt1 && tracks[0].title?.toLowerCase().includes(c.wrongAt1)) {
      console.log(`  ⚠ tracks #1 is historically wrong result`)
    }
  }

  if (c.trackId) {
    console.log(
      `Track ${c.trackId}: most_popular #${posPopularTrack === -1 ? "NOT FOUND" : posPopularTrack + 1}, tracks #${posTracks === -1 ? "NOT FOUND" : posTracks + 1}`
    )
  }

  const autoPlayTrack = popularTrack ?? tracks[0]
  const autoOk =
    c.trackId
      ? autoPlayTrack?.id === c.trackId
      : findTrackPosition([autoPlayTrack], c.expected) === 1

  console.log(`Auto-play via most_popular-first: ${autoOk ? "OK" : "WRONG — would need re-rank or picker"}`)
  console.log()

  summary.push({
    query: c.query,
    popular1: popular[0] ? fmtPopular(popular[0], 0).trim() : "none",
    tracks1: tracks[0] ? fmtRawTrack(tracks[0], 0).trim() : "none",
    autoOk,
  })
}

console.log("=".repeat(70))
console.log("SUMMARY")
console.log()
for (const s of summary) {
  console.log(`${s.query.padEnd(35)} | auto-play OK: ${s.autoOk ? "yes" : "NO"}`)
  console.log(`  most_popular #1: ${s.popular1}`)
  console.log(`  tracks #1:       ${s.tracks1}`)
}
