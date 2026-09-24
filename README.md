# qobuz-discord

[![License: ISC](https://img.shields.io/github/license/marcag3/qobuz-discord)](LICENSE)
[![Tests](https://github.com/marcag3/qobuz-discord/actions/workflows/ci.yml/badge.svg)](https://github.com/marcag3/qobuz-discord/actions/workflows/ci.yml)
[![Deployment](https://github.com/marcag3/qobuz-discord/actions/workflows/docker.yml/badge.svg)](https://github.com/marcag3/qobuz-discord/actions/workflows/docker.yml)

Stream music from a premium Qobuz account, plus Radio-Canada [Ohdio](https://ici.radio-canada.ca/ohdio) catch-up and live radio, into Discord voice channels.

A single-container bot for private servers — no Lavalink, no Redis, no multi-service stack. One shared Qobuz account, public Ohdio streams, slash commands, and ffmpeg transcoding inside one process.

## Why this exists

There is no maintained bot that streams Qobuz directly into Discord voice. The alternatives fall short:

| Approach | Problem |
|----------|---------|
| Generic music bots | Hardcoded to YouTube or Spotify, not Qobuz |
| Lavalink / NodeLink stacks | Heavy to deploy; Qobuz sources often resolve metadata but fail to stream |
| Download-then-play bots | Write files to disk instead of live voice streaming |
| Qobuz search APIs | Poor ranking for natural-language queries — auto-playing result #1 plays the wrong track |

This bot keeps the deployment model simple and uses `/play` autocomplete so users pick the right result instead of trusting rank #1. `/ohdio` does the same for Radio-Canada shows, episodes, and live stations.

## Features

- **Qobuz catalog search** with autocomplete on `/play`
- **Direct play** from a search query or Qobuz URL (`/play`)
- **Ohdio catch-up** — episodes, shows, podcasts, segments, audiobooks, and playlists from an Ohdio URL or `/ohdio` search
- **Ohdio live radio** — ICI Première, ICI Musique, and other regional stations (Now Playing shows **On Air**)
- **Queue management** — skip, view queue, stop
- **Now Playing** embed with inline controls
- **Single process** — discord.js, Qobuz, Ohdio, and ffmpeg in one container (~128–256 MB RAM)
- **Per-guild queues** — each Discord server has its own playback queue

## Requirements

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/)
- A [Discord bot application](https://discord.com/developers/applications) (token + client ID)
- A **Qobuz premium** subscription (Ohdio needs no extra account)

## Installation

Create a directory for the bot, then add the two files below.

### `docker-compose.yml`

```yaml
services:
  bot:
    image: ghcr.io/marcag3/qobuz-discord:latest
    container_name: qobuz-discord
    restart: unless-stopped
    env_file: .env
    volumes:
      - bot-data:/app/data

volumes:
  bot-data:
```

The `bot-data` volume keeps credentials saved with `/qobuz-auth` across restarts and image updates.

### `.env`

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
QOBUZ_USER_TOKEN=
# OHDIO_REGION_ID=8
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | Yes | Bot token from the [Discord Developer Portal](https://discord.com/developers/applications) |
| `DISCORD_CLIENT_ID` | Yes | Application ID (same portal) |
| `QOBUZ_USER_TOKEN` | No | Browser session token — see below. Can also be set later from Discord with `/qobuz-auth`. |
| `OWNER_ID` | No | Discord user ID(s), comma-separated, allowed to use `/qobuz-auth` and receive Qobuz alerts. Defaults to the application owner in the Developer Portal. |
| `QOBUZ_APP_ID` / `QOBUZ_APP_SECRET` | No | Pin a stream-signing pair. If Qobuz rejects it, the bot falls back to secrets derived from the web player. |
| `QOBUZ_CREDENTIALS_PATH` | No | Where `/qobuz-auth` saves credentials (default `data/qobuz-credentials.json`) |
| `GUILD_ID` | No | Register slash commands to one guild only (faster while testing) |
| `OHDIO_REGION_ID` | No | Live radio region (default `8` = Montréal). Catch-up URLs work without this. |

#### Qobuz user token

1. Log in at [play.qobuz.com](https://play.qobuz.com).
2. Open browser DevTools → **Network**.
3. Trigger any action that hits the Qobuz API (e.g. play a track).
4. Find a **POST** request to `api.json` and copy the `X-User-Auth-Token` header value into `QOBUZ_USER_TOKEN`.

The token expires periodically. You don't need to edit `.env` or restart when it does. See [Fixing Qobuz from Discord](#fixing-qobuz-from-discord).

#### Fixing Qobuz from Discord

If Qobuz stops working, the bot keeps running: Ohdio still plays, and users get a short explanation instead of a generic error. The bot owner gets a DM with a status panel. You can also open the panel any time with `/qobuz-auth`, in a server or in a DM with the bot.

| Panel state | What to do |
|-------------|------------|
| **Token rejected** | Copy a fresh token (steps above) and press **Update credentials** |
| **App secret rejected** | Press **Re-derive secret**. If Qobuz changed its web player, paste a known-good app ID and secret instead. |
| **Qobuz unreachable** | Nothing: the bot retries automatically (1, 5, 15, then every 30 minutes) |

New credentials are checked against Qobuz before they're used. If the check fails, nothing is changed. Working credentials are saved to `QOBUZ_CREDENTIALS_PATH` with owner-only file permissions and take precedence over `.env`. Press **Clear saved (use .env)** to go back to `.env`.

Only `OWNER_ID` (or the application owner) can use the panel, even if other server members are admins. Tokens are entered in a Discord modal, so they never appear in a channel, and the bot only ever shows their last four characters.

### Start

```bash
docker compose pull
docker compose up -d
```

Logs:

```bash
docker compose logs -f bot
```

Update to a new release:

```bash
docker compose pull
docker compose up -d
```

Pinned releases are also published as `ghcr.io/marcag3/qobuz-discord:v1.0.0` — change the `image` tag in `docker-compose.yml` to pin a version.

### Invite the bot

In the Discord Developer Portal, create an OAuth2 invite URL with:

- Scopes: **bot**, **applications.commands**
- Bot permissions: **Connect**, **Speak**, **Use Voice Activity**

Add the bot to your server, join a voice channel, and run `/play` or `/ohdio`.

## Commands

| Command | Description |
|---------|-------------|
| `/play <query\|url>` | Search Qobuz (autocomplete), or play a Qobuz or Ohdio URL |
| `/ohdio <query\|url>` | Search Ohdio (autocomplete), play a show/episode URL, or tune live radio |
| `/skip` | Skip to the next track |
| `/queue` | Show upcoming tracks |
| `/stop` | Stop playback and clear the queue |
| `/qobuz-auth` | Bot owner only: Qobuz status and credential updates |

Anyone in the server can control playback.

### Ohdio

`/ohdio` searches Radio-Canada Ohdio. Autocomplete lists shows, recent episodes, and a live station when the query matches one. Pasting an [Ohdio](https://ici.radio-canada.ca/ohdio) URL into `/play` or `/ohdio` also works.

| Input | Result |
|-------|--------|
| Search text (`pénelope`, a podcast name) | Pick a show or episode from autocomplete |
| Episode, show, podcast, segment, audiobook, or playlist URL | Queue that item (a show URL plays the latest episode) |
| `premiere`, `ici premiere`, or an ICI Première URL | Live ICI Première for the configured region |
| `musique`, `ici musique`, or an ICI Musique URL | Live ICI Musique |

Live streams keep playing until you skip or stop. Catch-up needs no Radio-Canada login.

## How it works

```
Discord slash command
        │
        ├──────────────┐
        ▼              ▼
  Qobuz API      Ohdio (Radio-Canada)
  search /       GraphQL + HLS stream
  stream URL
        │              │
        └──────┬───────┘
               ▼
        ffmpeg (transcode to Opus)
               │
               ▼
        Discord voice channel
```

The bot runs as a single Node.js process. Each guild gets its own queue and voice connection. Audio is fetched from Qobuz or Ohdio, transcoded on the fly, and pushed to Discord via `@discordjs/voice`.

## Development

### Contribute

Clone the repository to work on the bot locally:

```bash
git clone https://github.com/marcag3/qobuz-discord.git
cd qobuz-discord
cp .env.example .env
# fill in .env — see Installation above
npm install
npm test
npm run build
npm start
```

Run with file watching during development:

```bash
npm run dev   # terminal 1 — recompiles on change
npm start     # terminal 2
```

Build and run the container from source:

```bash
docker build -t qobuz-discord .
docker run -d --name qobuz-discord --env-file .env -v qobuz-data:/app/data --restart unless-stopped qobuz-discord
```

Integration tests (live Qobuz API, requires `QOBUZ_USER_TOKEN`):

```bash
npm run test:integration
```

### Documentation

| Doc | Purpose |
|-----|---------|
| [DESIGN.md](./docs/DESIGN.md) | Architecture, commands, deployment |
| [STACK_EVALUATION.md](./docs/STACK_EVALUATION.md) | Why custom vs Lavalink / NodeLink |
| [SPIKES.md](./docs/SPIKES.md) | Validation experiments |
| [IMPLEMENTATION_STATUS.md](./docs/IMPLEMENTATION_STATUS.md) | Build and test checklist |

## License

[ISC](LICENSE)
