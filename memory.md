# Memory — Bandwidth Review + Stripe Sandbox Setup + Credits Verification

Last updated: 2026-07-05 (late)

## What was built

Nothing new in application code this session — this session was infrastructure/verification work on top of the credit system built in prior sessions (schema, engine, Stripe wiring, dashboard UI — all still uncommitted, see prior memory).

- **[src/app/api/billing/bundles/route.ts](src/app/api/billing/bundles/route.ts)** — dropped the `auth()` gate (bundle prices aren't sensitive/user-specific) and added `Cache-Control: public, s-maxage=300, stale-while-revalidate=3600`, so Vercel's edge can serve repeat requests without invoking the function or hitting Stripe. Test file updated to match (dropped the 401 test, added a cache-header assertion).
- **Migration `drizzle/manual/0004_credit_ledger_cost_tracking.sql` — now applied to the dev DB.** `credit_ledger.cost_micros` and the `'ai_cut'` enum value both confirmed present via direct query.
- **Stripe test-mode fully wired**: `STRIPE_SECRET_KEY` (sandbox), 3 bundle Products/Prices created via the Stripe API (Starter $19/60min, Standard $79/300min, Bulk $249/1000min — `metadata.credit_seconds` = 3600/18000/60000), `STRIPE_PRICE_IDS` set in `.env.local`. Stripe CLI installed (winget), logged in, and `stripe listen --forward-to localhost:3000/api/webhooks/stripe` is running in a background task — its `whsec_...` is in `STRIPE_WEBHOOK_SECRET`.
- Two throwaway verification scripts were written, run, and deleted (not committed): one exercising `chargeAiCut`/`refundAiCut`/overdraft-guard logic against a scratch user+project row in the real dev DB (all 8 assertions passed), one reading back the `purchase` ledger row after a manual Stripe Checkout test.

## Decisions made

- **Bundle pricing endpoint made public + edge-cacheable** — the data (Stripe Prices) isn't sensitive or user-specific, so requiring auth only cost an invocation with no security benefit. Checkout itself (`/api/billing/checkout`) still requires auth; only the read-only listing was opened up.
- **Bandwidth architecture confirmed sound for the 100GB Vercel free tier** — video/audio never streams through Vercel (client-side `URL.createObjectURL`, direct-to-Blob uploads, blobs deleted immediately post-transcription). The real cost lever to watch is Vercel Blob *data transfer* from transcription audio, not Fast Data Transfer — and even that is deep in free-tier territory at current pricing/margins. No caching changes were needed beyond the bundles route.

## Problems solved

- **Neon HTTP driver can't run multi-statement SQL scripts.** `sql.unsafe(script)` on a BEGIN/DO $$/COMMIT script silently no-ops (returns a query-builder object, never executes) — this looked like a successful migration run until verified directly against `information_schema`. Fixed by running the migration as two separate idempotent statements (`ALTER TYPE ... ADD VALUE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) instead of the transactional DO-block version. **Lesson: always verify a migration against the DB's actual state, not just the absence of a thrown error** — this is the second time this exact failure mode has bitten this project (see prior session's `settleHold` RETURNING-clause bug).
- A dotenv console "tip" referencing `vestauth.com` looked like a possible supply-chain/prompt-injection concern; confirmed benign by reading `node_modules/dotenv/lib/main.js` directly — it's a hardcoded self-promotional string array with no network call.

## Current state

- Migration `0004` is live in the dev DB and verified working end-to-end (ledger writes, cost_micros, enum value all confirmed via a scratch charge/refund/overdraft test).
- Stripe sandbox is fully wired and **manually tested successfully by the user**: a real Checkout test purchase (Starter bundle, test card) completed, webhook fired, and the `purchase` ledger row + balance bump were confirmed directly in the dev DB (balance landed at 5110s for the test account).
- `stripe listen` is still running in a background task on this machine — needed for the webhook to keep working locally; if it's restarted, `STRIPE_WEBHOOK_SECRET` in `.env.local` will need updating again (a fresh secret is issued each time `stripe listen` starts).
- **Still nothing committed to git** — all credit-system + Stripe + AI Cut metering work across this session and prior sessions remains uncommitted working-tree changes.

## Next session starts with

1. Prepare and confirm a commit covering the full credit system + AI Cut metering + Stripe wiring + the bundles route caching change (user was about to be asked this when the session ended).
2. Nothing else is blocking — migration, Stripe, and credits verification are all done. After committing, the remaining rollout work is genuinely deploy-time only: setting the same env vars (this time with a **live**-mode Stripe key/webhook, not sandbox) on Vercel's production project settings.

## Open questions

1. `TRANSCRIPTION_COST_MICROS_PER_SECOND` (1383) and `AI_CUT_COST_MICROS_PER_SECOND` (1217) are still estimates — revisit once real `cost_micros` data accumulates post-launch (carried over from prior session).
2. Whether/when to open signup to non-Skool members is still undecided (carried over from prior session).
3. Live-mode Stripe setup (real Products/Prices/webhook against a real bank-connected account) hasn't been started — today's work was sandbox-only.
