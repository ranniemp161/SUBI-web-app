# Roadmap — Ecosystem (repo-wide)

Features that span the whole ecosystem (shared `packages/db`, the wallet billing portal, cross-app concerns). App-specific work lives in its own roadmap (for example `docs/roadmap/rough-cut/`).

**Build approach**: Tracer Bullet — vertical slices; each feature built end-to-end through every layer, working.

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| 1 | USD-denominated Wallet | Slice 1 | done |
| 2 | Demo-only free credits gate | Slice 1 | existing |
| 3 | Auto-recharge notification channel | Deferred | planned |
| 4 | AI Cut differentiated retail rate | Deferred | planned |

## Slice 1

### 1. USD-denominated Wallet · done
Redenominate the balance from `tokens` to plain US dollars, add opt-in auto-recharge, and give the wallet a premium UI. ADR: [0002](../../adr/_root/0002-usd-wallet/index.md)
**Done when:** the balance reads and spends as US dollars end to end (buy, meter, hard-stop at $0), a user can save a card and auto-recharge on their own threshold safely, existing balances are converted with no value lost, and the wallet billing UI is a premium redesign on the shared theme.
- [x] Design it (ADR): [0002](../../adr/_root/0002-usd-wallet/index.md)
- [x] Build it: `/develop money-ledger` — money end to end: schema rename + conversion migration, credits library in micros, bundle `credit_micros`, balance shown as `$X.XX`, spend + hard-stop gate (AC-1..4, AC-8). Code complete + typecheck/tests green; code in `packages/db`, `packages/ui`, `apps/wallet`, `apps/rough-cut`. Migrations `0002`+`0003` **applied + reconciled on dev** (2026-07-08). **Slice-1 verified on dev 2026-07-08**: AC-2/3/4/8 runtime-confirmed against the converted schema (deposit credits $19.00, spend deducts retail dollars in micros, overdraft hard-stops on the CHECK, conversion reconciles). AC-1 display primitive locked; authed UI render is the one remaining manual eyeball. **Prod migration still pending at deploy.**
- [x] Build it: `/develop auto-recharge` — Stripe off-session: save card, settings, cron sweep, daily cap + idempotency, decline handling (AC-5..7). Code complete + typecheck clean; code in `apps/wallet` (`lib/autorecharge.ts`, `lib/stripe.ts`, `lib/notifications.ts`, `api/billing/{checkout,setup-intent,autorecharge}`, `api/cron/autorecharge`, `api/webhooks/stripe`) + `packages/db` (migration `0004`, applied on dev). Notification channel deferred (seam only). **Slice-2 verified end to end on dev 2026-07-08**: AC-5/6/7 all met — the real running `/api/cron/autorecharge` route charged a seeded eligible user off-session (Stripe test) and credited the balance ($1 → $20), idempotency + daily cap + decline→auto-disable all confirmed. The earlier cron-401 blocker was fixed via `/debug` (added `/api/cron(.*)` to both apps' `proxy.ts` public matcher; also unblocked `/api/cron/cleanup` and rough-cut's `blob-sweep`). **Prod migration `0004` still pending at deploy.** **Gap found + fixed 2026-07-08 (`/develop auto-recharge` re-run):** the settings "Add card" button was never actually wired to a card form — it started a SetupIntent and just showed a success message. No card could ever be saved that way (the AC-5/6/7 verification above only exercised the checkout-purchase save path, not the standalone settings path). Added a real Stripe Elements form (`add-card-form.tsx` + `stripe-client.ts`); typecheck/lint clean. **Click-tested live in the browser by the user 2026-07-08**: clicked "Add card", entered the Stripe test card, panel refreshed showing "Visa •••• 4242", "Card saved.", and the auto-recharge toggle no longer disabled — confirmed working end to end. `/harden` flagged 3 should-harden items on this new form (unhandled rejection can stick the button on a network drop, the success message can race the persisting webhook, a missing publishable key would fail silently) — **all 3 fixed same day**, typecheck/lint/build/tests clean (12 tests total across the feature's files); see `docs/hardening/2026-07-08-main.md` for the closed-out detail.
- [x] Build it: `/develop wallet-ui` — premium wallet billing UI on `@repo/ui` + minimal rough-cut "add funds" prompt (AC-9). Code complete + typecheck clean; code in `apps/wallet/src/app/dashboard/` (5 new client components: `balance-hero.tsx`, `low-balance-banner.tsx`, `bundle-cards.tsx`, `autorecharge-panel.tsx`, `transaction-history.tsx`), `apps/wallet/src/app/globals.css` (wallet theme tokens), `apps/wallet/src/lib/stripe.ts` (`getSavedCard` helper), layout polish. Superseded `checkout-button.tsx` deleted. rough-cut already complete from slices 1+2 (credits panel + 402 toast).
- [x] Verify it: `/verify usd-wallet`
- [x] Test it: `/test usd-wallet` (tests green on dev)

### 2. Demo-only free credits gate · existing
Shipped off-plan (drift, no ADR): `is_member` now defaults to `false` and the automatic monthly credit grant is restricted to a single `MEMBER_ALLOWLIST_EMAIL`, so everyone else pays via Stripe instead of getting free credits by default (commits fd01b3d, 0f57c7c).
**Done when:** membership defaults to non-member, the monthly grant only fires for the allowlisted demo email, and existing rows are backfilled to the new default.
code in `apps/rough-cut/src/lib/users.ts`, `packages/db/src/schema.ts`, `packages/db/drizzle/0009_dizzy_human_fly.sql`

## Deferred

### 3. Auto-recharge notification channel
Notify a user by email (or another channel) when auto-recharge declines or gets auto-disabled, closing the seam left open in ADR 0002's auto-recharge slice. Walked through `/architect` on 2026-07-11: picking a real provider (Resend) felt like unnecessary scope for a demo/pre-client-signoff stage, so this is on hold. In-app visibility (the wallet dashboard already reflects a declined/disabled auto-recharge state) is judged sufficient for now.
**Done when:** the client gives a go-ahead on outbound billing emails; then a user whose auto-recharge declines or gets disabled after repeated failures is notified through a real channel, not just a silent state change.
- [ ] `/architect auto-recharge notification channel` (on hold, no ADR yet — re-run when the client greenlights outbound email)

### 4. AI Cut differentiated retail rate
AI Cut is priced equal to transcription today to keep pricing simple, but its real compute cost is roughly 7x higher (see `[[project_credits_pricing_decision]]`); revisit once `cost_micros` data shows the true margin gap.
**Done when:** a pricing decision is made (keep equal, or split the rate) backed by real usage data, and any rate change is applied.
- [ ] `/architect ai cut differentiated retail rate`

## Open questions

- **Member monthly grant** (from ADR 0002): the full money-era form (monthly dollar grant vs separate free-minutes vs dropped) is still deferred to a client conversation. Feature 2 above is an interim, demo-only stopgap (allowlist one email, everyone else pays), not the final answer — Slice 1 still does not depend on it.
