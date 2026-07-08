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

## Legend

- `existing` = shipped before this roadmap existed, confirmed from code, no task list, `/develop`/`/sync` leave it alone.
- `done` = built and verified through this pipeline.
