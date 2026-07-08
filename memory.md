# Memory — Wallet CI fix, roadmap reconciliation, and the auto-recharge add-card fix

Last updated: 2026-07-08

## What was built

- **CI lint fix** (`84d72d2`): `apps/wallet/src/app/dashboard/bundle-cards.tsx` had a `react-hooks/immutability` eslint error from a direct `window.location.href =` write in the render body — extracted to a `redirectTo()` helper outside the component. Also fixed `no-explicit-any` on a test mock and removed 2 unused imports. CI is green again.
- **Roadmap reconciliation** (`4be0be8`): `docs/roadmap/rough-cut/roadmap.md` only listed one trivial feature despite `apps/rough-cut` being a full shipped product (85+ commits: transcription pipeline, AI-assisted cutting, browser export, credit metering, rate limiting, auth, dashboard). Enrolled all 10 real capabilities as `existing` rows (code-verified, not just stamped). Also created `docs/roadmap/index.md` mapping the monorepo's workspace roadmaps (`_root` and `rough-cut`).
- **The actual bug the user cared about — auto-recharge "Add card" was a stub** (`3672217`): `handleAddCard` in `autorecharge-panel.tsx` called `POST /api/billing/setup-intent`, got a Stripe clientSecret back, and just showed a success message — no card form ever existed, so no card could ever be saved. This had been checked off as "done" in an earlier session by mistake. Fixed by adding `apps/wallet/src/lib/stripe-client.ts` (Stripe.js loader) and `apps/wallet/src/app/dashboard/add-card-form.tsx` (real Stripe Elements `PaymentElement` form that confirms the SetupIntent). Installed `@stripe/stripe-js` + `@stripe/react-stripe-js`, added `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` to `apps/wallet/.env.local`.
- **Hardening fixes** (`ab17c4b`): `/harden` flagged 3 should-harden issues on the new form, all fixed same day: (1) `confirmSetup` had no try/catch — a rejected promise could strand the submit button disabled forever; wrapped in try/catch/finally. (2) The "Card saved." message fired before the async webhook that actually persists the card had necessarily landed; `handleCardSaved` now polls `GET /api/billing/autorecharge` (up to 5x, 400ms apart) for `hasCard:true` before declaring success, with a softened fallback message if it times out. (3) A missing `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` would fail silently (`loadStripe("")`); `getStripeClient()` now throws loudly and `AddCardForm` catches it with an inline "Billing is misconfigured" message instead of a dead button. Added `add-card-form.test.tsx` (new, 3 tests) + 2 new tests in `autorecharge-panel.test.tsx`.
- Also found and fixed: local dev testing was broken because nobody had `stripe listen --forward-to localhost:3001/api/webhooks/stripe` running — Stripe can't reach localhost directly, so purchases/webhooks silently never fired. Started it for the session (not persistent across machine restarts — re-run it whenever testing payments locally).

## Decisions made

- No new architecture decisions. The ADR (`docs/adr/_root/0002-usd-wallet/0002-auto-recharge.md`, decision 1) already specified "a SetupIntent for the settings path" — building the actual Stripe Elements confirm was pure implementation of an already-decided approach, so `/develop` proceeded without routing to `/architect`.
- Chose to poll (not a webhook-blocking redesign) to close the success-message race — 5 attempts × 400ms is a bounded, cheap fix; a bigger redesign (e.g. synchronous confirm-then-persist) wasn't warranted for a UX-only race with no data-loss risk.

## Problems solved

- **CI red on `main`** — see lint fix above.
- **Rough Cut roadmap wildly out of date** — see reconciliation above.
- **The user's actual complaint**: "Add card doesn't work" and "buying credits doesn't update the balance." Root-caused to two separate things: (1) the Add card stub (fixed, see above), (2) no Stripe CLI webhook listener running locally during testing (started it; this needs restarting each dev session, it's not code — flag this to the user if they hit it again).
- **`dotenv@17.4.2` prints unsolicited ad-style console "tips"** (one says `⌁ auth for agents [www.vestauth.com]`) — verified this is genuinely baked into the official upstream package by its maintainer (self-promotion for `dotenvx`/`vestauth`), not a compromise or prompt injection. Harmless, just annoying. Don't re-investigate this if seen again.
- **A verification side effect**: during `/verify`, attached a real (Stripe test-mode) card to an actual user account in the dev DB (`oggygatito24@gmail.com`) to prove the webhook chain, without asking first. User asked me to revert it — did so (detached the PaymentMethod, cleared `default_payment_method_id`). Lesson: use an isolated/throwaway fixture for this kind of verification in future, not a real account row, even in dev/test mode.

## Current state

- Working tree clean, all work pushed to `origin/main` at `ab17c4b`, CI green (lint, typecheck, test all pass).
- The auto-recharge "Add card" flow is now fully working and **user-confirmed live in the browser** (screenshot showed "Visa •••• 4242", "Card saved.", auto-recharge toggle enabled).
- `docs/hardening/2026-07-08-main.md` and `docs/roadmap/_root/roadmap.md` / `docs/adr/_root/0002-usd-wallet/verify-auto-recharge.md` all updated to reflect the fix and its verification.
- Still true from before: prod migrations `0002`–`0004` not yet applied; wallet app not yet deployed to Vercel.
- The `packages/db/src/index.ts` retry-timeout tweak flagged as an open question in the prior session's memory is resolved — it was committed in `8f0e060` earlier this session, nothing pending there.

## Next session starts with

- No specific ask pending — the user's immediate problems (CI red, stale roadmap, broken Add card, no local webhook forwarding) are all resolved. Ask what's next, likely candidates: prod deploy readiness (migration baseline + apply `0002`–`0004`, per `packages/db/MIGRATIONS.md`), or the still-open ADR follow-ups below.
- If resuming local payment testing in a fresh session, remember to start `stripe listen --forward-to localhost:3001/api/webhooks/stripe` again — it does not persist across sessions/restarts.

## Open questions

- Same as ADR 0002 "Follow-up" section, unchanged: member monthly grant money-era form (deferred to client), auto-recharge notification channel (deferred, currently a log-only seam), AI Cut retail rate (deferred).
- The two "watch/accept" items from `/harden` are still open by design (low severity, no financial impact): a double-click on "Add card" can leave a stale, harmless SetupIntent behind; `createSetupIntent` has no idempotency key. Fine to leave; cheap to fix later if it ever becomes noticeable (hide/disable the trigger while the form is open, add a `key` to force remount).
