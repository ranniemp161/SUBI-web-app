# Memory — Wallet App Hardening & Security Fixes

Last updated: 2026-07-07

## What was built

- Fixed an AI Cut double-charging race condition by implementing an atomic idempotency guard. Updated `apps/rough-cut/src/app/api/projects/[id]/ai-cut/route.ts` to check an `Idempotency-Key` header against the Postgres `rate_limits` table.
- Updated the frontend `runAiCut` flow in `apps/rough-cut/src/app/(app)/dashboard/[id]/page.tsx` to safely generate and pass a UUID as the `Idempotency-Key` header, preventing duplicate requests on double-clicks.
- Created a serverless cron endpoint at `apps/wallet/src/app/api/cron/cleanup/route.ts` to `DELETE` expired rate limit buckets, fixing unbounded database growth. Configured a `vercel.json` cron to trigger this daily.
- Secured the Stripe checkout flow in `apps/wallet/src/app/api/billing/checkout/route.ts` by strictly enforcing `process.env.PUBLIC_APP_URL` instead of relying on the incoming request `Host` header.

## Decisions made

- Chose to use the existing `rate_limits` table structure as a 24-hour distributed lock to enforce API idempotency for AI cut generation, avoiding the need for a Drizzle database migration.
- Decided to fail loudly (returning a 500 error and reporting to Sentry) if `PUBLIC_APP_URL` is unconfigured in production, explicitly averting host header injection phishing risks.

## Problems solved

- **Concurrency Race Condition**: Eliminated the possibility of the `chargeAiCut` CTE running twice concurrently for the same frontend click event.
- **Postgres Table Bloat**: Ensured the IP-based rate limiting system won't exhaust DB storage under a distributed botnet attack.

## Current state

- Hardening fixes are fully implemented, uncommitted in the working tree.
- TypeScript compiler passes cleanly across the workspace (`turbo run typecheck`).
- The Wallet app is now significantly more robust against production load and adversarial input.

## Next session starts with

- Commit the hardening fixes to the repository.
- Verify the fixes against any upcoming integration tests or continue expanding Wallet app features.

## Open questions

- None at the moment.
