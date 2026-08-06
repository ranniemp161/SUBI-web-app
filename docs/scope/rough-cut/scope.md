# Scope: Rough Cut

Browser based video transcription and AI assisted rough cutting. A user uploads a
video, its audio is transcribed, the transcript drives an editable timeline, and
export runs client side in the browser.

**Build approach:** Tracer Bullet (vertical slices; each feature built end to end
through every layer, working).
**Workflow:** Beta (after `/develop`, run `/check verify`, then `/test`). The
project's default rigor tier; a feature's own tier tag (e.g. `· GA`) overrides it.

_You are in charge. Every box below is a suggestion, not a gate: run any, skip
any, and mark a feature `done` when you decide it is._

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| A | Landing page and marketing | Existing | existing |
| B | Authentication and access control | Existing | existing |
| C | Project management dashboard | Existing | existing |
| D | Video transcription pipeline | Existing | existing |
| E | Text based video editor | Existing | existing |
| F | AI assisted cutting | Existing | existing |
| G | Client side browser export | Existing | existing |
| H | Credit and token metering | Existing | existing |
| I | IP based rate limiting | Existing | existing |
| J | Cron cleanup and housekeeping | Existing | existing |
| K | Timeline Select and Hand tools | Existing | existing |
| L | Production hardening and observability | Existing | existing |
| 1 | Studio auto cut flow | Slice 6 | in-progress |
| 2 | Transcript and Timeline Live Sync | Slice 8 | in-progress |
| 3 | Word Boundary Timestamp Refinement | Slice 8 | done |
| 4 | Frame Accuracy and Timeline Synchrony | Slice 9 | in-progress |
| 5 | Timed transcript and subtitle export | Slice 10 | in-progress |

## Existing

Shipped before this scope existed, or off plan. Confirmed from the code and
`apps/rough-cut/AGENTS.md`, not from a plan, so they carry no task list.
`/develop` and `/sync` leave `existing` rows alone.

### A. Landing page and marketing · existing
Public, SEO friendly marketing page (hero, feature grid, FAQ), redirects signed in
users straight to the dashboard.
code in `src/app/page.tsx`

### B. Authentication and access control · existing
Clerk SSO (multi domain with the Wallet app), the Clerk user sync webhook, and the
`proxy.ts` auth gate. The old access code gate is gone: the `users` row itself is
the authorization now (migration `0012_retire_access_codes.sql`).
code in `src/proxy.ts`, `src/app/(auth)/`, `src/app/api/webhooks/clerk/route.ts`, `src/lib/authz.ts`

### C. Project management dashboard · existing
Home page listing a user's video projects: drag and drop upload, live progress
(extract, upload, transcribe), retry failed jobs, delete with confirmation.
code in `src/app/(app)/dashboard/page.tsx`, `src/components/file-picker.tsx`

### D. Video transcription pipeline · existing
The browser extracts the audio track client side, uploads it straight to Vercel
Blob (bypassing the server function size limit), starts transcription, and deletes
the blob once done. Status reaches the client over Pusher, not polling.
code in `src/app/api/transcribe/deepgram/route.ts`, `src/app/api/transcribe/callback/route.ts`, `src/lib/deepgram.ts`, `src/lib/pusher.ts`

### E. Text based video editor · existing
Studio UI: transcript panel with click to seek, keep and cut timeline, video
player, manual and AI cut suggestions, undo and redo.
code in `src/app/(app)/dashboard/[id]/page.tsx`, `src/components/transcript-panel.tsx`, `src/components/timeline-bar.tsx`, `src/lib/edl.ts`

### F. AI assisted cutting · existing
An AI Cut run against the transcript suggests cuts for silence, retakes, and
filler words. Runs on the Edge runtime and streams NDJSON phase lines so Vercel's
proxy cannot kill the connection mid run.
code in `src/app/api/projects/[id]/ai-cut/route.ts`, `src/lib/ai-rough-cut.ts`, `src/lib/ai-cuts.ts`

### G. Client side browser export · existing
WebCodecs MP4 export (Chromium and Edge only) plus the NLE interchange formats
(FCPXML, CMX 3600 EDL, FCP7 XML), all generated in the tab.
code in `src/lib/export/`, `src/workers/export-worker.ts`, `src/components/export-modal.tsx`

### H. Credit and token metering · existing
Per minute USD micros billing: transcription reserved on upload and settled on the
real callback duration, AI Cut charged per run, hold and settle and refund with a
non negative CHECK guarding concurrent spends.
code in `src/lib/credits.ts`, `src/app/api/credits/route.ts`

### I. IP based rate limiting · existing
Per IP fixed window limits on the routes with no session to key on, backed by
Upstash and Vercel KV, fail closed on the money moving paths.
code in `src/lib/rate-limit.ts`, `src/lib/ip-rate-limit.ts`

### J. Cron cleanup and housekeeping · existing
Daily blob sweep for orphaned audio uploads, plus best effort cleanup when a
transcription kickoff fails.
code in `src/app/api/cron/blob-sweep/route.ts`, `src/app/api/transcribe/blob-cleanup/route.ts`

### K. Timeline Select and Hand tools · existing
Shipped off plan (drift, no spec) in PR #91 on 2026-07-26: a Select tool (`A`) and
a Hand tool (`H`) for the timeline, with styled tooltips on the controls.
**Done when:** the two tools are selectable by button and by keyboard shortcut, and
each changes what a drag on the timeline does.
code in `src/components/timeline-bar.tsx`, `src/components/editor/`, `packages/ui/src/tooltip.tsx`

### L. Production hardening and observability · existing
Shipped as a wave of infrastructure work rather than a planned feature: Sentry on
client, server, and edge with source maps, Vercel Speed Insights for real user Web
Vitals, fail closed rate limits with payload size caps, database migration
preflight and drift guards, and Playwright end to end tests against the Vercel
preview deploy.
**Done when:** errors from every runtime reach Sentry with readable stacks, the
money moving paths fail closed under load, and a schema change cannot merge without
its migration.
code in `apps/rough-cut/instrumentation*.ts`, `src/lib/rate-limit.ts`, `packages/db/scripts/preflight.ts`, `.github/workflows/db-verify.yml`, `.github/workflows/e2e.yml`

## Slice 6 (carried forward from the frozen roadmap)

This slice was in flight when the roadmap was retired, so it moved here and kept
its number. Slices 1 to 5 and Slice 7 closed in the roadmap and are not repeated.

### 1. Studio auto cut flow · in-progress
Client requested UX redesign, evolved twice. ADR 0003 first shipped the auto run
chain behind one loader. ADR 0004 supersedes its upload and trigger design: the
upload confirm modal is gone (AI polish is mandatory, no toggle, no price screen)
and the chain is gated on the user reselecting their source video, not on
transcript readiness alone.
**Done when:** selecting a file goes straight into processing with no confirm panel
(insufficient funds caught inline, no modal), a ready project with no saved edit
list shows "Ready for step 2" on the dashboard, opening its studio shows the
reselect prompt first, and the mechanical then AI polish chain fires only after a
verified reselect, landing the user in the finished editor. AI failure or
insufficient funds still lands safely on the mechanical result with the existing
manual retry button.
- [x] Design it (ADR): [0004](../../adr/rough-cut/0004-reselect-gated-pipeline/index.md) (supersedes [0003](../../adr/rough-cut/0003-studio-auto-cut-flow/index.md))
- [x] Build it: `/develop studio auto cut flow`
  - [x] Upload flow simplification: remove the confirm modal and AI polish toggle, mandatory `aiPolishRequested`, inline combined cost pre flight, "Ready for step 2" dashboard label (child 1, AC-1..5)
  - [x] Reselect gated processing: gate the auto chain on a verified reselect, relabel the loader, preserve all existing failure and legacy behavior, full page loading state with a progress bar until the chain settles (child 2, AC-6..12)
- [ ] Verify it: `/check verify studio auto cut flow`
- [ ] Test it: `/test studio auto cut flow`
ADR [0004](../../adr/rough-cut/0004-reselect-gated-pipeline/index.md) · code in `src/lib/validation.ts`, `src/app/api/projects/route.ts`, `src/app/(app)/dashboard/page.tsx`, `src/app/(app)/dashboard/[id]/page.tsx`

## Slice 8

### 2. Transcript and Timeline Live Sync · in-progress

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

### 3. Word Boundary Timestamp Refinement · done

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
- [x] Test it: /test Word Boundary Timestamp Refinement — `src/lib/word-alignment.test.ts`

## Slice 9

### 4. Frame Accuracy and Timeline Synchrony · in-progress

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

## Slice 10

### 5. Timed transcript and subtitle export · in-progress

Enrolled by `/scope` on 2026-08-06, after the fact. This shipped into Rough Cut but
was tracked only under b-roll, so this scope understated what the app now does. The
export surface and the new API route are Rough Cut's, and they are user facing.

**Intent**: Let a finished cut leave Rough Cut as timing, not just as video: a
timed transcript another app can plan against, and captions a creator can ship.
**Done when**: the export dialog offers a timed transcript and subtitle files
alongside the video and the three NLE formats, every timecode is relative to the
final cut rather than the original file, and another app can fetch the same
document over an authorized route.

- [x] Design it (spec) [_root/0001](../../specs/_root/0001-transcript-contract/index.md)
- [ ] Build it: tracked as **b-roll feature 2's sub boxes**, not repeated here, so
      there is one place to tick. See [broll/scope.md](../broll/scope.md) · code in
      `src/lib/export/transcript-collapse.ts`, `src/lib/export/transcript-document.ts`,
      `src/app/api/projects/[id]/transcript/route.ts`, `src/components/export-modal.tsx`
- [ ] Verify it: `/check verify timed transcript and subtitle export` (first pass
      failed 2026-08-06 on the cross origin path, see the b-roll row)
- [ ] Test it: `/test timed transcript and subtitle export`

Three formats out, one document behind them: JSON carries everything (word timings,
the exact frame rate, provenance), WebVTT keeps the word grid, SRT keeps only the
cue text. Long segments split into readable caption cues at real word boundaries,
never at invented ones.

**Note for whoever touches `timebase.ts` or `frame-math.ts` next:** both are now one
line re-export shims. The real code moved to `@repo/transcript`. The key files table
in `apps/rough-cut/AGENTS.md` still describes them as if they hold the arithmetic,
which stays accurate only while the shims do. `/sync` should reconcile that line.

## Deferred

Out of scope for the current build pass, kept so the plan stays honest. None are
urgent, and three of them are deliberately waiting on real usage data rather than
on a decision.

- **Prune the dead AI run machinery** `from ADR 0003` · needs a decision. Once the
  studio auto cut flow has been live long enough to confirm no multi run use case
  resurfaces, remove the dead run list routes (`PATCH .../ai-cut/active`,
  `DELETE .../ai-cut/runs/[runId]`, rename) and revisit `AI_CUT_RUN_LIMIT`,
  possibly collapsing `ai_cut_runs` toward one row per project.
  **Done when:** the dead routes are removed and the run cap is right sized, with
  no user facing change.
- **One decode pass for waveform and word alignment** `from spec 0003` · The source
  file is decoded twice per project today, once by `lib/waveform.ts` and once by
  `lib/word-alignment.ts`. Merging them into one pass would halve that work.
  **Done when:** a project decodes its source once and both the waveform and the
  alignment pass read from that single decode.
- **Should the first auto cut wait for refinement?** `from spec 0003` · waiting on
  usage data. Revisit whether a brand new project's first automatic rough cut
  should wait for the refinement pass to finish, once there is real data on how
  often that first cut misses a word.
- **Revisit the energy threshold approach** `from spec 0003` · waiting on accuracy
  data. If energy threshold refinement proves insufficient in practice (noisy
  source audio, music beds), revisit options 2 and 3 in the spec's rationale with
  real numbers in hand, not speculative research.
- **Export format analytics** `from spec 0001` · waiting on a question worth
  asking. Nothing records which export format a user picks. Add an event on each
  format's download before any future decision that needs that data.

## Accepted risks

Revisit only if they bite in practice.

- **Video reselect duration check, same duration blind spot** (ADR 0003): two
  genuinely different videos within 1500ms of each other's duration would pass. A
  lightweight second signal (file size band, sampled fingerprint) could be layered
  on if it bites.
- **Diarization and paragraphs** (ADR 0004): deliberately deferred, not rejected.
  Revisit if a multi speaker or long form use case appears.

The old "frame snap assumes 30fps" risk is **closed**: spec 0004 replaced the fixed
grid with the detected source frame rate.

## Legend

- **Next step** = the first unticked box.
- **needs a decision** = run `/architect` first; otherwise straight to `/develop`.
- **Status** `planned` → `in-progress` → `done`, plus `existing` (predates this
  scope or shipped off plan, `/develop` and `/sync` leave it alone) and `dropped`.
- **Workflow tier tag** beside a heading (e.g. `· GA`) overrides the project
  default for that one feature; no tag means it inherits.
- **Slice numbering continues the frozen roadmap.** Slices 1 to 5 and Slice 7
  closed in [docs/roadmap/rough-cut/roadmap.md](../../roadmap/rough-cut/roadmap.md)
  and are not repeated here. Slice 6 was in flight and moved here with its number.
  Slices 8 and 9 are the first planned in this file.
