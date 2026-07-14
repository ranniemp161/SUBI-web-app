# Review, client-preview, 2026-07-12

**Reviewed by**: claude-opus-4-8 (author model unspecified, different model per /check review)
**Scope**: 2 files, uncommitted
**Verdict**: Approve with nits

## Summary
Adds a Descript-style hand-tool pan (hold Space or toggle the Hand button, drag to scroll) via capture-phase pointer handlers on the scroll container, plus a confirm-first Restore flow for cut clips (click selects, then a Restore button restores), and a `e.repeat` guard so held-Space no longer rapid-fires play/pause. The implementation is careful and idiomatic — the capture handlers early-return when the tool isn't armed, so they don't swallow ordinary interactions, and the refs-mirror pattern matches what the file already does for zoom. The remaining issues are all Minor: a few state-lifecycle edges (stuck pan after a cancelled pointer or window blur, and a Restore button that Escape can't dismiss) and the absence of any test for the new/changed timeline logic.

## Minor

### 🟡 Pan state can stick after a cancelled pointer (pan-on-hover), `apps/rough-cut/src/components/timeline-bar.tsx:346-359`
**Problem**: There is no `onPointerCancelCapture` handler. If the browser fires `pointercancel` mid-drag (common on touch/pen, and possible when a system gesture or scroll takes over), `handlePanPointerUp` never runs, so `isPanningRef.current` stays `true` and pointer capture is never released. `handlePanPointerMove` only guards on `isPanningRef.current` — not on whether a button is actually down — so after a cancel the timeline will scroll on plain mouse movement with no button held. The Space keyup path self-heals this, but a hand-tool-toggle pan has no such reset; it only recovers on the next full pointerdown/up cycle.
**Why it matters**: A dropped/cancelled pointer leaves the timeline "panning on hover," which is a confusing dead state until the user clicks again. More likely to surface on touch/pen than desktop mouse.
**Suggested fix**: Add an `onPointerCancelCapture` that mirrors `handlePanPointerUp` (clear `isPanningRef`/`isPanning`, release capture), or have the move handler also verify `e.buttons !== 0` before scrolling.

### 🟡 `selectedCutStart` isn't cleared on Escape (Restore button lingers), `apps/rough-cut/src/components/timeline-bar.tsx:152` / `apps/rough-cut/src/app/(app)/dashboard/[id]/page.tsx:667-671`
**Problem**: The page's Escape handler clears the kept-clip selection (`setSelectedStart(null)`), but `selectedCutStart` lives entirely inside `TimelineBar` and has no parent-driven reset. So after selecting a cut, Escape dismisses everything else on screen (shortcuts sheet, retake review, clip selection) but leaves the green Restore button and the white ring on the cut clip. It's cleared on scrub and on selecting a kept clip, just not on Escape.
**Why it matters**: Inconsistent dismissal — Escape reads as "clear selection" everywhere else, so the surviving Restore affordance looks like a bug to the user. Not harmful (any scrub/keep-click clears it).
**Suggested fix**: Clear `selectedCutStart` on Escape too. Since the state is internal, either add a window `keydown` Escape listener in `TimelineBar`, or lift the cut selection to the parent alongside `selectedStart` so the existing Escape branch clears both.

### 🟡 Held Space can stay "armed" after window blur, `apps/rough-cut/src/components/timeline-bar.tsx:302-330`
**Problem**: `isSpaceHeld` is set on `keydown` and cleared on `keyup`, both window-scoped. If the user holds Space and the window loses focus (alt-tab, Cmd-Tab, DevTools), the `keyup` is delivered to the other window and never received here — `isSpaceHeld`/`isSpaceHeldRef` stay `true`. The timeline then remains pan-armed (grab cursor, clicks pan instead of scrub) until the next Space press+release over the page.
**Why it matters**: Alt-tabbing while holding Space is common; the user returns to a timeline that silently won't scrub. Minor but easy to hit.
**Suggested fix**: Reset the space-held/pan state on a window `blur` (and optionally `visibilitychange`) listener in the same effect.

### 🟡 No test covers the new pan/hand logic or the changed cut-click semantics, `apps/rough-cut/src/components/timeline-bar.tsx`
**Problem**: Tests are configured (Vitest + Testing Library, colocated `*.test.tsx`), but there is no `timeline-bar.test.tsx` at all, so none of this is exercised: hand-tool arm/disarm, pan-drag scroll math, the capture-phase preemption, or — most importantly — the behavior change where clicking a cut used to call `onRestoreSegment` immediately and now only selects it. That semantic change to an existing contract has zero regression coverage. `dashboard/[id]/page.test.tsx` passing doesn't reach into `TimelineBar`'s click handling.
**Why it matters**: The change silently alters what a cut-clip click does; without a test, a future refactor could revert or break the confirm-first flow undetected.
**Suggested fix**: Add a `timeline-bar.test.tsx` asserting at minimum: clicking a cut does not call `onRestoreSegment` but surfaces Restore, and clicking Restore does call it once with the segment. (Test authoring is /test's job — flagging the gap only.)

## Nits
- ⚪ `apps/rough-cut/src/components/timeline-bar.tsx:142-144`, inconsistent ref-mirroring: `handToolActiveRef` is written during render (matches the existing `pxPerSecRef`/`fitPxPerSecRef` pattern, so it's safe) while `isSpaceHeldRef` is written inside the event handlers. Both work; picking one style would read cleaner.
- ⚪ `apps/rough-cut/src/components/timeline-bar.tsx:311-316` and `apps/rough-cut/src/app/(app)/dashboard/[id]/page.tsx:588`, Space is now `preventDefault`'d by two independent window keydown listeners. Fine today (they mount together), but the coupling is implicit — a comment cross-referencing the two would help the next reader.
- ⚪ `apps/rough-cut/src/components/timeline-bar.tsx:773`, `isSelectedCut` keys off `segment.start` equality; if the EDL mutates so a different cut later starts at the same time, the Restore ring could reattach to the wrong clip. Very low likelihood given how cuts are produced; noting for awareness.

## Strengths
- The author's chief worry — capture-phase `stopPropagation` swallowing legitimate clicks when not panning — is correctly handled: all three pan handlers early-return before any `stopPropagation`/`preventDefault` when the tool isn't armed (`!isSpaceHeldRef && !handToolActiveRef`) or not actively panning (`!isPanningRef`), so the non-armed steady state is fully transparent to the existing scrub/select/trim handlers.
- The Restore and Delete inline buttons are mutually exclusive by construction: `isSelected` requires `!isCut`, `isSelectedCut` requires `isCut`, and `handleSegmentClick` clears the opposite selection on every click, so they can never both show — including across different clips.
- The `e.repeat` guard is placed correctly (before the switch, after the meta/ctrl early-returns) and is well-commented; it fixes the real auto-repeat play/pause flicker without affecting single Space presses.
- `setPointerCapture` on the scroll container makes the pan drag robust to the pointer leaving the element mid-drag — the right primitive for this.

## Test coverage
Test runner is configured. The diff adds meaningful new branching logic (pan arming from two sources, capture-phase interception, confirm-first restore) and changes an existing contract (cut-click no longer restores), none of which is covered — there is no `timeline-bar.test.tsx`. The existing `dashboard/[id]/page.test.tsx` (19 tests) still passes but does not exercise any of this. Recommend adding component-level tests for the restore-confirm flow and hand-tool toggle; the pan-drag scroll math and pointer-cancel edge are lower priority but would catch the stuck-state regression noted above.
