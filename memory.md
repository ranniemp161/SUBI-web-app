# Memory — Studio Rough-Cut UX Overhaul + Progress UX + Waveform Fix

Last updated: 2026-07-05 (late evening)

## What was built

All committed and pushed (`db9b27a` dashboard glass UI redesign, `e1a29a5` studio overhaul — working tree clean, main pushed to origin).

- **Opt-in rough cut flow** ([src/app/(app)/dashboard/[id]/page.tsx](src/app/(app)/dashboard/[id]/page.tsx)): projects open with the full *uncut* timeline (keep-all EDL, no auto-build on load). A dismissible `RoughCutHero` card floats over the video preview with a sensitivity picker (light/balanced/aggressive) + "Create rough cut" button. After the run, a summary card in the transcript panel shows what was removed and upsells "Enhance with AI Cut" with the credit cost stated; the card auto-collapses after 10s (held open while AI runs) and is suppressed/reframed when the project already has stored `aiCuts` (no double-pay upsell). Hero is dismissed by any accepted edit (incl. trim drags/splits) and never shows for projects with a saved EDL.
- **AI Cut strictly opt-in**: removed the automatic Gemini pass from [src/app/api/transcribe/callback/route.ts](src/app/api/transcribe/callback/route.ts) (regression test asserts `runAiRoughCut` is never called there). Every AI Cut run charges via `chargeAiCut`; rate-limited 10/user/hour; refund on failure. Removed dead `buildInitialEDLWithAi` from ai-cuts.ts.
- **Timeline fixes** ([src/components/timeline-bar.tsx](src/components/timeline-bar.tsx)): zoom-to-fit computes `viewportWidth / totalDuration`; dynamic zoom-out floor so any video length fits on screen (wheel + buttons + `0` key).
- **Cut residue fix** ([src/lib/edl.ts](src/lib/edl.ts)): `absorbCutResidue` folds wordless kept slivers < 0.3s trapped between two cuts into the left cut; `changedSpan(prev, next)` scopes the sweep to where the edit landed so deliberate tiny keeps elsewhere survive. Runs inside `applyEdl`'s setState updater. Tests in edl.test.ts cover word-safety, protection, span scoping.
- **Dead UI removed**: placeholder rail tools (Select/Trim/Captions/Audio/Titles/Settings), Share button, Ripple delete, track-header Eye/Lock icons, fake "Speaker 1" label, duplicate timecode. Rail is now AI Cut / Filler / Review (Review opens the retake queue).
- **Visual unification**: studio violet → dashboard blue (classes, waveform canvas color, scrollbars, focus rings); shared `--color-surface: #0c0c0e` token in globals.css used by hero + buy-credits modal.
- **Progress UX**: new [src/components/progress-ring.tsx](src/components/progress-ring.tsx) (centered radial % indicator). Dashboard cards show a big centered ring on the poster through extract (real %) → upload (real %) → transcribe (duration-calibrated estimate, ~30× realtime, holds at 95%); ready/failed toasts fire when the 4s status poll flips. Studio shows a centered `AiCutOverlay` ring while Gemini runs (transcript-length-calibrated estimate).
- **Waveform reliability** ([src/lib/waveform.ts](src/lib/waveform.ts)): rewritten to stream-decode via mediabunny `AudioSampleSink` (WebCodecs) — flat memory, no size cap, handles MOV/MP4 variants that `decodeAudioData` chokes on. Old Web Audio whole-file decode kept as fallback (1.5GB cap applies only there).

## Decisions made

- **Both cut passes are explicit user actions**: mechanical rough cut is a free button (hero), AI Cut is a paid button — nothing auto-runs, nothing bills without a click. Chosen over auto-mechanical partly for the visible "watch the cuts happen" value moment.
- **Cost constants split** ([src/lib/credits.ts](src/lib/credits.ts)): `TRANSCRIPTION_COST_MICROS_PER_SECOND` = 166 (Deepgram-only, was 1383 blended), `AI_CUT_COST_MICROS_PER_SECOND` = 1217 — transcription no longer carries Gemini cost since the pass is opt-in and always charged.
- **Transcription/AI progress percentages are time-based estimates** (no real progress signal from Deepgram/Gemini) — climb to 95%, complete on real result. Extraction/upload percentages are real.
- **Bandwidth architecture reconfirmed**: filmstrip thumbnails + waveform are generated client-side from the local File; dashboard posters are CSS gradients — zero server bandwidth for all of them.
- Sensitivity + "Re-run rough cut" stayed in the studio status bar for re-runs (hero carries the first run) — deliberate deviation from the original plan.

## Problems solved

- **Cut residue root cause**: silence cuts are padded inward by `silencePadSeconds` (0.06–0.15s) while word-boundary cuts end exactly at word edges — adjacent cuts trapped a pad-width kept sliver. Fixed via absorbCutResidue (see above).
- **Waveform "often empty"**: `decodeAudioData` can't parse many video containers (MOV especially) and needed the whole file in memory. Fixed by streaming mediabunny decode.
- **react-hooks/set-state-in-effect lint** bit twice: fixed by keying card dismissal to the event timestamp (transcript panel) and seeding transcribe-progress entries in fetch/poll handlers instead of a reactive effect (dashboard).

## Current state

- Everything above is committed and pushed to origin/main. Typecheck, lint, and 222 tests green.
- **Not yet eyeball-tested end to end** — the full arc (upload → extract/upload rings → transcribe estimate → ready toast → studio → hero → rough cut → summary card → AI Cut overlay → waveform on a previously-failing MOV) has only unit-level verification.
- Production rollout still pending (see auto-memory `project_credits_rollout`): prod DB needs migrations 0003+0004, Vercel prod env needs live-mode Stripe keys/webhook + price IDs. If Vercel auto-deploys main, the new code is live against whatever prod env exists — credit flow won't work there until that setup is done.

## Next session starts with

1. Eyeball test the full flow with a real video (ideally a MOV that previously showed an empty waveform).
2. Then production rollout: apply migrations 0003+0004 to prod DB, create live-mode Stripe products/prices/webhook, set Vercel prod env vars.

## Open questions

1. Cost-per-second estimates (166 / 1217 micros) are still estimates — validate against real `credit_ledger.cost_micros` data post-launch.
2. Whether/when to open signup to non-Skool members (carried over).
3. AI Cut progress estimate calibration (40 words/s review rate) is a guess — tune after watching real runs.
