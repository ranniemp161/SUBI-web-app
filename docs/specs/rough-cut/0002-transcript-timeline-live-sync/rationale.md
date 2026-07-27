# 0002. Transcript and timeline live sync — rationale

## Context

The transcript panel (`transcript-panel.tsx`) and the timeline bar (`timeline-bar.tsx`) both receive `currentTime` as a prop from the studio page (`dashboard/[id]/page.tsx`) and independently compute what to highlight or where to draw the playhead. This keeps playback position in sync, but every other piece of interaction state (which word or range is selected, what the user is hovering) lives locally inside each component and is never shared. A user who drags to select three words in the transcript sees no matching highlight on the timeline; a user who selects or trims a clip on the timeline sees no matching highlight in the transcript. Clicking either pane does seek playback, but that is currently the only link between them.

Two smaller correctness gaps compound the disconnected feeling. First, the word timestamps the transcript highlights against are clipped by `sanitizeWords()` while the cut range a deletion produces is padded by a separate constant (`WORD_CUT_PAD_SECONDS`), so the transcript's idea of a word's boundary and the timeline's idea of the same cut's boundary can be a few milliseconds apart. Second, times are rounded to milliseconds in some places (`clampWordCutRange`) but kept as raw floats elsewhere, so repeated cut and restore actions can accumulate tiny rounding drift. Neither is visible as a single glaring bug, but both work against the "frame accurate" feel the product wants.

The team wants the two panels to behave as equal, tightly synced peers (not one becoming the primary editing surface and the other secondary), while keeping today's layout: transcript panel and timeline bar stay where they are, restyled for visual cohesion rather than merged into a single surface.

## Options considered

### Option 1: Extend the existing lifted state pattern

Add the new shared state (hover position, cross panel selection) as more lifted state in the studio page, following the same pattern already used for `currentTime`: state lives in `dashboard/[id]/page.tsx`, flows down as props, and change handlers flow up as callbacks. No new dependency, no new architectural concept.

**Pros**:
- Consistent with the pattern the codebase already uses successfully for playback time.
- No new dependency to learn, install, or maintain.
- Small, incremental, easy to review and roll back a piece at a time.

**Cons**:
- Prop lists on the studio page and its two child components grow a bit; still manageable at the current size of the page (two consumers), but would not scale gracefully to a third or fourth panel needing the same state.

### Option 2: Introduce a dedicated client state store (e.g. Zustand or a React context)

Move playback time, hover, and selection into a small dedicated store both panels subscribe to directly, bypassing prop drilling entirely.

**Pros**:
- Removes prop drilling; either panel could grow independently without touching the page component.
- A natural fit if a third consumer of this state appears later (e.g. a future waveform panel).

**Cons**:
- New dependency and a new pattern the codebase does not use anywhere else today (no Zustand, Redux, or state library is currently installed).
- Bigger surface to test and reason about for a feature that currently has exactly two consumers.
- Not justified by today's scale; the "boring technology" bar is not met yet.

### Option 3: Merge transcript and timeline into a single unified component

Rebuild the two panels as one component (Descript style: a waveform woven directly into the transcript, no separate timeline bar).

**Pros**:
- Removes the sync problem structurally: there is only one source of state because there is only one component.

**Cons**:
- Directly contradicts the confirmed direction (keep the current layout, restyle for cohesion, keep both panels as equal peers rather than merging them).
- Large rewrite risk for a live product; the strangler pattern would still be needed to ship it safely, which is a much bigger effort than the sync problem requires.

## Rationale

The project has exactly two consumers of this shared state today (the transcript panel and the timeline bar), and the existing `currentTime` prop already proves the lifted state pattern works for exactly this kind of cross panel sync. Reaching for a state library before there is a third consumer, or any measured problem with prop drilling, would be exactly the kind of premature infrastructure the project's own conventions warn against. If a future panel (a waveform view, a speaker track) needs the same state, that is the point to revisit Option 2, not before.

The engineer was explicit that the two panels should stay equal, tightly synced peers rather than one becoming primary, which rules out Option 3's structural merge outright regardless of its technical appeal.
