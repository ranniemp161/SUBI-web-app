# Rough Cut Scope

## Transcript and Timeline Live Sync
`in-progress`

**Intent**: Make the transcript panel and the timeline bar behave as tightly synced, equal peers (Descript style), sharing hover and selection state and staying frame accurate, instead of two loosely connected views.
**Done when**: Hover and selection sync both ways between the two panels, the two known timing drift bugs are fixed, and their visual language is unified, with no regression to existing playback seek or instant edit propagation.

- [x] Design it (spec) [0002](../../specs/rough-cut/0002-transcript-timeline-live-sync/index.md)
- [x] Build it: /develop Transcript and Timeline Live Sync — code in `apps/rough-cut/src/app/(app)/dashboard/[id]/page.tsx`, `apps/rough-cut/src/components/transcript-panel.tsx`, `apps/rough-cut/src/components/timeline-bar.tsx`, `apps/rough-cut/src/lib/edl.ts`, `apps/rough-cut/src/lib/sync-colors.ts`
  - [x] Shared sync state foundation: lift hover and selection state into the studio page alongside `currentTime` (AC-3, AC-4, AC-8)
  - [x] Hover preview, both directions: transcript hover previews on the timeline and timeline hover previews in the transcript, without disrupting playback (AC-5, AC-6, AC-7)
  - [x] Bidirectional selection highlighting: transcript drag select and timeline clip select or trim each highlight the other, and selection clears when playback starts (AC-3, AC-4, AC-8)
  - [x] Timing drift fix: reconcile word boundary clipping against cut padding, standardize cut and restore time rounding (AC-9)
  - [x] Visual unification and regression pass: shared color tokens across both panels, confirm instant edit propagation and autosave timing are unchanged (AC-10, AC-11)
- [ ] Verify it: /check verify Transcript and Timeline Live Sync (blocked 2026-07-21 — no browser-automation tool available in session; command-based checks passed, UI/manual steps in verify.md still need a live pass)
- [x] Test it: /test Transcript and Timeline Live Sync

## Frame Accuracy and Timeline Synchrony
`in-progress`

**Intent**: Close the remaining frame accuracy gaps left after specs 0002 and 0003: one shared millisecond to frame conversion function used by both the live editing path and export, a guard against export silently using a guessed frame rate, a shared timebase for the filmstrip and waveform, and provably accurate frame by frame step controls.
**Done when**: The live editing path and export compute frame numbers through the same shared function; export is disabled (with a clear message) whenever the real source frame rate is not yet known; the filmstrip and waveform position themselves from the same detected frame rate and duration as the playhead; and step forward/back one frame controls exist, confirmed by `requestVideoFrameCallback` where supported, with no regression to existing continuous playback or EDL cut skipping.

- [x] Design it (spec) [0004](../../specs/rough-cut/0004-frame-accuracy-timeline-synchrony/index.md)
- [x] Build it: /develop Frame Accuracy and Timeline Synchrony — code in `apps/rough-cut/src/lib/frame-math.ts` (new), `apps/rough-cut/src/lib/export/timebase.ts`, `apps/rough-cut/src/components/export-modal.tsx`, `apps/rough-cut/src/components/timeline-bar.tsx`, `apps/rough-cut/src/components/video-player.tsx`, `apps/rough-cut/src/components/editor/shortcuts-overlay.tsx`, `apps/rough-cut/src/app/(app)/dashboard/[id]/page.tsx`
  - [x] Shared frame math module: extract and generalize the existing export frame rounding into `frame-math.ts`, used by both the live and export paths (AC-1 to AC-4)
  - [x] Export fps reselect guard: disable export with a clear message until the real source frame rate is known (AC-5 to AC-7)
  - [x] Filmstrip and waveform shared timebase: position both from the shared timeline duration in `timeline-bar.tsx`, sized to the detected fps (AC-8 to AC-10)
  - [x] Frame accurate step controls: step forward/back one frame, repurposing `,`/`.`, confirmed by `requestVideoFrameCallback` where supported, with a regression pass on continuous playback (AC-11 to AC-16)
- [ ] Verify it: /check verify Frame Accuracy and Timeline Synchrony (blocked 2026-07-24 — no browser-automation tool or sample video in session; all five command checks passed, the real-browser UI/manual steps in verify.md still need a live pass)
- [x] Test it: /test Frame Accuracy and Timeline Synchrony — `frame-math.test.ts`, `video-player.test.tsx`, `export-modal.test.tsx`, `timeline-bar.test.tsx`, `shortcuts-overlay.test.tsx` cover the feature's whole area, all passing

## Word Boundary Timestamp Refinement
`done`

**Intent**: Tighten each transcript word's start/end timestamp against the real decoded audio, client side, so manual cuts and the auto rough cut land exactly on the spoken word instead of trusting Deepgram's ASR estimate as-is.
**Done when**: Every project (new or returning) gets a one time, background, non blocking refinement pass on reselect; refined timestamps persist and are used by every cut path; a word that can't be confidently refined keeps its original timestamp untouched; no new vendor ever receives the audio.

- [x] Design it (spec) [0003](../../specs/rough-cut/0003-word-boundary-timestamp-refinement/index.md)
- [x] Build it: /develop Word Boundary Timestamp Refinement — code in `packages/db/src/schema.ts`, `apps/rough-cut/src/lib/word-alignment.ts`, `apps/rough-cut/src/lib/edl.ts`, `apps/rough-cut/src/lib/validation.ts`, `apps/rough-cut/src/app/api/projects/[id]/route.ts`, `apps/rough-cut/src/app/(app)/dashboard/[id]/page.tsx`
  - [x] Data model & persistence foundation: `wordsAligned` migration, `TranscriptWord.aligned` field, PATCH schema/route wiring (AC-4)
  - [x] Core refinement algorithm: one pass energy envelope extraction plus per word local search, pure and unit tested (AC-1, AC-2)
  - [x] End to end trigger slice: reselect fires the pass, main thread yielding, the mid pass edit guard, live state update, and persistence (AC-3, AC-6, AC-8)
  - [x] Edge case hardening: decode failure and interrupted pass fall back safely; existing manual cut paths transparently use refined timestamps (AC-2, AC-5, AC-7)
  - [x] Regression pass: existing waveform/filmstrip decode, auto cut chain, and manual cut/restore flows unaffected, including the mid pass edit guard (AC-8)
- [x] Verify it: /check verify Word Boundary Timestamp Refinement (command based checks passed 2026-07-21; the live UI/manual checks that were blocked — no browser tool in session — were confirmed manually by the engineer in the real app the same day)
- [ ] Test it: /test Word Boundary Timestamp Refinement
