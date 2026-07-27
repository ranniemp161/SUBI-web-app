# 0004. Frame accuracy and timeline synchrony — rationale

## Context

Specs 0002 and 0003 already closed the two known drift bugs between the transcript panel and the timeline bar (word boundary versus cut padding mismatch, mixed rounding), and added client side re alignment of the transcription vendor's word timestamps against the real decoded audio. This decision is proactive quality work, not a response to a reported bug: with those two closed, a code map of the remaining time handling in `apps/rough-cut` turned up four further gaps that were never in scope for 0002 or 0003.

A code map of `src/components/video-player.tsx`, `src/components/timeline-bar.tsx`, `src/lib/edl.ts`, `src/lib/export/timebase.ts`, and `src/lib/detect-frame-rate.ts` found:

1. **No frame accurate seeking anywhere.** `video.currentTime = seconds` is spec approximate, not frame exact. `requestVideoFrameCallback` is used nowhere in `src/`. The existing `SEEK_QUANTIZATION_EPS` constant (`video-player.tsx:34`) only compensates for sub frame readback drift on a seek's exact target, not for landing on a chosen frame boundary.
2. **Two independently rounding systems, agreeing only "by construction."** The live editing and EDL path rounds to milliseconds (`roundMs`, `edl.ts:154`). The export path converts to frame numbers at the *detected* source frame rate (`toFrames`, `timebase.ts:76`). `timebase.ts`'s own comment (`:6`) says the two agree today only because export re derives frames from the same millisecond rounded seconds; there is no single shared function, so a future change to either path's rounding is not guaranteed to keep them agreeing.
3. **A silent 30 frames per second export fallback.** `page.tsx:1371` already carries a comment acknowledging this: whenever no source file is currently reselected in the session, export math falls back to `DEFAULT_FPS` (30), which a strict professional tool's relink (for example DaVinci Resolve's Media Pool) may reject. Acknowledged, never resolved.
4. **Filmstrip and waveform decode on their own time base.** Both align to the same pixels per second scale as the playhead, but each is drawn from its own independently decoded duration, never cross checked against the detected frame rate or against each other.

The forces at play: this is a browser only video editor with no server side video processing (`LIMITATIONS.md`), so every one of these gaps is a client side, in browser computation problem, not a backend one. The existing `sourceFps` detection (`detect-frame-rate.ts`) already exists and already feeds the export path; nothing here needs a new detection mechanism. The database stores word and cut timestamps in milliseconds and has no persisted frame rate column, set before a user ever reselects their source video, which rules out frame numbers as the *stored* format (see the shared frame math module's own rationale for why).

## Options considered

### Option 1: Close all four gaps as one coordinated slice

Design all four as related child decisions under one umbrella spec, built foundation first (shared frame math module, then the three things that depend on it or sit alongside it).

**Pros**:
- The three later children (fps guard, filmstrip and waveform, frame stepping) all either read the frame math module or read the same `sourceFps` state; deciding them together keeps that contract consistent from the start instead of three separate specs each guessing at how the others work.
- One spec, one confirmation round with the engineer, rather than four separate `/architect` runs covering overlapping code.

**Cons**:
- A larger single design conversation and a larger spec to review at once, even though each child stays independently buildable.

### Option 2: Four separate specs, one per gap

Run `/architect` four times, once per gap, each fully independent.

**Pros**:
- Each spec stays smaller and simpler to review in isolation.

**Cons**:
- Three of the four gaps (export fps guard, filmstrip and waveform, frame stepping) all need the same shared frame math module; deciding them separately risks each spec inventing its own version of that conversion function, recreating the exact "two systems that only agree by construction" problem this work exists to close.

### Option 3: Only the shared frame math module now, defer the rest

Close gap 2 alone (the highest leverage, lowest risk fix) and leave frame stepping, the fps guard, and the filmstrip and waveform alignment for a later decision.

**Pros**:
- Smallest possible first slice; lowest risk.

**Cons**:
- The engineer explicitly chose all four gaps as in scope for this decision (proactive quality work, not urgent), so deferring three of them would not match what was asked for; the fps guard and frame stepping in particular are both small, contained, and already fully diagnosed, no reason to hold them back.

## Rationale

Option 1 was chosen. The engineer selected all four gaps as in scope in the same conversation, and three of the four structurally depend on the same shared conversion function, so specifying them apart (Option 2) risks exactly the kind of divergence this work sets out to remove. Option 3 under delivers against what was actually asked for. Sequencing foundation first (the frame math module, then its dependents) follows both the project's Tracer Bullet default (`AGENTS.md`) and the plain dependency order: child 3 and child 4 call what child 1 introduces.

## References

None. The engineer opted out of a References section for this spec; the reasoning above is the complete record.
