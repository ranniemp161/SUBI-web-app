# Roadmap — Rough Cut App

The core product: browser-based video transcription and AI-assisted rough cutting. Users upload a video, its audio is transcribed, the transcript drives an editable timeline, and export runs client-side in the browser.

**Build approach**: Tracer Bullet — vertical slices; each feature built end-to-end through every layer, working.
**Weight profile**: mostly lean and medium

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| A | Landing page & marketing | Existing | existing |
| B | Authentication & access control | Existing | existing |
| C | Project management dashboard | Existing | existing |
| D | Video transcription pipeline | Existing | existing |
| E | Text-based video editor | Existing | existing |
| F | AI-assisted cutting | Existing | existing |
| G | Client-side browser export | Existing | existing |
| H | Credit/token metering | Existing | existing |
| I | IP-based rate limiting | Existing | existing |
| J | Cron cleanup & housekeeping | Existing | existing |
| 1 | Buy Credits Redirect | Slice 1 | done |
| 2 | Editor Studio UX Safety | Slice 2 | done |
| 3 | AI Cut paid re-run (versioned suggestions) | Slice 3 | done |
| 4 | Surface AI Cut last-run timestamp | Deferred | planned |
| 5 | Tune cut logic against utterance boundaries | Deferred | planned |

## Existing (pre-workflow, enrolled 2026-07-08)

These shipped before this roadmap existed. They are confirmed built and working from the code and `apps/rough-cut/AGENTS.md`, not from a plan, so they carry no task list. `/develop` and `/sync` leave `existing` rows alone.

### A. Landing page & marketing · existing
Public, SEO-friendly marketing page (hero, feature grid, FAQ), redirects signed-in users straight to the dashboard.
code in `src/app/page.tsx`

### B. Authentication & access control · existing
Clerk SSO (multi-domain with the Wallet app), Skool-community access-code-gated signup, Clerk user-sync webhook, and the `proxy.ts` auth gate.
code in `src/proxy.ts`, `src/app/(auth)/`, `src/app/api/auth/verify-code/route.ts`, `src/app/api/webhooks/clerk/route.ts`

### C. Project management dashboard · existing
Home page listing a user's video projects: drag-and-drop upload, live progress (extract → upload → transcribe), retry failed jobs, delete with confirmation.
code in `src/app/(app)/dashboard/page.tsx`, `src/components/file-picker.tsx`

### D. Video transcription pipeline · existing
Browser extracts the audio track client-side, uploads it directly to Vercel Blob (bypassing the server function size limit), kicks off transcription, and deletes the blob once done.
code in `src/app/api/transcribe/deepgram/route.ts`, `src/app/api/transcribe/callback/route.ts`, `src/app/api/transcribe/blob-token/route.ts`, `src/lib/deepgram.ts`

### E. Text-based video editor · existing
Studio UI: transcript panel with click-to-seek, keep/cut/uncertain timeline, video player, manual + AI cut suggestions, undo/redo.
code in `src/app/(app)/dashboard/[id]/page.tsx`, `src/components/transcript-panel.tsx`, `src/components/timeline-bar.tsx`, `src/lib/edl.ts`

### F. AI-assisted cutting · existing
Opt-in "AI Cut" run against the transcript to suggest cuts for silence, retakes, and filler words; user accepts or rejects each suggestion.
code in `src/app/api/projects/[id]/ai-cut/route.ts`, `src/lib/ai-rough-cut.ts`

### G. Client-side browser export · existing
WebCodecs-powered MP4 export (Chromium/Edge only), stitches the cut timeline with no gaps, quality selector for device constraints, runs in-tab.
code in `src/lib/export/plan.ts`, `src/lib/export/export-trigger.ts`, `src/workers/export-worker.ts`

### H. Credit/token metering · existing
Per-minute USD-micros billing: transcription reserved on upload and settled on the real callback duration, AI Cut charged per run, hold/settle/refund with a non-negative CHECK guarding concurrent spends.
code in `src/lib/credits.ts`, `src/app/api/credits/route.ts`

### I. IP-based rate limiting · existing
Per-IP fixed-window limits on the routes that have no session to key on (transcription callback, access-code verify, Clerk webhook), backed by Upstash/Vercel KV.
code in `src/lib/rate-limit.ts`, `src/lib/ip-rate-limit.ts`

### J. Cron cleanup & housekeeping · existing
Daily blob sweep for orphaned audio uploads, plus best-effort cleanup when a transcription kickoff fails.
code in `src/app/api/cron/blob-sweep/route.ts`, `src/app/api/transcribe/blob-cleanup/route.ts`

## Slice 1

### 1. Buy Credits Redirect · done
Redirect the local Stripe checkout modal to the separated Wallet app.
**Done when:** clicking "Buy credits" anywhere in Rough Cut deep-links the user to the Wallet app (e.g., localhost:3001) instead of opening the local Stripe popover.
- [x] Build it: `/develop buy credits redirect`

## Slice 2

### 2. Editor Studio UX Safety · done
Four small safety and accuracy fixes to the editor studio: a reassurance toast on exit, a server-side guard stopping AI Cut from charging twice, a duration check catching a wrong reselected video, and tighter transcript/frame timing.
**Done when:** leaving the editor shows a saved-and-safe toast, AI Cut cannot be charged twice for the same project without an explicit clear step, reselecting a mismatched video is blocked with a clear message, and transcript timestamps are frame-snapped with utterance grouping enabled.
- [x] Design it (ADR): [0001](../../adr/rough-cut/0001-editor-studio-ux-safety/index.md)
- [x] Build it: `/develop editor studio ux safety`
  - [x] Exit navigation reassurance toast (child 1)
  - [x] AI Cut re-run guard + Clear AI Cuts action (child 2)
  - [x] Video reselect duration verification (child 3)
  - [x] Transcript utterances + frame snap accuracy (child 4)
  code in `apps/rough-cut/src/app/(app)/dashboard/[id]/page.tsx`, `src/components/file-picker.tsx`, `src/app/api/projects/[id]/ai-cut/route.ts`, `src/lib/deepgram.ts`, `src/app/api/transcribe/deepgram/route.ts`
- [x] Verify it: `/verify editor studio ux safety` (manual signed-in pass confirmed working in the browser 2026-07-09)
- [x] Test it: `/test editor studio ux safety`

## Slice 3

### 3. AI Cut paid re-run (versioned suggestions) · done
Today, once AI Cut has produced suggestions, a user must Clear (discard) them before running again, no refund. A user who wants a second AI pass to compare against the first (not just redo) needs a different, additive shape.
**Done when:** a user can request a fresh, paid AI Cut pass without losing the current one, and see both to compare or choose.
- [x] Design it (ADR): [0002](../../adr/rough-cut/0002-ai-cut-paid-rerun/index.md)
- [x] Build it: `/develop ai cut paid re-run`
  - [x] Migration: `ai_cut_runs` table + `active_ai_cut_run_id` + `ai_cut_claim_at` on `projects`, backfill existing `ai_cuts`, drop the old column
  - [x] Claim + create path (POST): decoupled atomic claim, run-count cap check, new run row, sets active
  - [x] Switch active (PATCH `.../active`) and delete run (DELETE `.../runs/[runId]`, blocks deleting the active run, renumbers on delete)
  - [x] Client wiring: run list, switch with discard-manual-edits confirm, per-run delete, new error codes surfaced
  code in `packages/db/src/schema.ts`, `packages/db/drizzle/0005_ai_cut_runs.sql`, `apps/rough-cut/src/lib/projects.ts`, `apps/rough-cut/src/lib/ai-cuts.ts`, `apps/rough-cut/src/app/api/projects/[id]/ai-cut/route.ts`, `apps/rough-cut/src/app/api/projects/[id]/ai-cut/active/route.ts`, `apps/rough-cut/src/app/api/projects/[id]/ai-cut/runs/[runId]/route.ts`, `apps/rough-cut/src/app/api/projects/[id]/route.ts`, `apps/rough-cut/src/app/(app)/dashboard/[id]/page.tsx`
- [x] Verify it: `/verify ai cut paid re-run`
- [x] Test it: `/test ai cut paid re-run`

## Deferred

Surfaced as follow-ups while building Slice 2 (Editor Studio UX Safety), not yet scheduled into a slice. Each has its own decision status; none are urgent.

### 4. Surface AI Cut last-run timestamp · planned
When AI Cut has already run, tell the user when, so the already-run state reads as "current" rather than ambiguous or stale.
**Done when:** the already-run AI Cut UI state shows a relative or absolute last-run time.
- [ ] Build it: `/develop ai cut last run timestamp`

### 5. Tune cut logic against utterance boundaries · planned
`retake-detection.ts` now has real Deepgram utterance boundaries available (`utteranceEnds`) but only uses them for sentence grouping; how aggressively cut suggestions should lean on them versus raw word gaps hasn't been tuned against real footage yet.
**Done when:** cut-suggestion quality has been checked against real footage with utterance boundaries in play, and any tuning needed is applied.
- [ ] Build it: `/develop tune cut logic utterance boundaries`

## Accepted risks (revisit only if they bite in practice)

- **Video reselect duration check, same-duration blind spot** (ADR 0003): two genuinely different videos within 1500ms of each other's duration would pass. If this bites, a lightweight second signal (file size band, sampled fingerprint) could be layered on.
- **Frame snap assumes 30fps** (ADR 0004): wrong by up to about one real frame on non-30fps footage (most visible at 24fps/60fps). Real per-video fps detection is the future upgrade if variable/non-30fps source video becomes common.
- **Diarization and paragraphs** (ADR 0004): deliberately deferred, not rejected; revisit if a multi-speaker or long-form use case appears.

## Legend

- `existing` = shipped before this roadmap existed, confirmed from code, no task list, `/develop`/`/sync` leave it alone.
- `done` = built and verified through this pipeline.
