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
| `src/schema.ts` | Table defs: `users`, `projects`, `creditLedger`, `aiCutRuns`, plus B-Roll's `brollProjects`, `brollAssets`, `brollScenes`, `brollCharacters` (+ enums `transcript_status`, `credit_ledger_reason`, `broll_render_status`). The `broll_*` tables and `credit_ledger.broll_project_id` arrived in migration `0015` (spec `docs/specs/broll/0002-data-model`), **applied to the dev branch and to production on 2026-08-08**; `apps/broll` is a live workspace and reads them on every page. Three more followed: `0016` adds the `credit_ledger_reason` values in their own migration (Postgres will not let a value added in a transaction be used in that same transaction), `0017` adds `broll_scenes.chart_rejection_reason` and `user_edited_at`, and `0018` (spec `docs/specs/broll/0007-character-reuse`) creates `broll_characters` and moves an asset's owner from the project to the character. **`0017` and `0018` are applied to the dev branch only**: production carries no b-roll rows and b-roll has no production deploy yet, so they land there with that deploy. `0019` and `0020` (spec `docs/specs/broll/0008-object-scenes`) add object scenes and are the same shape as the `0016`/`0015` pair: `0019` adds the `broll_object_image` ledger reason on its own and `0020` adds the four `broll_scenes` object columns. **Apply them in two separate `db:migrate` runs** — see the Gotcha below about one transaction. `accessCodes` is gone — migration `0012_retire_access_codes.sql` dropped it; the `users` row itself is the authorization now. `projects.source_fps_num`/`source_fps_den` (migration `0013`) hold the source video's frame rate as an exact rational so 29.97 stays 30000/1001; written by the browser at reselect, and read only by rough-cut's transcript route, which needs a timebase with no source file in hand |
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
This package also has `typecheck` and `test`, and both gate `main` through the
`check` job. They were added late: before that this package had no `tsconfig.json`
of its own and no `test` script, so `schema.ts` was only ever checked through
whatever the apps imported, and the two test files in `src/` had never run once.
```bash
npm -w @repo/db typecheck   # tsc --noEmit, via the root tsconfig.base.json
npm -w @repo/db test        # vitest run
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
- Every statement that mutates a balance lives in `@repo/billing`, never in an
  app. The ledger row and the cached balance move together inside one statement
  there, which is what makes the `CHECK` above enough without transactions. See
  `packages/billing/AGENTS.md`.
- The Neon HTTP driver is stateless per request (no pool). `withDbRetry` in
  `src/index.ts` retries only connection-establishment failures (regex-matched
  in `RETRYABLE`), never a failure after a query may have committed.

## Gotchas
- **Every pending migration runs inside ONE transaction.** `drizzle-kit`'s
  migrate path opens a single `BEGIN`, replays every statement of every pending
  migration file, then `COMMIT`s (its `transactionProxy`; `drizzle-orm`'s own
  migrator does the same at `pg-core/dialect.cjs`). Two consequences that are
  easy to get wrong:
  - A lock taken by an early statement is held until the whole run commits. So
    `ADD CONSTRAINT ... NOT VALID` followed by `VALIDATE CONSTRAINT` **in the
    same file buys nothing** — the point of that split is to let writers through
    during the scan, and they are blocked either way. It only works across two
    migration files applied in two separate `db:migrate` runs. This cost a
    withdrawn acceptance criterion (AC-47 in spec `broll/0002`); migration `0015`
    adds its constraints plainly and records the reasoning inline.
  - A "separate, later migration" is only a separate transaction once the
    earlier one has actually been applied. Generating two and running
    `db:migrate` once puts them in the same transaction.
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
