-- Redenominate the balance from tokens (seconds) to USD micros (1,000,000 = $1).
-- This file is DDL only: it renames the three columns (data preserved), renames
-- the overdraft CHECK, and adds the two new ledger reasons. The actual value
-- conversion lives in 0003, because Postgres will not let a newly added enum
-- value ('conversion') be used in the same transaction that adds it.
ALTER TABLE "users" RENAME COLUMN "tokens" TO "balance_micros";--> statement-breakpoint
ALTER TABLE "credit_ledger" RENAME COLUMN "delta_tokens" TO "delta_micros";--> statement-breakpoint
ALTER TABLE "projects" RENAME COLUMN "tokens_hold" TO "hold_micros";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_tokens_nonneg";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_balance_micros_nonneg" CHECK ("users"."balance_micros" >= 0);--> statement-breakpoint
ALTER TYPE "public"."credit_ledger_reason" ADD VALUE 'conversion';--> statement-breakpoint
ALTER TYPE "public"."credit_ledger_reason" ADD VALUE 'auto_recharge';
