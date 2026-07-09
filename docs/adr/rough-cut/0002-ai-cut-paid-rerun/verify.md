# Verify: AI Cut paid re-run · ADR 0002 · updated 2026-07-09

_Steps derived from ADR 0002 acceptance criteria. `/verify` runs these; `/test` locks the durable ones._

## UI / manual

- [ ] Sign in, open a project whose transcript is ready, click "AI Cut" → a first run completes, appears as run 1 (active, highlighted) in the status bar's "AI runs" list → AC-1
- [ ] Click "AI Cut" again on the same project → a second paid run completes, run 2 appears alongside run 1, run 1 is still visible in the list (not lost) → AC-1
- [ ] Click run 1's number → confirm toast "Switch to run 1?" appears; press Cancel → nothing happens, run 2 stays active → AC-3
- [ ] Click run 1's number again, press Switch → run 1 becomes active (highlighted), its ranges are applied to the timeline, and the prior manual/AI edits are discarded → AC-3
- [ ] Run AI Cut a 3rd time → run 3 created successfully (3/3 shown) → AC-1, AC-2
- [ ] Run AI Cut a 4th time → blocked with a clear error toast ("Already have 3 saved runs…"), no charge, no Gemini call → AC-2
- [ ] Click the eraser next to a non-active run → confirm toast "Delete run N?"; press Cancel → nothing happens → AC-4
- [ ] Confirm the delete → that run disappears from the list, remaining runs keep contiguous numbers (e.g. deleting run 2 of 1/2/3 renumbers run 3 to run 2) → AC-4
- [ ] Try to delete the currently active run → no delete control is shown for it in the UI (server also blocks it with 409 `AI_CUT_RUN_IS_ACTIVE` if called directly) → AC-4
- [ ] After deleting one run (back under the cap), running AI Cut again succeeds and charges normally → AC-1, AC-2

## Commands

- [ ] `curl -X POST /api/projects/<id>/ai-cut` twice back-to-back (simulating a double-click) → exactly one charge lands in `credit_ledger`, the loser gets 409 `AI_CUT_IN_PROGRESS` → AC-5
- [ ] `curl -X PATCH /api/projects/<id>/ai-cut/active -d '{"runId":"<not-this-projects-run>"}'` → 404 `AI_CUT_RUN_NOT_FOUND`, no data leaked about the other run → AC-6
- [ ] `curl -X DELETE /api/projects/<id>/ai-cut/runs/<not-this-projects-run>` → 404 `AI_CUT_RUN_NOT_FOUND` → AC-6
- [ ] Query `ai_cut_runs` for a project with 3 runs, delete the oldest, requery → `run_number` values are `1,2` with no gap → AC-4
- [ ] `npm -w @repo/rough-cut typecheck` and `npm -w @repo/rough-cut test` → both green → all AC (regression gate)

## Acceptance-criteria coverage

- AC-1 (re-run without losing prior results) — covered by the first three UI steps and the "runs again" command step.
- AC-2 (3-run cap, clear 409) — covered by the 4th-run UI step and the ledger double-charge command step.
- AC-3 (switch active, discard-edits warning) — covered by the switch UI steps.
- AC-4 (delete non-active run, block active delete, renumber) — covered by the delete UI steps and the renumbering command step.
- AC-5 (concurrent claim serializes charges) — covered by the double-POST command step.
- AC-6 (auth + ownership + rate limit on all three endpoints) — covered by the cross-project PATCH/DELETE command steps; rate limiting is exercised by the existing `ai-cut:${clerkId}` bucket shared with POST (route tests already assert 429 on a limiter denial for all three routes).
