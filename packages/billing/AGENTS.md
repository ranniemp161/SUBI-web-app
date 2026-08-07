# @repo/billing

## Overview
The single implementation of the money invariant for the SUBI ecosystem. Owns
every statement that moves a balance, plus the rates and metering those
statements bill against. Consumed by `apps/rough-cut` (spends) and
`apps/wallet` (deposits) — both read and write the same `users` /
`credit_ledger` tables in `@repo/db`.

This package exists because the logic used to live twice, once per app. The two
copies drifted silently: rough-cut's `chargeAiCut` gained `ON CONFLICT`
idempotency while wallet's kept an unguarded `UPDATE`, and wallet's entire copy
was dead code that no test covered. **Do not re-implement any of this app-side.**

## Key files

| File | Owns |
|---|---|
| `src/pricing.ts` | Rates, metering, conversions, and display — pure, no imports at all, safe in a client bundle. `MICROS_PER_USD`, `RETAIL_MICROS_PER_MINUTE` (env-overridable), `chargeMicrosForSeconds`, `formatUsd`, the per-second cost estimates that populate `credit_ledger.cost_micros`, hold sizing (`costSecondsForDurationMs`, `secondsFromDeepgramDuration`), and the member grant helpers. |
| `src/ledger.ts` | Every statement that moves money: `reserveCredits`, `reclaimStaleHold`, `settleHold`/`settleHoldQuietly`, `depositPurchase`, `chargeAiCut`, `refundAiCut`, `ensureMonthlyGrant`. Server-only, enforced by an `import "server-only"` at the top. |
| `src/index.ts` | Barrel re-exporting both, for the common server-side case. |

## Conventions
- **Money is integer USD micros everywhere** (1,000,000 = $1). It becomes a
  human `"$X.XX"` string only at the display edge.
- **The ledger is the source of truth**; `users.balance_micros` is a cache of
  `SUM(delta_micros)`. Every mutation writes both, in one statement.
- **One statement per mutation, never a read-then-write.** The neon-http driver
  has no transactions, so atomicity comes from Postgres' single-statement
  semantics — each mutation is a CTE pipeline that commits entirely or not at
  all. A multi-step version of any of these has a TOCTOU window that charges
  twice.
- **Overdraft protection is the `users_balance_micros_nonneg` CHECK constraint,
  deliberately** — no `balance_micros >= cost` qual appears in any UPDATE.
  Concurrent spends serialize on the `users` row; whichever would overdraft
  raises `23514` and rolls back its whole statement, earlier CTEs included.
  `isCheckViolation` walks the Neon driver's nested cause chain to spot it.
- **Idempotency rides on `credit_ledger.stripe_event_id`**, which is a generic
  unique/nullable slot rather than a Stripe-specific one: Stripe deposits use
  the Checkout session id, AI Cut charges and refunds use the caller's
  `Idempotency-Key` under `ai_cut:` / `ai_cut_refund:` prefixes. The column name
  predates that widening (renaming it is a queued follow-up).
- **Exactly-once settling** rests on the UPDATE's re-checked qual: only the call
  that flips `hold_micros` to NULL produces ledger and balance effects; a racing
  second call matches zero rows and every downstream CTE is empty.
- **A client component imports `@repo/billing/pricing`, never `@repo/billing`.**
  The barrel re-exports `ledger.ts`, so reaching through it for `formatUsd` or
  the retail rate would pull the Neon driver into the browser bundle. `ledger.ts`
  carries `import "server-only"` to make that a build error rather than a silent
  200KB, the same guard `apps/rough-cut/src/lib/blob.ts` uses.
- **The retail rate is one constant, shared by the server that charges it and
  the client that shows it.** Client-side uses are advisory only: the env
  override carries no `NEXT_PUBLIC_` prefix, so the browser always resolves to
  `DEFAULT_RETAIL_MICROS_PER_MINUTE`. A pre-flight "you probably can't afford
  this" hint is fine; the charge itself is always computed in `ledger.ts`.
- Import via the package exports, not deep relative paths: `@repo/billing`,
  `@repo/billing/pricing`, `@repo/billing/ledger`.
- No build step — consumed as TypeScript source directly (workspace package),
  same pattern as `packages/server-shared` and `packages/ui`.

## Gotchas
- **`withDbRetry` is not used here, on purpose.** It is documented as
  read-only (`packages/db/src/index.ts`): a timed-out INSERT may have committed
  server-side, so retrying a write could duplicate ledger rows. Every function
  in `ledger.ts` is a write.
- **`RETAIL_MICROS_PER_MINUTE` is read at module load**, so it is fixed for the
  life of the process. It is also **not** in `turbo.json`'s `build` env list, so
  a `next build` sees `undefined` and compiles against the default — see the
  root `AGENTS.md` note about env vars that a Vercel build cannot see.
- **Vitest has no `react-server` condition**, so the `server-only` import in
  `ledger.ts` would hit that package's throwing default export in tests. Every
  config that loads this package aliases it to the no-op `empty.js`: this
  package's own `vitest.config.ts`, plus `apps/rough-cut` and `apps/wallet`. A
  new consumer with tests needs the same alias.
- `chargeAiCut` returning zero rows means two different things: with an
  idempotency key it is a retry that lost the `ON CONFLICT` race (already
  charged, treat as success); without one it is a genuinely missing user row
  (throw).

## Related ADRs
- `docs/adr/_root/0001-monorepo-wallet-architecture.md` — why shared logic lives in its own package rather than being duplicated per app.
- `docs/adr/_root/0002-usd-wallet/index.md` — USD-denominated wallet, the micros ledger, and auto-recharge.
