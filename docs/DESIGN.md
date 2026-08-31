# Qobuz Discord Bot — Design Document

> **See also:**
> - [STACK_EVALUATION.md](./STACK_EVALUATION.md) — landscape survey and approach comparison
> - [SPIKES.md](./SPIKES.md) — **Phase 0 experiments (do these before coding)**
> - [SPIKE_RESULTS.md](./SPIKE_RESULTS.md) — record spike outcomes
> - [handoff.md](./handoff.md) — prior NodeLink + ByteBlaze lessons

## Status

| Phase | State |
|-------|-------|
| Stack decision | ✅ Custom monolith (discord.js + Qobuz client + ffmpeg) |
| Phase 0 spikes | ✅ All done — see [SPIKE_RESULTS.md](./SPIKE_RESULTS.md) |
| Phase 1+ implementation | ⬜ Ready to start |

## Overview

A private Discord bot that streams music from a single premium Qobuz account into voice channels. The bot is intended for personal or small-group use on one or a few Discord servers, with minimal server footprint and low maintenance burden.

### Decisions (locked)


| Decision                  | Choice                                                         |
| ------------------------- | -------------------------------------------------------------- |
| Bot visibility            | **Private** — not listed publicly; invite-only                 |
| Qobuz accounts            | **One account** — shared across all guilds the bot joins       |
| Playback control          | **Anyone** in the server can search, queue, skip, and stop     |
| Search / play resolver    | **`most_popular` only** — ignore the `tracks` bucket entirely |
| Queue scope               | Per guild (each Discord server has its own queue)              |
| Auth model (v1)           | `QOBUZ_USER_TOKEN` in `.env` (browser token); email/password optional later |
| Auth model (v2, optional) | Web login page for easier credential setup (still one account) |


---



## Goals



### Functional

- Search the Qobuz catalog and add tracks to a queue
- Play audio in a Discord voice channel
- Skip to the next track
- View the current queue
- Stop playback and clear the queue



### Non-functional

- **Small footprint:** single process, ~128–256 MB RAM, no extra services (Redis, Lavalink, Postgres)
- **Low maintenance:** thin codebase (~800–1200 lines), isolated Qobuz client, well-supported Discord libraries
- **Simple deploy:** one Docker container, `.env` configuration



### Out of scope (v1)

- Per-user or per-guild Qobuz accounts
- Playlist / album / discography playback
- Shuffle, repeat, volume, lyrics
- Downloading tracks to disk
- Hi-res streaming (Discord voice does not benefit)
- Public multi-tenant hosting

---



## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                 Single Node.js process                       │
│                                                              │
│  ┌─────────────┐   ┌─────────────┐   ┌──────────────────┐   │
│  │ discord.js  │   │  Fastify    │   │  Player manager  │   │
│  │ slash cmds  │   │  (v2 auth)  │   │  queue / voice   │   │
│  │ + buttons   │   │             │   │  per guild       │   │
│  └──────┬──────┘   └──────┬──────┘   └────────┬─────────┘   │
│         │                 │                    │             │
│         └─────────────────┼────────────────────┘             │
│                           ▼                                  │
│                  ┌─────────────────┐                         │
│                  │  Qobuz adapter  │                         │
│                  │  search / stream│                         │
│                  └────────┬────────┘                         │
│                           ▼                                  │
│                  ┌─────────────────┐                         │
│                  │ ffmpeg (static) │  source → Opus         │
│                  └─────────────────┘                         │
└──────────────────────────────────────────────────────────────┘
            │                                    │
            ▼                                    ▼
     Discord Gateway / Voice              Qobuz REST API
```



### Components


| Component            | Responsibility                                                                          |
| -------------------- | --------------------------------------------------------------------------------------- |
| **Bot (discord.js)** | Slash commands, button interactions, embeds                                             |
| **Player manager**   | Per-guild voice connection, audio player, in-memory queue                               |
| **Qobuz adapter**    | Auth, search, signed stream URL retrieval — isolated for easy repair if the API changes |
| **ffmpeg**           | Transcode Qobuz audio (FLAC or MP3) to Opus for Discord                                 |
| **Auth server (v2)** | Optional Fastify HTTP server for a one-time Qobuz login page                            |


---



## Stack



### Runtime & language


| Layer           | Choice             | Rationale                         |
| --------------- | ------------------ | --------------------------------- |
| Language        | **TypeScript**     | Type safety with minimal overhead |
| Runtime         | **Node.js 22 LTS** | Required by `@discordjs/voice`    |
| Package manager | **npm**            | Standard, no extra tooling        |




### Core dependencies


| Package            | Purpose                                   |
| ------------------ | ----------------------------------------- |
| `discord.js` v14   | Bot framework, slash commands, components |
| `@discordjs/voice` | Voice channel join, audio playback        |
| `@discordjs/opus`  | Opus encoding (performance)               |
| `ffmpeg-static`    | Bundled ffmpeg — no system install        |
| `fastify`          | Lightweight HTTP server (v2 auth only)    |
| `better-sqlite3`   | Encrypted token storage (v2 auth only)    |
| `dotenv`           | Local configuration                       |




### Qobuz client

No official public API exists for hobby projects. The bot uses the reverse-engineered Qobuz REST API v0.2 (`https://www.qobuz.com/api.json/0.2`).

**Strategy:** wrap all Qobuz calls behind a narrow interface in `src/qobuz/`. Use `@kud/qobuz` for transport/auth/metadata; add a thin search layer for `most_popular` (the package drops it).

```ts
type PopularItemType = "tracks" | "albums" | "artists" | "playlists"

type PopularItem = {
  type: PopularItemType
  id: string | number
  title: string
  artistName?: string
}

type SearchResult = {
  mostPopular: PopularItem[]   // sole search source — from catalog/search only
}

interface QobuzClient {
  login(email: string, password: string): Promise<Session>
  search(query: string, limit?: number): Promise<SearchResult>
  expandToTracks(item: PopularItem): Promise<Track[]>  // album/artist/playlist → tracks
  getStreamUrl(trackId: number): Promise<StreamInfo>
}
```

`catalog/search` returns `most_popular.items` as wrapped objects: `{ type, content }`. Parse `content` for id/title/performer. **Ignore** the `tracks` bucket — it is poorly ranked and redundant ([SPIKE_RESULTS.md](./SPIKE_RESULTS.md)).

**App credentials (**`app_id`**,** `app_secret`**):** extracted from the Qobuz web player `bundle.js` at startup, cached in memory. This avoids hardcoding values that Qobuz rotates.

**Stream quality:** format **6** (FLAC 16-bit / 44.1 kHz) or format **5** (MP3 320 kbps). Discord voice is capped at ~128 kbps Opus; hi-res formats waste CPU and bandwidth with no audible benefit.

### What we are not using


| Rejected            | Reason                                           |
| ------------------- | ------------------------------------------------ |
| Lavalink            | Extra JVM service; unnecessary for a private bot |
| Redis / Postgres    | Overkill for in-memory queues and one account    |
| Python / discord.py | Voice stack less mature; more dependency pain    |
| Microservices       | Operational cost with no benefit at this scale   |


---



## Authentication



### v1 — Environment variables (ship first)

The bot owner sets credentials once in `.env`:

```env
DISCORD_TOKEN=...
QOBUZ_USER_TOKEN=...   # from play.qobuz.com devtools (see SPIKES.md)
```

Same token flow as LavaSrc / NodeLink homelab. Token is kept in memory; refresh manually in `.env` on 401.

Optional later: `QOBUZ_EMAIL` + `QOBUZ_PASSWORD` for programmatic login if browser token is too annoying.

### v2 — Web login (optional, later)

A `/setup` slash command (restricted to the server owner) returns a one-time HTTPS link. The owner enters Qobuz credentials on a simple page; the bot stores an encrypted token in SQLite and updates the in-memory session.

Still **one account** — the web flow is a convenience for initial setup, not multi-user auth.

---



## Playback & Permissions



### Who can control playback

**Anyone** in a guild can use all playback commands. No role checks beyond what Discord requires (e.g. user must be in a voice channel to trigger `/play`).


| Command       | Who          | Requirement                         |
| ------------- | ------------ | ----------------------------------- |
| `/search`     | Anyone       | None                                |
| `/play`       | Anyone       | Must be in a voice channel          |
| `/skip`       | Anyone       | Bot must be playing in that guild   |
| `/queue`      | Anyone       | None                                |
| `/stop`       | Anyone       | Bot must be connected in that guild |
| `/setup` (v2) | Server owner | Bot admin only                      |




### Queue model

- One queue per guild (`Map<GuildId, Track[]>`)
- In-memory only — queue is lost on bot restart
- `/play` while idle: join requester's voice channel and play immediately
- `/play` while playing: append to queue
- On track end or `/skip`: dequeue and play next; disconnect when queue is empty



### Voice behavior

- Bot joins the voice channel of the user who invoked `/play`
- If already connected elsewhere in the same guild, move to the requester's channel
- One active voice connection per guild

---



## User interface



### Slash commands


| Command           | Description                                            |
| ----------------- | ------------------------------------------------------ |
| `/search <query>` | Search Qobuz; select menu from `most_popular` only        |
| `/play <query>`   | Play `most_popular` #1 immediately (see resolver below)   |
| `/skip`           | Skip the current track                                 |
| `/queue`          | Show upcoming tracks                                   |
| `/stop`           | Stop playback, clear queue, disconnect                 |




### Interactive components

A **Now Playing** embed is posted when a track starts. Button row:

```
[ ⏭ Skip ]  [ ⏹ Stop ]  [ 📋 Queue ]
```

Buttons are ephemeral-safe: only the guild that owns the message can interact. No user restriction — anyone can press them.

---

## Search resolver (`most_popular`)

**Decision:** search and play use **only** `most_popular`. The separate `tracks` bucket from `catalog/search` is ignored — it matches what the web app shows as best results, and the text-match `tracks` list is worse ([SPIKE_RESULTS.md](./SPIKE_RESULTS.md)).

### `/play <query>` flow

```
catalog/search(query)
  │
  ▼
most_popular.items[0]   ← always use #1 (not first type=tracks — use literal #1)
  │
  ├─ type: tracks  ──► enqueue that track → play
  ├─ type: albums  ──► album/get(id) → enqueue all tracks in album order → play
  ├─ type: artists ──► artist top tracks (artist/get or equivalent) → enqueue → play
  └─ type: playlists ──► playlist/get → enqueue tracks → play
```

**Examples from spike:**

| Query | `most_popular` #1 | Play behavior |
|-------|-------------------|---------------|
| `and we knew it was ` | track — Lane 8 | Play that track |
| `lane 8` | artist — Lane 8 | Queue artist top tracks, start first |
| `bohemian rhapsody` | album — Queen | Queue album, start first track |

### `/search <query>` flow

Select menu from **all** `most_popular` items (labeled by type: Track / Album / Artist / Playlist). Selecting any item uses the same `expandToTracks()` path as `/play`.

### `/play <qobuz url>`

Bypass search — resolve URL to track/album/artist/playlist id directly, then same expand → enqueue path.

### Deferred (not v1)

- Re-ranking (`SearchRank`) — only if `most_popular` proves wrong in practice
- Deezer bridge — not needed; `most_popular` finds titles the `tracks` bucket misses
- Autocomplete — needs fast partial search + interaction streaming

---



## Audio pipeline

```
1. Resolve input (URL, or catalog/search → most_popular #1 → expandToTracks)
2. Enqueue track(s); play first if idle
3. Call Qobuz track/getFileUrl → time-limited CDN URL
4. Spawn ffmpeg: HTTP input → Opus output
5. createAudioResource(ffmpeg stdout) → AudioPlayer.play()
6. On Idle (track finished) → play next in queue
7. On skip/stop → kill ffmpeg process, act on queue
```

**Stream URL timing:** fetch the CDN URL immediately before playback, not when enqueueing. URLs expire.

**Resource cleanup:** kill the ffmpeg subprocess on skip, stop, disconnect, or process shutdown.

---



## Data & state


| Data                   | Storage                    | Lifetime                                       |
| ---------------------- | -------------------------- | ---------------------------------------------- |
| Per-guild queue        | In-memory `Map`            | Until restart or `/stop`                       |
| Qobuz session token    | In-memory                  | Until 401 or restart (v1); SQLite backup in v2 |
| App credentials        | In-memory (from bundle.js) | Refreshed on startup                           |
| Now Playing message ID | In-memory `Map`            | Per guild, for button updates                  |


No database required for v1.

---



## Deployment



### Docker

Single container based on `node:22-slim`. `ffmpeg-static` is bundled via npm.

```yaml
# docker-compose.yml (sketch)
services:
  bot:
    build: .
    restart: unless-stopped
    env_file: .env
    # ports only needed for v2 web login:
    # ports: ["3000:3000"]
```



### Hosting

Any of: VPS, homelab, Raspberry Pi 4+. Target **1 vCPU, 256 MB RAM**.

### Reverse proxy (v2 only)

Caddy or nginx in front of the auth server for HTTPS. Not needed for v1.

### Configuration


| Variable            | Required    | Description                                                           |
| ------------------- | ----------- | --------------------------------------------------------------------- |
| `DISCORD_TOKEN`     | Yes         | Bot token from Discord Developer Portal                               |
| `DISCORD_CLIENT_ID` | Yes         | For slash command registration                                        |
| `QOBUZ_USER_TOKEN`  | Yes (v1)    | Browser auth token — see [SPIKES.md](./SPIKES.md)                     |
| `QOBUZ_EMAIL`       | Optional    | Programmatic login (not spike priority)                               |
| `QOBUZ_PASSWORD`    | Optional    | Programmatic login (not spike priority)                               |
| `GUILD_ID`          | Recommended | Restrict slash command registration to your server (faster iteration) |
| `ENCRYPTION_KEY`    | v2          | 32-byte hex key for token encryption at rest                          |
| `AUTH_BASE_URL`     | v2          | Public HTTPS URL for the login page                                   |


---



## Project structure

```
qobuz-discord/
├── docs/
│   ├── DESIGN.md
│   ├── STACK_EVALUATION.md
│   ├── SPIKES.md
│   ├── SPIKE_RESULTS.md
│   └── handoff.md
├── spikes/                # throwaway Phase 0 scripts (not production)
│   └── search/
├── src/                   # Phase 1+ (not created yet)
│   ├── index.ts
│   ├── config.ts
│   ├── bot/
│   ├── qobuz/
│   └── auth/              # v2 only
├── Dockerfile             # Phase 1+
├── docker-compose.yml
├── .env.example
├── package.json
└── tsconfig.json
```

---



## Build phases

Implementation starts **after** Phase 0 spikes. See [SPIKES.md](./SPIKES.md).

### Phase 0 — Spikes ✅ complete

Validate assumptions with throwaway scripts in `spikes/`. Record results in [SPIKE_RESULTS.md](./SPIKE_RESULTS.md).

| Spike | Status |
|-------|--------|
| **Search** | **Done** |
| Auth | **Done** |
| Stream URL | **Done** |
| Discord voice | **Done** — audible playback confirmed |
| `@kud/qobuz` package | **Done** — partial; custom search + stream |

**Phase 1 gate:** ✅ passed — proceed to bot scaffold.

### Phase 1 — MVP

- [ ] Project scaffold (TypeScript, discord.js, Docker)
- [ ] Qobuz client: transport + `most_popular` search + `expandToTracks` (album/artist/playlist)
- [ ] `/search` with select menu (`most_popular` only)
- [ ] `/play` with URL support + **always play `most_popular` #1**
- [ ] `/skip`, `/queue`, `/stop`
- [ ] In-memory per-guild queue
- [ ] ffmpeg → Opus playback pipeline

### Phase 2 — Polish

- [ ] Now Playing embed with Skip / Stop / Queue buttons
- [ ] Error messages and reconnect on voice disconnect
- [ ] Optional: re-rank fallback if `most_popular` proves wrong in the field

### Phase 3 — Optional polish

- [ ] Web login page (`/setup` for server owner)
- [ ] Health check HTTP endpoint
- [ ] Graceful shutdown (kill ffmpeg, leave voice)

---



## Risks


| Risk                              | Likelihood        | Impact | Mitigation                                                             |
| --------------------------------- | ----------------- | ------ | ---------------------------------------------------------------------- |
| Qobuz API changes (signing, auth) | Medium            | High   | Isolated `src/qobuz/` module; monitor community clients                |
| Qobuz ToS / account action        | Low (private use) | High   | Personal use only; do not redistribute streams                         |
| Credential exposure               | Low               | High   | `.env` never committed; v2 tokens encrypted at rest                    |
| Voice disconnects                 | Medium            | Low    | Auto-reconnect; re-join on next `/play`                                |
| Poor Qobuz `tracks` bucket        | High (known)      | None   | Ignored — search uses `most_popular` only ([SPIKE_RESULTS.md](./SPIKE_RESULTS.md)) |
| Stream URL expiry mid-track       | Low               | Medium | Fetch URL just before playback; refetch on failure                     |


---



## Discord application setup

1. Create an application at [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a bot, copy token → `DISCORD_TOKEN`
3. Enable **Server Members Intent** only if needed (not required for v1)
4. Invite bot with scopes: `bot`, `applications.commands`
5. Bot permissions: `Connect`, `Speak`, `Use Voice Activity`, `Send Messages`, `Embed Links`
6. Keep the bot **unlisted** — generate invite URL manually, do not submit to Discord app directory

---



## References

- [SPIKES.md](./SPIKES.md) — Phase 0 experiments
- [SPIKE_RESULTS.md](./SPIKE_RESULTS.md) — spike outcomes
- [discord.js voice guide](https://discordjs.guide/voice/)
- [Qobuz API v0.2 (unofficial OpenAPI)](https://github.com/api-evangelist/qobuz)
- [@kud/qobuz npm package](https://www.npmjs.com/package/@kud/qobuz)

