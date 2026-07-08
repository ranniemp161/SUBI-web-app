# Memory — USD Wallet: money-ledger + auto-recharge (slices 1 & 2)

Last updated: 2026-07-08

## What was built

- **Slice 1 (money-ledger)** — redenominated the balance from `tokens` (seconds) to **USD micros** (1,000,000 = $1). Schema renames in `packages/db/src/schema.ts` (`balance_micros`/`delta_micros`/`hold_micros`, CHECK `users_balance_micros_nonneg`, enum `+conversion +auto_recharge`); migrations `0002_usd_micros_rename.sql` + `0003_usd_micros_convert.sql`. New `packages/ui/src/money.ts` (`formatUsd`, `chargeMicrosForSeconds`, `RETAIL_MICROS_PER_MINUTE=316667`). Both apps' `lib/credits.ts` converted to micros. `stripe.ts` `tokensFromPrice`→`creditMicrosFromPrice`; webhook/checkout use `creditMicros`. Balance shown as `$X.XX` (wallet dashboard, rough-cut credits-panel/gate).
- **Slice 2 (auto-recharge)** — 6 `users` columns + migration `0004_autorecharge_columns.sql`. New `apps/wallet`: `lib/autorecharge.ts` (idempotency key, cap, deposit, failure/auto-disable), `lib/notifications.ts` (seam), `api/billing/setup-intent`, `api/billing/autorecharge` (settings + validation), `api/cron/autorecharge` (sweep). Extended `lib/stripe.ts` (off-session helpers), checkout (save card), webhook (auto_recharge deposit + setup_intent). Cron in root `vercel.json` (`*/2 * * * *`).
- **Bug fix (/debug)** — added `/api/cron(.*)` to both apps' `proxy.ts` public matcher (Clerk middleware was 401'ing the session-less cron caller before its `CRON_SECRET` check). Fixed the wallet auto-recharge/cleanup crons and rough-cut's blob-sweep. Regression tests added to both `proxy.test.ts`.
- **Tests** — `money.test.ts`, `stripe.test.ts`, `autorecharge.test.ts`, settings/cron/webhook route tests. Added `test` script to `packages/ui/package.json`.

## Decisions made

- Money stored as **integer USD micros**, formatted to `$X.XX` only at the display edge. Metering rate (316,667/min) differs by design from the exact bundle-conversion (19,000,000/3600s) — an hour meters to 19,000,020 vs the $19 bundle's 19,000,000.
- Conversion migration `0003` writes a **reconciling delta** (`new_balance − existing_ledger_sum`), deviating from the ADR's literal "delta = new balance", so `SUM(delta_micros) == balance_micros` holds exactly. **Flagged in the SQL + ADR for confirmation.**
- `drizzle-kit migrate` **cannot** run these migrations (it batches all pending in one transaction; `0003` uses the enum value `0002` adds in that same transaction — Postgres forbids it). Use the **neon-http migrator** (autocommit) instead. Documented in the ADR.
- Auto-recharge **notification channel is deferred** (open ADR question) — built a log-only seam, not a provider. Failure accounting lives in the **sweep** (not the webhook) because off-session `confirm:true` fails synchronously and catches `authentication_required` (which emits no `payment_failed` webhook); the webhook is an idempotent backstop.
- Idempotency key = `autorecharge:v1:<user>:s<successesToday>:f<failures>` — advances only on real state change, so sweep re-runs dedup while declines still retry to auto-disable.

## Problems solved

- Applied all 4 migrations to the **dev** Neon branch via the neon-http migrator after inserting the one-time `0000` baseline row (the tracking table existed but was empty; `rate_limits` still present). Reconciliation passed (2 real users: 20,045 tok → $105.79, 1,016 tok → $5.36).
- The `/api/cron` 401 bug (above) — found during `/verify`, fixed in `/debug`.

## Current state

- **Slices 1 & 2 built, migrated on dev, and verified end-to-end on dev** (real Stripe test off-session charge credited a seeded user $1→$20; idempotency, daily cap, decline→auto-disable all confirmed). Auto-recharge logic is unit-tested and green.
- Both apps typecheck clean. **Pre-existing/unrelated red tests:** wallet `env.test.ts` (env-var isolation) and `webhook-test.test.ts` (live-DB, no `DATABASE_URL` in vitest) — not from this work.
- **Nothing committed** this session — all changes are in the working tree, uncommitted. **App still not deployed; prod migrations `0002`–`0004` not applied.**
- Roadmap feature `USD-denominated Wallet` is `in-progress`: money-ledger + auto-recharge build boxes ticked; feature-level `Verify it`/`Test it` stay unticked (they cover all 3 slices).

## Next session starts with

- **`/develop wallet-ui`** — slice 3 (ADR 0002/0003): premium wallet billing UI on `@repo/ui` + minimal rough-cut "add funds" prompt (AC-9). This is the last slice; it lets `Verify it`/`Test it` close the whole feature to `done`.
- Then `/sync` (refresh `packages/db/AGENTS.md`, still says "tokens" not micros; record auto-recharge conventions).

## Open questions

- Confirm the `0003` reconciling-delta deviation with `/architect` (or accept as-is).
- Notification channel for auto-recharge (email provider vs in-app) — deferred ADR decision.
- Member monthly grant's money-era form (deferred to client) — `ensureMonthlyGrant` runs in micros as a placeholder.
- Prod migration at deploy: baseline `0000`, then neon-http migrator (**not** the drizzle-kit CLI), re-run reconciliation (prod has more users).
