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
npm run db:push       # DEV ONLY - schema-diff, no history (see warning below)
npm run db:studio     # browse the DB
```

`DATABASE_URL` is read from `.env.local` in this directory (see `drizzle.config.ts`).
Point it at the branch you intend to change. **Dev and prod are separate Neon
branches — migrate each one separately, dev first.**

## The rule

- **Prod (and any DB with data you can't lose): `generate` + `migrate` only.**
  Every change is a committed, reviewed SQL file applied in order and tracked.
- **`db:push` is for throwaway dev branches only. Never point it at prod.**
  `push` does a schema-diff and will silently offer a destructive drop/recreate
  for type conversions (it tried exactly this on the `transcript_status`
  text->enum change). That is fine on disposable data, unacceptable on prod.

## Day-to-day dev workflow

1. Edit `src/schema.ts`.
2. While the shape is still churning, `npm run db:push` against a disposable dev
   branch to iterate fast.
3. Once the change settles: `npm run db:generate`, review the emitted
   `drizzle/NNNN_*.sql`, commit it with the code.
4. Apply with `npm run db:migrate` (dev branch first, then prod at deploy time).

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
