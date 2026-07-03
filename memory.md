# Memory — DB-retry fix + Deepgram "corrupt audio" investigation

Last updated: 2026-07-02

## What was built

All changes this session are **uncommitted** (working tree only — nothing pushed to `main`).

### A) Create-project 500 fix — DONE & verified
- **`src/db/index.ts`** — new `withDbRetry(query, {attempts=3, timeoutMs=4000, baseDelayMs=150})`
  helper + `DbTimeoutError`. Retries an **idempotent read** on transient connection
  failures only (regex over `fetch failed`/`ECONNRESET`/DNS/etc., walking the
  Neon driver's nested `cause`/`sourceError`). Each attempt has its own timeout
  (abandons a stuck fetch early instead of waiting undici's ~10s). Emits a
  `console.warn("[db] transient query failure (attempt n/3), retrying: …")`
  breadcrumb on each retry. **Writes are deliberately NOT wrapped** (a timed-out
  INSERT may have committed → duplicate rows).
- **`src/lib/projects.ts`** — wrapped `getOwnedProject` + `getOwnedProjectStatus`.
- **`src/app/api/projects/route.ts`** — wrapped the POST `users` SELECT (the exact
  query that 500'd) and both GET reads.

### B) Deepgram "corrupt audio" — DIAGNOSTIC ONLY (temporary, must be removed)
- **`src/app/api/transcribe/deepgram/route.ts`** — added a `[DIAGNOSTIC]`
  `TransformStream` byte-counter around the streamed upload to Deepgram. Logs
  `[dg-diag] status=… declaredBytes=<Content-Length> forwardedBytes=<counted>
  truncated=<bool>` right when Deepgram responds. **This is instrumentation, not
  a fix — delete it once the truncated-vs-not question is answered.**

## Decisions made

- **DB resilience = read-only retry** (user chose this scope explicitly over
  "reads + guarded writes" or "no code change"). Symptom mitigation, not a root fix.
- The two errors this session are **separate problems**: (A) create 500 is fixed;
  (B) Deepgram corrupt-audio is unrelated and still open.

## Problems solved

- **Create 500 `fetch failed` to Neon** — root cause is NOT a bad query and NOT a
  Neon outage (direct probe: 79–1093ms healthy). It's the single Node process
  getting **network/event-loop-starved mid-request** while a large file streams
  over the uplink, stalling the outbound Neon TLS handshake; the Neon HTTP driver
  does zero retries so one blip = 500. Fixed by `withDbRetry`. **Verified live**:
  log showed `[db] transient query failure (attempt 1/3) … DB query exceeded
  4000ms` followed by success (project row created, no 500).
- **Disproved my own first theory** that the transcribe route buffers the whole
  file in memory — it already **streams** (`body: request.body, duplex:"half"`,
  see the EPROTO comment). So the pressure is uplink bandwidth, not RAM.
- **Dev JSON log ≠ request log**: `.next/dev/logs/next-development.log` captures
  console + compile events only; per-request `POST … in Nms` timing lines go to
  the **terminal stdout** (not that file). Don't infer "route never hit" from it —
  use DB `transcript_status` as the source of truth.

## Current state

- `tsc` clean, **55/55 vitest pass**. Create flow works (retry confirmed absorbing
  a real stall).
- **Deepgram transcription is BROKEN for the test file**: `0615.mp4`, **23:32**
  duration, user confirms codec is the same as previously-working files (`0502.mov`
  transcribed fine). Fails with Deepgram 400 **"failed to process audio: corrupt
  or unsupported data"** → project card shows **Failed**. File is valid on disk
  (app read its duration client-side), so the leading hypothesis is **truncation
  in transit** of the streamed upload (only long/large files fail).
- Config: `NEXT_PUBLIC_TRANSCRIBE_PROVIDER=deepgram`, **no `PUBLIC_APP_URL`** →
  deepgram route runs in **SYNC mode** on localhost (reads transcript from the
  response; no callback). Dev server already running on **:3000** (PID 11588,
  `next dev --webpack`, Next 16.2.9). A 2nd `npm run dev` will just grab :3001 and
  exit — reuse :3000.

## Next session starts with

1. **Read the `[dg-diag]` line** from `.next/dev/logs/next-development.log` (or ask
   user to retry importing `0615.mp4` to regenerate it). Decision fork:
   - `truncated=true` (forwardedBytes < declaredBytes) → upload cut off in transit;
     fix is our side (investigate why the browser→server stream ends early under a
     saturated uplink; consider buffering-with-Content-Length or chunked handling).
   - `truncated=false` → full file reached Deepgram and it still rejected →
     Deepgram-side decode issue (send a real `Content-Length` instead of chunked,
     or route large/long files through callback mode instead of sync).
2. **Remove the `[DIAGNOSTIC]` byte-counter** from the deepgram route once answered.
3. **Commit** the `withDbRetry` fix (A) — it's verified and worth landing
   independently of the Deepgram investigation.

## Open questions

- **Truncation vs Deepgram decode** — unresolved; the `[dg-diag]` log answers it.
- Does Deepgram's **sync (non-callback) endpoint** have a lower size/duration
  ceiling than callback mode? A 23-min file in sync mode may be the trigger.
- The `withDbRetry` mitigation can't cure **sustained** uplink contention (all 3
  retries fail if saturation lasts the whole upload). True fix is the upload
  **topology** — e.g. browser→R2 then hand Deepgram a URL (Deepgram fetches it,
  no proxy, no contention). This is the R2 decision still parked with the client
  (see `project_r2_storage_decision.md`) — do NOT act on it without sign-off.
- Prior session's items still open: Phase-4 manual verification (export/downscale/
  4K-HEVC-VP9), prod Neon migration if deploying, optional Dockerfile.
