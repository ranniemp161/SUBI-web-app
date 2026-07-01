# Memory — Deepgram Local (Sync Mode) + Phase-5 Export Fixes

Last updated: 2026-07-02

## What was built

Two threads this session, both uncommitted.

### Deepgram transcription now works on localhost with NO tunnel

Root cause found: the deepgram route built the callback URL from the request
origin (`localhost:3000`), and Deepgram rejects a localhost callback as
`"Invalid callback URL."` (err surfaced only in server logs). The user had only
ever used local faster-whisper before, so this was first exposure, not a
regression.

- **`src/lib/deepgram.ts`** (NEW) — extracted shared `normalizeDeepgram`,
  `extractDeepgramError`, and the Deepgram response types out of the callback
  route so both the sync and callback paths produce the identical editor-ready
  transcript shape.
- **`src/app/api/transcribe/callback/route.ts`** — now imports from
  `@/lib/deepgram` (removed its local copies).
- **`src/app/api/transcribe/deepgram/route.ts`** — reworked to two auto-selected
  modes:
  - **Synchronous (localhost):** omit the `callback` param; read the transcript
    straight from Deepgram's HTTP response, normalize, store it (status→ready),
    then return. No tunnel needed. Chosen when the resolved callback host is
    localhost/127.0.0.1/::1/*.local (`isLocalHostname`).
  - **Callback (public host):** unchanged scalable flow — token + `callback`
    param, Deepgram POSTs to /api/transcribe/callback which flips status→ready.
  - Added `PUBLIC_APP_URL` env override for the callback base (use a tunnel's
    https origin to force/test the callback path locally). Trailing slashes
    trimmed.
  - The 502 error body now includes `detail: extractDeepgramError(...)`, so the
    client toast shows Deepgram's real reason (client `readErrorReason` reads
    `detail` first) instead of the generic "Deepgram rejected the request."

### Phase-5 export: cancel-path correctness fixes (from a /review earlier)

- **`src/workers/export-worker.ts`** — `cancelRequested` flag closes a
  cancel-before-init race: set on any cancel, reset each start, checked right
  before `execute()` (no await between check and execute), throwing
  `ExportError("cancelled", …)` if a cancel landed during `Conversion.init`.
- **`src/app/(app)/dashboard/[id]/page.tsx`** — `handleExport`'s `onError` now
  takes `(message, code)` and, on `code === "cancelled"`, calls
  `toast.dismiss("export")` instead of a red "Export failed" toast.

## Decisions made

- **Deepgram sync-on-localhost is automatic, not a manual flag** — keeps local
  dev zero-config (works like whisper did) while production (public origin)
  keeps the scalable callback flow untouched. `PUBLIC_APP_URL` is the escape
  hatch to force callback mode locally via a tunnel.
- **Export finding #3 (boundary fuzz) intentionally NOT fixed** — inherent to
  whole-sample cutting, bounded per-cut, no drift. Verify by ear, only invest
  (frame-accurate re-slicing) if a real cut edge sounds/looks wrong.
- Export cancel fixes #1/#2 are preventive/latent — no UI triggers cancel until
  the Phase-6 button is wired to `exportHandleRef.current.cancel()`.

## Problems solved

- **"Invalid callback URL" on Deepgram** — solved via sync mode (above).
- **Cancel would have shown "Export failed"** and **cancel-during-init was a
  no-op** — both fixed (above).
- (Already committed in 44a68e2 from prior sessions: export double-close +
  progress-throttle.)

## Current state

- Deepgram sync mode **confirmed working end-to-end** on localhost:
  `POST /api/transcribe/deepgram ... 200 in 94s` — held the connection ~84s of
  app code while Deepgram transcribed, stored transcript, status→ready. Project
  `bbdc4763-8f9b-417a-9d5d-12470e831037` transcribed successfully.
- All this session's changes pass `tsc --noEmit` + eslint clean. Export tests
  still 12/12 (not re-run this session but untouched).
- Everything this session is **UNCOMMITTED**: src/lib/deepgram.ts (new),
  callback/route.ts, deepgram/route.ts, export-worker.ts, dashboard/[id]/page.tsx.
- Phase-5 export feature code itself is already committed (44a68e2); the
  cancel-path fixes on top are not.
- Export was still **never re-verified in-browser after a clean restart** (the
  restore-step re-test kept getting superseded — first by /review, then by the
  Deepgram bug).
- Dev server running on :3000 (Next.js 16.2.9, webpack) — bg task bhpijcfh2.
- `gh` NOT authenticated (`gh auth login` needed before any PR).

## Next session starts with

1. Commit this session's work. Sensible split: (a) Deepgram sync mode
   (lib/deepgram.ts + both routes), (b) export cancel-path fixes (worker +
   dashboard). Or one commit — user's call.
2. Still-owed: re-verify the MP4 export in-browser after a clean restart
   (smooth progress → green "Export complete", playable MP4, correct cuts,
   spot-check a cut boundary for A/V sync — also covers un-fixed finding #3).
3. Phase 6: wire the cancel button to `exportHandleRef.current.cancel()` (path
   is ready), HEVC/MOV + VP9/WebM source testing, browser-support gating UI.

## Open questions

- **Deepgram sync-mode timeout on long files.** The 94s hold worked, but a much
  longer video could hit the proxy/Next timeout in sync mode. Tunnel + callback
  (PUBLIC_APP_URL) is the fallback if that happens. Untested past the one file.
- iPhone/non-H.264 export sources (HEVC/MOV, VP9/WebM) — user deferred. Only one
  71MB H.264 file tested.
- Export decodes the whole source even for heavily-cut timelines (encode skipped
  for cuts) — fine for MVP; keyframe-seek skipping is the follow-up if slow.
- Deferred long-term: filler-word detection, semantic/rambling trim, preset
  tuning on real footage; and the R2/object-storage scalability decision pending
  the client conversation (see project_r2_storage_decision.md in cross-session
  memory).
