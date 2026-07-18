# Cloud Infra Review: SUBI (rough-cut + wallet) on Vercel + Neon + Upstash + Clerk + Stripe

**No Terraform/CDK/K8s exists — this is a pure PaaS deployment.** That's the right call at this scale (solo dev, client-preview, a handful of managed services), so the top recommendation is *not* "adopt IaC" — it's "make the two `vercel.json` files and the dashboard settings they depend on legible to a future reader," since dashboard config is currently the only place several load-bearing decisions live.

## Infrastructure Inventory

| Layer | Provider | Config location |
|---|---|---|
| Compute | Vercel (2 separate projects: rough-cut, wallet), Next.js serverless + 1 Edge function (`ai-cut`) | `apps/rough-cut/vercel.json`, root `vercel.json` |
| Cron | Vercel Cron | `apps/rough-cut/vercel.json` (blob-sweep, `0 4 * * *`), root `vercel.json` (autorecharge `0 5 * * *`, cleanup `0 0 * * *`) |
| Database | Neon Postgres (HTTP driver, no pool), shared by both apps via `@repo/db` | Runtime connection: `packages/db/src/index.ts` (`DATABASE_URL`); `packages/db/drizzle.config.ts` is the drizzle-kit CLI config for migrations only |
| Cache/rate-limit | Upstash Redis via Vercel KV | `KV_REST_API_URL`/`TOKEN`, `@repo/server-shared/rate-limit` |
| Object storage | Vercel Blob (audio only, deleted post-transcription) | `BLOB_READ_WRITE_TOKEN` |
| Auth | Clerk, multi-domain SSO across both apps | env vars only — domain/session config lives entirely in the Clerk dashboard, not in repo |
| Billing | Stripe (wallet app is sole authority) | `STRIPE_*` env vars, webhook route |
| Realtime | Pusher | `PUSHER_*` env vars |
| Observability | Sentry — **rough-cut only**. Env-gated init (`src/instrumentation.ts`, `sentry.server/edge.config.ts`, `instrumentation-client.ts`, `withSentryConfig` wrap) exists solely in rough-cut. Wallet has **no Sentry init at all** (no instrumentation files, no config wrap, no `SENTRY_DSN` in its `.env.example`), so its `reportError` calls via `@repo/server-shared` are console-only no-ops. See Reliability Gap #6. | `apps/rough-cut/src/sentry.*.config.ts`, `apps/rough-cut/next.config.ts` |
| External APIs | Deepgram (transcription), Gemini (AI cut) | API keys only |

**What the app expects but no file defines** (dashboard-only, drift risk):

- Each Vercel project's **Root Directory** setting. `apps/rough-cut/vercel.json` implies rough-cut's root = `apps/rough-cut`. The root-level `vercel.json` registering wallet's crons is confirmed intentional by `docs/adr/_root/0002-usd-wallet/0002-auto-recharge.md:68` ("registered in root `vercel.json`") — meaning **wallet's Vercel project root is the repo root**, not `apps/wallet`. The two projects use asymmetric root-directory conventions. Currently correct, but nothing in-repo states this, so the next person who adds a wallet cron will naturally reach for `apps/wallet/vercel.json` — where Vercel will silently never read it.
- Vercel **Deployment Protection** + the automation bypass secret (`VERCEL_AUTOMATION_BYPASS_SECRET`) — dashboard toggle, not versioned.
- Clerk multi-domain/satellite configuration — SSO between two apps on two domains is a dashboard-side relationship, invisible in either `proxy.ts`.
- Custom domains + DNS/TLS — entirely Vercel dashboard/registrar, nothing in repo.
- Neon backup/PITR retention window — plan-tier setting, not in repo.

## Critical Findings (Act This Week)

| # | Resource | Finding | Risk | Exact Fix |
|---|---|---|---|---|
| 1 | Both `next.config.ts` files (rough-cut, wallet) | No security headers block at all — no CSP, no `X-Frame-Options`, no `Strict-Transport-Security`. Vercel adds a few defaults but not CSP. | Clickjacking / no defense-in-depth against XSS if one is ever introduced. Low likelihood given Clerk-gated app, but zero-cost to close. | Add a `headers()` function to each `next.config.ts`:<br>`async headers() { return [{ source: "/(.*)", headers: [{ key: "X-Frame-Options", value: "DENY" }, { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] }] }` |

*(Nothing rises to "public exposure" territory — no open DB, no wildcard IAM, no committed secrets. `.env.local` is correctly gitignored in all three workspaces; only `.env.example` templates are tracked, and they contain no real values.)*

## Reliability Gaps

| # | Resource | Gap | Failure Scenario | Fix | Tier-Appropriate? |
|---|---|---|---|---|---|
| 1 | root `vercel.json` vs `apps/rough-cut/vercel.json` | Asymmetric Root Directory convention across the two Vercel projects, undocumented in repo | A future contributor adds a new wallet cron to `apps/wallet/vercel.json` (the obvious place) — Vercel never registers it, no error, cron silently never runs | Add one line to `AGENTS.md` or `apps/wallet/AGENTS.md`: "wallet's Vercel project root = repo root; crons go in the top-level `vercel.json`, not `apps/wallet/vercel.json`" | Yes — 2-minute fix, prevents a real recurrence class |
| 2 | `apps/wallet/src/app/api/cron/cleanup/route.ts` | Cron is a documented no-op (per `docs/hardening/2026-07-07-main.md:37`) but still scheduled and invoked daily | Wasted invocation only — no functional risk, but it's a stale entry in the only IaC-like file you have | Delete the `cleanup` entry from root `vercel.json` and the route, or leave a one-line comment in `vercel.json` explaining why a no-op cron is intentionally still registered | Yes — trivial cleanup |
| 3 | `vercel.json` (autorecharge) | Already flagged in the prod-readiness review: Hobby plan's once-daily cron cap turns auto-recharge into a ~23h-exposure daily batch instead of near-real-time | Carrying this over only because it's the one place infra-tier choice (Hobby vs Pro) directly drives a reliability/product contract | Documented and accepted already (ADR 0002 follow-up) — no new action, just confirming it's the same root cause as the Vercel plan tier | Accepted at this tier |
| 4 | `@repo/server-shared/rate-limit` | Ordinary abuse caps fail open on a Redis error, by explicit commented design (`rate-limit.ts:83-84`) — but **money-moving paths do not**: checkout, setup-intent, autorecharge PATCH, and the AI Cut idempotency lock all pass `failClosed: true` and refuse on a Redis error. Missing KV config in production **throws** at limiter construction (`rate-limit.ts:17-18`) rather than failing open. Every Redis failure is `reportError`ed to Sentry either way. | An Upstash outage degrades only the non-monetary abuse caps to unlimited (Sentry-visible); billing-adjacent routes start refusing (fail-closed) until Redis recovers — no double-charge exposure | Acceptable as designed for a single-demo-account preview; the fail-open half only covers abuse caps, and the Sentry paging on failure only works where Sentry is initialized (see Gap #6) | Accepted at this tier |
| 5 | Neon | Single connection string, no read replica, backup restore untested (already flagged in prod-readiness review) | Carried over for completeness — this skill's DR section calls it out from the infra side: no IaC/snapshot-as-code, so a Neon branch restore is entirely a console action today | Test a restore once (see prod-readiness review); if it becomes a repeated need, script it via Neon's API/CLI rather than console clicks | Fine for now |
| 6 | `apps/wallet` (no Sentry init) | Wallet — the sole billing authority — has no Sentry initialization: no `instrumentation.ts`, no `sentry.*.config.ts`, no `withSentryConfig` in `next.config.ts`, no `SENTRY_DSN` in `.env.example`. `Sentry.captureException` is a no-op without init, so every `reportError` in wallet (Stripe webhook failures, fail-closed rate-limit alerts whose code comment says an outage "must page someone") reaches console logs only | A Stripe webhook that starts failing (stale endpoint, bad signing secret, DB error) never surfaces in Sentry — purchases silently stop crediting with zero alerting, exactly the silent-failure class the console-verify section worries about | Copy rough-cut's env-gated Sentry pattern into wallet (instrumentation files + config wrap + `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` env vars on the Vercel project) | No — billing errors need at least one alerting channel even at preview tier |

## Cost Optimizations

No paid infra sizing to optimize — everything is either free-tier or usage-metered (Vercel Hobby, Neon likely free/launch tier, Upstash free tier, Clerk free tier, Sentry free tier). The one real cost lever is a **product** one, not infra: Vercel Hobby's cron cap already forced the auto-recharge cadence from 2 min → daily (documented, accepted). No dollar estimate is meaningful here since current spend is near-$0 — flag this section as **not applicable at current scale**, revisit once a paid Vercel plan or real traffic volume exists.

## Verify in Console (Not Visible in Repo)

- **Vercel → wallet project → Settings → General → Root Directory**: confirm it's actually the monorepo root (as the ADR implies), and confirm the wallet project's Build Command scopes to the wallet workspace (e.g. `turbo build --filter=wallet` or similar) rather than building everything.
- **Vercel → both projects → Settings → Deployment Protection**: confirm which protection mode is on and that `VERCEL_AUTOMATION_BYPASS_SECRET` matches between the Vercel project setting and the env var consumed in `apps/rough-cut/src/app/api/transcribe/deepgram/route.ts`.
- **Vercel → both projects → Settings → Domains**: confirm custom domains + TLS are attached (not still on `*.vercel.app`) if this is client-facing.
- **Clerk dashboard → Domains**: confirm the multi-domain/satellite relationship between rough-cut and wallet is configured as intended — this is invisible from `proxy.ts` in both apps.
- **Neon console → Backup/Restore**: confirm PITR window and retention days for the current plan tier (ties to the prod-readiness review's untested-restore finding).
- **Stripe dashboard → Webhooks**: confirm the registered webhook endpoint URL matches wallet's actual prod domain and `STRIPE_WEBHOOK_SECRET` matches the live signing secret (a stale endpoint from an earlier preview domain would silently stop crediting purchases).
- **Vercel → Cron Jobs tab (both projects)**: confirm all three crons (`blob-sweep`, `autorecharge`, `cleanup`) actually show as registered — the cheapest way to settle the Root Directory question above.

## Sound Decisions (Keep)

- Env-var handling is clean: `.env.local` never committed, `.env.example` templates carry no real values, secrets injected per-environment via Vercel — no config/rebuild coupling.
- `turbo.json`'s explicit `env` passthrough list (already bitten once by a missing entry, per `AGENTS.md`) is the right pattern for a Vercel monorepo build — just keep it disciplined as new secrets get added.
- Build-time guards in both `next.config.ts` files that throw if `NEXT_PUBLIC_WALLET_URL`/`NEXT_PUBLIC_ROUGH_CUT_URL` still point at `localhost` in a Vercel production build — a real, working safety net against a classic monorepo cross-app misconfiguration.
- Neon's HTTP driver (stateless, no pool) is the correct choice for a serverless/Vercel deployment — avoids the classic Postgres connection-exhaustion failure mode serverless functions hit with pooled drivers.
- Media bytes never transit the server (browser → Vercel Blob direct upload) — sidesteps Vercel's function body-size limits entirely by design, documented in `LIMITATIONS.md`.

## Action Items (Priority Order)

1. Add security headers (`X-Frame-Options`, HSTS) to both `next.config.ts` — 15 minutes, zero risk.
2. Verify wallet's Vercel Root Directory setting and document the asymmetric convention in `AGENTS.md` so a future cron addition doesn't go to the wrong file silently.
3. Remove or comment the dead `cleanup` cron entry in root `vercel.json`.
4. Verify Stripe webhook endpoint + Clerk domain config in their consoles now, while it's cheap — both are single points of silent failure for billing/auth that no test in the repo can catch.
5. Carry forward from the prod-readiness review: test a Neon restore and a Vercel rollback — both are infra-console actions this review can't verify from files alone.
6. Wire Sentry init into wallet (copy rough-cut's env-gated pattern: `instrumentation.ts`, `sentry.server/edge.config.ts`, `instrumentation-client.ts`, `withSentryConfig` wrap) and set the DSN env vars on the wallet Vercel project — without it, Stripe webhook failures and fail-closed rate-limit events in the billing app are console-only and effectively invisible.
