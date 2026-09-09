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

## Ohdio catch-up spike

**Date:** 2026-09-09  
**Method:** `spikes/ohdio/run.mjs` — GraphQL BFF `episodeById` + `playbackListByGlobalId` → MediaNet `validation/v2` → ffprobe / `ffmpeg -t 3`  
**URLs:** [Cosmopolite 1173568](https://ici.radio-canada.ca/ohdio/musique/emissions/cosmopolite/episodes/1173568/vendredi-21-aout-2026) (music, 1 file); [Pénélopé 1091696](https://ici.radio-canada.ca/ohdio/premiere/emissions/penelope/episodes/1091696/mercredi-3-juin-2026) (Premiere, 10 cues / 3 files)  
**Run by:** agent session

### Cosmopolite (music)

| Check | Result |
|-------|--------|
| GraphQL `episodeById` (no account) | **PASS** — `EpisodeMusique`, playable, `header.media2.id` = **10742215** |
| Page `playlistItemId.mediaId` | **null** — do not use this field alone |
| GraphQL `playbackListByGlobalId` (`contentTypeId` 18) | **PASS** — 1× `PlaybackListItemEpisodeMusiqueClip`, `appCode=medianet`, `audioType=episode-talk` |
| Unique mediaIds | **1** (10742215) |
| `validation/v2` | **PASS** — `errorCode` 0, `mediaType=audio`, 128 kbps |
| DRM | **tokenId = 1** (Akamai `hdnea` signed URL, TTL **120s**) — not Widevine; ffmpeg reads it. Differs from the podcast probe where `tokenId` was `null`. |
| HLS host | `rcavmedias-static.akamaized.net` |
| ffprobe | **PASS** — HLS, AAC LC 48 kHz stereo, duration **3554s** |
| ffmpeg `-t 3` | **PASS** |

Episode id **1173568** ≠ MediaNet id **10742215**. Fetch the HLS URL immediately before play (same rule as Qobuz CDN expiry).

### Pénélopé (Premiere — cues vs files)

| Check | Result |
|-------|--------|
| GraphQL `episodeById` | **PASS** — `EpisodePremiere`, playable, `header.media2.id` = **10681661** |
| Playback list | **10 cues**, **3 unique mediaIds** (hour files: 10681661, 10681756, 10681806) |
| Cue model | Cues **share** a mediaId; `mediaSeekTime` is the chapter offset (0 / 117 / 2184 …) |
| DRM | **tokenId = null** (no `hdnea`) |
| HLS + ffmpeg | **PASS** 10/10 cues (each probe is the whole hour file from t=0) |
| `ffmpeg -ss {seek} -t 2` | **PASS** (cue 1, seek=117s) |

Do **not** queue 10 resources — that would replay hour 1 three times. Collapse consecutive identical mediaIds; optional `-ss mediaSeekTime` to start at a cue.

### Conclusions

- [x] Catch-up is ffmpeg-readable with no login (music + Premiere)
- [x] Playback list is the source of truth; queue **unique mediaIds** in order
- [x] Premiere cues are seek points on hour files, not separate HLS assets
- [x] Live — see [Ohdio live spike](#ohdio-live-spike)
- [x] Discord voice pipe — see [Ohdio Discord HLS spike](#ohdio-discord-hls-spike)

**Bottom line:** `/play <ohdio-episode-url>` → GraphQL playback list → `validation/v2` (`medianet`) → ffmpeg. One queue item per unique mediaId.

---

## Ohdio live spike

**Date:** 2026-09-09  
**Method:** `spikes/ohdio/live.mjs` — GraphQL `liveSchedules` → `validation/v2` `appCode=medianetlive` + call sign → ffprobe / `ffmpeg -t 3`  
**Run by:** agent session

The earlier assumption (“live is a numeric MediaNet id, not a call sign”) was **wrong for the live appCode**. `medianet` rejects call signs with error **34** (`L'id média doit être numerique`). `medianetlive` accepts the call sign.

### Results (regionId 8 = Montréal)

| Check | Result |
|-------|--------|
| GraphQL `liveSchedules` | **PASS** — 7 networks |
| ICI Première call sign | **cbf** (on air: Pénélope) |
| `medianet` + `cbf` | **FAIL** error 34 (expected) |
| `medianetlive` + `cbf` | **PASS** — `errorCode` 0, `tokenId=7`, `mediaType=audio` |
| HLS host | `rcavliveaudio.akamaized.net` (`/hls/live/2006635/P-2QMTL0_MTL/master.m3u8`) |
| `hdnea` TTL | **none** (unsigned live playlist) |
| ffprobe | **PASS** — HLS, AAC 48 kHz stereo (no duration; live) |
| ffmpeg `-t 3` | **PASS** |

Other call signs in this region (not ffmpeg-probed in this run): ICI Musique `cbfx`; webradios `sp01radio`…`sp05radio`. Spot-check: `medianetlive` returned HLS for `cbfx` and `sp01radio` as well.

### Conclusions

- [x] Live Première is ffmpeg-readable with no login
- [x] Use `appCode=medianetlive` + call sign; do not send call signs to `medianet`
- [x] Resolve the playlist at play time (even without `hdnea`)
- Region 8 is Montréal; other regions will return different call signs

**Bottom line:** live is a different validation appCode, not a different GraphQL episode path.

---

## Ohdio Discord HLS spike

**Date:** 2026-09-09  
**Method:** `spikes/ohdio/voice.mjs --live` — unique catch-up mediaIds then live → ffmpeg s16le 48 kHz → `@discordjs/voice`  
**Run by:** agent session  
**Human confirmation:** audible playback in Discord ✅ (user confirmed)

### Pipeline

```
validation/v2 (just-in-time)
  → ffmpeg -re -i $HLS -f s16le -ar 48000 -ac 2 pipe:1
  → createAudioResource(stdout, { inputType: StreamType.Raw })
```

Same Discord stack as the Qobuz voice spike (`@discordjs/voice` 0.19.2 + `@snazzah/davey` 0.1.12).

### Results

| Check | Result |
|-------|--------|
| Join voice | **PASS** — Les Roux / Général |
| Connection Ready | **PASS** |
| Pénélopé hour 1 (mediaId 10681661, 8s) | **PASS** — player Playing |
| Pénélopé hour 2 (mediaId 10681756, 8s) | **PASS** — sequential second resource |
| ICI Première live `cbf` (8s) | **PASS** — player Playing |
| Clean disconnect | **PASS** |

### Conclusions

- [x] Catch-up HLS plays in Discord with the Qobuz PCM pipe
- [x] Sequential unique files work (queue-per-file, not concat filter)
- [x] Live HLS plays on the same connection after catch-up
- [x] Audible in Discord (Pénélopé hours + live Première)

**Bottom line:** Ohdio can share the existing player; resolver returns one or more HLS URLs (unique mediaIds, then optional live).

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
