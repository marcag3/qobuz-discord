# qobuz-discord

Private Discord bot that streams from a single premium Qobuz account.

**Status:** Implementation complete — MVP + polish. See [docs/IMPLEMENTATION_STATUS.md](./docs/IMPLEMENTATION_STATUS.md).

## Documentation

| Doc | Purpose |
|-----|---------|
| [DESIGN.md](./docs/DESIGN.md) | Target architecture, commands, deployment |
| [STACK_EVALUATION.md](./docs/STACK_EVALUATION.md) | Why custom vs NodeLink / Lavalink / forks |
| [SPIKES.md](./docs/SPIKES.md) | Phase 0 validation experiments (start here) |
| [SPIKE_RESULTS.md](./docs/SPIKE_RESULTS.md) | Record spike outcomes |
| [handoff.md](./docs/handoff.md) | Prior NodeLink + ByteBlaze homelab lessons |

## Quick start

```bash
cp .env.example .env
# Set DISCORD_TOKEN, DISCORD_CLIENT_ID, QOBUZ_USER_TOKEN — see docs/SPIKES.md

npm install
npm test
npm run build
npm start
```

### Docker

```bash
docker compose up --build
```

### Manual smoke checklist

- [ ] Bot joins voice on `/play`
- [ ] `/play bohemian rhapsody` plays audio
- [ ] `/skip`, `/queue`, `/stop` work
- [ ] `/search` select menu enqueues selection
- [ ] Now Playing buttons (Skip / Stop / Queue) work
