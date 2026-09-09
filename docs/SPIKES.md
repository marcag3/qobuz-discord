# Phase 0 — Spikes

Spikes are **throwaway experiments** that validate risky assumptions before building the full bot. Code in `spikes/` is not production — it exists to answer yes/no questions cheaply.

**Current status**

| Spike | Status | Owner | Doc section |
|-------|--------|-------|-------------|
| Search | **Done** — see [SPIKE_RESULTS.md](./SPIKE_RESULTS.md) | agent | [Search spike](#search-spike) |
| Auth | **Done** — see [SPIKE_RESULTS.md](./SPIKE_RESULTS.md) | agent | [Auth spike](#auth-spike) |
| Stream URL | **Done** — see [SPIKE_RESULTS.md](./SPIKE_RESULTS.md) | agent | [Stream URL spike](#stream-url-spike) |
| Discord voice | **Done** — see [SPIKE_RESULTS.md](./SPIKE_RESULTS.md) | agent | [Voice spike](#voice-spike) |
| `@kud/qobuz` evaluation | **Done** — see [SPIKE_RESULTS.md](./SPIKE_RESULTS.md) | agent | [Package spike](#package-spike) |
| Ohdio catch-up HLS | **Done** — see [SPIKE_RESULTS.md](./SPIKE_RESULTS.md) | agent | [Ohdio spike](#ohdio-spike) |
| Ohdio live | **Done** — see [SPIKE_RESULTS.md](./SPIKE_RESULTS.md) | agent | [Ohdio live spike](#ohdio-live-spike) |
| Ohdio Discord HLS | **Done** — see [SPIKE_RESULTS.md](./SPIKE_RESULTS.md) | agent | [Ohdio voice spike](#ohdio-voice-spike) |

Record results in [SPIKE_RESULTS.md](./SPIKE_RESULTS.md) after each spike.

---

## Prerequisites (all spikes)

### Qobuz user token

Same method as LavaSrc / NodeLink homelab:

1. Open [play.qobuz.com](https://play.qobuz.com) and log in.
2. DevTools → **Network** → find a **POST** request to `api.json`.
3. Copy header `X-User-Auth-Token` → `QOBUZ_USER_TOKEN` in `.env`.

Token expires periodically. Re-copy from browser when API returns 401.

### Local env

```bash
cp .env.example .env
# fill QOBUZ_USER_TOKEN (and later DISCORD_TOKEN for voice spike)
```

Spike scripts read from `.env` via `dotenv`. Do not commit `.env`.

---

## Search spike

**Goal:** Understand what Qobuz's API actually returns for real queries, and whether pick-from-results UX is enough (vs re-ranking / Deezer bridge).

**This is the highest-priority spike** — it drove most of the NodeLink pain documented in [handoff.md](./handoff.md).

### What you are answering

| Question | How you'll know |
|----------|-----------------|
| Does Qobuz search return usable results at all? | Tracks appear for each test query |
| Is rank #1 often wrong? | Compare position 1 vs expected track |
| Is the track in the top 25 but badly ranked? | Re-ranking may be enough for `/play` |
| Is the track missing entirely from results? | Deezer bridge or URL-only play may be needed |
| Which API endpoint is better? | Compare `catalog/search` vs `track/search` |

### Test queries (from homelab)

Use these exact strings — we have known expected outcomes:

| Query | Wrong result (historical) | Expected |
|-------|-------------------------|----------|
| `lane 8` | Deadmau5 – Strobe | Lane 8 – e.g. *Disappear* |
| `and we knew it was our time` | unrelated partial match | Lane 8 & Massane – *And We Knew It Was Our Time* ([track 424950499](https://open.qobuz.com/track/424950499)) |
| `bohemian rhapsody` | (baseline) | Queen – *Bohemian Rhapsody* near top |
| `radiohead creep` | (baseline) | Radiohead – *Creep* near top |

Add 2–3 songs you actually search for in Discord.

### Suggested approach

**Option A — curl (no code)**

If you still have NodeLink running on the homelab:

```bash
# Inside or against nodelink container
curl -H "Authorization: $NODELINK_PASSWORD" \
  "http://localhost:2333/v4/loadtracks?identifier=directSearch=lane%208"
```

Inspect `tracks[]` order, titles, artists, `info.identifier`.

**Option B — `@kud/qobuz` script (recommended for this repo)**

```bash
mkdir -p spikes/search
cd spikes/search
npm init -y
npm install @kud/qobuz dotenv
```

Create `spikes/search/run.mjs`:

```js
import "dotenv/config"
import { connect } from "@kud/qobuz"

const queries = [
  "lane 8",
  "and we knew it was our time",
  "bohemian rhapsody",
  "radiohead creep",
]

const client = await connect({ token: process.env.QOBUZ_USER_TOKEN })

for (const query of queries) {
  console.log("\n" + "=".repeat(60))
  console.log("QUERY:", query)
  const { tracks, albums, artists } = await client.search.search(query, { limit: 10 })
  console.log("\nTracks:")
  tracks?.slice(0, 10).forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.title} — ${t.artist?.name ?? "?"} (id: ${t.id})`)
  })
  if (albums?.length) {
    console.log("\nAlbums (top 3):")
    albums.slice(0, 3).forEach((a, i) => {
      console.log(`  ${i + 1}. ${a.title} — ${a.artist?.name ?? "?"} (id: ${a.id})`)
    })
  }
}
```

```bash
# from repo root
node spikes/search/run.mjs
```

Adjust API calls if `@kud/qobuz` search signature differs — check package docs.

**Option C — raw Qobuz API**

Call `GET /catalog/search?query=...&limit=25` with `app_id` + `X-User-Auth-Token`. Useful if evaluating a custom client instead of `@kud/qobuz`.

Reference: [Qobuz API OpenAPI](https://github.com/api-evangelist/qobuz).

### What to record

Copy output into [SPIKE_RESULTS.md](./SPIKE_RESULTS.md) using this template:

```markdown
## Search spike — YYYY-MM-DD

### Method
@kud/qobuz / curl NodeLink / raw API

### lane 8
- #1: ...
- Lane 8 in results? position: ...
- Verdict: picker sufficient / re-rank needed / track missing

### and we knew it was our time
- #1: ...
- Track 424950499 in results? position: ...
- Verdict: ...

### Conclusions
- [ ] Pick-from-results UX is sufficient for v1
- [ ] Need re-ranking (port SearchRank from homelab)
- [ ] Need Deezer bridge for missing titles
- [ ] @kud/qobuz search API is adequate / inadequate because ...
```

### Pass / fail criteria

| Outcome | Implication for DESIGN.md |
|---------|---------------------------|
| Expected track in top 5 for most queries | `/search` picker is enough; optional re-rank for `/play` |
| Expected track in top 25 but not top 5 | **Re-ranking required** before auto-play |
| Known track not in top 25 | **Deezer bridge** or drop `/play` auto-guess for those cases |
| `@kud/qobuz` can't search | Write minimal internal client in `src/qobuz/` |

---

## Auth spike

**Goal:** Confirm `QOBUZ_USER_TOKEN` works and how long it stays valid.

```bash
# Minimal check: any authenticated endpoint
# e.g. GET /user/get with token header → 200 + user id
```

**Pass:** 200 response with user profile.  
**Fail:** 401 → refresh token from browser; document refresh cadence in SPIKE_RESULTS.

---

## Stream URL spike

**Goal:** `track/getFileUrl` returns a CDN URL that ffmpeg can read.

Depends on: auth spike pass.

1. Pick a track ID from search spike (e.g. Queen – Bohemian Rhapsody).
2. Request stream URL (format **6** FLAC or **5** MP3 320).
3. Verify:

```bash
ffmpeg -i "$CDN_URL" -t 5 -f null -
```

**Pass:** ffmpeg reads without error.  
**Fail:** Check request signing (`request_sig` MD5), `app_secret`, format id.

If `@kud/qobuz` lacks `getStreamUrl`, implement signing per [Qobuz tracks API](https://github.com/api-evangelist/qobuz) — see homelab `qobuz.ts` patch.

---

## Voice spike

**Goal:** ffmpeg output → `@discordjs/voice` → Discord voice channel plays audio.

Depends on: stream URL spike pass + `DISCORD_TOKEN` + test guild.

Minimal script: join voice, pipe ffmpeg stdout to `createAudioResource`, play 30s, leave.

**Pass:** Audible playback in test channel.  
**Fail:** Try format 5 (MP3) instead of 6 (FLAC); check Opus/ffmpeg args.

---

## Package spike

**Goal:** Decide `@kud/qobuz` vs internal client.

| Capability | Required | `@kud/qobuz` has it? |
|------------|----------|----------------------|
| Token auth | Yes | Yes |
| Search (tracks) | Yes | Yes (verify in search spike) |
| Stream URL / signing | Yes | **Verify** — may be metadata-only |
| Auto `app_id` from bundle | Nice | Yes |

Fill the last column during search + stream URL spikes. If stream signing is missing, use `@kud/qobuz` for search only and ~100 lines for `getFileUrl` in `src/qobuz/stream.ts`.

---

## Ohdio spike

**Goal:** Catch-up audio for an Ohdio episode URL — GraphQL BFF → MediaNet `validation/v2` → HLS that ffmpeg can read.

Already known before this spike (do not re-prove): public GraphQL at `https://services.radio-canada.ca/bff/audio/graphql`; episode + media ids; MediaNet HLS; podcast DRM `tokenId: null`. Premiere shows expose several **cues** that often share a mediaId (hour file + `mediaSeekTime`).

Test URLs:

```
https://ici.radio-canada.ca/ohdio/musique/emissions/cosmopolite/episodes/1173568/vendredi-21-aout-2026
https://ici.radio-canada.ca/ohdio/premiere/emissions/penelope/episodes/1091696/mercredi-3-juin-2026
```

### What you are answering

| Question | How you'll know |
|----------|-----------------|
| Does `episodeById` + `playbackListByGlobalId` return playable mediaIds? | GraphQL `mediaId` (not the episode id) |
| Does Cosmopolite have 1 file or N like Pénélopé? | unique `mediaId`s, not raw `items.length` |
| Are Premiere cues separate files or seek points? | `mediaSeekTime` on shared mediaId |
| Is catch-up DRM-free for ffmpeg? | `validation/v2` `tokenId` + ffprobe/ffmpeg |
| How short-lived is the HLS URL? | Akamai `hdnea` `exp - st` |

### Suggested approach

```bash
node spikes/ohdio/run.mjs
node spikes/ohdio/run.mjs 'https://ici.radio-canada.ca/ohdio/.../episodes/{id}/{slug}'
```

Path: URL episode id → GraphQL (`contentTypeId` **18**) → each `mediaPlaybackItem.mediaId` → `media/validation/v2` (`appCode=medianet`, `tech=hls`) → ffprobe + `ffmpeg -t 3`. Collapse consecutive identical mediaIds; `ffmpeg -ss {mediaSeekTime}` for cue skip.

Do not use `playlistItemId.mediaId` from the page as the only source — it can be `null` while `header.media2.id` / the playback list still have the MediaNet id.

### Pass / fail criteria

| Outcome | Implication |
|---------|-------------|
| HLS + ffmpeg pass for every unique mediaId | Same ffmpeg pipe as Qobuz can ingest Ohdio catch-up; fetch URL immediately before play |
| `tokenId` non-null **and** ffmpeg fails | Treat as DRM; drop catch-up |
| Several unique mediaIds | Queue one resource per **file**, not per cue |
| Cues share a mediaId | Use `mediaSeekTime` (`-ss`) if starting mid-hour |

---

## Ohdio live spike

**Goal:** ICI Première (and other Ohdio networks) **live** HLS that ffmpeg can read.

Catch-up `appCode=medianet` requires a **numeric** mediaId. Live uses a **call sign** with `appCode=medianetlive`.

```bash
node spikes/ohdio/live.mjs              # ICI Première, regionId 8 (Montréal → cbf)
node spikes/ohdio/live.mjs musique      # ICI Musique (cbfx)
node spikes/ohdio/live.mjs --all        # every network in the region
```

Path: GraphQL `liveSchedules(regionId)` → `broadcastingStationCodeName` (call sign) → `validation/v2` `appCode=medianetlive` → ffprobe + `ffmpeg -t 3`.

| Outcome | Implication |
|---------|-------------|
| Live HLS + ffmpeg pass | `/play` can take a live network URL/call sign; same PCM pipe |
| Call sign fails on `medianet` | Do not reuse catch-up validation params for live |
| Region changes the call sign | Default region 8 (Montréal); map Discord guild → region later if needed |

---

## Ohdio voice spike

**Goal:** Ohdio HLS → ffmpeg s16le 48 kHz → `@discordjs/voice`, including sequential unique catch-up files and optional live.

Depends on: catch-up + live ffmpeg pass + `DISCORD_TOKEN`.

```bash
node spikes/ohdio/voice.mjs          # 2 unique Pénélopé hours, 8s each
node spikes/ohdio/voice.mjs --live   # then 8s of ICI Première live
```

Same pipeline as the Qobuz voice spike. Re-fetch `validation/v2` immediately before each file (catch-up `hdnea` TTL can be 120s).

**Pass:** connection Ready, player Playing, no ffmpeg/player errors; human confirms audio.  
**Fail:** try without `-re`; check DAVE (`@snazzah/davey`) same as Qobuz voice spike.

---

## After all spikes

1. Update [SPIKE_RESULTS.md](./SPIKE_RESULTS.md) with final decisions.
2. Update [DESIGN.md](./DESIGN.md) open questions (Deezer bridge, auto-play threshold).
3. Start **Phase 1** scaffold only when search + stream URL + voice spikes pass (or failures are documented with workarounds).

**Do not** start Phase 1 (full bot scaffold) until the **search spike** is recorded — search drives UX and resolver design.

---

## References

- [handoff.md](./handoff.md) — Issue 6 search quality, test queries
- [STACK_EVALUATION.md](./STACK_EVALUATION.md) — why search is stack-independent
- [DESIGN.md](./DESIGN.md) — target architecture after spikes
