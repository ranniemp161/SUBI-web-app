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
| `src/schema.ts` | Table defs: `users`, `projects`, `creditLedger`, `aiCutRuns` (+ enums `transcript_status`, `credit_ledger_reason`). `accessCodes` is gone — migration `0012_retire_access_codes.sql` dropped it; the `users` row itself is the authorization now. `projects.source_fps_num`/`source_fps_den` (migration `0013`) hold the source video's frame rate as an exact rational so 29.97 stays 30000/1001; written by the browser at reselect, and read only by rough-cut's transcript route, which needs a timebase with no source file in hand |
| `src/index.ts` | `db` singleton (Neon HTTP driver) + `withDbRetry` (timeout/retry wrapper around retryable connection failures) |
| `drizzle/*.sql` | Committed, reviewed migration history (source of truth for schema changes) |
| `drizzle.config.ts` | Reads `DATABASE_URL` from `.env.local` in this directory |
| `scripts/preflight.ts` | Prints the target host/endpoint/database and requires you to type the endpoint id back before `db:migrate` or `db:push` runs. Set `MIGRATE_CONFIRM=<endpoint>` to skip it in a script — the value must match the endpoint **exactly**, including the `-pooler` suffix a pooled connection string carries (`ep-restless-wind-aou4pefe-pooler`, not `ep-restless-wind-aou4pefe`), or it refuses |
| `MIGRATIONS.md` | Full migration runbook — read before touching schema or running any `db:*` command |

## Commands
Run from `packages/db` (all drizzle-kit commands must run from here — this is
where `drizzle.config.ts` lives):
```bash
npm run db:generate   # schema.ts changed -> emit a reviewed SQL migration file
npm run db:migrate    # apply pending migrations (tracked in __drizzle_migrations)
npm run db:verify     # read-only check that the live schema matches schema.ts
npm run db:push       # dev branch ONLY - can silently drop/recreate columns
npm run db:studio     # browse the DB
```

## Conventions
- **Two Neon branches** in project `SUBI-APP` (`gentle-meadow-01487691`):
  `production` (`ep-restless-wind-aou4pefe`) serves Vercel Production **and
  Vercel Preview**; `dev` (`ep-holy-hall-aoe13azt`) is local only. `.env.local`
  points at `dev` and must stay that way — never edit it to point at production,
  not even temporarily.
- **`apps/rough-cut/.env.local` points at `production`, unlike this package's.**
  Verified 2026-08-06 by reading both files. Running the app locally therefore
  reads and writes the production database, while a bare `db:migrate` from here
  hits `dev`. The two disagree on purpose; assuming either holds for the other
  sends you at the wrong database. Read the file before running anything.
- **Reach production explicitly, per command.** `dotenv` does not override
  existing env vars, so an inline value wins:
  `DATABASE_URL="$(neonctl connection-string production --project-id gentle-meadow-01487691 --role-name neondb_owner --database-name neondb --pooled)" npm run db:migrate`
- **Production gets `generate` + `migrate` only.** `db:push` is for `dev`: it
  schema-diffs with no history and will silently offer a destructive
  drop/recreate for type conversions (see MIGRATIONS.md).
- **Migrations must be backward compatible** — deployed code keeps serving
  traffic against the schema mid-change, and Preview reads `production`. Add,
  deploy, then drop in a *later* migration; never rename or drop in the same
  step as the code change.
- `db:migrate` and `db:push` run `scripts/preflight.ts` first, which prints the
  target endpoint and refuses to continue until you type it back. Nothing else
  in the chain reports which database it touched.
- `.github/workflows/db-verify.yml` re-checks the live schema after every
  production deploy using a **read-only** role. CI never writes to the database;
  applying migrations stays manual and local.
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
