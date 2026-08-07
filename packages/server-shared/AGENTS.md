# @repo/server-shared

## Overview
Shared server-only utilities for the SUBI ecosystem, extracted out of `apps/rough-cut` so `apps/wallet` (and any future app) gets the same rate limiting, error reporting, and **authorization** without duplicating the logic. Consumed by both `apps/rough-cut` and `apps/wallet`.

## Key files

| File | Owns |
|---|---|
| `src/rate-limit.ts` | `rateLimit()` — fixed-window limiter backed by Upstash Redis (Vercel KV). Takes a `failClosed` option: false (default) fails open on a Redis error, true fails closed for money-moving/idempotency-guard paths. |
| `src/ip-rate-limit.ts` | `getClientIp()` + `ipRateLimit()` — the limiter keyed by IP instead of a Clerk user id, for the routes with no session (each app's `proxy.ts` public list). |
| `src/authz.ts` | `getAuthorizedDbUser()` — the write-route gate. The `users` row IS the authorization; this reads it and lazily provisions from Clerk when the webhook hasn't landed yet. |
| `src/users.ts` | `provisionUser()` + `isAllowlistedMember()` — the idempotent upsert of a `users` row, and the single rule deciding who gets the monthly member grant. |
| `src/observability.ts` | `reportError()` — logs to console and forwards to Sentry (`@sentry/nextjs`); a no-op until Sentry is configured. This is how errors caught and swallowed by route handlers reach Sentry. |
| `src/index.ts` | Re-exports all of them. |

## Conventions
- Each app keeps its own thin wrapper on top of `rateLimit()` for its specific buckets/keys (e.g. `apps/rough-cut/src/lib/rate-limit.ts` defines `readRateLimit`/`aiCutRateLimit`); this package owns only the shared mechanism, not app-specific limits.
- **No app may keep a local copy of `authz`, `users`, or `ip-rate-limit`.** They gate the same `users` row against the same database, and the copies had already drifted before they were consolidated here (see Gotchas).
- **`getAuthorizedDbUser` only ever trusts an email Clerk reports as PRIMARY **and** VERIFIED.** A signed-in user can attach extra, initially unverified addresses to their own Clerk profile, so `emailAddresses[0]` is attacker-influenced. Membership follows the stored email, so trusting an arbitrary array entry lets someone self-grant the monthly credit grant by adding `MEMBER_ALLOWLIST_EMAIL` as a secondary address. Never soften this check.
- Import via the package exports, not deep relative paths: `@repo/server-shared`, `@repo/server-shared/rate-limit`, `@repo/server-shared/ip-rate-limit`, `@repo/server-shared/authz`, `@repo/server-shared/users`, `@repo/server-shared/observability`.
- No build step — consumed as TypeScript source directly (workspace package), same pattern as `packages/ui`.

## Gotchas
- **A test that mocks a *route's* limiter must mock the layer the route actually calls.** `ipRateLimit` lives here and calls this package's own `./rate-limit`, so mocking an app-local `@/lib/rate-limit` shim no longer intercepts it — mock `@repo/server-shared/rate-limit` instead (mocking one layer below `ipRateLimit` is deliberate in `transcribe/callback/route.test.ts`, so the real `getClientIp()` key construction still runs and can be asserted).
- **The Wallet copy of `authz` was the unsafe one.** It read `emailAddresses[0]` blind while rough-cut's required a verified primary — and because Wallet's `getAuthorizedDbUser` provisions rows too, it could write an unverified, user-chosen email into the `users` row that rough-cut's authz later falls back to reading. Consolidation kept rough-cut's implementation. This is the same failure mode `@repo/billing` exists to prevent: two copies of one rule do not stay in sync.

## Related ADRs
- `docs/adr/_root/0001-monorepo-wallet-architecture.md` — why shared server logic lives in its own package rather than being duplicated per app.
