ALTER TABLE "users" ALTER COLUMN "is_member" SET DEFAULT false;
--> statement-breakpoint
-- One-time backfill: membership (and the monthly credit grant it unlocks) is
-- now restricted to a single allowlisted demo email instead of every
-- sign-up. Existing rows predate that policy and still carry the old
-- default (true) — bring them in line with it now.
UPDATE "users" SET "is_member" = (lower("email") = lower('rannieandtj@gmail.com'));