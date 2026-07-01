# Memory — Phase 5: In-Browser MP4 Export (WebCodecs)

Last updated: 2026-07-01

## What was built

Phase 5 of the rough-cut editor — client-side MP4 export that renders the
EDL's "keep" segments to a downloadable file, entirely in the browser
(Chrome/Edge, WebCodecs). New files:

- **`src/lib/export/plan.ts`** (+ `plan.test.ts`, 12 tests) — pure logic:
  `getKeepRanges`, `totalKeptSeconds`, and `createTimeRemapper` (maps a
  source-timeline timestamp to its position in the rendered output, where
  kept ranges are concatenated gap-free; returns null for cut/out-of-range
  timestamps so the caller drops that sample).
- **`src/lib/export/types.ts`** — worker message protocol
  (`start`/`cancel` → worker; `progress`/`done`/`error` ← worker) and
  `ExportErrorCode`. The `start` message carries the source `File`, the
  `EDL`, and a `FileSystemFileHandle` (structured-cloneable — the writable
  stream it produces is NOT, so the handle crosses into the worker and the
  worker creates its own writable).
- **`src/lib/export/export-trigger.ts`** — main-thread orchestration:
  `isExportSupported()` (checks VideoEncoder/Decoder + showSaveFilePicker)
  and `startExport()` (opens the native save dialog inside the click's
  user-activation, spins up the worker, relays progress/done/error).
- **`src/lib/export/file-system-access.d.ts`** — ambient `showSaveFilePicker`
  types (missing from lib.dom.d.ts).
- **`src/workers/export-worker.ts`** — runs Mediabunny's `Conversion`
  off-main-thread; `video.process`/`audio.process` remap each sample's
  timestamp (or return null to drop it) per the EDL.
- **`src/app/(app)/dashboard/[id]/page.tsx`** — Export button in `TopBar`
  now live (was hardcoded `disabled`); added `exportState`, `handleExport`
  (sonner progress toast with id "export"), and a `beforeunload` guard while
  exporting.

## Decisions made

- **Switched from the planned `mp4box` + `mp4-muxer` to `mediabunny`**
  (v1.50.0). `mp4-muxer` installed as *deprecated* in favour of Mediabunny —
  the same author's actively-maintained successor that does demux + mux +
  WebCodecs glue + a high-level `Conversion` (trim/transcode) API in one
  zero-dependency, fully-typed package. It's literally sponsored by Gling.ai
  (the competitor this app is modelled on). User approved the swap
  mid-implementation. `mp4box`/`mp4-muxer` were uninstalled.
- **Output streams to disk via File System Access API** (showSaveFilePicker
  + FileSystemWritableFileStream), not a buffered Blob — keeps memory flat
  for long exports (same OOM-class risk as the prior Deepgram upload fix).
- **Worker owns the write lifecycle.** The `FileSystemWritableFileStream`
  writes to a temp swap file and only commits on `close()`; on error the
  worker `abort()`s to discard the temp and leave any original untouched.
- **MVP scope only** — one video + one audio track, Mediabunny's default
  encode settings (no bitrate/resolution UI), simple % progress,
  beforeunload guard. No libav fallback: unsupported source codecs fail with
  a clear message (Conversion `isValid`/`discardedTracks`).

## Problems solved

Two bugs surfaced on the first real export (file wrote fine but UI said
"failed", plus a React crash):

- **Double-close → false "Export failed".** Mediabunny's `StreamTarget`
  already closes whatever WritableStream it's given when the conversion
  finalizes. The worker then called `writable.close()` a second time on the
  already-closed stream → throw → "failed" toast, even though the muxer had
  already written a complete, playable MP4. **Fix:** hand `StreamTarget` a
  thin forwarding `WritableStream` wrapper (only implements `write`, piping
  chunks — shape `{type:'write',data,position}` — to `fileWritable.write()`).
  The real file stream stays unlocked and under the worker message-handler's
  sole control: `close()` (commit) on success, `abort()` (discard) on error.
- **"Maximum update depth exceeded" React crash.** Mediabunny's `onProgress`
  fires per output packet (hundreds+ of times); each call hit
  `toast.loading(...,{id:"export"})`, flooding sonner's store until React's
  update-depth guard tripped. **Fix:** the worker throttles progress messages
  to at most once per whole percent (`Math.floor(progress*100)` change).

## Current state

- Export is implemented and passes all static checks: `tsc --noEmit`,
  eslint, 40/40 vitest, and a full `next build` (Turbopack) that bundles the
  worker without error.
- **Confirmed working end-to-end pre-fix already produced a complete,
  playable MP4** (user played the 71MB output — perfect). The only issue was
  the false "failed" toast from the double-close, now fixed.
- Both fixes are in the working tree but **NOT yet re-verified after a clean
  dev-server restart** — worker code and next.config.ts do NOT reliably
  hot-reload (same gotcha as the Deepgram session). The dev server on
  :3000 was killed at end of session for the user to restart.
- All Phase-5 changes are uncommitted (git status: new src/lib/export/*,
  src/workers/export-worker.ts, modified dashboard/[id]/page.tsx,
  package.json/lock).

## Next session starts with

1. Restart `npm run dev`, hard-refresh the editor tab (Ctrl+Shift+R) so the
   new worker bundle loads, and re-run an export. Expect: smooth progress,
   green "Export complete" toast, no "Maximum update depth" error, playable
   MP4 with cuts landing correctly.
2. Spot-check a cut boundary or two for A/V sync in the output.
3. If good, commit the Phase-5 work and open a PR (check `gh auth status`
   first — gh was not authenticated in earlier sessions).
4. Then Phase 6 polish: cancel button wired to `ExportHandle.cancel`,
   HEVC/MOV (iPhone) + VP9/WebM source testing, browser-support gating UI.

## Open questions

- Does export hold up on non-H.264 sources (HEVC/MOV from iPhone, VP9/WebM
  screen recordings)? Only tested on the one 71MB file so far.
- Export decodes the *whole* source even for heavily-cut timelines (only
  encode is skipped for cut spans) — acceptable for MVP, but may be slow on
  long footage. Lower-level keyframe-seek skipping is the follow-up if so.
- Still deferred from prior sessions: filler-word detection,
  semantic/rambling trim, preset tuning against real footage; and the
  R2/object-storage scalability decision pending the client conversation
  (see project_r2_storage_decision.md in cross-session memory).
