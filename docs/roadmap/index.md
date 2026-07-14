# Roadmap — SUBI ecosystem (monorepo)

Maps every workspace roadmap in this repo. Each app plans its own slices; repo-wide concerns (shared `packages/db`, the wallet billing portal, cross-app conventions) live in `_root`.

| Workspace | Roadmap | Status rollup |
|---|---|---|
| `_root` (ecosystem-wide) | [docs/roadmap/_root/roadmap.md](_root/roadmap.md) | 1/1 planned features done (USD-denominated Wallet), 1 drift item enrolled, 2 follow-ups queued |
| `apps/rough-cut` | [docs/roadmap/rough-cut/roadmap.md](rough-cut/roadmap.md) | 6/7 planned features done, 1 in-progress (studio auto-cut flow), 1 deferred, 10 pre-existing capabilities enrolled for context |
| `apps/wallet` | tracked under `_root` (the Wallet app *is* the ecosystem-wide billing feature) | see `_root` |

## Notes

- `apps/wallet` has no roadmap of its own — its build is the `_root` roadmap's "USD-denominated Wallet" feature, since it's a single ecosystem-wide capability rather than a set of app-local slices.
- Rough Cut's roadmap was created after most of the app already shipped; ten capabilities (landing page, auth, dashboard, transcription pipeline, editor, AI cutting, export, credit metering, rate limiting, cron cleanup) were enrolled `existing` on 2026-07-08 from a code scan, not planned here.
