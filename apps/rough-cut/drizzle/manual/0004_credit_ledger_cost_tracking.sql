-- Real per-entry cost tracking + a dedicated ledger reason for AI Cut re-runs.
--
-- Purely additive and idempotent (safe alongside `npm run db:push`):
--   psql "$DATABASE_URL" -f drizzle/manual/0004_credit_ledger_cost_tracking.sql
--
-- No backfill: historical rows keep cost_micros NULL.

BEGIN;

-- Postgres allows ADD VALUE inside a transaction as long as the new value
-- isn't referenced by any statement in the same transaction (which it isn't
-- here) — safe alongside 0003's precedent of shipping schema + routes together.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum WHERE enumlabel = 'ai_cut'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'credit_ledger_reason')
  ) THEN
    ALTER TYPE "credit_ledger_reason" ADD VALUE 'ai_cut';
  END IF;
END $$;

-- USD micros (1,000,000 = $1) — cents can't represent the ~$0.083/min blended
-- Deepgram+Gemini cost estimate at per-second granularity.
ALTER TABLE "credit_ledger" ADD COLUMN IF NOT EXISTS "cost_micros" integer;

COMMIT;
