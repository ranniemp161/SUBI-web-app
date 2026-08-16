# @repo/transcript

## Overview
The transcript document that carries timing between apps, plus the repo's only
implementation of the frame arithmetic behind it. Rough Cut writes a document
from a finished cut; b-roll reads it and plans scenes against it. Consumed by
`apps/rough-cut` today, by `apps/broll` once that app exists.

The package owns both ends of the **document**: shaping, validating, hashing,
serializing, parsing, and rendering it back out as subtitles. It does **not**
own the cut. See the boundary rule in Conventions.

## Key files
| File | Owns |
|---|---|
| `src/frame-math.ts` | `secondsToFrame`, `msToFrame`, `frameToSeconds`, `frameToMs`, `frameDurationSeconds` — the single seconds/ms to frame rounding rule for the whole repo (spec `0004`, hoisted here by spec `_root/0001`). `apps/rough-cut/src/lib/frame-math.ts` is a one line re-export shim onto this |
| `src/timebase.ts` | `DEFAULT_FPS`, `snapToStandardFps`, `nominalFps`, `isDropFrame`, `toFrames`, `minClipSeconds`, `formatTimecode` — SMPTE timecode and standard rate snapping, including drop frame counting for NTSC 29.97/59.94. `apps/rough-cut/src/lib/export/timebase.ts` is a one line re-export shim onto this |
| `src/document.ts` | The Zod schema that **is** the definition of a valid transcript document, with the TypeScript type inferred from it; plus `MAX_DOCUMENT_BYTES` and `MAX_SEGMENT_COUNT` |
| `src/build.ts` | `buildTranscriptDocument` (already collapsed segments in, validated document out), `serializeTranscriptDocument`, and `canonicalFingerprint` (stable hash over a canonical form: sorted keys, numbers rounded to the millisecond grid) |
| `src/read.ts` | `parseTranscriptDocument` plus the `importSrt` / `importVtt` subtitle importers, and `TranscriptParseError` |
| `src/write.ts` | `toSrt` / `toVtt` — the document rendered back out as captions, including the caption cue splitting and line wrapping |
| `src/index.ts` | Re-exports everything above |

## Commands
```bash
npm -w @repo/transcript test        # vitest run
npm -w @repo/transcript typecheck   # tsc --noEmit, via the root tsconfig.base.json
```

## Conventions
- **No build step.** Consumed as TypeScript source directly, the same pattern as
  `packages/ui` and `packages/server-shared`. That means this package compiles
  under **each consuming app's `tsconfig`**, not its own. It does now have a
  `tsconfig.json`, but that one only powers `typecheck`: it extends the root
  `tsconfig.base.json`, which deliberately mirrors the apps' settings so this
  package cannot pass its own check and then fail inside an app. Nothing is built
  from it. Rough Cut targets
  below ES2020, which is why `canonicalFingerprint` uses two 32 bit FNV-1a
  passes with `Math.imul` rather than `BigInt` — `BigInt` literals do not
  compile at that target. A future shared package inherits the same constraint.
- Import through the package exports, never a deep relative path:
  `@repo/transcript`, `@repo/transcript/frame-math`, `/timebase`, `/document`,
  `/build`, `/read`, `/write`.
- **This package never learns what an EDL is** (spec `_root/0001` AC-16).
  Applying cuts needs the EDL, and the EDL is Rough Cut's private editing model.
  Rough Cut collapses first (`apps/rough-cut/src/lib/export/transcript-collapse.ts`)
  and hands this package segments that are already post cut. Adding an EDL type
  or any cut handling here runs the dependency the wrong way and welds b-roll to
  how Rough Cut happens to represent an edit today.
- **Nothing in a document is ever fabricated.** A measurement that was not taken
  is absent, never defaulted to a plausible looking value: `confidence` is
  optional rather than defaulted, `fps` is nullable rather than guessed, and an
  imported subtitle's word timings are never interpolated from a cue's span.
  This is the product's selling point, not a style preference.
- **`DEFAULT_FPS` is a definitional default for the helpers and their tests
  only** — never a live fallback on any export path. Every real export is
  blocked until the source's true rate is known.
- **Adjacent words are allowed to overlap.** Speech recognition routinely gives
  a fast compound ("United States") two words sharing a start, and Rough Cut's
  `sanitizeWords` deliberately leaves such a pair alone. Word ordering is
  therefore validated on `start`, not against the previous word's `end`.
  Tightening that check rejects real transcripts: it would force either dropping
  a spoken word or inventing a boundary no measurement supports.
- **An imported subtitle's segments are allowed to overlap too**, for the same
  reason one level up. A document built from an EDL has segments that cannot
  overlap by construction, so an overlap there really is a bug worth catching. A
  subtitle file is not built that way: caption cues routinely overlap by a
  fraction of a second where one speaker's line runs under the next. Refusing
  that would leave only bad options, either turning away a real caption file or
  inventing boundaries the file does not state. Segment ordering is therefore
  validated the same way word ordering is, on `start`.
- `MAX_DOCUMENT_BYTES` (5 MiB) and `MAX_SEGMENT_COUNT` (20,000) are
  **provisional**, sized by arithmetic rather than the measurement spec
  `_root/0001`'s follow up asks for. Retune them in `document.ts`; nothing else
  reads the numbers.
- Tests are colocated `*.test.ts` next to source, run with Vitest.

## Gotchas
- **The subtitle writers mark every word, including the one that opens a cue.**
  It looks redundant against the cue's own start time, and is not: `importVtt`
  builds words from inline timestamp markers alone, so text before the first
  marker is not a timed word to it. Omitting that marker silently dropped the
  opening word of every cue on the way back in.
- A document's segments run one whole utterance long, which is the right unit
  for a planner and unreadable as captions. `toSrt` / `toVtt` split them into
  caption sized cues **at real word boundaries only**, so a segment with no
  words (a plain SRT import) is left whole rather than split at an invented
  point.

## Related specs
- `docs/specs/_root/0001-transcript-contract/index.md` — the document contract,
  why the frame math moved here, and where the cut boundary sits.
- `docs/specs/rough-cut/0004-frame-accuracy-timeline-synchrony/index.md` — the
  original frame accuracy work this arithmetic came from.

_Drafted by /sync from the introducing change, worth a quick human pass._
