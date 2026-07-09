# Child 4 — Transcript and Frame Accuracy

## Summary

Two accuracy improvements to the transcription pipeline. On the recognition side, add `utterances: true` to the Deepgram request so the cut-suggestion logic sees phrase and sentence boundaries. On the timing side, snap every word timestamp to a 1/30s (33.33 ms) grid inside `normalizeDeepgram`, so seek, cut boundaries, and export all read frame-aligned values instead of raw sub-frame floats. The 1/30s snap is a heuristic, not true per-video fps detection, and its one honest limitation is named below.

## Context

**Deepgram request options today** (`apps/rough-cut/src/app/api/transcribe/deepgram/route.ts:190-197`): `model: "nova-3"`, `smart_format: "true"`, `punctuate: "true"`, `filler_words: "true"`. `utterances` is not passed. The app is a rough-cut editor whose cut suggestions target silences, retakes, and filler words, driven by word-level timestamps.

**Timing today**: `normalizeDeepgram` (`apps/rough-cut/src/lib/deepgram.ts:49-64`) passes Deepgram's raw float `start`/`end` seconds straight through (lines 52-57). There is no fps-aware rounding anywhere in the pipeline. The only nearby `Math.round` calls are for pixel-width thumbnail drawing (`timeline-bar.tsx:329`) and ms conversion in the file picker (`file-picker.tsx:58`), neither related to seek or frame snapping. So seek targets and EDL cut boundaries carry sub-frame floats, which can land a cut or a seek between frames and read as slightly off.

## Options considered

### Deepgram options

**Option A — Add `utterances: true`, nothing else (chosen).**
`utterances` groups words into natural spoken segments (pauses, sentence ends). Pros: gives the cut logic phrase and sentence boundaries to align retake and silence detection to, which is exactly the signal a rough cut wants; small request change, no cost model surprise. Cons: adds a section to the response the normalizer must choose whether to consume; grouping is heuristic and will not always match a human's idea of a sentence.

**Option B — Add diarization (`diarize: true`).**
Pros: speaker labels. Cons: this is a single-source rough-cut editor, not a multi-speaker meeting transcriber; the cut logic keys off silence, retakes, and fillers, not who is speaking. Diarization adds processing and response weight for a signal the feature does not use. Deferred.

**Option C — Add `paragraphs: true`.**
Pros: paragraph grouping. Cons: overlaps with what `utterances` already gives for this use, and `smart_format` already handles formatting; adding paragraphs on top is redundant weight. Deferred.

### Frame snap point

**Option D — Snap inside `normalizeDeepgram` (chosen).**
Round each word's `start`/`end` to the nearest 1/30s at normalization time. Pros: every downstream consumer (seek, EDL cut boundaries, export) sees frame-aligned values from a single point, so there is one place to reason about and no consumer can forget to snap. Cons: it bakes the 30fps assumption into stored transcript data, so a later change of grid means re-normalizing (acceptable, transcript re-fetch already exists).

**Option E — Snap ad hoc at each call site (seek, cut, export).**
Pros: keeps stored data as raw Deepgram floats. Cons: every current and future consumer must remember to snap, and any that forgets reintroduces the bug; three-plus places to keep in sync. Rejected.

## Decision

**Deepgram**: add `utterances: true` to the request (`route.ts:190-197`). Do not add diarization or paragraphs. The cut-suggestion logic consumes utterance boundaries to align phrase/sentence grouping; word-level timestamps remain the primary driver.

**Frame snap**: apply the snap in `normalizeDeepgram` (`deepgram.ts:52-57`), mapping each word's `start` and `end` through a snap to the nearest 30fps frame:

```
const FPS = 30;
const snap = (seconds: number) => Math.round(seconds * FPS) / FPS;
// start: snap(w.start), end: snap(w.end)
```

Snapping at normalization means seek targets, EDL cut boundaries, and export all inherit frame-aligned values with no per-call-site work. Raw Deepgram floats are never surfaced downstream.

## Rationale

`utterances` is the one added option that feeds the actual feature: a rough cut wants to cut at natural phrase and sentence boundaries, and utterance grouping gives that directly. Diarization and paragraphs add response and processing weight for signals this single-source, silence-and-retake-driven editor does not consume, so they are deferred rather than silently dropped.

Snapping in `normalizeDeepgram` puts frame alignment at the single chokepoint every consumer already flows through, which is the difference between "aligned everywhere by construction" and "aligned wherever someone remembered". It also matches how the pipeline is documented: one normalizer producing the editor-ready shape for both the sync and callback paths.

The 1/30s grid is a heuristic, and this is stated plainly rather than sold as a complete fix. Most consumer video is 24, 25, or 30 fps, so a 30fps grid aligns the large majority of sources to within a real frame. The honest limitation: a 60fps or 24fps source snapped to a 30fps grid can be off by up to roughly one real frame at export time. That is still far better than raw sub-frame floats that can land mid-frame arbitrarily, but it is not exact for non-30fps footage. True per-video fps detection is the real fix and is deferred to Follow-up.

## Requirements

- **AC-1**: The Deepgram request includes `utterances: true`; `diarize` and `paragraphs` are not set.
- **AC-2**: `normalizeDeepgram` returns every word `start` and `end` snapped to the nearest 1/30s (a multiple of 33.33 ms), for both the sync and callback transcription paths.
- **AC-3**: Downstream seek, EDL cut boundaries, and export consume the snapped values with no additional per-call-site rounding.
- **AC-4**: The snap is deterministic and idempotent: re-normalizing an already-normalized value yields the same value.
- **AC-5**: Adding `utterances` does not break the existing normalizer, which still reads `results.channels[0].alternatives[0].words`.

## Build plan

1. Add `utterances: "true"` to the Deepgram query options (`route.ts:190-197`). (AC-1, AC-5)
2. Add the `snap` helper in `deepgram.ts` and apply it to `start` and `end` in the `normalizeDeepgram` word map (`deepgram.ts:52-57`). (AC-2, AC-4)
3. Confirm no downstream consumer applies its own conflicting rounding to seek/cut values; leave the pixel-width and ms-conversion `Math.round` calls untouched (they are unrelated). (AC-3)

## Consequences

**Positive**: Cut suggestions get phrase and sentence boundaries to align to. Seek, cuts, and export land on frame boundaries from a single source of truth, removing the mid-frame drift of raw floats.

**Negative / tradeoffs**: The 30fps snap is wrong for non-30fps footage by up to about one real frame (most visible on 24fps and 60fps sources), a deliberately accepted heuristic cost. Snapping at normalization bakes the 30fps assumption into stored transcript data, so changing the grid later means re-normalizing. `utterances` grouping is heuristic and will not always match a human's sense of a sentence.

**Neutral**: No migration and no schema change. Both changes are localized (one request option, one helper in the normalizer) and revertable in one commit.

## Follow-up

- **Real per-video fps detection** remains the future upgrade if variable-frame-rate or non-30fps source video becomes common. A client-side probe (for example `requestVideoFrameCallback` sampling) could measure the actual fps and store it per video, letting the snap use the true grid. Deferred because most consumer video is 24/25/30 fps and the flat 30fps heuristic covers the vast majority of cases at a fraction of the complexity.
- **Utterance consumption**: decide how aggressively the cut logic should lean on utterance boundaries versus raw word gaps; start conservative and tune once real footage is observed.
- Diarization and paragraphs are deliberately deferred, not rejected forever; revisit if a multi-speaker or long-form use case appears.
