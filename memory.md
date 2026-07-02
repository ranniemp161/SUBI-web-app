# Memory — Production-Hardening Pass (Phases 0–4)

Last updated: 2026-07-02

## What was built

A multi-phase production-readiness pass. All work is **committed to `main`**
(6 commits, listed below). Started from an architecture review that flagged
improvement areas; the client is handling the R2/object-storage + deploy-target
decision separately (see Open questions), so that was excluded.

**Commits (newest last):**
- `4eaf0b4` — Phase 6 export controls: cancel wiring + up-front browser-support
  gating (this was uncommitted from the prior session; committed as the
  baseline). Added `starting`/`cancelling` export states so Cancel only shows
  once a real handle exists; `useSyncExternalStore` gates the Export button
  without a hydration mismatch. Files: `dashboard/[id]/page.tsx`.
- `39200e4` — Phase 1 API hardening: **zod input validation** (`src/lib/validation.ts`)
  on POST/PATCH `/api/projects` bodies (EDL/transcript/create, strictObject,
  size caps); **trimmed `GET /api/projects`** to metadata-only columns; new
  lightweight **`GET /api/projects/[id]/status`** (`getOwnedProjectStatus` in
  `lib/projects.ts`) with the dashboard 4s poll repointed to it.
- `48567e3` — Phase 2: **Postgres fixed-window rate limiter** (`src/lib/rate-limit.ts`,
  `rate_limits` table) — one atomic upsert; applied to create (60/hr) and
  transcribe (30/hr, shared Deepgram+whisper); **`transcript_status` text→enum**
  (Drizzle `pgEnum`). Migration SQL at `drizzle/manual/0001_*.sql`. Added
  `db:generate`/`db:push` scripts.
- `88276e4` — Phase 3 #6: **env-gated Sentry** (`@sentry/nextjs`). `sentry.server/
  edge.config.ts`, `instrumentation.ts`, `instrumentation-client.ts`,
  `lib/observability.ts` `reportError()`. API route catch blocks now call
  `reportError` (they swallow errors + return 5xx, so Next's `onRequestError`
  never sees them). `next.config.ts` wraps with `withSentryConfig` only when
  `SENTRY_DSN` set (dynamic import).
- `3b30680` — Phase 3 #7: **route tests** + `vitest.config.ts` (`@/` alias).
  Callback token auth matrix, project ownership (401/404, GET+DELETE), deepgram
  guard ordering (401→403→429). 55 tests total pass.
- `eaf4087` — Phase 4 docs: **`LIMITATIONS.md`**.

## Decisions made

- **Rate-limit backend = Postgres** (not Redis/in-memory): no new infra, correct
  under concurrency (single atomic upsert), instance-count agnostic — safe
  before the deploy-topology decision is made.
- **Error tracking = Sentry, fully env-gated**: a complete no-op until
  `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` are set. Chosen over structured-logging-
  only.
- **API catch blocks route through `reportError`** because handlers return 5xx
  without rethrowing, so `onRequestError` can't capture them.
- **DB enum conversion applied via a reviewed manual SQL** (in-place `USING`
  cast), NOT `db:push`, since push may drop/recreate the column and lose data.

## Problems solved

- **Turbopack "whole project traced" build warning** — investigated by stashing
  Phase-3 and building at `48567e3`: it is **pre-existing**, from the whisper
  route's `join(process.cwd(), "scripts", …)` dynamic path — NOT caused by the
  Sentry work. Documented in LIMITATIONS.md; non-fatal on a Node host.
- **setState-in-effect lint** on the export-support probe (prior session's
  carryover) — solved with `useSyncExternalStore` (null server snapshot).

## Current state

- `tsc` clean, eslint clean, **`next build` passes** (only the pre-existing
  whisper trace warning), **55/55 vitest tests pass**.
- **DB migration is APPLIED** to the Neon branch referenced by `.env.local`
  (dev). Ran via a temp Node script (Neon WebSocket Pool, atomic txn, since
  `psql` isn't installed) — `transcript_status` is now the enum, `rate_limits`
  table exists. Temp runner deleted; tree clean.
- Rate-limiting endpoints now work (table exists). Sentry dormant (no DSN set).

## Next session starts with

1. **Phase 4 manual verification (with the user, needs real files + dev server):**
   re-verify MP4 export (smooth progress → green "Export complete" → playable
   MP4 → correct cuts → A/V sync spot-check), the new Cancel button +
   browser-support gating, and HEVC/MOV + VP9/WebM source testing. Run
   `npm run dev` (Next 16, `--webpack`) on :3000.
2. If deploying: **apply `drizzle/manual/0001_*.sql` to the PRODUCTION Neon
   branch** — the migration so far only hit the dev branch in `.env.local`.

## Open questions

- **R2/object-storage + deploy-target decision** — user is raising the storage
  cost/scalability tradeoff (browser+server-memory proxy, ~8GB body, single
  long-running Node process, not serverless-friendly) with their client. Do NOT
  re-add R2 or change the deploy assumption without that sign-off. See
  cross-session memory `project_r2_storage_decision.md`.
- **HEVC/VP9 export** still unverified (only one H.264 file tested).
- **Sentry** not yet enabled (needs the user's account + DSN env vars; see
  LIMITATIONS.md).
- Deferred long-term (unchanged): filler-word detection, semantic/rambling trim,
  preset tuning on real footage; export keyframe-seek skipping if slow.
