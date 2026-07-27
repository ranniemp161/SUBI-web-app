# Export fps reselect guard

Child spec of [0004. Frame accuracy and timeline synchrony](index.md).

## Summary

Export needs to know the real frame rate of the source video to compute correct frame numbers, but the app only learns that frame rate when the user reselects their source file (the video itself is never stored on the server). If a project has not been reselected yet in the current session, export today silently falls back to a guessed 30 frames per second, a gap the code already flags but never closes. This child stops that silent guess: export is disabled until the real frame rate is known.

## Requirements

**User stories**:
- As an editor, I want export to refuse to run rather than guess a frame rate, so I never hand a professional editing tool a file with the wrong frame numbers.

**Acceptance criteria**:
- **AC-5**: The export action (in `export-modal.tsx` and wherever else export is triggered) is disabled, with a visible explanatory message, whenever `sourceFps` is not yet known (the source file has not been reselected this session).
- **AC-6**: The explanatory message tells the editor exactly what to do (reselect their source file) and disappears the moment `sourceFps` becomes known, with no page reload needed.
- **AC-7**: `DEFAULT_FPS` (`timebase.ts`) is no longer read as an export time fallback; it may remain in the file only if still needed elsewhere (for example as a constant referenced by tests), but no export code path silently substitutes it for a missing `sourceFps`.

## Decision

**Chosen option**: Gate the export action itself on `sourceFps` being known, the same way the app already gates the automatic cut chain on `sourceFile !== null` (ADR 0004), rather than letting export run at a guessed frame rate with only a warning.

This keeps one consistent rule in the app: no frame precise action runs before the source file has been reselected and its frame rate detected. It also matches the reselect gated pipeline pattern this app already uses elsewhere (ADR 0004), so it is not a new mental model for the codebase.

## Feature design

**Data model sketch**: None. `sourceFps` is already client side session state (`page.tsx`); this child adds no new field.

**State transitions**: Export action: `disabled` (no `sourceFps` yet) to `enabled` (source file reselected, `detectVideoFps` resolved) to `disabled` again only if the project is reloaded and not yet reselected in this session.

**API surface**: None. No new route; this is a client side UI gate.

**Value sourcing**:
| Action | Value produced | Source |
|---|---|---|
| Decide whether export is enabled | Boolean gate | `sourceFps !== null` (`page.tsx`, already set by `detectVideoFps`) |
| Explanatory message when disabled | The message text | A fixed string naming the required action (reselect source file); no dynamic value needed |

**Key invariants**:
- No export ever runs with a frame rate that was not actually detected from the current source file.
- The gate reads existing state (`sourceFps`); it introduces no new detection mechanism.

**Critical test scenarios**:
- Happy path: reselect the source file, `sourceFps` resolves, the export action becomes enabled with no reload, verifies **AC-5**, **AC-6**.
- Edge case: open a returning project before reselecting, confirm the export action is disabled and the message is visible, verifies **AC-5**.
- Regression: no export code path still reads `DEFAULT_FPS` as a live fallback, verifies **AC-7**.

## Build plan

1. [x] Add the `sourceFps` gate to the interchange export's `exportFormatBlockedReason` and render the explanatory message as visible text in the export modal, satisfies **AC-5**, **AC-6**.
2. [x] Remove the `DEFAULT_FPS` fallback from every export time computation path (each handler guards on `sourceFps` and uses it directly; the timecode-offset detection also no longer falls back to `DEFAULT_FPS`), satisfies **AC-7**.
3. [x] Confirm the happy path still exports with the fps mock; the fps-unknown blocked state is a real-browser verify step (jsdom has no WebCodecs so MP4 is always blocked, disabling the whole Export button), satisfies **AC-5**, **AC-6**, **AC-7**.

## Consequences

**Positive**: Export can no longer silently produce a file at the wrong frame rate; closes an already acknowledged, previously unresolved gap (`page.tsx:1371`).

**Negative / tradeoffs**: A returning editor who wants to export a project they have not reselected yet in this session must reselect first, one extra required step in that specific case; this already matches how cutting and AI polish behave in the app (ADR 0004), so it is a consistent rule, not a new kind of friction.

**Rationale**: See the umbrella [rationale.md](rationale.md).
