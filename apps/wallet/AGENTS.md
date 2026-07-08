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
| `src/app/api/cron/autorecharge/route.ts` | Scheduled cron job that sweeps candidates and bills off-session for auto-recharge |
| `src/app/api/billing/checkout/route.ts` | Creates the Stripe Checkout session |
| `src/app/api/webhooks/stripe/route.ts` | Stripe webhook — writes the credit-ledger grant on successful payment (idempotent via `stripeEventId`) |
| `src/lib/env.ts` | Validated cross-app URL (`ROUGH_CUT_URL`) — same pattern as rough-cut's `env.ts`; only place allowed to read `NEXT_PUBLIC_ROUGH_CUT_URL` |
| `src/lib/credits.ts`, `src/lib/access-codes.ts`, `src/lib/authz.ts` | Same shared-domain logic as rough-cut's equivalents, both apps read/write the same `@repo/db` ledger |
| `src/app/api/cron/cleanup/route.ts` | Scheduled cleanup job |
| `src/proxy.ts` | Clerk auth middleware, same pattern as rough-cut |

## Commands
```bash
npm run dev -w wallet     # next dev -p 3001 (port pinned)
```
Tests run via the root `npm run test` (turbo); no wallet-scoped test script is defined yet.

## Conventions
- Stripe is the sole billing authority for the whole ecosystem — no other app processes payments directly (see ADR `0001`).
- Bundle prices/amounts are never hardcoded in code; they come from the Stripe dashboard via the `STRIPE_PRICE_IDS` allowlist plus each Price's `metadata.credit_micros`.
- Shares `@repo/db`, Clerk config, Sentry, and Upstash rate-limiting conventions with `apps/rough-cut` — see `apps/rough-cut/AGENTS.md` for the patterns (env validation, IP vs per-user rate limiting, Sentry env-gating) which apply identically here.

## Related ADRs
- `docs/adr/_root/0001-monorepo-wallet-architecture.md`
- `docs/adr/_root/0002-usd-wallet/index.md`
