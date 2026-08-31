# Stack Evaluation: Qobuz → Discord

This document evaluates existing projects, reusable packages, and architectural approaches before committing to a custom implementation. It incorporates lessons from the [NodeLink + ByteBlaze handoff](./handoff.md) and the product decisions in [DESIGN.md](./DESIGN.md).

**Context:** private bot, one Qobuz account, anyone can control playback, minimal footprint and maintenance.

**Current step:** Phase 1 — bot scaffold. All Phase 0 spikes passed; see [SPIKE_RESULTS.md](./SPIKE_RESULTS.md).

---

## Executive summary

| Question | Answer |
|----------|--------|
| Does a turnkey Qobuz → Discord app exist? | **No.** Nothing mature, maintained, and direct-streaming was found. |
| Should we fork an existing bot? | **No.** Closest matches are either empty, download-only, or generic Lavalink bots without Qobuz focus. |
| Should we reuse packages? | **Yes, selectively.** `@kud/qobuz` (API client), `@discordjs/voice` (playback), optionally LavaSrc (if choosing Lavalink). |
| Is search solvable by picking a different stack? | **Partially.** Qobuz catalog search is weak at the API level. Stack choice changes *where* you patch, not *whether* you need search UX work. |
| Recommended path | **Custom monolith** (discord.js + Qobuz client + ffmpeg), with search UX that shows multiple results instead of auto-playing rank #1. |
| What to do now | **[Search spike](./SPIKES.md)** — validate Qobuz API results before any bot code |

---

## The real problem (not just "pick a stack")

From the NodeLink deployment, failures clustered into three independent categories:

```
User types "lane 8"
        │
        ▼
┌───────────────────┐     Issue 4: Bot sends ytsearch: to NodeLink
│  Search routing   │     (Rainlink hardcodes YouTube)
└─────────┬─────────┘
          ▼
┌───────────────────┐     Issue 6: Qobuz returns wrong track first
│  Search relevance │     (API ranking, not bot bug)
└─────────┬─────────┘
          ▼
┌───────────────────┐     Issue 5: NodeLink resolves URL but can't stream
│  Playback pipe    │     (missing loadStream in Qobuz source)
└─────────┬─────────┘
          ▼
     Discord audio
```

**Search is the hardest ongoing problem** because:

1. Qobuz's `/catalog/search` and `/track/search` ranking is poor for natural-language queries (documented in handoff: `lane 8` → Deadmau5, title queries missing known tracks).
2. Any stack that does **"play first search result"** inherits this problem.
3. Workarounds (re-ranking, Deezer→Qobuz bridge) are **application logic**, not audio-server features. Moving from NodeLink to Lavalink does not eliminate them.
4. Autocomplete is a separate hard problem in Lavalink-compatible bots (Rainlink has no Qobuz engine; LavaSrc uses `qbsearch:` prefix but bot clients must send it).

**Implication for design:** the fix is primarily **UX + resolver logic**, not swapping audio servers.

| Strategy | Effect on search pain |
|----------|----------------------|
| `/play query` → auto-play `results[0]` | High pain — same wrong-track reports regardless of stack |
| `/search query` → user picks from top 5–10 | **Low pain** — sidesteps bad ranking for most cases |
| Re-ranking scorer (from handoff `SearchRank.ts`) | Medium improvement for `/play` convenience |
| Deezer catalog bridge (from handoff `qobuz.ts`) | Helps when Qobuz search misses a known title |
| Qobuz URL / paste link | Zero ambiguity — always works |

---

## Landscape: existing projects

### Direct Qobuz → Discord (voice streaming)

| Project | Stars | Verdict | Notes |
|---------|-------|---------|-------|
| [mrlewismharris/Qobuz-Discord-Bot](https://github.com/mrlewismharris/Qobuz-Discord-Bot) | 1 | ❌ Not viable | Empty README, no visible implementation, 0 forks |
| [CZnavody19/streamrip-discord](https://github.com/CZnavody19/streamrip-discord) | ~few | ❌ Wrong model | Downloads via streamrip → Plex scan. Not voice streaming |
| **This repo (planned)** | — | ✅ Target | Custom build |

**Conclusion:** nobody has shipped a maintained, direct Qobuz voice bot worth forking.

### Lavalink-compatible audio servers with Qobuz

| Project | Qobuz mode | Streaming | Maturity | Verdict |
|---------|------------|-----------|----------|---------|
| [NodeLink](https://github.com/PerformanC/NodeLink) | Direct (`qbsearch:`, `directSearch=`) | Was broken (`loadStream` missing in 3.8.0; patched in homelab) | Young, fast-moving | ⚠️ Used in handoff; high patch burden |
| [LavaSrc](https://github.com/topi314/LavaSrc) | **Direct** (not mirror) | Full `QobuzAudioSourceManager` + signed CDN URLs | Mature, widely deployed | ✅ Best Lavalink plugin for Qobuz |
| [PulseLink](https://github.com/ItzRandom23/PulseLink) | **Mirror only** | Resolves metadata → plays via YouTube/ISRC | Active | ❌ Wrong goal — not direct Qobuz audio |

### Generic Discord music bots (not Qobuz-specific)

| Project | Stars | Qobuz support | Verdict |
|---------|-------|---------------|---------|
| [LavaMusic](https://github.com/bongodevs/lavamusic) | ~720 | Via LavaSrc plugin on Lavalink — not built-in | ⚠️ Heavy bot; configure, don't fork |
| [ByteBlaze](https://github.com/DeepLunaria/ByteBlaze) | small | Via NodeLink + **custom patches** | ❌ Already proved painful (handoff) |
| [MCbabel/discord-music-bot](https://github.com/MCbabel/discord-music-bot) | — | None (YouTube, Spotify→YT, etc.) | ❌ |
| [JonPark0/MusicBot](https://github.com/JonPark0/MusicBot) | — | None | ❌ |

### Qobuz API libraries / sidecars (not Discord bots)

| Project | Lang | Use case | Verdict |
|---------|------|----------|---------|
| [@kud/qobuz](https://www.npmjs.com/package/@kud/qobuz) | TS | Search, metadata, token auth, auto `app_id` | ✅ **Reuse** in custom bot |
| [BartolomeoRusso9/qobuz-rest-api](https://github.com/BartolomeoRusso9/qobuz-rest-api) | Python | REST proxy: search + `/stream/{id}` | ⚠️ Optional sidecar; 4 stars, single maintainer |
| [DJDoubleD/QobuzApiSharp](https://github.com/DJDoubleD/QobuzApiSharp) | C# | Reference implementation | 📖 Reference only |
| [streamrip](https://github.com/nathom/streamrip) | Python | Download tool | ❌ Wrong model for Discord voice |

---

## Should we fork?

| Candidate | Fork? | Why |
|-----------|-------|-----|
| Qobuz-Discord-Bot | No | Nothing to fork |
| ByteBlaze | No | Would inherit Rainlink's YouTube-default search; homelab already needed 3 custom files + rebuild pipeline |
| LavaMusic | No | 720 stars but bloated for a private bot (i18n, DB, plugin ecosystem). Better to **configure** it or write a thin bot |
| NodeLink | No | Patch via bind-mount is fragile; upstream may fix Qobuz but search/routing still needs bot-side work |
| streamrip-discord | No | Download workflow, not streaming |

**Port, don't fork:** the valuable artifacts from the homelab effort are logic, not repositories:

- `NodeLinkSearchPlugin.ts` → concept: never send `ytsearch:` for plain queries
- `SearchRank.ts` → reusable scoring module
- `qobuz.ts` patch (`loadStream`, Deezer bridge) → reference for stream URL + fallback resolver

These belong in a single custom codebase, not spread across forked upstreams.

---

## Approach comparison

### A. NodeLink + ByteBlaze (current homelab stack)

```
Discord → ByteBlaze (patched) → Rainlink WS → NodeLink (patched) → Qobuz CDN
```

| | |
|---|---|
| **Containers** | 2 (NodeLink + ByteBlaze) |
| **RAM** | ~200–350 MB combined |
| **Pros** | Already partially working; Node.js audio server lighter than JVM |
| **Cons** | 3 patch layers; `legacyWS: true` undocumented; image drift on Komodo rebuilds; Rainlink has no Qobuz search engine; autocomplete still broken |
| **Search** | Requires bot plugin + NodeLink re-rank + optional Deezer bridge |
| **Maintenance** | **High** — bind-mounts, custom builds, upstream breaks |
| **Fit** | ⚠️ Sunk cost only — not recommended as long-term base |

### B. Lavalink + LavaSrc + minimal custom bot

```
Discord → thin bot (discord.js + lavalink-client) → Lavalink+JVM → LavaSrc Qobuz → CDN
```

| | |
|---|---|
| **Containers** | 2 (Lavalink + bot) |
| **RAM** | ~400–600 MB (JVM dominates) |
| **Pros** | LavaSrc Qobuz is **Direct** and battle-tested; `qbsearch:` prefix documented; no `loadStream` patch needed; large community |
| **Cons** | JVM footprint; Lavalink plugin/version pinning; token refresh still manual; search quality still Qobuz-native |
| **Search** | Bot must use `qbsearch:query` explicitly; show multiple results in bot UI |
| **Maintenance** | **Medium** — fewer patches than NodeLink stack, but JVM + plugin updates |
| **Fit** | ✅ Best option if you accept larger footprint for proven audio pipeline |

**LavaSrc Qobuz identifiers** (from upstream docs):

- Search: `qbsearch:animals architects`
- URL: `https://open.qobuz.com/track/52151405`
- Requires `userOauthToken` (browser devtools) — same token pain as NodeLink

### C. Lavalink + LavaSrc + LavaMusic (configure, don't fork)

```
Discord → LavaMusic (off-the-shelf) → Lavalink → LavaSrc
```

| | |
|---|---|
| **Containers** | 2–3 (+ optional Postgres) |
| **RAM** | ~500–800 MB |
| **Pros** | Full feature set (queue, buttons, i18n) out of the box; active project |
| **Cons** | Massive surface area for a private bot; Qobuz still needs LavaSrc config; may not expose Qobuz-first search without modification; Postgres optional but pushed |
| **Search** | Default is multi-source / YouTube-leaning — needs config + possible source prefix overrides |
| **Maintenance** | **Medium-high** — tracking LavaMusic releases for a bot you barely customize |
| **Fit** | ⚠️ "Working > small" escape hatch from handoff — viable if custom bot effort is unwanted |

### D. Custom monolith — discord.js + Qobuz client + ffmpeg ⭐ Recommended

```
Discord → single bot process → Qobuz API → CDN → ffmpeg → Opus → voice
```

| | |
|---|---|
| **Containers** | 1 |
| **RAM** | ~128–256 MB |
| **Pros** | Full control; no Lavalink/Rainlink impedance mismatch; search UX designed correctly from day 1; smallest deploy; all logic in one repo |
| **Cons** | You own voice reconnect, queue, ffmpeg lifecycle; no community audio filters |
| **Search** | Native multi-result UI; port `SearchRank` + Deezer bridge as optional modules |
| **Maintenance** | **Low-medium** — one codebase; Qobuz API changes hit one `src/qobuz/` module |
| **Fit** | ✅ Best match for stated goals |

See [DESIGN.md](./DESIGN.md) for detailed structure.

### E. Custom bot + qobuz-rest-api sidecar

```
Discord → bot (discord.js + voice) → qobuz-rest-api (FastAPI) → Qobuz API
```

| | |
|---|---|
| **Containers** | 2 |
| **RAM** | ~200–300 MB |
| **Pros** | Separates Qobuz auth/signing from bot; `/stream/{id}` HTTP proxy simplifies bot playback |
| **Cons** | Extra service to deploy; Python + Node; sidecar has 4 GitHub stars, single maintainer |
| **Search** | Sidecar exposes search endpoints — bot still needs ranking UX |
| **Maintenance** | **Medium** — two repos/services, dependency on unmaintained sidecar |
| **Fit** | ⚠️ Only if you want Python for Qobuz and TypeScript for Discord |

### F. Download-then-play (streamrip)

Rejected. High latency, disk I/O, legal/ToS gray area, poor queue UX.

---

## Scoring matrix

Weighted for: **private bot, one account, minimal footprint, minimal maintenance, search matters**.

| Criterion (weight) | A NodeLink | B Lavalink+LavaSrc | C LavaMusic | D Custom | E Sidecar |
|--------------------|-----------|-------------------|-------------|----------|-----------|
| Footprint (20%) | 7 | 4 | 3 | **10** | 6 |
| Maintenance (25%) | 2 | 6 | 5 | **8** | 5 |
| Qobuz direct play (20%) | 6* | **9** | **9** | **9** | 8 |
| Search control (25%) | 5 | 6 | 5 | **9** | 7 |
| Time to working (10%) | 8 | 6 | 7 | 5 | 6 |
| **Weighted total** | **4.9** | **6.3** | **5.4** | **8.4** | **6.1** |

\*NodeLink only after homelab patches; upstream status uncertain without re-test.

---

## Packages to reuse (custom approach)

### Definitely use

| Package | Role | Why |
|---------|------|-----|
| `discord.js` v14 | Bot framework | Standard, maintained |
| `@discordjs/voice` | Voice playback | Official voice library |
| `@discordjs/opus` | Opus encode | Performance |
| `ffmpeg-static` | Transcode | No system dependency |
| `@kud/qobuz` | Qobuz API | Token auth, auto `app_id`, typed search — **evaluate in spike**; fall back to ~100-line internal client if gaps found |

### Port from homelab (don't import repos)

| Module | Source | Purpose |
|--------|--------|---------|
| `search/rank.ts` | `SearchRank.ts` | Score Qobuz results against query |
| `search/deezer-bridge.ts` | `qobuz.ts` `searchViaCatalogBridge` | Fallback when Qobuz search misses |
| — | `NodeLinkSearchPlugin` concept | N/A in custom bot — no Rainlink to misroute |

### Do not use

| Package | Why |
|---------|-----|
| Rainlink / Shoukaku with default config | YouTube-default search engines |
| PulseLink for Qobuz | Mirror-only — plays YouTube, not Qobuz |
| Lavalink (in custom approach) | Unnecessary second process |
| streamrip | Download model |

---

## Search design (stack-independent)

**Locked:** search and play use **only** `most_popular` from `catalog/search`. The `tracks` bucket is ignored ([SPIKE_RESULTS.md](./SPIKE_RESULTS.md)).

```
Input: query string | Qobuz URL
        │
        ├─ Qobuz URL? ──────────────────────────► resolve id → expandToTracks
        │
        ├─ /search or /play with query
        │       │
        │       ▼
        │   catalog/search(query) → most_popular only
        │       │
        │       ├─ /play ──► items[0] → expand by type → enqueue → play
        │       └─ /search ──► picker from all most_popular items
        │
        └─ (no Deezer bridge in v1)
```

**Commands:**

| Command | Behavior |
|---------|----------|
| `/search <query>` | Select menu from `most_popular` items only |
| `/play <query>` | Play `most_popular` #1 (track, album, artist, or playlist) |
| `/play <qobuz url>` | Direct resolve, no search |
| `/skip` | Next in queue |

**No autocomplete in v1.** Defer until core playback is stable.

---

## Authentication comparison

All approaches share the same Qobuz auth reality:

| Method | Pros | Cons |
|--------|------|------|
| Email + password via API | Automatable, `.env` only | Qobuz may block; password in config |
| Browser `user_auth_token` | Works reliably (LavaSrc/NodeLink docs) | Expires; manual refresh in `.env` |
| `@kud/qobuz` token connect | Auto `app_id`, keychain store | Still need initial token from browser |

**v1 recommendation:** `QOBUZ_USER_TOKEN` in `.env` (same as LavaSrc/NodeLink). Add email/password login in bot only if token flow is too annoying.

---

## Decision: custom implementation

### Why custom wins for this project

1. **No forkable Qobuz Discord bot exists.**
2. **NodeLink + ByteBlaze proved** the pain is at the integration boundary (search routing, incomplete sources), not missing features.
3. **Search is a UX problem** — a custom bot can mandate pick-from-results without fighting Rainlink defaults.
4. **Private + one account + queue/skip** is ~800 lines — Lavalink adds process complexity for features you don't need (filters, multi-node, sharding).
5. **Homelab patches become first-class modules** instead of bind-mounts over upstream.

### When to choose Lavalink + LavaSrc instead

Pick approach **B** if:

- You want audio filters, crossfade, or advanced Lavalink features later
- You're OK with ~500 MB RAM and JVM ops
- You'd rather configure LavaSrc than own ffmpeg process management
- A spike shows `@kud/qobuz` stream URL signing is broken or incomplete

### When to abandon everything and configure LavaMusic

Pick approach **C** only if a custom bot spike fails on voice stability and you need *something working this week*. Accept the footprint tax.

---

## Recommended implementation plan

> **Detailed spike instructions:** [SPIKES.md](./SPIKES.md)  
> **Record outcomes:** [SPIKE_RESULTS.md](./SPIKE_RESULTS.md)

### Phase 0 — Spikes ✅ complete

Validate assumptions with throwaway scripts in `spikes/`, not a full bot.

| Spike | Status | Pass criteria | Fail action |
|-------|--------|---------------|-------------|
| **Search** | **Done** | Test queries documented; conclusions in SPIKE_RESULTS | `most_popular` bucket only |
| Qobuz auth | **Done** | Token returns valid session | Manual refresh on 401 |
| Stream URL | **Done** | `getFileUrl` → ffmpeg reads CDN URL | Custom signing + seed-derived `app_secret` in `src/qobuz/` |
| Discord voice | **Done** | ffmpeg → `@discordjs/voice` plays in test channel | Format 5 MP3; `@snazzah/davey` required |
| `@kud/qobuz` | **Done** | Covers search + auth; stream signing custom | `most_popular` + `stream.ts` |

**Phase 1 approved.** Proceed to MVP scaffold.

### Phase 1 — MVP (approach D)

From [DESIGN.md](./DESIGN.md):

- `/search` with select menu (search-first, not play-first)
- `/play` with URL support + guarded auto-play
- `/skip`, `/queue`, `/stop`
- Single container Docker deploy

### Phase 2 — Search quality

- Port `SearchRank` scorer
- Optional Deezer bridge behind feature flag
- `/play` confidence threshold

### Phase 3 — Polish

- Now Playing embed + buttons
- Token refresh helper / web setup page
- Graceful shutdown

---

## Migration from current homelab

If/when the custom bot replaces NodeLink + ByteBlaze:

1. Run custom bot on a different process/port; test in parallel
2. Keep NodeLink stack running until custom bot passes search + playback checklist from handoff
3. Decommission `byteblaze-src/` patches, `nodelink/patches/qobuz.ts` bind-mount
4. Salvage: `SearchRank.ts`, Deezer bridge logic, `.env` Qobuz token

**Do not** invest further in NodeLink patches unless Phase 0 spikes fail and you need a fallback while building custom.

---

## Open questions for next design pass

_Resolve after search spike — record answers in [SPIKE_RESULTS.md](./SPIKE_RESULTS.md)._

1. **Deezer bridge:** keep it? Requires Deezer credentials (ARL) for a second service. Powerful for missed titles; adds maintenance.
2. **`/play` auto-play threshold:** always show picker vs auto-play when score > X?
3. **Token refresh:** manual `.env` edit acceptable for private bot, or build refresh flow in v1?
4. **`@kud/qobuz`:** does it expose stream URL signing, or only metadata?

---

## References

- [SPIKES.md](./SPIKES.md) — Phase 0 experiment guide
- [SPIKE_RESULTS.md](./SPIKE_RESULTS.md) — spike outcomes (fill in after each run)
- [handoff.md](./handoff.md) — NodeLink + ByteBlaze battle scars
- [DESIGN.md](./DESIGN.md) — custom monolith target architecture
- [LavaSrc Qobuz docs](https://github.com/topi314/LavaSrc#qobuz) — `qbsearch:` prefix, direct playback
- [NodeLink Qobuz source commit](https://github.com/PerformanC/NodeLink/commit/8c577cb) — added Jan 2026
- [@kud/qobuz](https://www.npmjs.com/package/@kud/qobuz) — Node Qobuz client
- [qobuz-rest-api](https://github.com/BartolomeoRusso9/qobuz-rest-api) — optional sidecar reference
