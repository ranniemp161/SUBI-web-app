# @repo/server-shared

## Overview
Shared server-only utilities for the SUBI ecosystem, extracted out of `apps/rough-cut` so `apps/wallet` (and any future app) gets the same rate limiting and error reporting without duplicating the logic. Consumed by both `apps/rough-cut` and `apps/wallet`.

## Key files
| File | Owns |
|---|---|
| `src/rate-limit.ts` | `rateLimit()` — fixed-window limiter backed by Upstash Redis (Vercel KV). Takes a `failClosed` option: false (default) fails open on a Redis error, true fails closed for money-moving/idempotency-guard paths. |
| `src/observability.ts` | `reportError()` — logs to console and forwards to Sentry (`@sentry/nextjs`); a no-op until Sentry is configured. This is how errors caught and swallowed by route handlers reach Sentry. |
| `src/index.ts` | Re-exports both. |

## Conventions
- Each app keeps its own thin wrapper on top of `rateLimit()` for its specific buckets/keys (e.g. `apps/rough-cut/src/lib/rate-limit.ts` defines `readRateLimit`/`aiCutRateLimit`); this package owns only the shared mechanism, not app-specific limits.
- Import via the package exports, not deep relative paths: `@repo/server-shared`, `@repo/server-shared/rate-limit`, `@repo/server-shared/observability`.
- No build step — consumed as TypeScript source directly (workspace package), same pattern as `packages/ui`.

## Related ADRs
- `docs/adr/_root/0001-monorepo-wallet-architecture.md` — why shared server logic lives in its own package rather than being duplicated per app.
