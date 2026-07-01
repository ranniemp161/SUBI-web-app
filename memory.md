# Memory — Rough Cut App — Timeline Split Follow-up (PR + review fixes)

Last updated: 2026-07-01

## What was built

Branch `feat/timeline-split`, working tree currently CLEAN at committed HEAD
`62b21ec` (select-and-delete clips + scrollbar polish). No uncommitted changes.

This session was housekeeping on top of that commit, not new features:

**1. Merge/PR state clarified.** PR #1 already merged `feat/timeline-split` into
`main` **up through `85a8845` (razor split)** — `origin/main` HEAD is the merge commit
`9ee1de0`. The ONLY unmerged commit is `62b21ec` (select-and-delete + scrollbar). So the
outstanding work is a small FOLLOW-UP PR for just that one commit, not the whole branch.
Drafted title ("Select-and-delete timeline clips + scrollbar polish") and body in-chat.

**2. `gh` CLI installed.** `winget install --id GitHub.cli` → gh **v2.95.0**, on the
machine PATH at `C:\Program Files\GitHub CLI\gh.exe`. **NOT yet authenticated** —
`gh auth login` is interactive and this session is non-interactive, so the user has to run
it themselves (GitHub.com → HTTPS → "Login with a web browser" → device code). User was
mid-flow (had opened the repo page in the browser, not the device-login page yet).

**3. `/review` of commit `62b21ec`.** Verdict: Layer 1 (plan alignment) PASS, Layer 2
(system integrity) PASS with one minor note, Layer 3 found 2 minor issues (below).

**4. Two review fixes were written AND verified green (tsc + eslint + 7/7 vitest),
then REVERTED.** They are NOT in the working tree now (tree is clean at `62b21ec`).
If we redo them, here is exactly what they were:
- **Issue #1 — `deleteSelected` (page.tsx):** it cleared the selection (`setSelectedStart(null)`)
  BEFORE calling `applyEdl`, so deleting the last kept clip → guard refuses ("Can't remove
  everything") but the selection ring/trash already vanished. Fix: clear selection only on
  a stale/invalid selection or AFTER `applyEdl` returns true; keep it on a refused delete.
- **Issue #2 — clip- vs word-selection could coexist; Delete resolved by focus, not true
  exclusion.** Fix made them mutually exclusive, event-driven (NOT effects — eslint rule
  `react-hooks/set-state-in-effect` rejects local setState in an effect):
  - `TranscriptPanel` → `forwardRef<TranscriptPanelHandle>` exposing `clearSelection()`
    via `useImperativeHandle`; page holds a `transcriptPanelRef` and calls it from
    `handleSelectSegment` when a clip is selected.
  - New `onWordsSelected` prop: transcript fires it (via a `useEffect` watching
    `selection.size > 0`) so the page nulls `selectedStart`. Calling a PARENT callback in
    an effect is lint-clean; calling the LOCAL `clearSelection` in an effect is NOT.
  - No loop: each direction ends in a `set…(null)`/empty state the other treats as a no-op.

## Decisions made

- Follow-up PR should contain ONLY `62b21ec`; don't reopen the whole branch (85a8845 and
  earlier are already in main via merge `9ee1de0`).
- Left the Layer-2 minor (`bg-red-600` raw color on the trash hover) as-is: no destructive
  token exists in the system and red-for-delete is a sound convention; tokenizing it is a
  separate, opt-in change.
- (carried) Never let an edit empty the timeline — `applyEdl` returns a boolean and refuses
  any `keptDuration <= 0` edit; cut callers only toast on success.
- (carried) Selection identity = segment `start` time (unique). Split = persistent `split`
  flag surviving `mergeAdjacent`. EDL = single source of truth, SECONDS, autosaved to
  Postgres `edl` jsonb; rule-based only; dev server MUST be `npx next dev --webpack`.

## Problems solved

- Untangled the PR confusion: main already has the razor split (PR #1); only the
  select-and-delete commit still needs a PR.
- Cleared a suspected bug: the boundary-drag trim path (`handleTrimBoundary` → `trimBoundary`)
  bypasses `applyEdl`'s empty-timeline guard, BUT `trimBoundary` only shifts one shared
  boundary and clamps both sides to `MIN_SEGMENT_SECONDS`, so it CANNOT empty the timeline.
  The invariant holds by construction there — no fix needed.
- (carried) Black screen on the editor = NOT a code bug: Clerk redirect loop from local
  system CLOCK SKEW (JWT `iat` in the future). Fix = sync the Windows clock, restart dev
  server, hard-reload.

## Current state

- Working tree CLEAN at `62b21ec`; the two review fixes above were reverted and must be
  re-applied if wanted. (memory.md itself was also reverted this session before this save.)
- `gh` v2.95.0 installed but NOT authenticated. No follow-up PR opened yet. Compare URL:
  https://github.com/ranniemp161/SUBI-web-app/compare/main...feat/timeline-split?expand=1
  (or click the green "Compare & pull request" on the repo page).
- Still NO live browser verification of split / select-delete / empty-timeline guard /
  scrollbar — blocked by the Clerk/clock-skew redirect loop. Verified via tsc + eslint +
  vitest only.
- Transcription still the temporary local faster-whisper path; Deepgram not restored
  (blocked on client meeting). No secrets stored here.

## Next session starts with

1. Confirm with the user whether to RE-APPLY the two reverted review fixes (they were green;
   details under "What was built #4"). If yes, re-do Issue #1 + #2, re-run
   `npx tsc --noEmit` / `npx eslint` / `npx vitest run`, then commit.
2. Finish `gh auth login` (interactive, user-run) OR open the follow-up PR via the compare
   URL / green button, using the drafted title/body. PR should show only `62b21ec` (+ any
   re-applied fixes).
3. Sync the system clock, restart `npx next dev --webpack`, hard-reload, and VISUALLY VERIFY:
   S-key/Split razors a clip (violet boundary); click-select shows ring + trash;
   Delete/toolbar/trash remove a clip with working undo; deleting the last clip is refused
   with the toast; transcript scrollbar reads as a slim violet pill.

## Open questions

- Re-apply the reverted fixes, or intentionally ship `62b21ec` as-is? (User reverted them;
  reason unconfirmed.)
- Should `deleteSelected` block deleting the last clip with a tailored message, or is the
  generic `applyEdl` guard enough? (Issue #1 fix improved the UX but kept the generic guard.)
- Add a real `--destructive` design token instead of raw `bg-red-600`? (Deferred.)
- (carried) Retake accuracy + false-starts; accent unification violet/blue; Deepgram
  restore (blocked on client meeting).
- (carried) Net-new editor features unbuilt: reorderable clips / true ripple delete (needs a
  clip model), filler-word detection, speaker diarization, Captions/Audio/Titles/Settings
  panels, Export, Share.
