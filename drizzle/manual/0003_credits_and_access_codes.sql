-- Pay-as-you-go transcription credits + per-member Skool access codes.
--
-- Structural parts are additive and idempotent (safe alongside `npm run
-- db:push`); the data backfill at the bottom grandfathers every existing user
-- as a Skool member and seeds the current month's grant — those two statements
-- only run via this script (push won't do them):
--   psql "$DATABASE_URL" -f drizzle/manual/0003_credits_and_access_codes.sql
--
-- NOTE: the 3600 in the backfill must match MEMBER_MONTHLY_GRANT_SECONDS.

BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'credit_ledger_reason') THEN
    CREATE TYPE "credit_ledger_reason" AS ENUM ('purchase','transcription','refund','grant');
  END IF;
END $$;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "credit_seconds" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "is_member" boolean NOT NULL DEFAULT false;

-- The atomicity linchpin: an overdraft anywhere in a single-statement credit
-- mutation raises 23514 and rolls the whole statement back (no transactions
-- available on the neon-http driver).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_credit_seconds_nonneg'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_credit_seconds_nonneg" CHECK ("credit_seconds" >= 0);
  END IF;
END $$;

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "credit_hold_seconds" integer;

CREATE TABLE IF NOT EXISTS "credit_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "delta_seconds" integer NOT NULL,
  "reason" "credit_ledger_reason" NOT NULL,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "stripe_event_id" text UNIQUE,
  "month_key" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "credit_ledger_user_created_idx"
  ON "credit_ledger" ("user_id","created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_grant_month_uq"
  ON "credit_ledger" ("user_id","month_key") WHERE "reason" = 'grant';

CREATE TABLE IF NOT EXISTS "access_codes" (
  "code" text PRIMARY KEY,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "redeemed_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "redeemed_at" timestamptz,
  "revoked_at" timestamptz
);

-- Grandfather every existing user (they all signed up with the shared code).
UPDATE "users" SET "is_member" = true;

-- Seed this month's grant. Idempotent against the lazy top-up in
-- lib/credits.ts via the partial unique index above.
WITH ins AS (
  INSERT INTO "credit_ledger" ("user_id","delta_seconds","reason","month_key")
  SELECT "id", 3600, 'grant', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM')
  FROM "users" WHERE "is_member"
  ON CONFLICT ("user_id","month_key") WHERE "reason" = 'grant' DO NOTHING
  RETURNING "user_id","delta_seconds"
)
UPDATE "users" u SET "credit_seconds" = u."credit_seconds" + ins."delta_seconds"
FROM ins WHERE u."id" = ins."user_id";

COMMIT;
