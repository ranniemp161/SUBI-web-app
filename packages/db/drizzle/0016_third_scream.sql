-- B-Roll's two ledger reasons (spec broll/0002, AC-44).
--
-- Deliberately a SEPARATE migration from 0015, which added the broll_* tables
-- and credit_ledger.broll_project_id. The rule is the repo's add, deploy, then
-- use: a value must exist in the live enum before any deployed code writes it.
-- Nothing below uses either value — only application code does, later — so this
-- is a deploy-ordering requirement, not a Postgres one.
--
-- Postgres will not let a value added inside a transaction be USED in that same
-- transaction, and drizzle-kit replays every pending migration in one. That
-- costs nothing here for the reason above, but it is why these two statements
-- must not be followed by anything that writes them. Keep it that way.
--
-- ALTER TYPE ... ADD VALUE is not reversible: Postgres has no DROP VALUE. A
-- rollback means recreating the type and rewriting every column that uses it.
-- Both values are additive and no existing row is touched, so this applies
-- instantly with no table scan.
ALTER TYPE "public"."credit_ledger_reason" ADD VALUE 'broll_character_set';--> statement-breakpoint
ALTER TYPE "public"."credit_ledger_reason" ADD VALUE 'broll_plan_rerun';
