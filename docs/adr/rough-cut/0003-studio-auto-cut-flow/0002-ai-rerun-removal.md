# Child 2 — AI Re-run Removal and Free Restore

## Summary

Once child 1 makes the AI pass automatic, the always-visible "Enhance with AI" button, the paid re run, and the run list UI (switch, rename, delete) are no longer the right shape for the product: a project should only ever have paid for one AI attempt. This child removes that surface and replaces it with exactly one manual button, shown only when no AI run has ever succeeded, plus a free "Restore AI suggestions" action that reapplies the stored result client-side whenever the user has manually drifted away from it. Nothing about ADR 0002's storage or its concurrency guarantees changes; only the UI that called them does.

**Covers**: AC-6, AC-7, AC-10.

## Context

Two client-side surfaces let a user run AI Cut manually today. The tool rail's "AI Cut" icon (`page.tsx:1304-1313`, `active: !aiBusy`, always enabled regardless of run history) calls `runAiCut` on click. `TranscriptPanel`'s summary card (`apps/rough-cut/src/components/transcript-panel.tsx:676-724`) shows an "Enhance with AI Cut" call to action when `cutEvent.kind === "rough" && !hasAiCuts`, and a different "re-run anytime" message once `hasAiCuts` is true, referencing the exact paid re run flow this ADR removes.

The run-list UI (`AiCutRunDisplay`, `page.tsx:119-213`; `switchActiveAiCutRun`, `deleteAiCutRun`, `requestSwitchActiveAiCutRun`, `requestDeleteAiCutRun`, `requestRenameAiCutRun`, `page.tsx:811-932`; rendered at `page.tsx:1605-1621`) lets a user compare up to three stored, separately-paid `ai_cut_runs` rows, switch which is active, rename, or delete a non-active one. All of it calls `PATCH .../ai-cut/active`, `DELETE .../ai-cut/runs/[runId]`, and the rename route from ADR 0002.

`hasAiCuts` today is computed as `(activeAiCutRun?.ranges.length ?? 0) > 0` (`page.tsx:1295`), which is true only when the active run actually found something to cut. A run that legitimately found nothing (an empty `ranges` array, a real, successful, already-paid-for outcome) currently still shows the "Enhance with AI Cut" button, since `hasAiCuts` is false for it. That is the wrong signal once re-runs are gone: the button's job changes from "shown until you have a good result" to "shown until you have ever successfully paid for an attempt," a materially different, and simpler, condition.

## Requirements

Covers: AC-6, AC-7, AC-10.

## Decision

**Chosen option**: remove the rail button, the run-list UI, and their wiring; keep exactly one conditional manual button and add one free client-side restore action.

**RECOMMEND 3 — how "Restore AI suggestions" detects divergence, and where it lives.** Divergence is detected by re-applying the stored active run's ranges to the current EDL and comparing the result to the current EDL: `applyAiCuts(edl, activeAiCutRun, words)` (`apps/rough-cut/src/lib/ai-cuts.ts:119-141`) is already the exact function that lays the AI's ranges onto an EDL as restorable cuts, re-asserting the user's own restores afterward. If re-running it against the current EDL would change nothing, the user has not diverged and there is nothing to restore; if it would change something, the user has since restored (or otherwise altered) a span the AI wanted cut, and "Restore" becomes visible. This makes divergence detection and the restore action itself the same operation: showing "Restore" is deciding whether `applyAiCuts` is currently a no-op, and pressing it is calling that same function and applying the result. It lives in the same `TranscriptPanel` summary card the old "Enhance"/"re-run anytime" copy occupied (`transcript-panel.tsx:676-724`), replacing that copy, since that is the one place in the studio already dedicated to "what does the AI think of this transcript." Runner-up: track divergence as an explicit boolean flipped by every manual restore action — rejected, it requires threading a new piece of state through every restore call site (`handleRestoreSegment`, undo, `switchActiveAiCutRun`'s removal) for a comparison `applyAiCuts` can already answer for free, with no risk of the flag and the real EDL state ever drifting out of sync.

**Button visibility (a real behavior change from today).** The manual "Polish with AI ($X)" button's visibility becomes `project.aiCutRuns.length === 0` (no successful run has ever been stored, automatic or manual), not the current `hasAiCuts` (`ranges.length > 0`). A run that legitimately found nothing to cut is still a successful, already-paid-for attempt, and per AC-6 the button must disappear permanently after any successful run, whether or not that run found anything.

## Feature design

**Data model sketch**: none. This child adds no columns and no tables; it reads the exact `AiCutRun`/`ai_cut_runs` shape ADR 0002 already defined and child 1 already writes to (`apps/rough-cut/src/lib/ai-cuts.ts:56-64`).

**State transitions**:
- The manual button: visible when `project.aiCutRuns.length === 0`; on a successful click, a new `ai_cut_runs` row is created (exactly as `runAiCut` does today) and the button disappears for the rest of that project's life, satisfying AC-6's "disappears permanently."
- "Restore AI suggestions": visible when `project.aiCutRuns.length > 0` and `applyAiCuts(edl, activeAiCutRun, words)` would change the current EDL. Pressing it calls `applyEdl(applyAiCuts(edl, activeAiCutRun, words))`, the same client-side, no-network, no-charge path `switchActiveAiCutRun` already used to apply a run's ranges (`page.tsx:811-840`), minus the network call and the run-selection concept, since there is now only ever the one stored run.

**API surface**: no new endpoints. `POST /api/projects/[id]/ai-cut` is the only route this child's UI still calls (via the manual button), unchanged from child 1's description. `PATCH .../ai-cut/active`, `DELETE .../ai-cut/runs/[runId]`, and the rename route stay in the codebase (ADR 0002's tables and routes are retained per the umbrella's cross-child contracts) but this child's client code stops calling any of them.

**Key invariants**:
- At most one `ai_cut_runs` row is ever created per project after this ADR ships in full (one automatic attempt from child 1, or one manual click from this child, never both for the same project, since the manual button is gone the moment any run exists). The `AI_CUT_RUN_LIMIT` (3) and the run-count cap check in the POST route stay in place as a defensive backstop but are not expected to ever bind in normal use.
- "Restore" never calls Gemini and never touches the credit ledger; it is provably free because it is implemented as the same pure `applyAiCuts` function the paid run's result was originally applied with, called again client-side.
- The rail's always-on "AI Cut" icon (`page.tsx:1304-1313`) is deleted outright, not just hidden, so there is exactly one place in the UI (the transcript panel card) that can ever trigger a paid AI attempt, matching AC-6's "always-on button... removed."

**Security model**: unchanged. The manual button's click still goes through `POST /api/projects/[id]/ai-cut`'s existing auth, ownership, rate limit, and claim guard. "Restore" makes no network call at all, so it carries no new authz surface.

**Critical test scenarios**:
- Happy path, manual attempt: on a project with zero runs, the "Polish with AI" button is visible; clicking it charges once, applies the result, and the button is gone on every subsequent render for that project, even after a reload, verifies **AC-6**.
- Happy path, zero-cut result still counts: a successful run whose `ranges` array is empty still hides the manual button permanently, verifies **AC-6**.
- Happy path, restore: after a successful run, manually restore one AI-cut segment, verify "Restore AI suggestions" becomes visible; press it, verify the segment is cut again and the button returns to hidden (no divergence), with no network call made, verifies **AC-7**.
- Failure case, no divergence: after a successful run with no manual changes since, verify "Restore AI suggestions" is not shown (re-applying would be a no-op), verifies **AC-7**.
- Regression case, removed surfaces: verify the tool rail no longer renders an "AI Cut" icon, and the status bar no longer renders the run list (`AiCutRunDisplay`, switch/delete/rename), verifies **AC-6**.
- Legacy case: a pre-existing project with a saved run from before this ships correctly shows no manual button (`aiCutRuns.length > 0`) and, if diverged, offers Restore exactly as a newly-created project would, verifies **AC-10**.

## Build plan

1. Remove the tool rail's "AI Cut" entry from `railTools` and its `onClick={runAiCut}` wiring (`page.tsx:1296-1313`, `1371-1373`). (AC-6)
2. Remove `AiCutRunDisplay`, `switchActiveAiCutRun`, `deleteAiCutRun`, `requestSwitchActiveAiCutRun`, `requestDeleteAiCutRun`, `requestRenameAiCutRun`, and the run-list render block (`page.tsx:119-213`, `811-932`, `1605-1621`), along with the now-unused `AI_CUT_RUN_LIMIT` import if nothing else in the page references it. (AC-6)
3. Change the manual button's visibility condition from `hasAiCuts` (`ranges.length > 0`) to `project.aiCutRuns.length === 0`, and update `TranscriptPanel`'s summary card (`transcript-panel.tsx:676-724`) to show exactly one of: the "Polish with AI ($X)" call to action (no run yet), the "Restore AI suggestions" action (a run exists and the current EDL has diverged from it), or neither (a run exists and nothing has diverged). (AC-6, AC-7)
4. Add the divergence check (`applyAiCuts(edl, activeAiCutRun, words)` compared against the current `edl`) as a small memoized value in `page.tsx`, passed down to `TranscriptPanel` alongside the existing `hasAiCuts`-style props. (AC-7)
5. Wire "Restore AI suggestions" to call `applyEdl(applyAiCuts(edl, activeAiCutRun, words))` directly, client-side, no fetch. (AC-7)
6. Tests (co-located `*.test.ts(x)`, Vitest): the button-visibility change (including the zero-`ranges` case), the divergence memo's true/false cases, the Restore action's applied-EDL result, and a regression test asserting the rail and run-list markup are gone. (AC-6, AC-7, AC-10)

## Consequences

**Positive**: the studio now has exactly one place a user can trigger a paid AI attempt, and exactly one free way to get back to what the AI suggested if they wandered off it, both simpler to explain than "up to three versions, switch, rename, delete." The billing surface shrinks to match the product's real, current behavior (one attempt, ever) without touching how that one attempt is charged.

**Negative / tradeoffs**: a user who genuinely wants to compare two different AI passes (the use case ADR 0002 was built for) no longer can, short of the deferred pruning and any future re-introduction of that capability; this is a deliberate, client-confirmed narrowing of scope, not an oversight. `ai_cut_runs`, its three-run cap, and its now-unused routes remain in the codebase as dead capability until the Follow-up pruning happens.

**Neutral**: no schema change, no route removal, fully revertable by restoring the deleted UI code, since nothing server-side is touched by this child.
