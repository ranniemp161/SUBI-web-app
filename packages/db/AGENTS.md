# @repo/db

## Overview
Shared Drizzle ORM package: schema, migrations, and the Neon HTTP DB connection
used by both `apps/rough-cut` and `apps/wallet` via `@repo/db` / `@repo/db/schema`.
Guarantees both apps read and write the exact same tables. Currency is
**micros** (US dollars, where 1,000,000 micros = $1, see ADR `0002-usd-wallet`),
tracked by an append-only ledger.

## Key files
| File | Owns |
|---|---|
| `src/schema.ts` | Table defs: `users`, `projects`, `creditLedger`, `accessCodes`, `aiCutRuns` (+ enums `transcript_status`, `credit_ledger_reason`) |
| `src/index.ts` | `db` singleton (Neon HTTP driver) + `withDbRetry` (timeout/retry wrapper around retryable connection failures) |
| `drizzle/*.sql` | Committed, reviewed migration history (source of truth for schema changes) |
| `drizzle.config.ts` | Reads `DATABASE_URL` from `.env.local` in this directory |
| `MIGRATIONS.md` | Full migration runbook — read before touching schema or running any `db:*` command |

## Commands
Run from `packages/db` (all drizzle-kit commands must run from here — this is
where `drizzle.config.ts` lives):
```bash
npm run db:generate   # schema.ts changed -> emit a reviewed SQL migration file
npm run db:migrate    # apply pending migrations (prod-safe, tracked in __drizzle_migrations)
npm run db:push       # DEV ONLY - schema-diff, no history, can silently drop/recreate columns
npm run db:studio     # browse the DB
```

## Conventions
- **`generate` + `migrate` is the only prod-safe path.** `push` is for
  disposable dev branches only — never point it at prod (see MIGRATIONS.md for
  the destructive drop/recreate it attempted on a real type conversion).
- Dev and prod are **separate Neon branches** — migrate each one separately,
  dev first.
- `users.balance_micros` is a cached balance; the source of truth is
  `SUM(credit_ledger.delta_micros)`. A DB `CHECK` (`users_balance_micros_nonneg`) makes
  concurrent spends safe without transactions — an overdraft raises Postgres
  error `23514` and rolls back the mutation.
- `credit_ledger` is append-only; `stripeEventId` is unique and doubles as the
  Stripe webhook idempotency key; one `grant`-reason row per user per
  `monthKey` is enforced by a partial unique index.
- The Neon HTTP driver is stateless per request (no pool). `withDbRetry` in
  `src/index.ts` retries only connection-establishment failures (regex-matched
  in `RETRYABLE`), never a failure after a query may have committed.

## Gotchas
- Prod predates migration tracking (`__drizzle_migrations` didn't exist until
  the baseline described in MIGRATIONS.md) — do not run `db:migrate` cold
  against prod without confirming the baseline row for migration `0000` is
  already inserted.
- Drizzle matches applied migrations by a SHA-256 hash of the migration file's
  contents computed at runtime, not a value stored in `_journal.json`.

## Related ADRs
- `docs/adr/_root/0001-monorepo-wallet-architecture.md` — why the schema lives
  in a shared package.
- `docs/adr/_root/0002-usd-wallet/index.md` — why the currency is `micros` (US dollars) instead of tokens, and how auto-recharge is tracked.
