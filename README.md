# qobuz-discord

Stream music from a premium Qobuz account into Discord voice channels.

A single-container bot for private servers — no Lavalink, no Redis, no multi-service stack. One shared Qobuz account, slash commands, and ffmpeg transcoding inside one process.

## Why this exists

There is no maintained bot that streams Qobuz directly into Discord voice. The alternatives fall short:

| Approach | Problem |
|----------|---------|
| Generic music bots | Hardcoded to YouTube or Spotify, not Qobuz |
| Lavalink / NodeLink stacks | Heavy to deploy; Qobuz sources often resolve metadata but fail to stream |
| Download-then-play bots | Write files to disk instead of live voice streaming |
| Qobuz search APIs | Poor ranking for natural-language queries — auto-playing result #1 plays the wrong track |

This bot keeps the deployment model simple and sidesteps search pain with a `/search` picker so users choose the right track instead of trusting rank #1.

## Features

- **Qobuz catalog search** with a select menu (`/search`)
- **Direct play** from a query or Qobuz URL (`/play`)
- **Queue management** — skip, view queue, stop
- **Now Playing** embed with inline controls
- **Single process** — discord.js, Qobuz client, and ffmpeg in one container (~128–256 MB RAM)
- **Per-guild queues** — each Discord server has its own playback queue

## Requirements

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/)
- A [Discord bot application](https://discord.com/developers/applications) (token + client ID)
- A **Qobuz premium** subscription

## Installation

### 1. Get the project files

```bash
git clone https://github.com/marcag3/qobuz-discord.git
cd qobuz-discord
cp .env.example .env
```

### 2. Configure credentials

Edit `.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | Yes | Bot token from the Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Yes | Application ID (same portal) |
| `QOBUZ_USER_TOKEN` | Yes | Browser session token — see below |
| `GUILD_ID` | No | Restrict slash-command registration to one guild (useful while testing) |

#### Qobuz user token

1. Log in at [play.qobuz.com](https://play.qobuz.com).
2. Open browser DevTools → **Network**.
3. Trigger any action that hits the Qobuz API (e.g. play a track).
4. Find a **POST** request to `api.json` and copy the `X-User-Auth-Token` header value into `QOBUZ_USER_TOKEN`.

The token expires periodically. When API calls start returning 401, repeat the steps above.

### 3. Start the bot

Pull the published image and run:

```bash
docker pull ghcr.io/marcag3/qobuz-discord:latest
docker compose up -d
```

Follow logs:

```bash
docker compose logs -f bot
```

To update later:

```bash
docker compose pull
docker compose up -d
```

### 4. Invite the bot

Create an OAuth2 invite URL in the Discord Developer Portal with:

- Scopes: **bot**, **applications.commands**
- Bot permissions: **Connect**, **Speak**, **Use Voice Activity**

Add the bot to your server, join a voice channel, and run `/search` or `/play`.

## Commands

| Command | Description |
|---------|-------------|
| `/search <query>` | Search Qobuz and pick a track from a menu |
| `/play <query\|url>` | Play a search query or Qobuz track/album URL |
| `/skip` | Skip to the next track |
| `/queue` | Show upcoming tracks |
| `/stop` | Stop playback and clear the queue |

Anyone in the server can control playback.

## How it works

```
Discord slash command
        │
        ▼
  Qobuz API (search / metadata / stream URL)
        │
        ▼
  ffmpeg (transcode to Opus)
        │
        ▼
  Discord voice channel
```

The bot runs as a single Node.js process. Each guild gets its own queue and voice connection. Audio is fetched from Qobuz, transcoded on the fly, and pushed to Discord via `@discordjs/voice`.

## Container image

Published to GitHub Container Registry:

```
ghcr.io/marcag3/qobuz-discord:latest   # default branch builds
ghcr.io/marcag3/qobuz-discord:v1.0.0   # semver releases
```

## Development

For local development, spikes, and architecture notes, see the [docs/](./docs/) directory:

| Doc | Purpose |
|-----|---------|
| [DESIGN.md](./docs/DESIGN.md) | Architecture, commands, deployment |
| [STACK_EVALUATION.md](./docs/STACK_EVALUATION.md) | Why custom vs Lavalink / NodeLink |
| [SPIKES.md](./docs/SPIKES.md) | Validation experiments |
| [IMPLEMENTATION_STATUS.md](./docs/IMPLEMENTATION_STATUS.md) | Build and test checklist |

```bash
npm install
npm test
npm run build
npm start
```

## License

ISC
