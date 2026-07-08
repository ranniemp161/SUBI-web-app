# Research: pricing math and balance conversion

Supporting evidence for umbrella `0002` (all children). Optional depth, not required reading; the child ADRs are self-sufficient to build from.

## Unit

- 1 US dollar = 1,000,000 micros. All balances, ledger deltas, holds, and bundle credit values are integer micros. Format to `$X.XX` only at display.

## Retail rate

Derived from today's entry bundle, which sells ~60 minutes for $19:

```
$19 / 60 min = $0.31667 / min
RETAIL_MICROS_PER_MINUTE = round(19_000_000 / 60) = 316_667   (≈ $0.316667/min)
per second ≈ 5_277.8 micros

charge_micros(seconds) = round(seconds × RETAIL_MICROS_PER_MINUTE / 60)
```

The constant lives in env/config (like the Stripe price allowlist), so the client can tune it without a deploy. AI Cut uses the same rate for now (see umbrella Follow-up for a possible separate AI Cut rate; its real cost is ~7x transcription).

Real cost stays tracked separately in `cost_micros` using the existing constants (`TRANSCRIPTION_COST_MICROS_PER_SECOND = 166`, `AI_CUT_COST_MICROS_PER_SECOND = 1217`). Margin per row = `-delta_micros - cost_micros` for a charge.

## Bundle credit table

Balance credited per bundle, carried in each Stripe Price's `metadata.credit_micros`. The larger tiers credit bonus balance to preserve today's per-minute volume discount while keeping "balance = real spendable dollars".

| Bundle (pays) | Old tokens (sec) | Old min | credit_micros | Balance | Min at flat rate | Effective $/min |
|---|---|---|---|---|---|---|
| $19  | 3,600  | 60   | 19,000,000  | $19.00  | ~60   | $0.317 |
| $79  | 18,000 | 300  | 95,000,000  | $95.00  | ~300  | $0.263 |
| $249 | 60,000 | 1000 | 318,000,000 | $318.00 | ~1004 | $0.248 |

The bonus values ($95, $318) are chosen so minutes-per-bundle match today's tiers at the single flat spend rate. They are config in Stripe metadata; the client can adjust.

## One-time balance conversion (existing prod users)

Convert each user's `tokens` (seconds) to micros at the retail rate, so existing value is preserved:

```
balance_micros = round(tokens × RETAIL_MICROS_PER_MINUTE / 60)
             = round(tokens × 5_277.8)

examples:
  3_600 tokens  → 19_000_000 = $19.00
 18_000 tokens  → 95_000_000 = $95.00
     600 tokens →  3_166_667 ≈ $3.17
```

Migration steps (through `packages/db` generate + migrate, after the `0000` baseline in `packages/db/MIGRATIONS.md`):

1. Rename `users.tokens → balance_micros`, `credit_ledger.delta_tokens → delta_micros`, `projects.tokens_hold → hold_micros`; rename the CHECK to `balance_micros >= 0`.
2. Add reason enum values `conversion` and `auto_recharge`.
3. `UPDATE users SET balance_micros = round(balance_micros * 19000000.0 / 3600)` (applied to the just-renamed column holding the old token count).
4. `INSERT` one `credit_ledger` row per user: reason `conversion`, `delta_micros` = the new balance, recording the pre-conversion token count for audit. This keeps `SUM(delta_micros)` reconciled with the cached balance.

Reconciliation check after migration: for every user, `balance_micros == SUM(credit_ledger.delta_micros)`.

## Notes

- Rounding is applied at each charge and at conversion; because storage is integer micros there is no float drift in the running balance.
- The member monthly grant amount is intentionally not set here (open question, umbrella Follow-up); `ensureMonthlyGrant` continues to function in micros with a placeholder value until the client decides.
