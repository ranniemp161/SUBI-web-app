# 0004. Frame accuracy and timeline synchrony

**Date**: 2026-07-24
**Status**: In Progress

## Structure

This is an umbrella decision made of four related child specs, ordered the way they should be built (each stands on its own, but B and C both call the module A introduces):

1. [0004-shared-frame-math-module.md](0004-shared-frame-math-module.md): one shared function both the live editing path and the export path call to turn a time in milliseconds into a frame number. Foundation for C and D.
2. [0004-export-fps-reselect-guard.md](0004-export-fps-reselect-guard.md): stops export from silently running at a guessed 30 frames per second when the real source file has not been reselected this session.
3. [0004-filmstrip-waveform-timebase.md](0004-filmstrip-waveform-timebase.md): makes the filmstrip and waveform strips line their pixels up using the same detected frame rate as the playhead and export, instead of their own decoded length.
4. [0004-frame-accurate-step-controls.md](0004-frame-accurate-step-controls.md): new step one frame forward and back controls, built on the browser's frame callback API so a step lands on a real decoded frame instead of an approximate time.

## Summary

Today, the Rough Cut editor's playhead, its transcript highlight, and its exported cut list each compute time slightly differently: the editing screen works in seconds and milliseconds, export works in frame numbers at whatever frame rate the source video turned out to be, and nothing ever asks the video itself to confirm it actually reached a specific frame. Specs 0002 and 0003 already closed the two known drift bugs between the transcript and the timeline. This decision closes four further gaps: one shared function so the two time systems can never quietly disagree again, a guard so export never silently uses a wrong frame rate, matching the filmstrip and waveform strips to that same frame rate, and new frame by frame stepping controls that are provably accurate rather than approximate. No server or database changes; everything here is client side, in the browser.

## Requirements

**User stories**:
- As an editor, I want the time the app shows me during editing to be the same time export actually cuts at, so what I see is what I get.
- As an editor, I want to step through my footage one exact frame at a time, so I can place a cut precisely instead of guessing.
- As an editor, I want export to refuse to guess a frame rate it does not actually know, so I never ship a file a professional editing tool rejects.
- As an editor, I want the filmstrip and waveform strips to line up with the playhead and the transcript, so nothing on screen looks slightly off.

**Acceptance criteria** (the full set; each child spec below repeats only the criteria it owns):
- **AC-1** to **AC-4**: see [0004-shared-frame-math-module.md](0004-shared-frame-math-module.md)
- **AC-5** to **AC-7**: see [0004-export-fps-reselect-guard.md](0004-export-fps-reselect-guard.md)
- **AC-8** to **AC-10**: see [0004-filmstrip-waveform-timebase.md](0004-filmstrip-waveform-timebase.md)
- **AC-11** to **AC-16**: see [0004-frame-accurate-step-controls.md](0004-frame-accurate-step-controls.md)

## Decision

**Chosen option**: Option 1: Close all four gaps as one coordinated slice, foundation first (see [rationale.md](rationale.md) for the alternatives weighed).

Build the shared frame math module first (child 1), since the export fps guard, the filmstrip and waveform fix, and the frame step controls all read from it. Milliseconds stay the one stored format in the database; nothing here changes what `packages/db` persists. The module is purely a computation layer, converting a millisecond time to a frame number at a given frame rate the same way everywhere it is used.

## Cross child contract

Every child below calls one shared function, added in child 1: `msToFrame(ms: number, fps: number): number`, plus its inverse `frameToMs(frame: number, fps: number): number`, living in a new `src/lib/frame-math.ts` alongside the existing `src/lib/export/timebase.ts` (whose `toFrames` logic moves here so both the live and export paths import the same code; `timebase.ts` re-exports it so the export call sites do not change). No child may add its own separate rounding logic. Every child that needs an frames per second value reads it from the already existing `sourceFps` state (`page.tsx`, set by `detectVideoFps` on reselect); none of these children add a second source of frame rate.

## Build plan

Read in pre flight: this app's default build approach is Tracer Bullet, vertical slices built end to end through every layer, working (`AGENTS.md`, set by `/roadmap`). Each child below is already a complete, working, end to end slice; building them foundation first is both the Tracer Bullet reading and the plain dependency order (B and C call what A introduces).

1. [x] Build child 1, the shared frame math module (`AC-1` to `AC-4`). No visible change to the app yet; this only moves and generalizes existing math so both paths share it.
2. [x] Build child 2, the export fps reselect guard (`AC-5` to `AC-7`). Small, independent, immediately closes an already acknowledged gap (`page.tsx:1371`).
3. [x] Build child 3, filmstrip and waveform shared timebase (`AC-8` to `AC-10`). Depends on child 1's module.
4. [x] Build child 4, frame accurate step controls (`AC-11` to `AC-16`). Depends on child 1's module; the largest slice, touching `video-player.tsx`'s playback loop and the keyboard shortcuts.

## Consequences

**Positive**:
- One place (`frame-math.ts`) now owns every millisecond to frame conversion in the app; a future change to rounding rules cannot silently desync the live path from the export path the way it theoretically could today.
- Export can no longer produce a file at a silently wrong frame rate.
- The filmstrip, the waveform, the playhead, and the transcript highlight all agree on the same frame rate.
- Editors get a real, provably accurate frame stepping tool, closer to a professional NLE.

**Negative / tradeoffs**:
- The frame step controls repurpose the existing `,` and `.` shortcuts (today a 0.1 second nudge) to mean exactly one frame instead; any editor relying on the old 0.1 second behavior gets a different, usually smaller, step.
- Frame accurate stepping is only available once a source file is reselected in the session (frame rate must be known); before that it stays disabled, same as export.
- `requestVideoFrameCallback` is used narrowly, only to confirm a seek landed on the target frame; continuous playback keeps using today's `requestAnimationFrame` loop unchanged, so this does not make every moment of playback frame exact, only step actions.
- On a browser without `requestVideoFrameCallback` (rare today), frame step controls fall back to the current approximate seek, so the "exact frame" guarantee is best effort, not universal.

**Neutral**:
- No database schema change and no data migration; the shared frame math module is a pure computation layer over the existing millisecond stored times.

## Follow-up

- [ ] No scope row in `docs/scope/rough-cut/scope.md` currently covers this decision; recommend enrolling a "Frame Accuracy and Timeline Synchrony" feature row so `/develop` can track this spec's build lifecycle, the same way spec 0002 got one.

## Rationale

Reasoning, the options weighed for tackling all four gaps together versus separately, and the evidence gathered while mapping the existing code: see [rationale.md](rationale.md).
