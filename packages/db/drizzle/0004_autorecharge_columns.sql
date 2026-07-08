-- Auto-recharge (ADR 0002/0002): store the Stripe customer + saved card and the
-- per-user auto-recharge settings on the users row. All additive: existing rows
-- default to auto-recharge off with no saved card, so nobody is charged until
-- they opt in.
ALTER TABLE "users" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "default_payment_method_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "autorecharge_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "autorecharge_threshold_micros" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "autorecharge_amount_micros" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "autorecharge_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_stripe_customer_id_unique" UNIQUE("stripe_customer_id");
