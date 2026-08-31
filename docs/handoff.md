# NodeLink + ByteBlaze Stack: Implementation Handoff

> **Successor direction:** This homelab stack is not the long-term target. The repo is moving to a **custom monolith** (see [DESIGN.md](./DESIGN.md), [STACK_EVALUATION.md](./STACK_EVALUATION.md)). **Next step:** [search spike](./SPIKES.md) — record results in [SPIKE_RESULTS.md](./SPIKE_RESULTS.md).

This document summarizes what it took to get a working Qobuz-first Discord music stack running on this homelab, and the non-obvious pitfalls a future agent should expect. It is based on the prior implementation conversations ([initial setup](1e73eee7-770b-44df-b877-58a088fa4ca1), [WebSocket/EBUSY fixes](1b8dff70-d137-44ca-ab17-6196ed586501), [Qobuz search/playback routing](e0f00011-54fc-4ed5-b4b6-386304c7d3a1), [search quality](235d704a-cdf7-4f0d-a349-9025f48ba778)).

---

## Why this stack exists

The previous Lavalink + YouTube setup broke repeatedly (`Video player configuration error`, client login failures, cipher issues). The goal shifted to **NodeLink + Qobuz** for reliable, high-quality playback. ByteBlaze was chosen as the Discord bot because it already uses Rainlink and supports NodeLink v2 as a Lavalink-compatible driver.

**Important framing:** "Qobuz-first" is not a config toggle. It required patches at three layers — bot search routing, NodeLink Qobuz streaming, and Qobuz search ranking.

---

## Architecture

```
Discord → ByteBlaze (byteblaze:latest, custom build)
              ↓ Rainlink WS (legacyWS: true)
          NodeLink (performanc/nodelink)
              ↓ Qobuz API + CDN streaming
          Qobuz Premium account
```

**Key paths:**
- Stack: `/srv/docker/audio/`
- Compose: `/srv/docker/audio/compose.yaml`
- Bot config: `/srv/docker/audio/app.yml`
- Secrets: `/srv/docker/audio/.env` (not in git)
- ByteBlaze patches: `/srv/docker/audio/byteblaze-src/`
- NodeLink runtime patch: `/srv/docker/audio/nodelink/patches/qobuz.ts` (bind-mounted into container)
- Komodo resources: `/srv/docker/komodo/resources/audio.toml`

---

## Issue 1: Deployment / Komodo bootstrap

### ByteBlaze image doesn't exist on Docker Hub
`docker compose up` fails with:
```
pull access denied for byteblaze, repository does not exist
```
ByteBlaze must be **built locally** (`byteblaze:latest`) via Komodo build or manual `docker build`. Compose uses `pull_policy: never`.

### Wrong NodeLink image tag
`performanc/nodelink:3.8` does not exist. Use `performanc/nodelink` (latest) or a valid semver tag. The README mentions `3.8.0` but the compose currently uses the untagged image.

### Komodo builder server name
Builder failed with `did not find any Server matching [[AUDIO_SERVER]]`. The `server` field in `audio.toml` must match the exact Komodo periphery server name (`server-gallant` on this host).

---

## Issue 2: WebSocket disconnects every ~45 seconds

**Symptom:** `/play` creates a player, then ~250ms later `NodeDisconnect` code 1006, then recurring 1002 every 45s. Playback fails with "Player is destroyed".

**Root cause:** NodeLink sends WebSocket ping frames every 45s. Rainlink's default WS client replies with an **unmasked pong** (RFC violation). NodeLink's server rejects it and closes with code 1002.

**Fix:** `legacyWS: true` in `app.yml`:

```yaml
player:
  NODES:
    - host: nodelink
      port: 2333
      driver: lavalink/v4/koinu
      legacyWS: true   # REQUIRED
```

Without this, the stack appears "configured correctly" but cannot sustain a connection long enough to play audio.

---

## Issue 3: EBUSY on database writes

**Symptom:**
```
EBUSY: resource busy or locked, rename 'cylane.database.json.*' -> 'cylane.database.json'
```

**Root cause:** Bind-mounting a **single file** (`./data/cylane.database.json:/main/bot/cylane.database.json`) breaks atomic rename writes.

**Fix:** Mount the directory, not the file:
```yaml
volumes:
  - ./data:/main/bot/data
```

And point the DB path in `app.yml` to `./data/cylane.database.json`.

---

## Issue 4: Search goes to YouTube even with Qobuz configured

**Symptom:** Autocomplete and `.play` return YouTube results. Playback stops after a few seconds (YouTube cipher/stream issues).

**Root cause:** This is the biggest conceptual trap. NodeLink is correctly configured:
```yaml
NODELINK_DEFAULTSEARCHSOURCE: '["qobuz"]'
```
A plain query like `bohemian rhapsody` **does** resolve to Qobuz when hit directly against NodeLink's `/v4/loadtracks` API.

But ByteBlaze/Rainlink hardcodes:
```typescript
defaultSearchEngine: 'youtube'
```
So every bot search becomes `ytsearch:query` **before** NodeLink sees it. NodeLink's default search source is never used.

Rainlink only knows `youtube`, `youtubeMusic`, and `soundcloud` as search engines — there is no `qobuz` engine type.

**Fix:** Custom `NodeLinkSearchPlugin` that intercepts `manager.search()` and rewrites plain-text queries to `directSearch=${query}`, which tells NodeLink to use its configured default source (Qobuz).

Location: `/srv/docker/audio/byteblaze-src/src/structures/NodeLinkSearchPlugin.ts`

This plugin must be registered in `Rainlink.ts` and the image rebuilt. Config alone cannot fix this.

---

## Issue 5: Qobuz search works but playback fails

**Symptom:** NodeLink logs show Qobuz track resolved, CDN URL obtained, then:
```
Source qobuz not found or does not support loadStream
```

**Root cause:** NodeLink 3.8.0 implements Qobuz **search** and **getTrackUrl**, but the Qobuz source class was missing `loadStream()`. The player can find the track and resolve a signed Akamai URL, but cannot actually read the audio stream.

**Fix:** Runtime patch adding `loadStream` to Qobuz, streaming the CDN URL over HTTP. Mounted via compose:
```yaml
volumes:
  - ./nodelink/patches/qobuz.ts:/app/src/sources/qobuz.ts:ro
```

**Fragility warning:** This is a bind-mount over upstream source inside the container. NodeLink image updates can silently break or overwrite this patch. After any NodeLink update, verify `loadStream` still exists and the mount is still valid.

---

## Issue 6: Qobuz search quality is poor

**Symptom (real user reports):**
| Query | Wrong result | Expected |
|---|---|---|
| `lane 8` | Deadmau5 – Strobe | Lane 8 – Disappear |
| `and we knew it was our time` | "If I knew it was our last time" | Lane 8 & Massane – And We Knew It Was Our Time |

**Root causes (layered):**

1. **Qobuz's own search ranking is weak.** `lane 8` returned Strobe first; actual Lane 8 tracks were at positions 3 and 5.
2. **The bot always played `tracks[0]`** with no local re-ranking.
3. **Title/artist ambiguity.** Short artist names collide with unrelated catalog entries.
4. **Qobuz text search misses known titles.** "And We Knew It Was Our Time" exists on Qobuz ([track 424950499](https://open.qobuz.com/track/424950499)) but did not appear in Qobuz's top search results for that exact title string. This is **not** a lyric-search problem — it is a catalog search relevance problem.

**Fixes applied:**

1. **Re-ranking in `qobuz.ts` patch** — score results by artist/title/phrase match against the query before returning them.
2. **Re-ranking in `NodeLinkSearchPlugin`** via `SearchRank.ts` — same scoring logic on the bot side.
3. **Deezer catalog bridge in `qobuz.ts`** (`searchViaCatalogBridge`) — when direct Qobuz search is weak, use Deezer to identify the intended track, then scan Qobuz albums for a match. This is how title searches like "And We Knew It Was Our Time" can still resolve to the correct Qobuz track.

**Note on YouTube fallback:** An earlier iteration added YouTube fallback for "low confidence" matches. The user pushed back — the failing query was a song title on Qobuz, not a case that should fall back to YouTube. The current `NodeLinkSearchPlugin` only re-ranks; it does not fall back to YouTube. The Deezer→Qobuz bridge in the NodeLink patch is the correct fix path for missed title matches.

---

## Issue 7: Autocomplete is still YouTube

Slash command autocomplete calls `client.rainlink.search(query)` with no source override. Even with the search plugin, autocomplete behavior depends on how Rainlink formats the query before the plugin intercepts it.

**There is no config-only fix.** Qobuz autocomplete requires the same kind of custom build work as search routing. This was investigated and left as a known limitation unless someone patches `AutoCompleteService.ts`.

---

## Issue 8: Discord permissions

ByteBlaze requires **Manage Messages** on most commands (to auto-delete its own messages). Missing this permission produces:
```
I do not have ManageMessages permission to execute this command!
```
This is unrelated to NodeLink/Qobuz but blocked testing during setup.

---

## What actually works today (current patched state)

| Layer | File | What it does |
|---|---|---|
| Compose | `compose.yaml` | NodeLink + ByteBlaze services, Qobuz env, qobuz.ts mount |
| Bot node config | `app.yml` | `legacyWS: true`, node pointing at `nodelink:2333` |
| Search routing | `byteblaze-src/src/structures/NodeLinkSearchPlugin.ts` | Rewrites plain queries to `directSearch=` |
| Search ranking | `byteblaze-src/src/utilities/SearchRank.ts` | Re-ranks Qobuz results client-side |
| Qobuz streaming | `nodelink/patches/qobuz.ts` | `loadStream`, re-ranking, Deezer catalog bridge |
| Updates | `komodo/resources/audio.toml` | Daily rebuild ByteBlaze + redeploy stack |

---

## Operational gotchas for the next agent

### Patching strategy is fragile
- **ByteBlaze patches** live in `byteblaze-src/` and must survive Komodo rebuilds from upstream `DeepLunaria/ByteBlaze`. If Komodo builds from a clean clone without these files, patches are lost.
- **NodeLink patches** are runtime bind-mounts. Image updates won't include them; they may also conflict if upstream changes `qobuz.ts` structure.

### Testing search vs playback separately
Always test both layers independently:
```bash
# Search only (inside nodelink container)
curl -H "Authorization: $PW" \
  "http://localhost:2333/v4/loadtracks?identifier=directSearch=lane%208"

# vs prefixed
curl -H "Authorization: $PW" \
  "http://localhost:2333/v4/loadtracks?identifier=ytsearch:lane%208"
```
If `directSearch=` returns Qobuz but the bot still plays YouTube, the problem is in ByteBlaze/Rainlink, not NodeLink.

### Qobuz token management
`QOBUZ_USER_TOKEN` in `.env` expires. Refresh requires editing `.env` and restarting NodeLink only.

### YouTube is still needed as a secondary source
NodeLink has `NODELINK_SOURCES_YOUTUBE_CIPHER_URL` configured for when YouTube is explicitly requested. YouTube via NodeLink is more reliable than Lavalink's youtube-source plugin, but still less reliable than Qobuz for day-to-day use.

### LavaMusic was considered as an alternative
A footprint comparison and migration plan to LavaMusic + LavaSrc was started when ByteBlaze/Qobuz integration proved painful. LavaSrc has native Qobuz support and avoids most of these patches, at the cost of a larger stack (Lavalink JVM + plugins). "Working larger footprint beats small unworking footprint" was the user's stated preference if NodeLink+ByteBlaze could not be stabilized.

---

## Recommended debugging order for a new agent

1. **Containers running?** `docker ps` — both `audio-nodelink-1` and `audio-byteblaze-1` healthy.
2. **WS stable?** Watch logs for 45s — no `NodeDisconnect` 1002. If present, check `legacyWS: true`.
3. **Search source?** Hit NodeLink API directly with `directSearch=` vs `ytsearch:`.
4. **Playback?** Check for `does not support loadStream` — qobuz.ts patch mounted?
5. **Wrong track?** Check search result ordering before blaming playback. Test re-ranking and Deezer bridge.
6. **Image drift?** Confirm `byteblaze:latest` contains `NodeLinkSearchPlugin.js` and NodeLink container has patched `qobuz.ts`.

---

## Bottom line

Implementing "NodeLink with Qobuz" sounds like a Docker compose job with a few env vars. In practice it required:

- A **custom ByteBlaze build** to fix search routing Rainlink doesn't support natively
- A **runtime NodeLink source patch** because Qobuz streaming was incomplete in 3.8.0
- A **WebSocket compatibility flag** undocumented in most setup guides
- **Search relevance patches** because Qobuz's catalog search is not good enough for a "play first result" UX
- Careful **volume mount choices** to avoid subtle filesystem errors

None of these are visible from NodeLink's docs or ByteBlaze's README. Assume every layer between the user typing a song name and audio coming out of Discord needs explicit verification.

### Salvage for custom bot

| Homelab artifact | Port to |
|------------------|---------|
| `SearchRank.ts` | `src/search/rank.ts` (if search spike says re-rank needed) |
| `qobuz.ts` Deezer bridge | `src/search/deezer-bridge.ts` (if search spike says missing titles) |
| `qobuz.ts` `loadStream` / CDN fetch | Reference for stream URL spike |
| Test queries (`lane 8`, etc.) | [SPIKES.md](./SPIKES.md) search spike |
| `QOBUZ_USER_TOKEN` in `.env` | Same auth for custom bot |