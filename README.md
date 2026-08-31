# qobuz-discord

Private Discord bot that streams from a single premium Qobuz account.

**Status:** Planning — custom monolith approach chosen; **search spike is next** (see [docs/SPIKES.md](./docs/SPIKES.md)).

## Documentation

| Doc | Purpose |
|-----|---------|
| [DESIGN.md](./docs/DESIGN.md) | Target architecture, commands, deployment |
| [STACK_EVALUATION.md](./docs/STACK_EVALUATION.md) | Why custom vs NodeLink / Lavalink / forks |
| [SPIKES.md](./docs/SPIKES.md) | Phase 0 validation experiments (start here) |
| [SPIKE_RESULTS.md](./docs/SPIKE_RESULTS.md) | Record spike outcomes |
| [handoff.md](./docs/handoff.md) | Prior NodeLink + ByteBlaze homelab lessons |

## Quick start (spikes only)

```bash
cp .env.example .env
# Add QOBUZ_USER_TOKEN — see docs/SPIKES.md
```

No bot code yet. Run spikes before `npm install` at repo root.
