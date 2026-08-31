# Spike results

Record outcomes here after each spike session. The implementation agent reads this before Phase 1.

---

## Search spike

**Date:** 2026-08-31 (updated after `most_popular` discovery)  
**Method:** Raw `catalog/search` via `@kud/qobuz` transport (`spikes/search/run.mjs`)  
**Run by:** agent session

### Key finding: two buckets

`catalog/search` returns **separate result buckets**:

| Bucket | What it is | Quality |
|--------|------------|---------|
| `tracks` | Text-match track listing | **Poor** — same bad ranking homelab saw |
| `most_popular` | Editorial/popularity results (mixed types: tracks, albums, artists) | **Much better** — matches web app "best result" |

`most_popular` items use a wrapped shape: `{ type: "tracks"|"albums"|"artists", content: { ... } }`. The web app and QBZ surface this separately from the track list. Our initial spike only read `tracks.items` and **missed the good results**.

`@kud/qobuz` `client.search.search()` **drops `most_popular`** — only maps `tracks`, `albums`, `artists`. Bot needs raw transport or a thin wrapper in `src/qobuz/search.ts`.

### Test results (`tracks` bucket — what @kud/qobuz returns today)

| Query | tracks #1 | Expected track in tracks? | Position |
|-------|-----------|---------------------------|----------|
| `lane 8` | Deadmau5 – Strobe | Yes (Disappear) | **#3** |
| `and we knew it was our time` | Acourve – unrelated | **No** (top 25) | — |
| `bohemian rhapsody` | Queen – Bohemian Rhapsody | Yes | **#1** |
| `radiohead creep` | Radiohead – Creep | Yes | **#1** |

### Test results (`most_popular` bucket — what web app shows)

| Query | most_popular #1 | First track in most_popular | Target track |
|-------|-----------------|-----------------------------|--------------|
| `lane 8` | **[artists]** Lane 8 | Strobe — Deadmau5 (#2) | Disappear at tracks #3, not in most_popular top tracks |
| `and we knew it was our time` | **[tracks]** And We Knew It Was Our Time — Lane 8 | same (#1) | **#1** ✓ |
| `and we knew it was ` | **[tracks]** And We Knew It Was Our Time — Lane 8 | same (#1) | **#1** ✓ |
| `bohemian rhapsody` | **[albums]** Bohemian Rhapsody — Queen | Queen track at #2 in bucket | tracks #1 also correct |
| `radiohead creep` | **[tracks]** Creep — Radiohead | same (#1) | **#1** ✓ |

### Endpoint comparison

`catalog/search` vs `track/search`: nearly identical `tracks` ordering. No benefit switching endpoints. The meaningful split is **`most_popular` vs `tracks` within `catalog/search`**, not endpoint choice.

### Conclusions

- [x] **Search = `most_popular` only** — ignore `tracks` bucket entirely; `/play` uses #1, `/search` picker lists all items
- [ ] Re-ranking (`SearchRank`) — deferred
- [ ] Deezer bridge — not planned
- [x] `@kud/qobuz` adequate: **partial** — transport/auth/metadata; add `most_popular` parsing + `expandToTracks` in bot

**Bottom line:** One bucket, one code path. See [DESIGN.md](./DESIGN.md) resolver section.

---

## Auth spike

**Date:** 2026-08-31  
**Method:** `spikes/auth/run.mjs` — `@kud/qobuz` `fetchAppId`, `validateCredentials`, `connect`, raw `user/get`  
**Run by:** agent session

### Results

| Check | Result |
|-------|--------|
| `fetchAppId()` (bundle scrape) | **PASS** — `app_id` `798273057` |
| `validateCredentials()` | **PASS** — `favorite/getUserFavorites` returns 200 |
| `user/get` | **PASS** — user id `14548256`, subscription `studio` |
| `connect()` end-to-end | **PASS** — client + search probe works |
| Invalid token | **PASS** — 401 as expected |

### How `@kud/qobuz` validates

`connect()` does **not** call `user/get`. It probes `favorite/getUserFavorites` (albums, limit 1) and treats 401 as expired/invalid token. Bot should surface the same 401 → "refresh token in `.env`" message.

### Refresh cadence

**Not measured** in this spike (would require waiting for natural expiry). Operational rule from homelab + LavaSrc docs:

- Token is a browser session cookie equivalent (`X-User-Auth-Token` from play.qobuz.com DevTools).
- When any authenticated call returns **401**, re-copy token from a logged-in browser session and restart the bot.
- No programmatic refresh without email/password login (deferred to v2 optional auth server).

### Conclusions

- [x] `QOBUZ_USER_TOKEN` in `.env` is sufficient for v1
- [x] Auto `app_id` bootstrap works — no need to set `QOBUZ_APP_ID` manually
- [x] `@kud/qobuz` auth path is adequate for the bot

---

## Stream URL spike

**Date:** 2026-08-31  
**Method:** `spikes/stream/run.mjs` — custom MD5 signing + `track/getFileUrl` + ffmpeg probe  
**Run by:** agent session

### Results

| Track | Format | CDN | ffmpeg |
|-------|--------|-----|--------|
| Queen – Bohemian Rhapsody (54091881) | 6 FLAC | Akamai | **PASS** |
| Queen – Bohemian Rhapsody (54091881) | 5 MP3 320 | Akamai | **PASS** |
| Radiohead – Creep (33933680) | 6 FLAC | Akamai | **PASS** |
| Radiohead – Creep (33933680) | 5 MP3 320 | Akamai | **PASS** |

**4/4 passed.** CDN host: `streaming-qobuz-std.akamaized.net`.

### `@kud/qobuz` stream signing

**No** — package has no `getFileUrl` / signing. Bot needs custom `src/qobuz/stream.ts`.

### Signing algorithm

```
request_sig = MD5("trackgetFileUrlformat_id{fid}intentstreamtrack_id{tid}{request_ts}{app_secret}")
```

Query params: `app_id`, `track_id`, `format_id`, `intent=stream`, `request_ts`, `request_sig`.  
Headers: `X-App-Id`, `X-User-Auth-Token`.

### app_secret derivation (critical)

The `production:{api:{appSecret:"..."}}` value in bundle.js **does not work** with the browser token. Secrets must be **derived from seed/timezone pairs** (Spoofbuz/onthespot method):

1. Find `initialSeed("...", window.utimezone.{tz})` entries in bundle.js
2. Match corresponding `name:".../Timezone",info:"...",extras:"..."` blocks
3. `base64decode(seed + info + extras minus last 44 chars)` → 32-char hex secret
4. **Probe each derived secret** at startup — user token is bound to one app_id/secret pair

Working secret for current token: **berlin** timezone derivation (varies when Qobuz rotates bundle).

### Format recommendation

Use **format 5 (MP3 320)** for Discord voice — ffmpeg reads it cleanly and avoids FLAC→Opus transcode CPU. Format 6 also works if needed.

### Conclusions

- [x] `track/getFileUrl` returns playable CDN URLs
- [x] ffmpeg can read both FLAC and MP3 streams
- [x] Custom signing required (~80 lines incl. secret derivation)
- [x] Fetch URL immediately before playback (expires)

---

## Voice spike

**Date:** 2026-08-31  
**Method:** `spikes/voice/run.mjs` — Qobuz CDN → ffmpeg (s16le 48kHz) → `@discordjs/voice`  
**Run by:** agent session  
**Human confirmation:** audible playback in Discord ✅ (user confirmed)

### Setup

| Dependency | Version / notes |
|------------|-----------------|
| `@discordjs/voice` | **0.19.2** — 0.18.x fails to reach Ready (no DAVE) |
| `@snazzah/davey` | **0.1.12** — required for Discord DAVE encryption (2026) |
| `opusscript` | 0.0.8 |
| `libsodium-wrappers` | 0.7.16 |
| ffmpeg | 6.1.1, libopus yes |

### Pipeline

```
track/getFileUrl (format 5 MP3)
  → ffmpeg -re -i $CDN_URL -f s16le -ar 48000 -ac 2 pipe:1
  → createAudioResource(stdout, { inputType: StreamType.Raw })
  → createAudioPlayer → voice connection
```

### Results

| Check | Result |
|-------|--------|
| Join voice channel | **PASS** — Les Roux / Général |
| Connection reaches Ready | **PASS** (with DAVE; 0.18 timed out) |
| Player reaches Playing | **PASS** |
| Audible playback | **PASS** — user confirmed hearing Bohemian Rhapsody |
| Clean disconnect | **PASS** |

### Format used

**Format 5 (MP3 320)** — matches stream spike recommendation.

### Conclusions

- [x] Full Qobuz → Discord voice path works end-to-end
- [x] Use `@discordjs/voice` ≥ 0.19 + `@snazzah/davey` (DAVE mandatory)
- [x] ffmpeg raw PCM → `StreamType.Raw` is the right transcode path
- [x] Bot should accept `DISCORD_VOICE_CHANNEL_ID` or join invoker's channel at runtime

---

## Package decision

**Date:** 2026-08-31

- Use `@kud/qobuz` for: auth/connect, transport, metadata (`tracks.get`, etc.)
- Custom code needed for: **`most_popular` search parsing**, **stream URL signing + app_secret derivation**, optional re-ranking for artist-query edge cases

---

## Go / no-go for Phase 1

| Gate | Status |
|------|--------|
| Search spike recorded | ✅ |
| Auth spike recorded | ✅ |
| Stream URL spike | ✅ |
| Voice spike | ✅ |
| Package decision | ✅ |

**Phase 1 approved:** ✅ — all spikes pass; proceed to bot scaffold
