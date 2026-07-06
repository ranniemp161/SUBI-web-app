# Memory — Splitting the Wallet App & DB Tokens Migration

Last updated: 2026-07-06 (evening)

## What was built

- **Standalone Wallet App (`apps/wallet`)**: Scaffolding complete; core dashboard, Stripe checkout logic (with `FormData` support), and token calculation logic implemented and verified.
- **Centralized Database (`packages/db`)**: Extracted all database definitions to a shared Drizzle package `packages/db`.
- **Database Schema Currency Rename**: Renamed the base currency representation across the schema from `credit_seconds` to a generalized `tokens` unit.
- **Production Database Fix**: Safely migrated the production Neon database. `drizzle-kit push` interactive prompts blocked column renames in CI; executed raw SQL migration scripts (`ALTER TABLE ... RENAME COLUMN ...`) on production to preserve data.
- **Rough Cut Refactor**: Refactored `apps/rough-cut` (25+ files) to pull from the shared `@repo/db` package and renamed all instances of `credit_seconds` to `tokens`. 221/221 unit tests passing.

## Decisions made

- The Wallet app is an entirely isolated app running on port 3000 locally, delegating `rough-cut` to 3001.
- `apps/wallet` manages Stripe bundle logic and the UI for buying tokens. `apps/rough-cut` solely consumes the tokens balance via `@repo/db` when making transcriptions/ai cuts.
- Used a backward-compatible fix in Stripe `getBundles()` logic (`tokensFromPrice`) to gracefully parse the legacy `credit_seconds` metadata from older test-mode Stripe products to prevent throwing "misconfigured bundle price".

## Problems solved

- **Database schema drift error**: Solved a 500 error on the dashboard caused by `users` column drift (code sought `tokens`, DB had `credit_seconds`) by safely syncing production without losing data.
- **Stripe fallback parsing**: Resolved a runtime crash in Wallet by adding fallback logic to correctly parse existing products lacking `tokens` metadata.
- **Refactoring cross-wiring**: Automated AST/regex replacements fixed `@/db` paths to `@repo/db` within `apps/rough-cut` alongside changing variable names to `tokens`, fixing all TS errors locally.

## Current state

- The Wallet app is working locally and running on `http://localhost:3000`.
- The Rough Cut app is refactored, type-checked, and passes all 221 unit tests. Currently running on `http://localhost:3001`.
- Production database safely migrated.
- Everything is in the working tree / ready for a `git commit`.

## Next session starts with

1. Confirm and commit the working-tree changes ("feat: split wallet app and migrate db to tokens"), then push.
2. Verify end-to-end token purchasing via the local Wallet app using test Stripe cards.
3. Test that transcribing a video in the Rough-Cut app correctly reads and decrements the new tokens balance.

## Open questions

1. Should the "Buy credits" modal that still exists inside the Rough-Cut app be removed or modified to deep-link directly to the separated Wallet app?
2. Are production Stripe environment variables perfectly mirrored between the separated apps?
