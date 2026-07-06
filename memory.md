# Memory — Status-Poll UX Fixes + Delete Confirmation Modal

Last updated: 2026-07-06 (evening)

## What was built

All in the working tree, **NOT yet committed** (user was asked and hasn't said yes). Also uncommitted from before: a small pre-existing `M src/app/(app)/dashboard/page.tsx` was already in git status at session start.

Fixes came out of a `/review` of two user complaints: "card stuck at 95% after transcription is actually done" and "delete has no confirmation".

- **Dashboard poll rewrite** ([src/app/(app)/dashboard/page.tsx](src/app/(app)/dashboard/page.tsx)): the transcript-status poll now keys off a stable `processingKey` string (sorted joined ids) instead of the `projects` array, so the 4s interval is no longer torn down/recreated every tick. It fires immediately on start, and re-checks on `visibilitychange` + window `focus` (background-tab timer throttling was the likely real cause of the "stuck 95%"). A `projectsRef` mirrors `projects` for toast file names without being an effect dependency.
- **Latent status bug closed**: the server keeps `transcriptStatus: "idle"` during the client-side extract/upload phases (project creation doesn't set it; only the Deepgram kickoff flips it to processing). The poll now treats only `ready`/`failed` as terminal — previously any poll tick during extraction would have flipped the optimistic "processing" card back to idle and killed the progress UI.
- **Asymptotic progress estimate**: `estimateTranscribePercent` is now `min(99, (1 − e^(−2·elapsed/expected)) · 100)` — ~86% at the expected finish, then a visible crawl toward 99% instead of parking dead at 95%.
- **Studio processing screen self-updates** ([src/app/(app)/dashboard/[id]/page.tsx](src/app/(app)/dashboard/[id]/page.tsx)): while `transcriptStatus === "processing"`, a poll (4s + tab-return listeners) checks `/api/projects/:id/status`; on ready/failed it bumps a `reloadNonce` state that re-runs the mount fetch effect, so the editor opens automatically. Screen copy updated to say so.
- **Delete confirmation modal** (dashboard): trash button now sets `confirmDeleteProject`; a modal styled on the buy-credits pattern (`bg-surface/95`, `role="alertdialog"`) names the file, warns it's permanent, offers Cancel / Delete project. Escape + backdrop-click cancel (both blocked while deleting). `handleConfirmedDelete` shows an error toast with the server reason on failure, a success toast on success, disables buttons + spinner while in flight, and also clears the project's `activeUploads` entry.

## Decisions made

- Poll cadence stays 4s; "instant" is achieved via immediate-first-check + tab-return re-check, not websockets/SSE — no server changes needed.
- Studio reload uses a `reloadNonce` state re-triggering the inline fetch effect, NOT an extracted `loadProject` useCallback — the repo's `react-hooks/set-state-in-effect` lint rule rejects calling an outside-defined state-setting callback from an effect body (third time this rule shaped a design; pattern: keep state-writing fetchers defined inside the effect, trigger re-runs via deps).
- Delete confirmation is an in-page modal matching the buy-credits panel, not `window.confirm`.

## Problems solved

- The "stuck at 95%" had three stacked causes: no push signal + interval reset on every poll tick (projects identity churn) + background-tab timer throttling; plus the estimate curve made even healthy waits look frozen. All addressed client-side.
- The idle-vs-processing mismatch (server idle during extract/upload while client shows processing) — see above; only ready/failed are terminal now.

## Current state

- Typecheck, ESLint, and all 222 tests green with the changes in the working tree.
- **Uncommitted.** User was offered a commit and hasn't responded — commit these two files first thing (feat/fix commit, e.g. "fix: instant transcript status updates and delete confirmation modal").
- Still not eyeball-tested end to end (carried over): upload → progress rings → tab away/back → instant ready flip → studio auto-open → delete flow with modal → waveform on a previously-failing MOV.
- Production rollout still pending (see auto-memory `project_credits_rollout`): prod DB migrations 0003+0004, live-mode Stripe products/prices/webhook, Vercel prod env vars.

## Next session starts with

1. Ask/confirm committing the working-tree changes (dashboard page + studio page), then push.
2. Eyeball test the full flow with a real video, specifically verifying the new behaviors: return-to-tab instant status flip, crawling (not frozen) percent, studio auto-open when ready, delete confirmation modal incl. failure toast.
3. Then the production rollout steps.

## Open questions

1. Cost-per-second estimates (166 / 1217 micros) still need validation against real `credit_ledger.cost_micros` post-launch.
2. AI Cut progress calibration (40 words/s) still a guess.
3. Whether/when to open signup to non-Skool members (carried over).
