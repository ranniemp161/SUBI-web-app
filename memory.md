# Memory — Webhook Debugging & Fixes

Last updated: 2026-07-07 21:14

## What was built

- **Proxy Routing Cleanup:** Removed the unused `/api/webhooks/stripe` bypass from `apps/rough-cut/src/proxy.ts` since the Stripe webhook handler exclusively lives in the Wallet app. This prevents configuration confusion and tightens security.
- **Verbose Webhook Logging:** Added highly detailed debug logs to `apps/wallet/src/app/api/webhooks/stripe/route.ts` that log exactly why webhooks succeed, fail, or skip database inserts (e.g., missing metadata, wrong event type, duplicate events).

## Decisions made

- **Wallet Centralization:** The Wallet app is the sole source of truth for handling Stripe webhooks (`checkout.session.completed`) and managing the credit ledger. The Rough Cut app simply consumes this data.

## Problems solved

- **Webhook Silent Failures ("200 OK" but no tokens):** We solved the issue where "Buy credits" wasn't updating user balances despite Stripe returning 200 OK. We discovered that Stripe test webhooks must be triggered through the UI, NOT the `stripe trigger` CLI command (which omits metadata and gracefully returns 200 OK). 
- **End-to-End Success:** Local end-to-end token purchases via Stripe test mode are now fully working, verified by the user directly in their Wallet dashboard.

## Current state

- Local Stripe testing works flawlessly.
- The webhook handler logic (`depositPurchase`) is fully verified by unit tests.
- We have uncommitted changes in `proxy.ts` and `route.ts`.

## Next session starts with

- **Commit and Push:** Commit the webhook logging and proxy changes, pull from `origin/main`, and push the fixes to GitHub so the CI pipeline is green.
- **Production Setup:** Configure the production Stripe Live Dashboard to point to the `wallet` app domain for `checkout.session.completed`, and update the Vercel environment variable `STRIPE_WEBHOOK_SECRET` for production.

## Open questions

- None at the moment.
