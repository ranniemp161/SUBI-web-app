-- One-time value conversion: turn each existing token (second) balance into its
-- USD-micros equivalent at the retail rate ($19 buys ~60 min => 19,000,000 micros
-- per 3600 seconds). Runs after 0002, which only renamed the columns, so at this
-- point "balance_micros" and "delta_micros" still physically hold the old token
-- numbers.
--
-- Step 1 writes one reconciling ledger row per user BEFORE the balance is
-- overwritten, so the pre-conversion token count is still readable for the audit
-- note (stored in cost_micros). The row's delta is (new_balance - current ledger
-- sum), which makes SUM(delta_micros) equal the converted cached balance exactly
-- for every user, even if a user's ledger had drifted from the cache beforehand.
--
-- NOTE ON THE ADR: child ADR 0002/0001 (and the research note) describe the
-- conversion row as "delta_micros = the new balance". Taken literally that would
-- only reconcile if a user's prior ledger rows summed to zero, which they do not
-- (they sum to the old token balance). To honor the ADR's own stated invariant
-- "for every user, balance_micros == SUM(delta_micros)" we write the reconciling
-- delta instead. Flagged for the ADR to confirm.
INSERT INTO "credit_ledger" ("user_id", "delta_micros", "reason", "cost_micros")
SELECT
  u."id",
  (round(u."balance_micros" * 19000000.0 / 3600.0)::integer) - COALESCE(l.sum_delta, 0),
  'conversion',
  u."balance_micros"
FROM "users" u
LEFT JOIN (
  SELECT "user_id", SUM("delta_micros")::integer AS sum_delta
  FROM "credit_ledger"
  GROUP BY "user_id"
) l ON l."user_id" = u."id"
WHERE (round(u."balance_micros" * 19000000.0 / 3600.0)::integer) <> COALESCE(l.sum_delta, 0);
--> statement-breakpoint
UPDATE "users" SET "balance_micros" = round("balance_micros" * 19000000.0 / 3600.0)::integer;
