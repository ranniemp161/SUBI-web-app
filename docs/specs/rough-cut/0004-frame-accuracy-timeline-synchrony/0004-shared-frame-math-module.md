# Shared frame math module

Child spec of [0004. Frame accuracy and timeline synchrony](index.md).

## Summary

The editing screen currently thinks in seconds and milliseconds; export currently thinks in frame numbers at the video's real frame rate. The two only agree today because export happens to re derive its frame numbers from the same millisecond rounded times, with no code actually forcing that agreement. This child adds one small, shared function both sides call, so they can never quietly drift apart.

## Requirements

**User stories**:
- As an editor, I want the frame number export computes for any given time to be the exact same frame number the editing screen would compute for that time, so a change to one side cannot silently break the other.

**Acceptance criteria**:
- **AC-1**: A new `src/lib/frame-math.ts` exports `msToFrame(ms: number, fps: number): number` and `frameToMs(frame: number, fps: number): number`, using the same rounding rule the export path uses today (round to nearest frame, matching `timebase.ts`'s existing `toFrames` behavior).
- **AC-2**: `src/lib/export/timebase.ts`'s existing `toFrames` (and any equivalent frame conversion in `fcpxml.ts`, `cmx3600.ts`, `xmeml.ts`) is replaced with a call into `frame-math.ts`, not duplicated. Every existing export test that exercises frame numbers still passes unchanged.
- **AC-3**: The database stays the source of truth in milliseconds; this module adds no migration, no new persisted column, and no change to how `edl.ts`'s `roundMs` stores cut and word boundaries. `msToFrame`/`frameToMs` are pure, stateless functions with no side effect.
- **AC-4**: `frame-math.ts` has direct unit tests covering: a millisecond time that falls exactly on a frame boundary, one that falls between two frames (confirms the rounding direction), and the round trip `frameToMs(msToFrame(ms, fps), fps)` staying within one frame's duration of the original `ms` at a range of common frame rates (23.976, 24, 25, 29.97, 30, 50, 59.94, 60).

## Decision

**Chosen option**: Extract the existing `toFrames` rounding logic out of `timebase.ts` into a new, general purpose `src/lib/frame-math.ts`, and have every other frame conversion in the app (present and future) import from there. `timebase.ts` keeps re exporting `toFrames` under its current name so no export call site needs to change, it just now delegates.

Milliseconds remain the one stored, canonical format in `packages/db`; this module is purely a computation layer that both the live editing path (which will start calling it, see the filmstrip/waveform and frame stepping children) and the export path convert through, so the two can never independently reinvent the rounding rule.

## Feature design

**Data model sketch**: None. No schema change; this touches only in memory computation.

**API surface**: None. No new route; a pure client side module.

**Value sourcing**:
| Action | Value produced | Source |
|---|---|---|
| Convert a stored millisecond time to a frame number | The frame number | `msToFrame(ms, fps)`, where `fps` is the already existing `sourceFps` state (`page.tsx`, from `detectVideoFps`) |
| Convert a frame number back to milliseconds | The millisecond time | `frameToMs(frame, fps)`, same `fps` source |

**Key invariants**:
- `msToFrame` and `frameToMs` are pure and stateless: same inputs always produce the same output, no reference to `Date.now()`, no reference to component state.
- There is exactly one rounding rule for millisecond to frame conversion in the codebase; no file outside `frame-math.ts` implements its own.

**Critical test scenarios**:
- Happy path: a known millisecond time at 30fps converts to the frame number a professional editor would compute for the same source, verifies **AC-1**.
- Regression: the full existing export test suite (`fcpxml.ts`, `cmx3600.ts`, `xmeml.ts`, `timebase.ts` tests) passes unchanged after the extraction, verifies **AC-2**.
- Round trip: `frameToMs(msToFrame(ms, fps), fps)` stays within one frame's duration of `ms` across the standard frame rate list, verifies **AC-4**.

## Build plan

1. [x] Create `src/lib/frame-math.ts` with `msToFrame`/`frameToMs` (plus `secondsToFrame`/`frameToSeconds`/`frameDurationSeconds`), moving `timebase.ts`'s existing rounding logic in, satisfies **AC-1**.
2. [x] Update `timebase.ts` (`toFrames` now delegates to `secondsToFrame`); the NLE export files already compute frames only through `toFrames`, so none duplicated the rounding, satisfies **AC-2**.
3. [x] Add the unit tests described in AC-4 (`frame-math.test.ts`), satisfies **AC-4**.
4. [x] Confirm no database or persisted format changes were introduced (pure computation module, ms stays the stored unit), satisfies **AC-3**.

Built as `VideoFps` rationals (the codebase's real frame-rate type) rather than a plain `fps: number`, so NTSC rates like 29.97 stay exact; this strengthens AC-1/AC-4 rather than weakening them.

## Consequences

**Positive**: One rounding rule, one place, used everywhere; removes the "agree by construction" fragility `timebase.ts`'s own comment already flagged.

**Negative / tradeoffs**: A small refactor risk to already shipped, tested export code; mitigated by AC-2's requirement that the existing export test suite passes unchanged.

**Rationale**: See the umbrella [rationale.md](rationale.md); this child implements Option 1's foundation step.
