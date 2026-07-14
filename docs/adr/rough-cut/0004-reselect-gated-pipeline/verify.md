# Verify: reselect gated pipeline · ADR 0004 · updated 2026-07-14 (AC-12 added)

_Steps derived from ADR 0004 acceptance criteria. `/verify` runs these; `/test` locks the durable ones._

## UI / manual

- [ ] Select a new video file on the dashboard with sufficient funds → extraction, Blob upload, and Deepgram transcription start immediately, no confirm panel, no click required after selection → AC-1
- [ ] Select a new video file with a balance below the combined transcription+polish cost → an inline, non-modal message appears near the file picker (no dialog); neither the project nor extraction is created → AC-3
- [ ] A project with `transcriptStatus === "ready"` and no saved edit list shows "Ready for step 2" on the dashboard; a project with a saved edit list or an existing AI Cut run shows plain "Ready" → AC-5
- [ ] Click a "Ready for step 2" row → lands on `/dashboard/[id]`, no other route → AC-6
- [ ] Open the studio on a fresh (ready, no saved edit list) project → first visible state is the existing video reselect prompt (`FilePicker`, unchanged duration-verification props) → AC-7
- [ ] On that fresh project, do NOT reselect → confirm no mechanical cut and no AI charge ever fires, even though the transcript alone is enough to build one → AC-8
- [ ] Reselect the correct video → the full-screen loader appears immediately with the exact copy "A.I. is doing the rough cut in the background..." and spans both the mechanical and AI phases → AC-8, AC-9
- [ ] Force the AI phase to fail or 402 after reselect → mechanical result stays applied and visible, existing error toast (and for 402, the add-funds deep link) appears, charge is refunded, manual "Polish with AI ($X)" button appears and is the retry path → AC-10
- [ ] Open a legacy project (saved edit list, or an existing AI Cut run) → loads straight into the editor with no reselect-prompt-as-gate behavior → AC-11
- [ ] Reselect a video with a mismatched duration → existing block-and-message behavior, unchanged, nothing fires → AC-7, AC-8
- [ ] Reselect on a fresh project → NO transcript panel, timeline, or rail is visible at any point before the chain settles — only the full-page loading state with the exact copy → AC-12
- [ ] Force the AI phase to fail or 402 while on the full-page loading state → it still swaps to the normal editor (mechanical result, existing toast/add-funds link, retry button) once settled, never gets stuck → AC-12, AC-10
- [ ] Open a legacy project → the full-page loading state never appears, straight into the editor as before → AC-11, AC-12
- [ ] While on the full-page loading state → a linear progress bar with a live percentage is visible under the message, advancing over time, and it disappears the moment the editor mounts → AC-12 (progress bar follow-up)

## Commands

- [ ] `npm -w @repo/rough-cut typecheck` → passes
- [ ] `npm -w @repo/rough-cut lint` → passes
- [ ] `npm -w @repo/rough-cut test` → all suites pass (440/440 at last run, including the new dashboard no-panel tests, the `hasEdl`/strict-schema route tests, the reselect-gating regression tests, the AC-12 full-page-loader tests, and the progress-bar test in `[id]/page.test.tsx`)

## Acceptance-criteria coverage

- AC-1 (no-click upload) — manual pass + `dashboard/page.test.tsx` ("no-click upload" describe block)
- AC-2 (`aiPolishRequested` always true, `aiPolish` rejected) — `route.test.ts`, `validation.test.ts`
- AC-3 (combined pre-flight, inline message) — `dashboard/page.test.tsx` ("inline insufficient-funds message")
- AC-4 (server remains authoritative — blob-token cap, ai-cut 402) — unchanged code path, not touched by this ADR; covered by pre-existing tests
- AC-5 ("Ready for step 2" vs "Ready") — `route.test.ts` (`hasEdl`), `dashboard/page.test.tsx` ("dashboard label")
- AC-6 (navigation to `/dashboard/[id]`) — manual pass (no new route was introduced, so no route-specific test needed)
- AC-7 (reselect prompt first) — `[id]/page.test.tsx` ("reselect-gated processing")
- AC-8 (the gate itself — the regression this ADR exists to prevent) — `[id]/page.test.tsx` ("does not fire the auto-chain before reselect")
- AC-9 (exact loader copy, spans both phases) — `[id]/page.test.tsx` ("fires the auto-chain the moment reselect succeeds")
- AC-10 (failure/402 handling unchanged) — `[id]/page.test.tsx` (existing 402 test, updated to reselect first)
- AC-11 (legacy inertness) — `[id]/page.test.tsx` ("a legacy project (saved edit list) opens straight into the editor")
- AC-12 (full-page loading state, added 2026-07-14) — `[id]/page.test.tsx` ("shows only the full-page loading state...", "swaps to the editor with the mechanical result once the chain settles via an AI failure...", "never shows the full-page loading state for a legacy project...", "shows a linear progress bar on the full-page loading state...")
