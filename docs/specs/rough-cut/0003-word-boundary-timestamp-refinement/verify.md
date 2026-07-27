# Verify: Word Boundary Timestamp Refinement · spec 0003 · updated 2026-07-21
_Steps derived from spec 0003 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Open a ready project, reselect its source video, wait a few seconds, confirm at least one transcript word's boundary visibly tightened (transcript highlighting/cut precision) with no page reload → AC-1, AC-3
- [ ] Cut a word (word-select cut, and Cut left/right) after the pass completes, confirm the cut lands exactly on the refined boundary, not the original Deepgram estimate → AC-5
- [ ] While the pass is still running (a long video), manually cut or trim a word, let the pass finish, confirm that word's manually-set boundary was NOT overwritten by refinement → AC-2, mid-pass edit guard
- [ ] Reselect a long video and confirm the editor becomes interactive at the same speed as before this feature — no new blocking wait screen → AC-8
- [ ] Reselect the same project a second time (or reload the page), confirm no visible re-run (no flicker/second pass) → AC-4

## Commands
- [ ] `npm run typecheck -w @repo/rough-cut` → passes → AC-1..AC-8 (no type regressions)
- [ ] `npm run lint -w @repo/rough-cut` → passes → no lint regressions (react-hooks/set-state-in-effect etc.)
- [ ] `npx vitest run` (in `apps/rough-cut`) → all tests pass, including `src/lib/word-alignment.test.ts` → AC-1, AC-2, mid-pass edit guard
- [ ] Query the `projects` table for a refined project: `wordsAligned` is `true` and `transcript.words[].aligned` is `true` for at least the refined words → AC-3, AC-4
- [ ] Inspect a PATCH request payload during refinement (network tab or server log): confirms `wordsAligned: true` and `transcript` with refined `words[]` are sent together → PATCH schema wiring
- [ ] Kill the tab/reload mid-pass (before it completes), reopen the project, confirm `wordsAligned` is still `false` and every word's `start`/`end` is unchanged from before → AC-7
- [ ] Force a decode failure (an unsupported/corrupt file), confirm no error is shown to the user and `wordsAligned` stays `false` → AC-7

## Acceptance-criteria coverage
- AC-1 (background pass refines on reselect, once per project) · covered by UI step 1, command step "wordsAligned true" check
- AC-2 (no confident boundary → original timestamp kept, never worse) · covered by `word-alignment.test.ts`'s flat-window/insufficient-hold/out-of-window tests, and the mid-pass edit guard UI step
- AC-3 (refined timestamps visible immediately, persisted across reload) · covered by UI step 1 and the DB query step
- AC-4 (never re-runs once complete) · covered by UI step 5 and the DB query step
- AC-5 (manual cuts land on refined boundary) · covered by UI step 2
- AC-6 (no new vendor, audio never leaves device) · covered by code review — `word-alignment.ts` only imports `mediabunny` (already used client-side) and never calls `fetch` with audio data
- AC-7 (decode failure / interrupted pass leaves project untouched, retried next reselect) · covered by the mid-pass-kill and decode-failure command steps
- AC-8 (no new blocking delay) · covered by UI step 4
