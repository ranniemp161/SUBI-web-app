# Database migrations

Single source of truth for how schema changes reach a database. The schema lives
in [`src/schema.ts`](./src/schema.ts) and is imported by every app via
`@repo/db/schema`. All drizzle-kit commands run **from this package** (`packages/db`),
because this is where `drizzle.config.ts` lives.

```bash
cd packages/db
npm run db:generate   # schema.ts changed -> emit a reviewed SQL migration file
npm run db:migrate    # apply pending migrations, then verify live DB matches schema
npm run db:verify     # standalone schema check — fails loudly if drift is detected
npm run db:push       # dev branch only - schema-diff, no history (see below)
npm run db:studio     # browse the DB
```

## Which database you are pointing at

Two Neon branches in project `SUBI-APP` (`gentle-meadow-01487691`):

| Branch | Endpoint | Used by |
|---|---|---|
| `production` | `ep-restless-wind-aou4pefe` | Vercel Production **and Vercel Preview** |
| `dev` | `ep-holy-hall-aoe13azt` | your machine only |

`DATABASE_URL` is read from `.env.local` in this directory (see
`drizzle.config.ts`), and **`.env.local` points at `dev`. Leave it that way.**
The default target of every `db:*` command should always be the branch where a
mistake costs nothing.

### Reaching production deliberately

`dotenv` does not override variables already present in the environment, so an
inline `DATABASE_URL` beats `.env.local` in `drizzle.config.ts`, `preflight.ts`
and `verify.ts` alike. Name production explicitly, one command at a time:

```bash
DATABASE_URL="$(neonctl connection-string production \
  --project-id gentle-meadow-01487691 --role-name neondb_owner \
  --database-name neondb --pooled)" npm run db:migrate
```

Production is then reachable only by asking for it — never by forgetting to
change a file back. Do not "temporarily" edit `.env.local` to point at
production; that is the failure mode this layout exists to prevent.

> **Vercel Preview still uses the `production` branch.** Only your local machine
> moved to `dev`. Until preview branching is set up, a preview deployment reads
> and writes real production data, so **every migration must still be backward
> compatible** — see the rule below.

### The confirmation prompt

`db:migrate` and `db:push` run `scripts/preflight.ts` before drizzle-kit touches
anything. It prints the target and makes you type the endpoint id back:

```
  ┌─────────────────────────────────────────────
  │  About to run: migrate
  │  Host        : ep-cool-name-123456.us-east-2.aws.neon.tech
  │  Endpoint    : ep-cool-name-123456
  │  Database    : neondb
  │  User        : neondb_owner
  └─────────────────────────────────────────────

Type the endpoint id to continue (ep-cool-name-123456):
```

This exists because the target is whatever `.env.local` last pointed at, and
neither `drizzle-kit` nor `db:verify` prints the host — so before this, running
a migration against the wrong Neon branch produced no signal at all. Typing the
id back is deliberate: a `y/N` prompt gets answered from muscle memory, and the
whole point is to make you read the target.

The password is never printed. For a scripted run, set
`MIGRATE_CONFIRM=<endpoint-id>`; it must match the endpoint the connection
string actually resolves to, or the command refuses.

## The rule

- **Production gets `generate` + `migrate` only.** Every change reaching
  `production` is a committed, reviewed SQL file applied in order and tracked.
- **`db:push` is for `dev` only.** It does a schema-diff with no history and will
  silently offer a destructive drop/recreate for type conversions (it tried
  exactly this on the `transcript_status` text->enum change). Fine on `dev`,
  never against `production`.
- **Every migration must be backward compatible.** Deployed code keeps serving
  traffic against the schema you just changed, and Vercel Preview reads
  `production` too. Add a column, deploy the code that uses it, drop the old
  column in a *later* migration. Never rename or drop in the same step as the
  code change.

## Day-to-day workflow

1. Edit `src/schema.ts`.
2. While the shape is still churning, `npm run db:push` against `dev` to iterate
   fast. `.env.local` already points there, so this needs no arguments.
3. Once it settles: `npm run db:generate`, then **read the emitted
   `drizzle/NNNN_*.sql`**. This review is where a destructive change gets caught.
4. Commit the SQL file together with the code that needs it. CI blocks a
   `schema.ts` change that arrives without one.
5. Apply to `dev` first — `npm run db:migrate` — to confirm the migration runs
   cleanly on a database that already has `dev`'s data in it.
6. Apply to production with the explicit `DATABASE_URL=...` form above. Preflight
   prints the target and makes you type the endpoint id back. Read it.
7. Push the branch and exercise the changed path on its Vercel preview, which
   reads `production`.

### Keeping `dev` fresh

`dev` drifts from production as real usage accumulates. When it gets stale
enough to stop being a useful rehearsal, reset it:

```bash
neonctl branches reset dev --project-id gentle-meadow-01487691 --parent
```

That discards everything on `dev` and re-snapshots production, so do not keep
anything there you care about.

## Automated verification (CI)

`.github/workflows/db-verify.yml` runs `db:verify` against **production** after
every production deploy of rough-cut or wallet, once daily on a schedule, and on
demand via workflow_dispatch. It is **not** a required status check — it reports
on a deploy that already happened, so blocking a merge on it would be
meaningless.

It exists because CI's other migration guard only proves a `.sql` file was
*committed*. Nothing proved it was *applied* — and since Drizzle builds an
explicit column list rather than emitting `SELECT *`, an unapplied migration
breaks every query against the affected table, not just the new field. The first
signal used to be a user hitting a 500.

**CI never applies a migration.** Applying stays manual, behind the confirmation
prompt above. Automating prod writes would require a write-capable
`DATABASE_URL` in GitHub Actions secrets, reachable by every third-party action
in every workflow — and Dependabot bumps those weekly.

### Setting up `PROD_DATABASE_URL_RO`

The workflow skips with a visible warning until this secret exists. It must be a
**read-only** role, so that the worst case of a compromised workflow is a leaked
list of column names rather than a dropped table.

On the production Neon branch, via the **SQL Editor** — not the Roles tab and not
`neonctl roles create`, because roles created through Neon's console, API or CLI
are granted `neon_superuser`:

```sql
CREATE ROLE ci_verify WITH LOGIN PASSWORD '<generated>';
GRANT CONNECT ON DATABASE neondb TO ci_verify;
GRANT USAGE ON SCHEMA public TO ci_verify;
-- Deliberately no SELECT on any table. This role confirms that a column exists;
-- it cannot read a single row. See the pg_catalog note below for why that works.
```

Then add the connection string for that role as a repository secret named
`PROD_DATABASE_URL_RO` (Settings -> Secrets and variables -> Actions).

### Why `verify.ts` reads `pg_catalog` and not `information_schema`

The SQL standard requires `information_schema` views to expose only objects the
current role holds some privilege on. A role with no table grants therefore sees
**zero rows** there, and every table looks like it is missing — which is exactly
what happened the first time `ci_verify` ran (all four tables reported missing
against a perfectly healthy database).

`pg_catalog` applies no such filter. Reading it is what allows the CI role to
hold `CONNECT` and `USAGE` and nothing else. **Do not change that query back to
`information_schema`** — it would appear to work when run as an owner and then
silently force you to grant `SELECT` on every table to CI.

### Confirming the role is really read-only

Grants are easy to get wrong in the permissive direction, so check rather than
assume. As `ci_verify`, all four of these must fail:

```sql
SELECT * FROM users LIMIT 1;        -- permission denied for table users
SELECT * FROM credit_ledger LIMIT 1;-- permission denied for table credit_ledger
CREATE TABLE should_not_exist(id int); -- permission denied for schema public
DROP TABLE projects;                -- must be owner of table projects
```

And this must report `false, true, 0, false`:

```sql
SELECT has_schema_privilege('ci_verify','public','CREATE')    AS create_on_public,
       has_database_privilege('ci_verify','neondb','CONNECT') AS can_connect,
       (SELECT count(*) FROM pg_auth_members m
          JOIN pg_roles u ON u.oid = m.member
         WHERE u.rolname = 'ci_verify')                       AS memberships,
       (SELECT rolsuper FROM pg_roles WHERE rolname='ci_verify') AS is_super;
```

## Baselining (historical — DONE, kept for the technique)

> **Production is fully baselined as of 2026-07-26.** All 13 migrations
> (`0000`–`0012`) are recorded in `drizzle.__drizzle_migrations` on both
> `production` and `dev`, and `db:migrate` runs cleanly against either. Nothing
> below needs doing again. It is kept because the same technique applies any
> time `push` puts DDL in a database without recording it.

### What was found on 2026-07-26

Production tracked only 8 of the 12 migrations that existed. `0007`, `0008`,
`0009` and `0010` were untracked, while `0011` — which came *after* them — was
tracked. `db:verify` passed the whole time, because it checks that every column
`schema.ts` declares exists; it cannot see a migration that was never recorded,
nor a table `schema.ts` no longer declares.

The effect: **`db:migrate` against production was broken.** It would have
started at `0007`, hit `ALTER TABLE projects ADD COLUMN file_size` on a column
already present, errored, and applied nothing. Discoverable only at the moment
you next needed to ship a schema change.

Cause: `db:push`. It syncs `schema.ts` to the database and records nothing, so
`0007`, `0009` and `0010` landed untracked. `0008` was different — it renames
`access_codes`, and push cannot infer a rename, so that table was simply left in
place while the migrations around it went in.

### How it was fixed

1. `0007`–`0010` were recorded as applied by inserting their SHA-256 hashes into
   `drizzle.__drizzle_migrations` — the procedure below, applied to four
   migrations instead of one.
2. The one piece that had genuinely never run — the `access_codes` rename — was
   expressed as a **new forward migration**, `0012_retire_access_codes.sql`,
   rather than by re-running `0008`. Re-running old migrations would have
   replayed `0009`'s `UPDATE users SET is_member = ...` backfill, which was
   harmless on that day's data and would not stay harmless.
3. Applied to `dev` first, verified, then to `production`.

The lesson worth keeping: **`push` and `migrate` against the same database will
desynchronise history**, and nothing in the toolchain warns you. That is why
`db:push` is now restricted to `dev`.

### The technique (for reuse)

Baselining marks a migration as already-applied so `migrate` skips it. Use it
when the DDL is provably in place but unrecorded:

1. **Inspect** the live prod schema and confirm it matches migration `0000`
   (`drizzle/0000_thick_young_avengers.sql`). In particular check whether the
   `rate_limits` table still exists.
2. **Mark `0000` as already-applied** so `migrate` skips it: create the
   `drizzle.__drizzle_migrations` table and insert one row for `0000`. Drizzle
   matches applied migrations by a **hash**, which it computes at runtime as the
   SHA-256 of the migration SQL file's contents (not a value stored in
   `_journal.json`). Compute it over `drizzle/0000_thick_young_avengers.sql`
   (e.g. `sha256sum` / `shasum -a 256` / `Get-FileHash -Algorithm SHA256`) and
   insert it with a `created_at` in epoch **milliseconds** (drizzle stores
   `bigint` ms; `_journal.json`'s `when` for `0000` is already that value):

   ```sql
   CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
     id SERIAL PRIMARY KEY,
     hash text NOT NULL,
     created_at bigint
   );
   INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
   VALUES ('<sha256-of-0000-sql>', 1783341102354);
   ```
3. **Run `npm run db:migrate`** — it then applies only what is genuinely pending.

After baselining, the database is fully managed — every later change is just
`generate` -> review -> `migrate`.

**Before baselining anything, prove the DDL is actually there.** Recording a
migration that never ran is worse than the problem it solves: it silently
guarantees the schema and the history disagree forever. Query the live database
for the specific columns, tables or defaults each migration introduces — that is
how `0008` was caught still pending while `0007`, `0009` and `0010` were not.

## History note: retired manual scripts

Before migration tracking existed, two prod changes were applied by hand-written,
reviewed scripts (removed once folded into the versioned history — both are now
represented by migration `0000`):

- **`rate_limits` table** (additive) + **`transcript_status` text->enum**
  conversion, done in-place with a `USING` clause to avoid the data-losing
  drop/recreate that `push` would have offered.
- **`projects.ai_cuts`** column addition (additive).
- **`projects.credit_hold_seconds` -> `tokens_hold`** column rename (an ad-hoc
  `fix-db.ts` script).

Do not re-run these; they are captured here only so the baseline's assumptions
are auditable.
