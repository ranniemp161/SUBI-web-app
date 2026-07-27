# Frame accurate step controls

Child spec of [0004. Frame accuracy and timeline synchrony](index.md).

## Summary

Today there is no way to move exactly one video frame forward or back; the closest shortcut nudges by a fixed 0.1 seconds, which is not one frame on most sources. This child adds real frame stepping, confirmed against the browser's own frame callback so a step provably lands on a decoded frame rather than an approximate time, and repurposes the existing `,`/`.` shortcut to mean it.

## Requirements

**User stories**:
- As an editor, I want to step exactly one frame forward or back, so I can place a cut precisely instead of guessing with an approximate nudge.

**Acceptance criteria**:
- **AC-11**: New step forward and step back one frame controls exist, reachable from the player controls and from the `,` (back) and `.` (forward) keyboard shortcuts, replacing today's 0.1 second nudge on those same keys. `shortcuts-overlay.tsx`'s listed shortcut for `,`/`.` is updated to say "Step 1 frame."
- **AC-12**: A frame step computes its target time using `frame-math.ts` (child 1) and the detected `sourceFps`, seeking the video to that exact frame; where the browser supports `requestVideoFrameCallback`, the step confirms the video actually presented that frame before the app treats the seek as settled.
- **AC-13**: A frame step moves through the real, underlying source video, ignoring cut ranges; it never jumps over a cut the way normal playback does.
- **AC-14**: The frame step controls are disabled until `sourceFps` is known (source file reselected this session), matching the export gate (see the export fps reselect guard child).
- **AC-15**: On a browser without `requestVideoFrameCallback`, frame stepping still works, falling back to today's seek and `currentTime` read with no error and no crash; only the frame exact confirmation is unavailable, not the feature itself.
- **AC-16**: Continuous playback (the existing `requestAnimationFrame` driven sync loop in `video-player.tsx`, including its EDL cut skipping) is unchanged by this work; `requestVideoFrameCallback` is used only around a frame step's seek, never as a replacement for the playback loop.

## Decision

**Chosen option**: Add frame stepping as a narrow, additive use of `requestVideoFrameCallback`, confirming only the seek target of a step, while leaving the existing `requestAnimationFrame` based continuous playback loop in `video-player.tsx` untouched.

The alternative, replacing the whole playback loop with an `requestVideoFrameCallback` driven one, would mean re implementing the EDL cut skipping logic that loop already handles correctly and that spec 0002 already shipped and verified, for a benefit (frame exactness during continuous playback, not just on a step) the engineer did not ask for. The narrow approach delivers the actual requested capability, frame accurate stepping, at much lower risk to already working, shipped code.

## Feature design

**Data model sketch**: None. No schema change; ephemeral client side player state only.

**State transitions**: Frame step control: `disabled` (no `sourceFps`) to `enabled` (source reselected). A step itself: `seeking` (video.currentTime set to the target frame's time) to `confirmed` (the next `requestVideoFrameCallback` fires and reports the presented frame matches, or, without browser support, the seek is treated as settled once `currentTime` reads back close enough) to idle.

**API surface**: None. No new route.

**Value sourcing**:
| Action | Value produced | Source |
|---|---|---|
| Step one frame forward or back | The target seek time | `frameToMs(msToFrame(currentTimeMs, sourceFps) ± 1, sourceFps)` (`frame-math.ts`, child 1) |
| Confirm a step landed on the right frame | Confirmation state | `requestVideoFrameCallback`'s reported `mediaTime`, compared to the target; falls back to a plain `currentTime` read when unsupported |
| Decide whether frame step controls are enabled | Boolean gate | `sourceFps !== null`, the same value the export fps reselect guard child reads |

**Key invariants**:
- A frame step always targets a real frame boundary of the source video's detected frame rate, computed through `frame-math.ts`, never a raw arithmetic guess.
- Frame stepping never skips a cut range; it steps the underlying source video 1:1.
- The continuous playback loop's existing behavior (rate, EDL cut skipping, drift corrections already shipped in spec 0002) is not modified by this child.

**Security model**: Not applicable. No new data access; reuses the project's existing `authz.ts` gate implicitly (the editor is already authorized to be viewing this project).

**Configuration required**: None.

**Critical test scenarios**:
- Happy path: with a source reselected, press `.` repeatedly, confirm the player advances exactly one frame at a time at the detected frame rate, verifies **AC-11**, **AC-12**.
- Cut boundary: frame step across a cut range, confirm it steps into the cut range rather than skipping it, verifies **AC-13**.
- Pre reselect: on a returning, not yet reselected project, confirm frame step controls are disabled, verifies **AC-14**.
- Fallback: simulate no `requestVideoFrameCallback` support, confirm frame stepping still works via the plain seek fallback, verifies **AC-15**.
- Regression: play a project with cuts end to end, confirm playback timing and cut skipping behave exactly as before this change, verifies **AC-16**.

## Build plan

1. [x] Add a `stepFrame(direction, fps)` method to the player (`video-player.tsx`) using `frame-math.ts` for the target frame, gated on `sourceFps` via `stepOneFrame` in `page.tsx`, satisfies **AC-11**, **AC-12**, **AC-14**.
2. [x] Wire step-back/step-forward buttons flanking Play in the transport bar (disabled until `sourceFps` known) and repurpose the `,`/`.` shortcuts, updating both `shortcuts-overlay.tsx` and the inline `page.tsx` shortcut list, satisfies **AC-11**.
3. [x] Add the `requestVideoFrameCallback` confirmation around a step's seek, with feature detection and a plain-seek fallback, satisfies **AC-12**, **AC-15**.
4. [x] Suppress the playback cut-skip during a frame step (`steppingRef`) so a step lands on the real source frame even inside a cut; unit tested, satisfies **AC-13**.
5. [x] Continuous playback loop untouched (`steppingRef` cleared on play); existing video-player/page tests still pass, satisfies **AC-16**.

## Consequences

**Positive**: Editors get a real, provably accurate frame stepping tool; the confirmation step removes the guesswork `SEEK_QUANTIZATION_EPS` currently papers over for this specific action.

**Negative / tradeoffs**: Repurposing `,`/`.` changes existing muscle memory from a 0.1 second nudge to a (usually smaller) one frame step; the feature is unavailable until a source file is reselected in the session, same limitation the export guard already imposes elsewhere; on the rare browser without `requestVideoFrameCallback`, the "provably accurate" guarantee degrades to best effort.

**Rationale**: See the umbrella [rationale.md](rationale.md).
