# 0002/0002: Auto-recharge (Stripe off-session)

Child of [0002 USD-denominated Wallet](./index.md). Depends on child `0001` (money unit and the deposit path). Read the umbrella first.

## Context

When the balance runs low the user should be able to have the wallet buy more automatically instead of hitting $0 and being blocked. This is the OpenAI "auto recharge" pattern: when the balance drops below a line the user sets, charge their saved card for an amount they set, without the user present. That last part ("without the user present") is a Stripe **off-session** payment and is the whole reason this is its own decision: it moves real money on the user's behalf, so it needs saved cards, a safe trigger, a daily cap, idempotency, and decline handling.

## Decision

### 1. Save the card with Stripe Customer + off-session setup

At the first bundle purchase (and from a "add a card" action in settings), create/attach a Stripe **Customer** and save a **PaymentMethod** for off-session use (Checkout with `customer_creation` + `payment_intent_data.setup_future_usage = 'off_session'`, or a SetupIntent for the settings path). We store only ids, never card data:

New `users` columns (all nullable except the flags):

| Column | Purpose |
|---|---|
| `stripe_customer_id text` (unique) | The Stripe customer to charge |
| `default_payment_method_id text` | The saved card to use off-session |
| `autorecharge_enabled boolean default false` | Master switch, off by default |
| `autorecharge_threshold_micros integer` | Charge when balance drops below this |
| `autorecharge_amount_micros integer` | How much to buy each time |
| `autorecharge_failures integer default 0` | Consecutive decline counter |

Auto-recharge **cannot be enabled without a usable `default_payment_method_id`** (enforced in the settings action).

### 2. Trigger: a wallet cron sweep (not a cross-app call)

Auto-recharge runs entirely inside the wallet app, because the wallet is the sole billing authority and rough-cut must never call Stripe. A scheduled sweep (extending the existing `api/cron/cleanup` pattern, run frequently, for example every minute) selects users who are `autorecharge_enabled`, have `balance_micros < autorecharge_threshold_micros`, have a payment method, are under the daily cap, and charges each off-session.

Because the threshold fires **before** $0 (for example at $5), the sweep tops the user up before they exhaust the balance, so in normal use they never hit the gate. A short sweep interval keeps the latency low; up to one interval of delay is acceptable because auto-recharge is a convenience, not a hard zero-downtime guarantee (the user can always top up manually).

**Why a sweep, not a synchronous trigger at spend time.** A spend happens in rough-cut, which cannot call Stripe. A synchronous path would need an authenticated internal wallet endpoint that rough-cut pings after every spend, adding cross-app auth and a request on the hot path. The sweep keeps all billing in the wallet, off the spend path, and is simpler to make safe.

### 3. The charge: off-session PaymentIntent, idempotent, capped

For each eligible user the sweep creates a PaymentIntent (`off_session: true`, `confirm: true`, the saved customer and payment method, amount = `autorecharge_amount_micros` converted to the Stripe minor unit) with an **idempotency key** derived from the user id and a time/threshold bucket, so a re-run of the sweep cannot double-charge. On the webhook `payment_intent.succeeded`, deposit `autorecharge_amount_micros` with reason **`auto_recharge`** (the new enum value from child `0001`), idempotent on the PaymentIntent id via `stripe_event_id`, and reset `autorecharge_failures` to 0.

**Daily cap.** Before charging, count `auto_recharge` ledger rows for the user in the last 24h; if at or over the configured maximum (for example 3), skip and do not charge. The distinct reason is what makes this count cheap and exact. The amount must be greater than the threshold (validated on save) so a recharge always lifts the balance clear of the trigger line, preventing an immediate re-fire.

### 4. Decline handling: notify, then auto-disable

On an off-session decline (webhook `payment_intent.payment_failed`, or a raised card error): notify the user, increment `autorecharge_failures`. After a small number of consecutive failures (for example 3), set `autorecharge_enabled = false` and notify that auto-recharge was turned off. The balance is then allowed to reach $0 and services gate via the child `0001` CHECK, exactly as if auto-recharge were never on. A later successful manual purchase or a fixed card + re-enable resets the counter.

### Implementation skills

**Offer to the engineer:** a Stripe Agent Skill and/or the Stripe MCP server would help build the off-session flow to Stripe's conventions. Not currently installed (see `apps/wallet/AGENTS.md`). Recommended follow-up: install the Stripe skill for the build and connect the Stripe MCP for live testing. (Offered per the architect flow; the engineer chooses.)

## Options considered

- **Synchronous trigger at spend time** (rough-cut pings a wallet endpoint after each spend). Rejected: puts a billing request on the hot spend path and needs cross-app auth; the sweep is simpler and keeps billing in the wallet.
- **Charge via a new Checkout session each time.** Rejected: Checkout is on-session (needs the user present); auto-recharge is by definition off-session, which requires a saved PaymentMethod and a direct PaymentIntent.
- **Disable auto-recharge on the first decline.** Rejected: a transient decline (a temporary hold, a momentary limit) would permanently switch it off; a small consecutive-failure count tolerates blips while still stopping on a dead card.
- **No daily cap, trust the threshold.** Rejected: a bug, a clock issue, or abuse could fire many charges; the cap plus idempotency plus amount-greater-than-threshold are the standard off-session safety net.

## Rationale

Off-session billing is the one genuinely new risk this feature adds, so every part of this child is about making an automatic charge safe: a saved-card requirement to enable it, a sweep that keeps Stripe out of rough-cut, an idempotency key so retries cannot double-charge, a distinct ledger reason that makes the daily cap a cheap count, and a failure counter that stops charging a dead card without over-reacting to a blip. Keeping it inside the wallet preserves 0001's single-billing-authority rule.

## Build plan

_Build progress (`/develop auto-recharge`, 2026-07-08): all tasks built, wallet + rough-cut typecheck clean. Migration `0004` applied + verified on the DEV branch. Notifications use a placeholder seam (`src/lib/notifications.ts`) because the channel is deliberately undecided (umbrella Follow-up). Prod migration + `/verify` + `/test` still pending._

1. **[x] Schema: auto-recharge columns (AC-5).** Six `users` columns added in `packages/db/schema.ts` + unique on `stripe_customer_id`. Migration `0004_autorecharge_columns.sql` (additive) applied to dev via the neon-http migrator; columns confirmed live.
2. **[x] Save-card path (AC-5).** Checkout route now attaches/reuses a Stripe Customer and sets `setup_future_usage: off_session`; `POST /api/billing/setup-intent` starts the settings add/replace-card flow. The webhook (`checkout.session.completed` + `setup_intent.succeeded`) persists `stripe_customer_id` and `default_payment_method_id`.
3. **[x] Settings API + validation (AC-5).** `GET`/`PATCH /api/billing/autorecharge`: rejects enabling without a saved card (`NO_CARD`), rejects `amount <= threshold`, and adds a defensive max-amount cap. Logic in `src/lib/autorecharge.ts`.
4. **[x] Cron sweep (AC-6).** `GET /api/cron/autorecharge` (Bearer `CRON_SECRET`, registered in root `vercel.json` every 2 min) selects eligible users and charges off-session with the idempotency key + daily-cap check.
5. **[x] Webhook: success + failure (AC-6, AC-7).** `payment_intent.succeeded` deposits reason `auto_recharge` (idempotent backstop; the deposit also resets failures). **Refinement:** failure accounting (increment + notify + auto-disable) lives in the **sweep**, not the webhook, because an off-session `confirm:true` charge fails synchronously there and catches every decline including `authentication_required` (which never emits `payment_failed`). The webhook's `payment_failed` handler only logs, to avoid double-counting. Behaviour (notify, then auto-disable after N declines) is unchanged from the ADR.
6. **[x] Daily cap + idempotency (AC-7).** 24h `auto_recharge` count gates each charge; the idempotency key (`autorecharge:v1:<user>:s<successesToday>:f<failures>`) advances only on a real state change, so sweep re-runs dedup while declines still retry and reach auto-disable.

## References

- `apps/wallet/src/lib/stripe.ts`, `apps/wallet/src/app/api/webhooks/stripe/route.ts`, `apps/wallet/src/app/api/cron/cleanup/route.ts` — the existing Stripe, webhook, and cron patterns to extend.
- Stripe off-session payments and SetupIntents (verify against current Stripe docs at build time).
