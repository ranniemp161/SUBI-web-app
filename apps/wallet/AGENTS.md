<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Overview
Centralized billing/credits portal for the SUBI app ecosystem (per ADRs `0001` and `0002`). Users buy USD-denominated bundles or enable auto-recharge via Stripe; the balance (stored in `micros`) is spent by other apps (currently `apps/rough-cut`) against the shared `@repo/db` credit ledger. Runs on port 3001.

## Key files
| File | Owns |
|---|---|
| `src/lib/stripe.ts` | Lazy Stripe singleton + `allowedPriceIds()` — bundles are a Stripe Price allowlist (`STRIPE_PRICE_IDS`, comma-separated), each carrying `metadata.credit_micros`; prices/amounts live entirely in the Stripe dashboard. Also includes auto-recharge and saved card utilities |
| `src/app/api/cron/autorecharge/route.ts` | Scheduled cron job that sweeps candidates and bills off-session for auto-recharge. Charges `CONCURRENCY` (10) users at a time, stops starting new batches at a 240s budget under the 300s `maxDuration`, and returns `{swept, processed, remaining, charged, declined, capped, skipped, errored}` |
| `src/app/api/billing/checkout/route.ts` | Creates the Stripe Checkout session |
| `src/app/api/webhooks/stripe/route.ts` | Stripe webhook — writes the credit-ledger grant on successful payment (idempotent via `stripeEventId`) |
| `src/lib/env.ts` | Validated cross-app URL (`ROUGH_CUT_URL`) — same pattern as rough-cut's `env.ts`; only place allowed to read `NEXT_PUBLIC_ROUGH_CUT_URL` |
| `@repo/server-shared/authz`, `@repo/server-shared/users` (not in this app) | Write-route authorization and user provisioning against the shared `@repo/db` `users` row. This app's local copies are deleted: its `authz` read `emailAddresses[0]` blind where rough-cut's required a **verified primary** address, and since this app provisions rows too, that could write an unverified user-chosen email into the row rough-cut later trusts. The safer implementation won. See `packages/server-shared/AGENTS.md` |
| `src/lib/autorecharge.ts` | Auto-recharge candidate selection, the per-day cap, the decline counter, and `depositAutoRecharge` — **the one ledger-writing statement still outside `@repo/billing`**, kept here because it resets `autorecharge_failures` in the same atomic statement. Moving it is a queued follow-up |
| `src/app/api/cron/cleanup/route.ts` | Scheduled cleanup job |
| `src/proxy.ts` | Clerk auth middleware, same pattern as rough-cut |

## Commands
```bash
npm run dev -w wallet     # next dev -p 3001 (port pinned)
npm run test -w wallet    # vitest run
```
Tests also run via the root `npm run test` (turbo), which picks this script up.

## Conventions
- Stripe is the sole billing authority for the whole ecosystem — no other app processes payments directly (see ADR `0001`).
- **The auto-recharge sweep is genuinely concurrent, and `sweepOne` must stay total.** Candidates are charged 10 at a time through `Promise.all`, so a function that *rejects* instead of returning an `Outcome` would discard the outcomes of the nine siblings sharing its batch — charges that may already have reached Stripe. Every path in `sweepOne` returns an outcome, and even the decline-recording write is wrapped (`noteFailureQuietly`) so a database hiccup can't escape. Keep it that way when adding a branch.
- **A non-zero `remaining` from the sweep is a page, not a stat.** It means candidates fell off the end of the time budget, and on Hobby the next run is ~24h away, so those users can reach $0 in the meantime. The route reports it to Sentry as well as in the body.
- **Balance mutations go through `@repo/billing`, never a local copy.** This app used to carry its own 434-line `src/lib/credits.ts`; it was dead except for `depositPurchase`, untested, and had already drifted from rough-cut's version (its `chargeAiCut` lacked the `ON CONFLICT` idempotency guard). It is deleted. See `packages/billing/AGENTS.md`.
- Bundle prices/amounts are never hardcoded in code; they come from the Stripe dashboard via the `STRIPE_PRICE_IDS` allowlist plus each Price's `metadata.credit_micros`.
- **Bundle changes take up to ~5 minutes to appear, by design.** `GET /api/billing/bundles` is CDN-cached (`s-maxage=300` + `stale-while-revalidate`) and `stripe.ts` keeps a per-instance in-memory cache; neither has a purge hook. After changing `STRIPE_PRICE_IDS` or a Price's `metadata.credit_micros`, the displayed bundles can be stale for up to ~5 minutes (redeploy to bust both layers immediately). This only affects the *listing*: checkout re-validates the priceId against the allowlist and fetches the live Price from Stripe at purchase time, so a stale card can never charge a stale amount.
- Shares `@repo/db`, Clerk config, Sentry, and Upstash rate-limiting conventions with `apps/rough-cut` — see `apps/rough-cut/AGENTS.md` for the patterns (env validation, IP vs per-user rate limiting, Sentry env-gating) which apply identically here.

## Related ADRs
- `docs/adr/_root/0001-monorepo-wallet-architecture.md`
- `docs/adr/_root/0002-usd-wallet/index.md`
