# Memory — Production-Hardening + 4K-Readiness

Last updated: 2026-07-02

## What was built

Two bodies of work this session, all **committed to `main`** (8 commits total).

### A) Production-hardening pass (Phases 0–4 docs)
- `4eaf0b4` — Phase 6 export controls: cancel wiring + up-front browser-support
  gating. `starting`/`cancelling` states so Cancel only shows once a real handle
  exists; `useSyncExternalStore` gates the Export button (no hydration mismatch).
  File: `dashboard/[id]/page.tsx`.
- `39200e4` — Phase 1: **zod validation** (`src/lib/validation.ts`) on POST/PATCH
  `/api/projects`; **trimmed `GET /api/projects`** to metadata columns; new
  **`GET /api/projects/[id]/status`** (`getOwnedProjectStatus`) with the
  dashboard poll repointed to it.
- `48567e3` — Phase 2: **Postgres rate limiter** (`src/lib/rate-limit.ts`,
  `rate_limits` table, atomic upsert) — create 60/hr, transcribe 30/hr (shared
  Deepgram+whisper); **`transcript_status` text→enum** (`pgEnum`). Migration:
  `drizzle/manual/0001_*.sql`. Added `db:generate`/`db:push` scripts.
- `88276e4` — Phase 3 #6: **env-gated Sentry** (`@sentry/nextjs`).
  `sentry.server/edge.config.ts`, `instrumentation.ts`,
  `instrumentation-client.ts`, `lib/observability.ts` `reportError()` (API
  catches route through it since they return 5xx without rethrowing).
  `next.config.ts` wraps with `withSentryConfig` only when `SENTRY_DSN` set,
  via dynamic import.
- `3b30680` — Phase 3 #7: **route tests** + `vitest.config.ts` (`@/` alias).
  Callback token auth, ownership (401/404), deepgram guard order (401→403→429).
- `eaf4087` — **`LIMITATIONS.md`**.

### B) 4K-readiness (answering "can it handle 4K?")
- `5181a1d` — three improvements:
  1. **Export encode pre-flight** — `export-worker.ts` reads the source video
     track and runs `canEncodeVideo('avc', {width,height})` at the output size
     before conversion; throws `"unsupported-resolution"` (new error code) with
     an actionable message instead of failing inside `execute()`.
  2. **Downscale on export** — Source/1080p/720p `<select>` in the editor top
     bar, threaded `startExport` → worker as `maxHeight`; mediabunny caps output
     height (aspect preserved, never upscales). New "Resolution too high" toast.
  3. **Deepgram large-file guard** — `DEEPGRAM_MAX_UPLOAD_BYTES` (~2 GB) in
     `src/lib/deepgram.ts`; rejected client-side (picker, before project/upload)
     and server-side (413 before proxying). Whisper path exempt.

## Decisions made

- **Rate-limit backend = Postgres**, **error tracking = Sentry (env-gated)** —
  both chosen deliberately (see prior rationale; safe before deploy topology is
  known).
- **4K / export is device-bound by design.** Export is 100% client-side
  (WebCodecs in a worker), so the architecture is resolution-**agnostic** (no
  cap, passes source through) but the real ceiling is the user's device. The
  guarantee is "no artificial ceiling + graceful degradation (pre-flight +
  downscale fallback)", NOT "every device can do 4K". Making 4K
  device-independent would require server-side/GPU encoding — a different
  architecture, not to be bolted on.
- **Docker is NOT required.** Prod server is pure Node (Neon/Clerk/Deepgram are
  external HTTP; export is client-side). The only system dep is the whisper
  path's Python — and whisper is the local-dev stand-in; **prod uses Deepgram**.
  Docker only becomes attractive for a container host (Fly), reproducibility, or
  running whisper in prod. Decision deferred to the deploy-target choice.

## Problems solved

- **Turbopack "whole project traced" build warning** — proven **pre-existing**
  (present at `48567e3` before Sentry) by stashing + building; caused by the
  whisper route's `join(process.cwd(), …)` dynamic path, NOT Sentry. Documented
  in LIMITATIONS.md; harmless on a Node host.
- **`psql` not installed** — applied the Phase-2 DB migration via a temp Node
  script using Neon's WebSocket Pool (atomic txn); script deleted after.

## Current state

- `tsc` clean, eslint clean, **`next build` passes** (only the pre-existing
  whisper trace warning), **55/55 vitest tests pass**.
- **DB migration APPLIED** to the Neon branch in `.env.local` (dev): enum +
  `rate_limits` live. Rate-limit endpoints work. Sentry dormant (no DSN).
- Working tree clean; everything committed.

## Next session starts with

1. **Phase 4 manual verification (with user; needs dev server + real files):**
   `npm run dev` (Next 16, `--webpack`, :3000). Re-verify MP4 export (progress →
   green complete → playable MP4 → correct cuts → A/V spot-check), the Cancel
   button + support gating, the **new Source/1080p/720p downscale**, and **4K +
   HEVC/MOV + VP9/WebM** sources.
2. If deploying: **apply `drizzle/manual/0001_*.sql` to the PRODUCTION Neon
   branch** (only the dev branch has it so far).
3. Optional, offered but not started: a **Dockerfile + `output: "standalone"`**
   (Deepgram-only, no Python) — only if the deploy target wants a container.

## Open questions

- **R2/object-storage + deploy-target decision** — user is raising the storage
  cost/scalability tradeoff (browser+server-memory proxy, ~8GB body, single
  long-running Node process, not serverless-friendly) with their client. Do NOT
  re-add R2 or change the deploy assumption without sign-off. Docker + prod DB
  migration both hinge on this. See `project_r2_storage_decision.md`.
- **Deepgram's exact upload limit** — `DEEPGRAM_MAX_UPLOAD_BYTES` set to ~2 GB
  from best knowledge; confirm against the current Deepgram plan/docs.
- **4K/HEVC/VP9 export unverified end to end** (only one ~71MB H.264 file tested).
- **Sentry** not enabled (needs user's account + DSN env vars; see LIMITATIONS.md).
- Deferred long-term (unchanged): filler-word detection, semantic/rambling trim,
  preset tuning on real footage; export keyframe-seek skipping if slow.
