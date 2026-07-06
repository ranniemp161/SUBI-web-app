-- Production-hardening schema changes (Phase 2).
--
-- This project syncs schema with `drizzle-kit push` and has no migration
-- history, so this file is a hand-written, reviewed script to apply the two
-- Phase 2 changes to an existing database with live data. Review, then run it
-- once against your database (e.g. psql "$DATABASE_URL" -f this-file.sql).
--
-- `npm run db:push` can also apply these, BUT the text -> enum column change
-- below is exactly the kind of type conversion push may offer to do via a
-- drop/recreate (which would lose transcript_status data). Prefer this script
-- for the enum step; the USING clause converts in place without data loss.

BEGIN;

-- 1) Rate-limit counters. Purely additive.
CREATE TABLE IF NOT EXISTS "rate_limits" (
  "key" text PRIMARY KEY NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  "window_start" timestamp with time zone DEFAULT now() NOT NULL
);

-- 2) transcript_status: text -> enum, converting existing rows in place.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transcript_status') THEN
    CREATE TYPE "transcript_status" AS ENUM ('idle', 'processing', 'ready', 'failed');
  END IF;
END$$;

ALTER TABLE "projects" ALTER COLUMN "transcript_status" DROP DEFAULT;
ALTER TABLE "projects"
  ALTER COLUMN "transcript_status" TYPE "transcript_status"
  USING "transcript_status"::"transcript_status";
ALTER TABLE "projects" ALTER COLUMN "transcript_status" SET DEFAULT 'idle';

COMMIT;
