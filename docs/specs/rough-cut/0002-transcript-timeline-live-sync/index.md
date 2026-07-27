# 0002. Transcript and timeline live sync

**Date**: 2026-07-21
**Status**: In Progress

## Summary

Today the transcript panel and the timeline bar in the Rough Cut editor each watch the same playback clock but otherwise act like two separate tools: selecting text in one does not highlight anything in the other, hovering shows nothing in the other pane, and a few small timing bugs mean the playhead and the highlighted word can drift apart by a fraction of a second. This spec adds shared selection and hover state between the two panels, fixes the known timing drift, and aligns their visual language, so they read and feel like one connected editing surface, closer to Descript's transcript driven editor. No database or API changes are needed; this is entirely client side state and UI work.

## Requirements

**User stories**:
- As an editor, I want selecting or clicking in either the transcript or the timeline to be reflected in the other, so both panels feel like one editing surface instead of two.
- As an editor, I want to hover over a word or a timeline position to preview it, without that preview disrupting playback or auto scroll, so I can scan quickly.
- As an editor, I want the playhead and the highlighted word to stay accurate and never visibly drift apart during playback, so I trust what I see.
- As an editor, I want a consistent look (colors, playhead style, highlight style) between the transcript and the timeline, so the editor reads as one connected tool.

**Acceptance criteria**:
- **AC-1**: Clicking a word in the transcript seeks playback and the timeline playhead to that word's start time (already works today; must keep working unchanged).
- **AC-2**: Clicking or scrubbing the timeline seeks playback and updates the transcript's active word highlight (already works today; must keep working unchanged).
- **AC-3**: Drag selecting a range of words in the transcript highlights the matching time range in the timeline.
- **AC-4**: Selecting or trim dragging a clip or range in the timeline highlights the matching words in the transcript.
- **AC-5**: Hovering a word in the transcript shows a lightweight preview marker at that time on the timeline, without moving the playhead or affecting playback.
- **AC-6**: Hovering a position on the timeline shows a lightweight preview highlight on the matching transcript word, without moving playback.
- **AC-7**: A hover preview never interrupts active playback: while the video is playing, the transcript keeps auto scrolling to follow the real playhead even while a hover preview is shown elsewhere.
- **AC-8**: Any active cross panel selection clears automatically the moment playback starts (play button, spacebar, or a seek that resumes playback).
- **AC-9**: The word/segment boundary mismatch between `sanitizeWords()` clipping and `clampWordCutRange()` padding is reconciled, and cut/restore edits are fixed to a single millisecond rounded time representation, so the playhead, the active word highlight, and the cut boundary agree at the millisecond during normal use.
- **AC-10**: Playhead color, active word highlight color, hover preview color, and selection highlight color are unified (shared tokens) between the transcript panel and the timeline bar.
- **AC-11**: Existing instant text edit propagation (cutting or restoring a word updates both panels immediately) and the existing autosave debounce timing are unchanged by this work.

## Decision

**Chosen option**: Option 1: Extend the existing lifted state pattern.

Add shared hover and cross panel selection state to `dashboard/[id]/page.tsx` alongside the existing `currentTime` state, thread it into `transcript-panel.tsx` and `timeline-bar.tsx` as props and callbacks, and fix the two known timing drift sources in `edl.ts`.

## Feature design

**Data model sketch**:
No persisted data model changes. All new state (hovered time, hovered word index, cross panel selection range) is ephemeral client side UI state, not written to the EDL or the database. The EDL's existing word and segment timing fields are unchanged; only the two drift sources described in AC-9 are corrected in how `edl.ts` computes and rounds them.

**State transitions**:
Cross panel selection: `none` to `active` (user drag selects in either panel) to `none` (playback starts, or the user clicks elsewhere to clear it). Hover preview: `none` to `active` (mouse enters a word or a timeline position) to `none` (mouse leaves); hover never blocks or delays a selection or playback state change.

**API surface**:
None. No new routes, no server changes; this is entirely client side.

**Value sourcing**:
| Action | Value produced or displayed | Source |
|---|---|---|
| Hover a transcript word | Preview marker's time on the timeline | The hovered word's `start` time, already present on the word object in the EDL |
| Hover a timeline position | Preview highlight's target word in the transcript | Computed with the existing `findActiveWordIndex()` binary search (`edl.ts`) against the hovered time |
| Drag select in transcript | Selected time range shown on the timeline | The `start` of the first selected word and the `end` of the last selected word |
| Select or trim a clip in the timeline | Selected word range shown in the transcript | The word indices whose `start`/`end` fall inside the selected clip's time range, via `findActiveWordIndex()` |
| Playback starts | Selection clears | The player's `play` event (already wired for `handleTimeUpdate`) triggers the same clear callback |

**Key invariants**:
- Hover state never changes playback time or the EDL; it is read only preview state.
- Cross panel selection is always expressed as a time range (`start`, `end`) so both panels can derive their own highlight from one shared value, rather than each panel tracking its own word indices or clip ids independently.
- A hover preview never overrides or delays the actively playing position's highlight or auto scroll (AC-7); hover is an additive overlay, never a replacement of the live state.
- Selection state is cleared, never paused or preserved, when playback starts (AC-8); there is no "resume selection" state to reason about.

**Security model**:
Not applicable. All new state is ephemeral, client side, and scoped to a project the user is already authorized to edit (unchanged from today's `authz.ts` gate); nothing new is read from or written to the server.

**Configuration required**:
None.

**Critical test scenarios**:
- Happy path: drag select three words in the transcript, matching timeline range highlights; select a clip in the timeline, matching words highlight in the transcript, verifies **AC-3**, **AC-4**.
- Hover during playback: start playback, hover a different part of the timeline, transcript auto scroll keeps following the real playhead and the hover marker shows without moving playback, verifies **AC-5**, **AC-7**.
- Edge case: select a range in the transcript, press play, selection clears immediately and playback highlight takes over cleanly, verifies **AC-8**.
- Boundary correctness: cut a word, restore it, cut an adjacent word, confirm the transcript highlight, the timeline cut boundary, and the playhead all agree at the millisecond with no visible drift after repeated edits, verifies **AC-9**.
- Regression: cut and restore a word, confirm both panels still update instantly and the autosave debounce timing (800ms, 5s ceiling) is unchanged, verifies **AC-11**.

## Build plan

Read in pre flight: no build approach is recorded in `AGENTS.md` or a scope row for this app. Defaulting to end to end (tracer bullet) slices: each task below lands a complete, working slice of behavior rather than plumbing followed by a separate wiring pass.

1. Add shared hover and selection state (`hoveredTime`, `selectedRange`) to `dashboard/[id]/page.tsx` alongside `currentTime`, threaded as props and callbacks into `transcript-panel.tsx` and `timeline-bar.tsx`. Foundation only, no visible behavior change yet, satisfies **AC-3**, **AC-4**, **AC-8** (enables all three).
2. Wire transcript word hover to publish `hoveredTime`; render the preview marker on the timeline, satisfies **AC-5**, **AC-7**.
3. Wire timeline hover to publish `hoveredTime`; render the preview highlight on the matching transcript word via `findActiveWordIndex()`, satisfies **AC-6**, **AC-7**.
4. Extend the transcript's existing drag select to publish `selectedRange`; render the matching highlight on the timeline, satisfies **AC-3**.
5. Extend the timeline's clip selection and trim drag to publish `selectedRange`; render the matching word highlight in the transcript, satisfies **AC-4**.
6. Clear `selectedRange` on the player's `play` event (covers the play button, spacebar, and a seek that resumes playback), satisfies **AC-8**.
7. Fix the boundary drift: reconcile `sanitizeWords()`'s clipped word edges against `clampWordCutRange()`'s cut padding, and standardize cut/restore time handling in `edl.ts` on one millisecond rounded representation, satisfies **AC-9**.
8. Unify the visual tokens (playhead, active word highlight, hover preview, selection highlight colors) shared between `transcript-panel.tsx` and `timeline-bar.tsx`, satisfies **AC-10**.
9. Regression pass: confirm cut/restore instant propagation and the autosave debounce timing are unaffected by the new shared state, satisfies **AC-11**.

## Consequences

**Positive**:
- The transcript and timeline stop feeling like two separate tools; selection and hover now flow both ways, matching the "equal, tightly synced peers" direction.
- The two known timing drift sources are fixed, so the playhead and highlight stay trustworthy during normal editing.
- No new dependency, no new architectural pattern; the change stays consistent with how `currentTime` already works.

**Negative / tradeoffs**:
- The studio page's prop list grows (two more pieces of shared state passed to two components); still manageable at today's scale but worth watching if a third panel is ever added.
- More shared state means more re renders to reason about; each panel should memoize its own derived highlight computation so hover/selection updates in one panel do not cause unnecessary re-renders in the other.

**Neutral**:
- The timeline's and the transcript's animation frame loops (auto scroll, playhead position) stay independent, they are not being merged into a single shared loop as part of this work; only the underlying time values they read are being corrected (AC-9). Worth revisiting only if profiling later shows visible jank, not before.

## Follow-up

- [x] No scope row in `docs/scope/` currently covers the Rough Cut editor; a "Transcript and Timeline Live Sync" feature row now exists so `/develop` can track this spec's build lifecycle status.
