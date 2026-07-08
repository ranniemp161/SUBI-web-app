# 0002: USD-denominated Wallet (money balance, auto-recharge, premium UI)

**Date**: 2026-07-08
**Status**: In Progress
**Scope**: Repo-wide (packages/db, apps/wallet, apps/rough-cut)
**Supersedes**: Decision 3 (Universal Currency: Tokens) of [0001](../0001-monorepo-wallet-architecture.md)

## Summary

Today the balance is a `tokens` count (really "1 token = 1 second of audio") shown as a number like "Available Tokens 2045". This ADR changes the balance to be **plain money in US dollars**. You buy a bundle, your balance goes up by real dollars, and as you transcribe or run AI Cut the dollars are spent down. When the balance gets low the user can turn on **auto-recharge** (automatically buy more when it drops below a line they set), or let it run out, in which case the app's paid services pause until they top up. The wallet app also gets a premium visual redesign, built on the shared theme so it matches the rest of the ecosystem.

Money is stored as an integer number of **USD micros** (1,000,000 micros = $1), the same unit the ledger already uses for cost tracking. The existing append-only ledger, the hold/settle flow, and the `CHECK(balance >= 0)` overdraft guard all stay exactly as they are; only the unit they count changes.

## Context

`0001` chose a `tokens` currency over money so that each app could set its own exchange rate (100 tokens = 1 min of video, 50 tokens = 1 image, and so on). In practice there is one spending app (`apps/rough-cut`) and tokens are just seconds with a dollar markup baked into the bundles. The client wants the wallet to read like a real prepaid money account (the OpenAI "Pay as you go / Credit balance $7.89" pattern was the reference), because that is far more intuitive for customers than an abstract token count, and it still works for future apps (a dollar buys video minutes or images or infographics, each app pricing its own service in dollars). Dollars are simply a more universal unit than tokens, so this supersedes decision 3 without giving up the multi-app goal.

The old production database has real users with `tokens` (second) balances, even though the monorepo apps are not yet deployed to Vercel. So this is a real migration with a one-time balance conversion, not a greenfield rename.

## Structure

This is an umbrella decision. Read `index.md` (this file) for the shared model and the cross-child contracts, then the child that covers your task.

| File | What it is | Supports |
|---|---|---|
| `0001-money-ledger.md` | Child ADR: the money unit, schema rename, retail metering, bundle-to-balance mapping, and the one-time balance conversion migration. The foundation the other two build on. | The unit change + gating |
| `0002-auto-recharge.md` | Child ADR: Stripe off-session auto-recharge (saved card, threshold and amount settings, the trigger sweep, daily cap, and decline handling). | Auto-recharge |
| `0003-wallet-ui.md` | Child ADR: the premium wallet billing UI on the shared theme, plus the minimal "add funds" prompts in rough-cut. | Premium UI/UX |
| `research/_shared-pricing-and-conversion.md` | The pricing math: retail rate derivation, the per-bundle balance table, and the token-to-micros conversion formula. Optional depth, not required reading. | All children |

## Cross-child contracts

The seams where the children connect. Build to these so the slices fit together.

- **The unit is USD micros everywhere.** `users.balance_micros`, `credit_ledger.delta_micros`, `projects.hold_micros`, and every bundle's `metadata.credit_micros` are integer micros. Money is only ever formatted to `$X.XX` at the display edge (a single `formatUsd(micros)` helper), never rounded in storage or math. Defined in child `0001`; consumed by `0002` (recharge amounts and thresholds are micros) and `0003` (display).
- **The zero-gate is the DB CHECK.** `CHECK(balance_micros >= 0)` is the single source of truth for "services cease at zero". A spend that would overdraft raises Postgres `23514`, rolls back, and returns `insufficient` (unchanged mechanism). Auto-recharge (`0002`) reduces how often users hit it; the rough-cut prompts (`0003`) are the user-facing face of it. No app checks the balance in application code to gate; the constraint does.
- **Only the wallet talks to Stripe.** rough-cut never calls Stripe. Auto-recharge (`0002`) runs entirely inside the wallet app (a cron sweep plus the webhook), so a spend in rough-cut never triggers a cross-app billing call. This keeps `0001`'s "wallet is the sole billing authority" rule intact.
- **Deposits are idempotent on the Stripe id.** Every balance increase (manual bundle purchase and auto-recharge) is a `credit_ledger` row keyed on a unique Stripe id (`stripe_event_id`), so a webhook retry never double-credits. Manual purchases keep reason `purchase`; auto-recharge uses reason `auto_recharge` (a new enum value) so it can be counted for the daily cap.

## Requirements

The acceptance criteria this whole feature is built and verified against. Each build task in the children is tagged with the AC(s) it satisfies.

- **AC-1**: The wallet balance is shown as US dollars formatted `$X.XX` (for example `$19.00`), never as a raw token or micro number.
- **AC-2**: Buying a bundle credits the balance by that bundle's configured dollar value ($19 bundle credits $19.00; the larger tiers credit their bonus value), and the value comes from the Stripe Price `metadata.credit_micros`, not from code.
- **AC-3**: Transcribing and running AI Cut deduct real dollars from the balance at the configured retail rate, and each spend writes a ledger row in micros while preserving the existing hold, settle, refund, and reclaim behaviour.
- **AC-4**: When the balance cannot cover a new job the job is blocked (hard stop), the user sees a clear "add funds" prompt, and any already in-flight job finishes. No balance ever goes negative.
- **AC-5**: A user can save a card and turn on auto-recharge with their own threshold and amount; it is off by default and cannot be enabled without a usable saved card.
- **AC-6**: When an eligible user's balance drops below their threshold, the wallet automatically charges their saved card off-session and credits the balance, without the user present.
- **AC-7**: Auto-recharge is safe: it never exceeds the configured maximum charges per day, a Stripe retry never double-charges, and repeated declines notify the user and then auto-disable auto-recharge (after which the balance is allowed to reach $0 and services gate normally).
- **AC-8**: Existing production users keep their value: their `tokens` balance is converted to the equivalent dollar balance in one migration step, with a ledger row recording the conversion.
- **AC-9**: The wallet billing screens are a premium redesign built on the shared `@repo/ui` theme (light and dark), and rough-cut shows a minimal, on-theme "out of funds, add funds" prompt that deep-links to the wallet.

## Build plan (Tracer Bullet slices)

The project build approach is Tracer Bullet (thin vertical slices, each working end to end through every layer). The atomic tasks live in each child's own `## Build plan`; these are the slices that roll them up. Build in order; each slice is shippable.

1. **Slice 1: money end to end (no auto-recharge yet).** The whole balance becomes dollars and works through every layer: schema rename and conversion migration, credits library in micros, bundle `metadata.credit_micros`, webhook deposit, wallet balance shown as `$X.XX`, rough-cut spend and gate. Covers AC-1, AC-2, AC-3, AC-4, AC-8. See child `0001`.
2. **Slice 2: auto-recharge end to end.** Save a card at purchase, auto-recharge settings, the cron sweep that charges off-session, the daily cap and idempotency, and decline handling. Covers AC-5, AC-6, AC-7. See child `0002`.
3. **Slice 3: premium UI.** The full premium wallet billing experience on the shared theme, plus the minimal rough-cut "add funds" prompt. Covers AC-9 (and re-skins the surfaces from slices 1 and 2). See child `0003`.

## Consequences

**Good**
- The balance reads like real money, which is what customers understand; the OpenAI-style "add funds / auto-recharge / runs out and pauses" flow is familiar and premium.
- The heavy concurrency machinery (single-statement CTE spends, the overdraft CHECK, hold/settle exactly-once) is reused unchanged, so the risky part of the system is not rewritten, only its unit is renamed.
- Retail pricing moves to config (Stripe metadata for bundle value, an env constant for the per-minute rate), so prices change with no redeploy, consistent with the existing Stripe-dashboard-driven bundles.

**Costs and risks**
- Auto-recharge introduces off-session card charging, which is real money moved without the user present. It needs the daily cap, idempotency, and decline handling in child `0002` to be safe, and it carries card-on-file (PCI) responsibility handled by Stripe (we store only the Stripe customer and payment-method ids, never card data).
- A one-time production balance conversion must be exact and auditable; it is gated behind the `0000` migration baseline noted in `packages/db/MIGRATIONS.md`.
- The member monthly grant is deliberately left undecided (see Follow-up), so slice 1 must not hardcode a grant assumption.

## Follow-up

- **OPEN QUESTION (owner: client conversation): the member monthly grant.** Skool members get 3600 free seconds (~60 min) per month today. Its money-era form (a monthly dollar grant, a separate free-minutes balance, or dropped) is not decided. The migration and slice 1 must not depend on the answer; the existing `ensureMonthlyGrant` stays functional in micros as a placeholder until the client decides. Revisit as its own decision.
- **Notifications channel for auto-recharge (declines, disabled).** This ADR assumes the user is notified but does not specify the channel (email via which provider, in-app, both). Settle when the notifications approach is chosen; not a blocker for the charge logic.
- **AI Cut may warrant its own retail rate later.** Kept equal to transcription for now to preserve current economics, but its real cost is ~7x higher; revisit once `cost_micros` data shows the true margin.
- **`packages/config-typescript`** remains unbuilt (noted in 0001); unrelated, listed only so it is not re-surfaced.
