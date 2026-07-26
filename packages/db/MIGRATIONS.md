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
npm run db:push       # DO NOT RUN - no safe target exists (see warning below)
npm run db:studio     # browse the DB
```

`DATABASE_URL` is read from `.env.local` in this directory (see `drizzle.config.ts`).

> **There is only one Neon branch, and it is production.**
> `packages/db/.env.local` holds the same connection string as Vercel's
> Production `DATABASE_URL`. Local development, Vercel Preview, and Vercel
> Production all read and write the same database.
>
> Every `db:*` command in this file is therefore a **production** operation the
> moment you run it. There is no staging step and nothing to practise on. The
> confirmation prompt described below is not one safeguard among several — it is
> the only one.

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

- **`generate` + `migrate` only.** Every change is a committed, reviewed SQL file
  applied in order and tracked. With a single branch this is not the
  conservative option, it is the only correct one.
- **Never run `db:push`.** It does a schema-diff with no history and will
  silently offer a destructive drop/recreate for type conversions (it tried
  exactly this on the `transcript_status` text->enum change). That is tolerable
  on disposable data — and there is no disposable data here, because the only
  branch is production. The script still exists for the day a dev branch does;
  until then treat it as unrunnable.
- **Every migration must be backward compatible**, because the currently
  deployed code keeps serving traffic against the schema you just changed. Add a
  column, deploy the code that uses it, drop the old column in a *later*
  migration. Never rename or drop in the same step as the code change.

## Day-to-day workflow

1. Edit `src/schema.ts`.
2. `npm run db:generate`, then **read the emitted `drizzle/NNNN_*.sql`**. This
   review is where a destructive change gets caught; there is no later gate.
3. Commit the SQL file together with the code that needs it. CI blocks a
   `schema.ts` change that arrives without one.
4. `npm run db:migrate` — it prints the target and makes you type the endpoint id
   back. Read it. This writes to production.
5. Push the branch. Its Vercel preview hits the database you just migrated, so
   exercise the changed path there before merging.

### If you want a safe place to iterate

Neon branches are cheap and near-instant, and a branch is a copy-on-write
snapshot of production data. Creating one, pointing `.env.local` at it, and
using `db:push` freely against it restores the fast iteration loop this doc used
to describe. Nothing in the repo depends on there being only one branch — the
only thing that must keep pointing at production is Vercel's `DATABASE_URL`.

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

## First-deploy baseline (one-time, production)

Prod predates migration tracking — it was built with `push`/ad-hoc scripts, so
`__drizzle_migrations` does not exist yet. Running `migrate` cold would try to
`CREATE TABLE` tables that already exist. Baseline it once:

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
3. **Run `npm run db:migrate`** — it then applies only the pending `0001`
   (`DROP TABLE IF EXISTS rate_limits`). The `IF EXISTS` makes it safe whether or
   not prod ever had the table.

After baselining, prod is fully managed — every later change is just
`generate` -> review -> `migrate`.

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
