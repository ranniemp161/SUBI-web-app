# Security Audit: SUBI (rough-cut + wallet) — DDoS Mitigation & Abuse Resilience

Scope: rate-limit coverage per API route, caching, unauthenticated/public endpoints, expensive
operations reachable without limits. Companion to `2026-07-15-cloud-infra-review.md`.

**Verdict up front**: the application-layer abuse story is unusually good for a project at this
stage — every one of the 20 API routes is behind either Clerk session auth, a cryptographic gate
(Stripe/svix signature, per-project single-use token, `CRON_SECRET`), or both, and every
authenticated route carries a per-user rate limit with the money-moving paths failing closed.
Nothing is Critical. The real gaps are one tier up (volumetric DDoS is entirely Vercel's edge,
unverifiable from the repo) and one tier down (the realtime and rate-limit *infrastructure* —
Pusher and Upstash — can themselves be exhausted, and both degrade in ways that hurt).

## Attack Surface Summary

**Entry points** (20 API routes + pages):

| Class | Routes | Gate | Rate limit |
|---|---|---|---|
| Authenticated reads (rough-cut) | `GET /api/projects`, `GET /api/projects/[id]`, `GET /api/credits`, `GET /api/projects/[id]/status` | Clerk middleware (default-deny) + `getAuthorizedDbUser` | shared `read:<clerkId>` 600/5min (`lib/rate-limit.ts:9-10`) |
| Authenticated writes (rough-cut) | `POST /api/projects` (60/hr), `PATCH /api/projects/[id]` (read bucket), `POST /api/transcribe/blob-token` (60/hr), `POST /api/transcribe/deepgram` (30/hr), `POST /api/transcribe/blob-cleanup` (per-user/hr) | Clerk + ownership checks | per-user buckets, fail-open |
| AI Cut cluster | `POST .../ai-cut`, `GET .../ai-cut/active`, `PATCH/DELETE .../ai-cut/runs/[runId]` | Clerk + ownership | shared `ai-cut:<clerkId>` 10/hr; POST adds **fail-closed** idempotency lock (`ai-cut/route.ts:69-71`) |
| Wallet billing | `POST /api/billing/checkout`, `POST /api/billing/setup-intent`, `GET/PATCH /api/billing/autorecharge` | Clerk | per-user/hr, **fail-closed** on Redis error |
| Public machine endpoints | `POST /api/webhooks/stripe`, `POST /api/webhooks/clerk`, `POST /api/transcribe/callback` | Stripe signature / svix signature / per-project single-use token (timing-safe) | per-IP 120/min (webhooks), 60/10min (callback) |
| Public human endpoints | `GET /api/billing/bundles`, landing pages, sign-in/up | none (by design) | **none in-app** — see Finding 2 |
| Crons | `blob-sweep`, `autorecharge`, `cleanup` | `CRON_SECRET` Bearer, fail-closed, timing-safe compare | n/a |

**Key assets**: Neon compute/storage, the credit ledger (money), third-party metered quotas
(Deepgram, Gemini, Vercel Blob ops, Upstash commands, Pusher connections), and on Hobby the
Vercel function-invocation budget — exhaustion there pauses the deployment (availability, not
bill shock).

**DoS-relevant design wins**: media bytes never transit a function (browser → Blob direct
upload), so the classic large-body vector doesn't exist; the landing page is deliberately kept
fully static/CDN (`proxy.ts:22-24`); expensive third-party calls (Deepgram, Gemini) sit behind
*both* a rate limit and an atomic credit reserve, so they cost the attacker money before they
cost you money.

## Critical (Fix Before Launch)

None found.

## High

None found. (For a public-launch tier, Finding 1 below arguably promotes to High because the
polling fallback was removed — a saturated Pusher app has no recovery path in the client.)

## Medium

| # | Finding | Evidence | CWE/OWASP | Exploit Scenario | Remediation |
|---|---------|----------|-----------|------------------|-------------|
| 1 | **Pusher channels are public; the realtime layer can be denied by anyone holding the public key** | `dashboard/page.tsx:679`, `dashboard/[id]/page.tsx:301` — `pusher.subscribe(id)` on plain (not `private-`) channels; `NEXT_PUBLIC_PUSHER_KEY` ships in the client bundle by definition | CWE-400 / A04 | An attacker lifts the public key + cluster from the JS bundle and opens connections directly against the Pusher app (never touching your servers, so no rate limit applies) until the plan's concurrent-connection/message quota is exhausted. Every in-flight transcription then sticks at "Transcribing…" forever — the client has no polling fallback anymore (`AGENTS.md`: "a silently-skipped event leaves the project stuck… until a manual reload"). Secondary: anyone who learns a project UUID can subscribe and watch its `transcript_status` events (negligible leak — status flag only) | Move to `private-<projectId>` channels with a Pusher auth endpoint that checks project ownership (Clerk session + `getOwnedProject`) — this makes third-party connection floods unauthenticatable. If accepted at preview tier, document that a Pusher quota alarm is the compensating control |
| 2 | **`/api/billing/bundles` is public with no rate limit, and its CDN cache is trivially bypassed** | `bundles/route.ts:13-19` (no limiter, intentionally unauthenticated); cache key includes the query string, and the route ignores query params | CWE-400 / A04 | `GET /api/billing/bundles?r=<random>` misses the CDN on every request, forcing a function invocation each time. Per-invocation cost is small (5-min in-memory cache in `stripe.ts:72-77`; worst case one `prices.retrieve` per allowlisted price per cold instance), but the invocations themselves drain the Hobby budget — the one resource whose exhaustion pauses the whole deployment | Two cheap layers: add `ipRateLimit(request, "bundles", …)` like the webhooks have, and/or strip the cache-bypass vector (Vercel WAF rule, or serve bundles from a static/ISR page segment where the router normalizes the key). The in-memory + CDN caching already present is correct — keep it |
| 3 | **The rate limiter's own quota is attacker-reachable, and exhausting it flips every abuse cap to fail-open at the worst moment** | Limiter runs *before* signature verification on all three public POST endpoints: `webhooks/stripe/route.ts:85` vs `:98`, `webhooks/clerk/route.ts:42` vs `:56`, `transcribe/callback/route.ts:62` (token check is at `:80-88`); fail-open on Redis error at `server-shared/rate-limit.ts:83-84` | CWE-400 / A04 | Unauthenticated junk POSTs to the webhook endpoints each consume ≥1 Upstash command despite carrying no valid signature. A sustained flood (especially distributed, defeating the per-IP buckets) burns the Upstash free-tier command quota; once Redis starts erroring, every *fail-open* cap in both apps silently disappears — precisely while under attack. (Money paths fail closed and missing-config-in-prod throws — both verified good.) | Reorder: verify the HMAC/svix signature (pure CPU, no I/O) *before* the Redis call on both webhook routes — invalid traffic then never touches Upstash. The Deepgram callback can't fully do this (its token lives in the DB) but its UUID/token shape checks at `:49-60` already shed malformed junk pre-Redis. Add an Upstash usage alert as the backstop |

## Low

| # | Finding | Evidence | CWE/OWASP | Exploit Scenario | Remediation |
|---|---------|----------|-----------|------------------|-------------|
| 4 | **Volumetric DDoS defense is entirely delegated to Vercel's edge and is unverifiable from the repo** | No WAF config, no challenge rules in repo (expected — Hobby dashboard-side) | A04 | App-layer per-user/per-IP limits stop *abuse*, not *floods*. A L7 flood at any public path is absorbed (or not) by Vercel's platform mitigation; on Hobby there are no custom WAF rules or spend headroom | Console: confirm Attack Challenge Mode is available and know where the toggle is before an incident. When the project moves to Pro (already forced by the cron-cadence issue, per ADR 0002), add a WAF rate-limit rule in front of the public endpoints as the pre-function throttle |
| 5 | **Multi-account amplification: all expensive-op limits key on `clerkId`, and account creation is only as hard as Clerk makes it** | Every limiter keyed `<bucket>:<clerkId>`; `webhooks/clerk/route.ts:68+` provisions a `users` row for every `user.created` | CWE-770 | N signups → N× (60 project-creates/hr in Neon, 60 blob tokens/hr — each with a 1MB floor even at zero balance, `blob-token/route.ts:94-98` — and 600 reads/5min). Credits gate everything *actually* expensive (Deepgram/Gemini need a funded balance), so the residual is Neon churn and ≤60MB/hr/account of Blob storage that the 6-hour orphan sweep reclaims | Verify Clerk bot protection (CAPTCHA/email verification) is on in the dashboard — that's the actual control. In-repo posture is acceptable: the zero-balance credit gate is doing the heavy lifting |
| 6 | **Per-IP limits assume Vercel-sanitized `x-forwarded-for`** | `ip-rate-limit.ts:13-16` trusts the first XFF entry; the comment correctly scopes this to Vercel's edge | CWE-348 | Safe as deployed (Vercel overwrites XFF). If any route is ever fronted differently (custom proxy, self-host, `next start` behind nginx), the header becomes attacker-controlled and every per-IP bucket is bypassable by rotating a fake XFF | No change needed now; the load-bearing assumption is documented in code. Re-check if the deploy target ever changes (deploy target is locked to Vercel per project decision) |

## Requires Runtime/Infra Verification

- Vercel platform DDoS posture: Attack Challenge Mode availability, whether Deployment
  Protection is on (it also fronts the public endpoints), and Hobby invocation/bandwidth caps.
- Clerk dashboard: bot protection / email verification on sign-up (controls Finding 5).
- Upstash console: current command usage vs plan quota + an alert threshold (controls Finding 3).
- Pusher dashboard: concurrent-connection and daily-message quota + alerting (controls Finding 1).
- Deepgram/Gemini spend alerts — credit-gated in-app, but a bug in the gate would only surface as
  a bill without provider-side alerts.

## Verified Good

- **Default-deny middleware in both apps**: everything not on the explicit public list 401s
  before any DB work (`rough-cut/proxy.ts:32-40`, `wallet/proxy.ts:23-31`); Clerk JWT
  verification is local, so unauthenticated floods at protected routes never touch Neon.
- **100% rate-limit coverage of authenticated routes** — no authenticated route lacks a limiter
  (verified by grep across all 20 routes; the only limiter-free routes are the three
  `CRON_SECRET`-gated crons and public `bundles`).
- **Money and compute are charged before spend, atomically**: transcription reserves credits via
  conditional UPDATE before Deepgram is called (`deepgram/route.ts:137`, 402 on insufficient);
  AI Cut holds a fail-closed idempotency lock (`ai-cut/route.ts:69-71`); upload size is bounded
  by affordable credit-seconds, closing the `durationMs=0` spoof (`blob-token/route.ts:85-98`).
- **Fail-closed where it matters**: checkout, setup-intent, autorecharge PATCH, AI Cut lock all
  pass `failClosed: true`; missing KV config in production throws instead of failing open
  (`server-shared/rate-limit.ts:17-18`); both cron gates fail closed on missing `CRON_SECRET`
  with timing-safe comparison (`blob-sweep/route.ts:17-21`, `cleanup/route.ts:13-18`).
- **Deepgram callback hardening**: UUID + token shape validation before any I/O, per-IP limit,
  then single-use per-project token compared timing-safely and cleared on use
  (`callback/route.ts:49-88`, `:106`).
- **Caching is correct per class**: landing page fully static/CDN by deliberate middleware
  design; user-specific API responses `Cache-Control: no-store` everywhere checked; the one
  public dataset (bundles) is CDN + in-memory cached. No user input is reflected into any
  cacheable response — no cache-poisoning vector found.
- **Long-running work is bounded**: `maxDuration` explicit on every long route (300s crons/AI
  Cut, 60s callback); the AI Cut edge stream costs an attacker a 10/hr budget to hold open.

## Action Items (Exploitability × Impact order)

1. [x] Move Pusher to `private-` channels with an ownership-checking auth endpoint — **fixed
   2026-07-15**: `projectChannel()` in `lib/pusher.ts` names the channels, all five server
   triggers and both client subscriptions use it, and the new `POST /api/pusher/auth`
   (Clerk session + `getAuthorizedDbUser` + per-user rate limit + `getOwnedProject`)
   countersigns subscriptions. A Pusher quota alert is still worth setting (item 4).
2. [x] Reorder webhook routes: signature verification before the Redis rate-limit call —
   **fixed 2026-07-15** in both `webhooks/stripe` and `webhooks/clerk`; tests now assert
   invalid-signature requests never consume a rate-limit slot.
3. [x] Add `ipRateLimit` to `GET /api/billing/bundles` — **fixed 2026-07-15**: 60/min per IP,
   with the 429 marked `no-store` so it can't be CDN-cached under the shared key.
4. [ ] Set usage alerts: Upstash commands, Pusher connections, Deepgram/Gemini spend.
5. [ ] Console verification pass: Clerk bot protection, Vercel Attack Challenge Mode /
   Deployment Protection status (fold into the cloud-infra review's console checklist).
6. [ ] When moving to Vercel Pro (already planned for cron cadence): add a WAF rate-limit rule
   in front of `/api/webhooks/*`, `/api/transcribe/callback`, and `/api/billing/bundles`.
