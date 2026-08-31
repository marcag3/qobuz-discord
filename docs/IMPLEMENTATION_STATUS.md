# Implementation progress

| Phase | Implement | Tests | Review | Refactor | Status |
|-------|-----------|-------|--------|----------|--------|
| 1 Scaffold | done | done | done | done | complete |
| 2 Qobuz adapter | done | done | done | done | complete |
| 3 Player | done | done | done | done | complete |
| 4 Commands | done | done | done | done | complete |
| 5 Search + deploy | done | done | done | done | complete |
| 6 Polish | done | done | done | done | complete |

## Verification

- `npm run build` — TypeScript compile
- `npm test` — 25 unit tests (fixtures + mocks)
- `npm run test:integration` — live Qobuz (requires `QOBUZ_USER_TOKEN`)
- `npm run lint` — ESLint
- `docker compose build` — container image

## Manual smoke (Discord)

Run the bot with valid `.env`, then verify:

- [ ] `/play bohemian rhapsody` — audible playback
- [ ] `/search lane 8` — select menu, queue on selection
- [ ] `/skip`, `/queue`, `/stop`
- [ ] Now Playing buttons (Skip / Stop / Queue)
