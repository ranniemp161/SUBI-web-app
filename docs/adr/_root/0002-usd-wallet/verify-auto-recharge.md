# Verify: auto-recharge · ADR 0002/0002 · updated 2026-07-08
_Steps derived from ADR 0002 acceptance criteria (slice-2 set: AC-5, AC-6, AC-7). `/verify` runs these; `/test` locks the durable ones. Use Stripe TEST mode throughout. The sweep is triggered by hand with the cron secret._

## Setup
- [ ] Migration `0004` applied to the target DB (dev already done; confirm `stripe_customer_id`, `default_payment_method_id`, `autorecharge_*` columns exist).
- [ ] Wallet running with Stripe test keys, `CRON_SECRET`, and a Stripe test webhook pointed at `/api/webhooks/stripe` (events: `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `setup_intent.succeeded`).

## AC-5 — save a card + enable, off by default, no enable without a card
- [ ] `GET /api/billing/autorecharge` for a fresh user → `enabled:false`, `hasCard:false` → AC-5
- [ ] `PATCH /api/billing/autorecharge {enabled:true, thresholdMicros:5000000, amountMicros:19000000}` with no card → 400 `NO_CARD` → AC-5
- [ ] Buy a bundle with Stripe test card `4242 4242 4242 4242` → after the webhook, query the user: `stripe_customer_id` and `default_payment_method_id` are set → AC-5
- [ ] `PATCH {enabled:true, thresholdMicros:5000000, amountMicros:3000000}` (amount <= threshold) → 400 → AC-5
- [ ] `PATCH {enabled:true, thresholdMicros:5000000, amountMicros:19000000}` (card present) → 200; DB shows `autorecharge_enabled=true`, threshold + amount set → AC-5

## AC-6 — balance below threshold triggers an off-session recharge
- [ ] Spend the balance below the $5 threshold (transcribe, or a direct ledger spend on a test user) → AC-6
- [ ] Trigger the sweep: `GET /api/cron/autorecharge` with header `Authorization: Bearer <CRON_SECRET>` → response `{charged:1,...}` → AC-6
- [ ] Query the user: `balance_micros` increased by $19.00; a `credit_ledger` row reason `auto_recharge` for +$19.00; `autorecharge_failures=0` → AC-6
- [ ] The whole thing happened with no user session present (only the cron secret) → AC-6

## AC-7 — safety: daily cap, idempotency, decline handling
- [ ] With balance still below threshold, call the sweep twice in quick succession → only ONE new `auto_recharge` ledger row / one Stripe charge (idempotency key dedup) → AC-7
- [ ] Force 3 successful recharges in 24h, then spend below threshold and sweep again → response shows `capped` (no 4th charge) → AC-7
- [ ] Replace the saved card with a Stripe decline PM (e.g. `pm_card_chargeDeclined` / test decline card), spend below threshold, sweep → `declined:1`; user `autorecharge_failures` incremented; a "declined" notice logged → AC-7
- [ ] Repeat declines to the cap (default 3) → `autorecharge_enabled` flips to `false`, a "disabled" notice logged; balance is then allowed to reach $0 and a new spend gates on the CHECK (child-0001 hard stop) → AC-7

## Commands
- [ ] `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3001/api/cron/autorecharge` → JSON `{swept,charged,declined,capped,errored}`
- [ ] `npm -w wallet run typecheck` → 0 errors (already green at build)

## Acceptance-criteria coverage
- AC-5 (save card + enable; off by default; no enable without card) … the settings + save-card steps
- AC-6 (auto-charge off-session below threshold, credit, no user present) … the sweep + ledger steps
- AC-7 (daily cap; no double-charge on re-run; declines notify then auto-disable) … the idempotency, cap, and decline steps

## Notes
- **Notifications are a placeholder seam** (`apps/wallet/src/lib/notifications.ts`) — the "notice logged" checks confirm the event fires; a real email/in-app channel is a deferred decision (umbrella 0002 Follow-up) and not part of this slice.
