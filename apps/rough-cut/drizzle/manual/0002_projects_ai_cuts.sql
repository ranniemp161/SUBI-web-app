-- AI rough cut: stored Gemini cut suggestions per project.
--
-- Purely additive — safe to apply with `npm run db:push` as well; this script
-- exists so the change can be reviewed and applied to a database with live
-- data the same way as 0001 (e.g. psql "$DATABASE_URL" -f this-file.sql).

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "ai_cuts" jsonb;
