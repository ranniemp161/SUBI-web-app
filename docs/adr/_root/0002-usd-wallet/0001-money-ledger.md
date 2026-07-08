# 0002/0001: Money-denominated ledger and metering

Child of [0002 USD-denominated Wallet](./index.md). Read the umbrella first for the shared unit and the cross-child contracts.

## Context

The balance, the ledger, and the per-job hold are all integer `tokens` (seconds) today. This child changes the unit to USD micros and sets how spending maps to dollars, without changing the concurrency design. It is the foundation slice; the other two children depend on the unit and the deposit path defined here.

## Decision

### 1. Store money as integer USD micros

Balances and ledger amounts become **integer micros** (1,000,000 = $1). Renames:

| Now | Becomes |
|---|---|
| `users.tokens` | `users.balance_micros` |
| `credit_ledger.delta_tokens` | `credit_ledger.delta_micros` |
| `projects.tokens_hold` | `projects.hold_micros` |

The `CHECK(users_tokens_nonneg)` becomes `CHECK(balance_micros >= 0)` (same guard, renamed). `credit_ledger.cost_micros` is unchanged and now sits alongside `delta_micros`: `delta_micros` is what the user was charged (retail), `cost_micros` is our real cost, and the two together give live margin.

**Why micros, not cents.** Metering is per-second at roughly $0.0053/sec, which is well below one cent, so integer cents would round every per-second charge and drift. Micros give sub-cent precision, are already the unit of `cost_micros`, and stay exact under integer math. Money is formatted to `$X.XX` only at the display edge via one `formatUsd(micros)` helper; it is never rounded in storage.

### 2. Retail metering: one flat per-minute rate, in config

A single retail rate drives all spending, derived from today's entry bundle ($19 for ~60 min):

```
RETAIL_MICROS_PER_MINUTE ≈ 316,667   (≈ $0.3167/min, i.e. $19 / 60 min)
charge_micros(seconds) = round(seconds × RETAIL_MICROS_PER_MINUTE / 60)
```

AI Cut uses the **same** rate (preserves current economics; a separate rate is a future option, see umbrella Follow-up). The rate lives in an env constant (for example `RETAIL_MICROS_PER_MINUTE`), consistent with the existing rule that prices are config, not code. `cost_micros` keeps using the existing real-cost constants (`TRANSCRIPTION_COST_MICROS_PER_SECOND`, `AI_CUT_COST_MICROS_PER_SECOND`).

The credits library keeps computing **billable seconds** exactly as it does now (client duration for the hold, Deepgram `metadata.duration` for the settle). Only the final step changes: seconds are multiplied into `charge_micros` before touching the ledger. Every existing behaviour (the hold's double-kickoff gate, settle exactly-once, refund, `reclaimStaleHold`, the shortfall clamp) is preserved, operating on micros.

### 3. Bundle-to-balance mapping with bonus tiers

Each Stripe Price carries `metadata.credit_micros` = the dollar balance to credit, which is not the same as `unit_amount` (what the user pays) for the bonus tiers:

| Bundle (pays) | `metadata.credit_micros` | Balance credited | Approx minutes |
|---|---|---|---|
| $19 | 19,000,000 | $19.00 | ~60 |
| $79 | 95,000,000 | $95.00 | ~300 |
| $249 | 318,000,000 | $318.00 | ~1000 |

This replaces `metadata.tokens`. `tokensFromPrice` becomes `creditMicrosFromPrice` (still tolerant of a missing/malformed value → skip the bundle, as today). The webhook deposits `credit_micros` with reason `purchase`, idempotent on the Checkout session id (unchanged path, renamed field). Values stay in the Stripe dashboard, so repricing or changing the bonus needs no redeploy.

### 4. One-time balance conversion migration

Existing production `tokens` (seconds) convert at retail value so nobody loses value:

```
balance_micros = round(tokens × RETAIL_MICROS_PER_MINUTE / 60)
# 3600 tokens → $19.00 ; 18000 → $95.00
```

The migration: rename columns (preserving data), convert the balances in place, and write one `credit_ledger` row per user (a new reason `conversion`, `delta_micros` = the converted balance, with the pre-conversion token count recorded in a note/`cost_micros` field for audit) so the ledger still sums to the cached balance. This runs through `packages/db` generate + migrate, after the one-time `0000` baseline described in `packages/db/MIGRATIONS.md` (prod predates migration tracking). See `research/_shared-pricing-and-conversion.md` for the exact arithmetic and rounding.

### Implementation skills

None new. Uses the existing Drizzle + Neon HTTP patterns in `packages/db` and the single-statement CTE style already in `apps/*/src/lib/credits.ts`.

## Options considered

- **Cents instead of micros.** Rejected: per-second charges are sub-cent, so cents round and drift; micros are already in the schema (`cost_micros`).
- **A `numeric`/decimal money type.** Rejected: exact but slower, invites float handling at the edges, and the codebase is already all-integer-micros for cost. Integer micros keep the CTE spends and the CHECK trivial.
- **Keep charging in seconds, convert to dollars only for display.** Rejected: the balance would still be seconds internally, so bonus tiers, auto-recharge amounts, and "balance = dollars paid" would all need a second mental model. Denominating the stored balance in money is the point.
- **Bake the volume discount into the per-minute rate per tier.** Rejected: a per-purchase rate makes "how much is a minute" ambiguous. One flat rate plus bonus balance on bigger tiers keeps a single, honest spend rate and still rewards larger purchases.

## Rationale

The whole risk in this system is the concurrency-safe spend (single-statement CTEs, the overdraft CHECK, hold/settle exactly-once). Renaming the unit and multiplying seconds into micros at the last step leaves that machinery untouched, so we get a money balance without reopening the dangerous code. Putting bundle value in Stripe metadata and the rate in an env constant matches the existing "prices are config" convention, so the client can tune economics without a deploy. Converting existing balances at retail value is the only option that preserves what users already paid for.

## Build plan

_Build progress (`/develop money-ledger`, 2026-07-08): code complete, both apps typecheck clean, rough-cut 231/231 tests green. Migration applied + reconciled on the DEV branch (2026-07-08); prod still pending at deploy._

1. **[x] Migration: rename + convert (AC-1, AC-3, AC-8).** In `packages/db/schema.ts` renamed the three columns and the CHECK, added reason enum values `conversion` and `auto_recharge`. SQL is two files (Postgres forbids using a newly added enum value in the same transaction that adds it): `drizzle/0002_usd_micros_rename.sql` (renames + CHECK + `ADD VALUE`) and `drizzle/0003_usd_micros_convert.sql` (converts balances + inserts one reconciling `conversion` ledger row per user), plus journal + snapshots. **Applied to the DEV branch 2026-07-08** after the one-time `0000` baseline (`MIGRATIONS.md`): reconciliation passed (`balance_micros == SUM(delta_micros)` for every user; 20045 tok → $105.79, 1016 tok → $5.36). **Note on the CLI:** `drizzle-kit migrate` fails here because it batches all pending migrations in one transaction, where `0003` uses the `conversion` enum value `0002` adds in that same transaction (Postgres rejects it). The neon-http migrator (autocommit, one statement at a time) applies them correctly — use that, not the CLI, for this pair. **Prod not yet migrated** (deploy step). See the note in `0003` where the reconciling delta deviates from the ADR's literal "delta = new balance" to keep `SUM(delta_micros) == balance_micros`.
2. **[x] `formatUsd(micros)` helper (AC-1).** Added to `@repo/ui` (`src/money.ts`, re-exported from `index.ts`) — micros → `$X.XX`, plus `chargeMicrosForSeconds` and the default `RETAIL_MICROS_PER_MINUTE`.
3. **[x] Credits library to micros (AC-3).** Both apps' `src/lib/credits.ts`: added env-overridable `RETAIL_MICROS_PER_MINUTE` + `chargeMicrosForSeconds()` + `memberGrantMicros()`, converted `reserveCredits`, `settleHold`, `reclaimStaleHold`, `chargeAiCut`, `refundAiCut`, `depositPurchase`, `ensureMonthlyGrant` to micros. All quals and the shortfall clamp preserved; every CTE field renamed.
4. **[x] Bundle mapping (AC-2).** `apps/wallet/src/lib/stripe.ts`: `tokensFromPrice` → `creditMicrosFromPrice` (reads `metadata.credit_micros`, legacy `tokens`×rate fallback); `Bundle.tokens` → `Bundle.creditMicros`. Checkout route writes `metadata.creditMicros`.
5. **[x] Webhook deposit (AC-2).** `api/webhooks/stripe/route.ts` reads `metadata.creditMicros` and deposits micros, reason `purchase`, unchanged idempotency.
6. **[x] Balance display (AC-1).** Wallet dashboard + rough-cut credits-panel/gate render `formatUsd(balanceMicros)`; ledger rows render `formatUsd(deltaMicros)` with sign. Bundle buttons show credited dollars.
7. **[x] Gate copy (AC-4).** Insufficient-balance surfaces now say "Not enough funds" / "Add funds" (minimal; premium prompt is child `0003`).

## References

- `research/_shared-pricing-and-conversion.md` — rate derivation, bundle table, conversion arithmetic.
- Reused mechanics: `apps/wallet/src/lib/credits.ts`, `packages/db/src/schema.ts`, `packages/db/MIGRATIONS.md`.
