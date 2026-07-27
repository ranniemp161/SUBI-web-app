# Filmstrip and waveform shared timebase

Child spec of [0004. Frame accuracy and timeline synchrony](index.md).

## Summary

The timeline's filmstrip (thumbnail strip) and waveform each decode the source video independently and position themselves using their own decoded duration. They line up with the playhead visually today only because nothing has yet caused them to disagree. This child makes them compute their placement from the same detected frame rate and duration the playhead and export already use, closing that gap before it causes a visible drift.

## Requirements

**User stories**:
- As an editor, I want the filmstrip and waveform to always agree with the playhead and the transcript about where a given moment falls, so nothing on screen ever looks slightly off.

**Acceptance criteria**:
- **AC-8**: `extractFilmstrip` (`src/lib/thumbnails.ts`) and `extractWaveform` (`src/lib/waveform.ts`) compute their pixel placement (`pxPerSec`, thumbnail and sample positions) from the same shared duration and `sourceFps` the playhead and export already use, not from their own independently decoded duration.
- **AC-9**: If a filmstrip's or waveform's own decoded duration ever disagrees with the shared duration by more than one frame's length (at the detected `sourceFps`), the shared duration wins for positioning; the disagreement does not silently reintroduce drift.
- **AC-10**: No visible regression to filmstrip or waveform rendering for the existing, already correct case (source file reselected, decode succeeds, durations agree).

## Decision

**Chosen option**: Change `extractFilmstrip` and `extractWaveform` to accept the shared duration and `sourceFps` as parameters and derive their pixel placement from those, instead of from `video.duration` or their own decode's sample count, using the shared `frame-math.ts` module (child 1) for any millisecond to frame conversion they need.

## Feature design

**Data model sketch**: None. No schema change; this is a client side rendering computation change.

**API surface**: None.

**Value sourcing**:
| Action | Value produced | Source |
|---|---|---|
| Position a filmstrip thumbnail or waveform sample on the timeline | Its pixel x position | The shared duration and `sourceFps` (already available as `page.tsx` state, the same values the playhead and export read), converted with `frame-math.ts` where a frame number is needed |

**Key invariants**:
- Filmstrip, waveform, playhead, and export all derive pixel or frame placement from the same duration and frame rate source; no component keeps a second, independently decoded notion of "how long is this video."

**Critical test scenarios**:
- Happy path: reselect a source file, filmstrip and waveform render aligned with the playhead at several scroll and zoom levels, verifies **AC-8**, **AC-10**.
- Edge case: a filmstrip or waveform decode that reports a duration slightly different from the shared duration still positions correctly using the shared value, verifies **AC-9**.

## Build plan

1. [x] Map the filmstrip and waveform draws against the shared timeline duration (`totalDuration(edl)`) rather than each decode's own `.duration`. The positioning lives in `timeline-bar.tsx`'s draw effects (the consumer), not in `extractFilmstrip`/`extractWaveform`, so the extractors were left unchanged and a `positioningDuration()` helper does the reconciliation, satisfies **AC-8**.
2. [x] Add the reconciliation rule (`positioningDuration` always prefers the shared duration) plus a dev-only warning, sized to one frame at the threaded `sourceFps`, when a decode's own length drifts beyond a frame, satisfies **AC-9**.
3. [x] Correct case unchanged (decoded == shared makes the mapping identical); existing timeline-bar tests still pass, satisfies **AC-10**.

Implementation note: the fix landed in `timeline-bar.tsx` (where positioning happens) plus `sourceFps` threading through `page.tsx`, not in `thumbnails.ts`/`waveform.ts` as originally sketched.

## Consequences

**Positive**: Removes a theoretical drift source before it becomes a visible bug; every visual element on the timeline now agrees on one time base.

**Negative / tradeoffs**: A small amount of additional coupling, `thumbnails.ts` and `waveform.ts` now depend on `page.tsx` state they did not need before; acceptable, the alternative is the drift risk this child exists to close.

**Rationale**: See the umbrella [rationale.md](rationale.md).
