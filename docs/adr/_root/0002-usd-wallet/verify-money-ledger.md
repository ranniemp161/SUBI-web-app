# Verify: money-ledger · ADR 0002/0001 · updated 2026-07-08
_Steps derived from ADR 0002 acceptance criteria (the slice-1 set: AC-1, AC-2, AC-3, AC-4, AC-8). `/verify` runs these; `/test` locks the durable ones. The migration steps must run first — the rest depend on a converted database._

## Commands (migration + data — AC-8)
- [ ] Confirm the one-time `0000` baseline row exists on the target DB (see `packages/db/MIGRATIONS.md`); if not, do it first. → prerequisite
- [ ] From `packages/db` with `DATABASE_URL` pointed at the **dev** Neon branch: `npm run db:migrate` → applies `0002_usd_micros_rename` then `0003_usd_micros_convert` with no error → AC-8
- [ ] Introspect the schema: `users.balance_micros`, `credit_ledger.delta_micros`, `projects.hold_micros` exist; the CHECK is `users_balance_micros_nonneg`; the `credit_ledger_reason` enum includes `conversion` and `auto_recharge` → AC-8
- [ ] Reconciliation query — for every user `balance_micros = SUM(credit_ledger.delta_micros)` returns zero mismatches → AC-8
- [ ] Spot-check conversion: a user who had 3600 tokens now has `balance_micros = 19000000` ($19.00); 18000 → 95000000 ($95.00) → AC-8
- [ ] Repeat the migrate + checks against the **prod** Neon branch only after dev passes → AC-8

## UI / manual (run the apps after the DB is converted)
- [ ] Open the wallet dashboard → the balance card reads a dollar amount like `$19.00`, never a raw token/micro number; ledger rows show signed dollars → AC-1
- [ ] Open rough-cut → the header credit chip reads `$X.XX` (amber when low) → AC-1
- [ ] Buy the $19 bundle via Stripe Checkout (test mode) → after the webhook, balance increases by exactly `$19.00`; a `purchase` ledger row of `+$19.00` appears; a duplicate webhook delivery does not double-credit → AC-2
- [ ] Buy the $79 bundle → balance increases by `$95.00` (bonus tier, from `metadata.credit_micros`) → AC-2
- [ ] Transcribe a short clip → balance drops by roughly the retail rate ($0.317/min); a `transcription` ledger row in micros is written; the hold settles against Deepgram's duration (refund on shortfall, no spurious refund when duration is missing) → AC-3
- [ ] Run an AI Cut → a further dollar deduction; a failed run refunds it → AC-3
- [ ] Drive a balance near $0, then start a new transcription → the job is blocked, an "Add funds" prompt (deep-linking to the wallet) shows, any already in-flight job still finishes, and the balance never goes negative → AC-4

## Commands (build gates — already green at build time)
- [ ] `npm -w @repo/rough-cut run typecheck` and `npm -w wallet run typecheck` → 0 errors
- [ ] `npm -w @repo/rough-cut test` → all pass (231/231 at build)

## Acceptance-criteria coverage
- AC-1 (balance shown as `$X.XX`) … wallet dashboard + rough-cut chip steps
- AC-2 (bundle credits configured dollar value from Stripe metadata) … $19 and $79 buy steps
- AC-3 (transcribe/AI Cut deduct real dollars, ledger in micros, hold/settle preserved) … transcribe + AI Cut steps
- AC-4 (hard stop at insufficient balance, add-funds prompt, no negative) … near-$0 step
- AC-8 (existing balances converted, one conversion ledger row, value preserved) … migration + reconciliation + spot-check steps
