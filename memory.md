# Memory — Rough Cut App — Phase 3 Editor (review fixes applied)

Last updated: 2026-06-30

## What was built

Prior session built the **entire Phase 3 "Editor Core"** (Descript/CapCut-style NLE
transcript editor). THIS session cleared the 5-item /review punch list that was deferred
to it. All changes type-check (`npx tsc --noEmit`) and lint (`npx eslint`) clean.

**Editor files (built earlier, still current):**
- `src/lib/edl.ts` — EDL types + pure helpers (`generateInitialEDL`, `cutWords`,
  `restoreSegment`, `setRangeStatus`, `trimBoundary`, `findSegmentAt`, etc.). **All times
  in SECONDS.** `restoreSegment` only reads `segment.start`/`end` (delegates to `setRangeStatus`).
- `src/lib/waveform.ts` — `extractWaveform(file)` → 4000 min/max peak buckets; skips decode
  above `MAX_WAVEFORM_BYTES = 1.5GB`.
- `src/components/video-player.tsx` — forwardRef `VideoPlayerHandle`, cut-skip playback,
  `safePlay()` swallows AbortError.
- `src/components/transcript-panel.tsx` — clickable words, drag/shift-click select,
  right-click menu (Cut/Restore/Play), strikethrough cuts, search, auto-scroll active word.
- `src/components/timeline-bar.tsx` — forwardRef `TimelineHandle`, two-track NLE timeline,
  scrubbable playhead, draggable clip boundaries (snap to word edges), viewport-only waveform
  canvas, mouse-wheel zoom toward cursor.
- `src/app/(app)/dashboard/[id]/page.tsx` — editor page: full-screen NLE chrome, debounced
  EDL autosave (PATCH), undo/redo stacks (`undoStack`/`redoStack` refs + `applyEdl`), keyboard
  layer + `?` ShortcutsOverlay. `handleRestoreSegment` computes from closed-over `edl` —
  CANNOT be called in a loop to restore multiple segments (each call overwrites the prior).

**THIS session's changes (all in transcript-panel.tsx + timeline-bar.tsx, UNCOMMITTED):**
- **#1 drag-select auto-scroll** (transcript-panel): new `dragging` state + rAF effect that
  scrolls the transcript when the cursor enters a 48px top/bottom edge zone during a drag
  (speed ramps to edge, capped 18px/frame), then hit-tests `document.elementFromPoint` against
  new `data-word-index` attrs to extend selection to the word now under the cursor. Stops at
  scroll limits.
- **#2 context-menu y-clamp** — `y = Math.min(e.clientY, window.innerHeight - 100)`.
- **#3 multi-word restore** — context-menu Restore now respects a multi-word selection by
  restoring the full selected SPAN via a synthetic `{start, end, status:"cut", reason:null}`
  segment (NOT a loop of onRestoreSegment, which would overwrite). Label shows "Restore N words".
- **#4 wheel-zoom deltaMode normalize** (timeline-bar) — wheel deltas scaled by deltaMode
  (×16 line-mode, ×clientHeight page-mode) before zoom/pan math, so mice zoom like trackpads.
- **#5 drag re-render perf** — each word extracted into a memoized `WordSpan` component; the
  three per-word callbacks (`handleWordMouseDown`/`MouseEnter`/`handleContextMenu`) made
  referentially stable by reading `anchorIndex`/`selection` from refs (`anchorIndexRef`/
  `selectionRef`, synced in a `useEffect`). Only changed words re-render mid-drag, not all ~2,431.

## Decisions made

- **EDL is the single source of truth** for transcript + timeline; autosaved to Postgres `edl` jsonb.
- **Editor accent = VIOLET; rest of app = BLUE** (known inconsistency, logged in `ui-registry.md`, unresolved).
- Layout = "Timeline hero / NLE". Trim drags snap to word edges (Alt overrides).
- Unbuilt features shown as disabled "coming soon" (not hidden).
- Video never stored server-side — editor re-selects the local file each load.
- Icons are emoji placeholders. Dev server MUST run `npx next dev --webpack` (Turbopack crashes here).
- **Ref-sync pattern**: lint rule `react-hooks/refs` forbids writing `ref.current` during render —
  do it in a `useEffect`, not inline at component-body top level.

## Problems solved

- (this session) Stable callbacks for memo: moved `anchorIndex`/`selection` reads to refs so
  `WordSpan` memo isn't busted every selection change. Ref sync must live in `useEffect`
  (in-render ref writes fail `react-hooks/refs` lint).
- (earlier) `play() interrupted by pause()` AbortError → `safePlay()`. Dashboard
  "Unexpected token '<'" → AbortController + content-type guard on status-polling fetch.
  Waveform alignment/blank-at-zoom → viewport-only canvas mapped via real audio duration.
  Phantom undo on boundary click → snapshot undo on first drag MOVE not pointerdown.

## Current state

- **Phase 3 editor + all 5 review fixes are done and type-check/lint clean.** Dev server
  `npx next dev --webpack` on http://localhost:3000.
- **The 5 fixes are NOT yet verified in a real browser by the human.** Auto-scroll feel (#1)
  and wheel-zoom normalization (#4) specifically want a real mouse + trackpad pass.
- Changes are UNCOMMITTED (working tree: transcript-panel.tsx, timeline-bar.tsx, video-player.tsx, memory.md).
- Transcription backend is STILL the temporary **local faster-whisper** path
  (`/api/transcribe/whisper` + `scripts/transcribe_whisper.py`). Deepgram NOT restored:
  key only has access to project `5959aa16-...`, `.env.local` had `edc4565c-...`. Waiting on a
  client Google Meet for the correct key+project pairing — **meeting has NOT happened yet (timezone mismatch).**

## Next session starts with

- **Human browser-verify the 5 fixes** (drag past viewport auto-scrolls + selects; context menu
  near bottom edge doesn't clip; right-click a cut word inside a multi-word selection restores the
  whole span; mouse wheel zooms at a usable speed; no jank dragging long transcripts). Then commit.
- After that, pick the next net-new editor feature (see open questions).

## Open questions

- **Accent unification:** keep violet editor-only, or migrate whole app blue→violet?
- **Deepgram restore:** blocked on the client meeting for a correct key+project pair. When it
  happens: verify with `curl https://api.deepgram.com/v1/projects/:id -H "Authorization: Token $KEY"`
  BEFORE editing `.env.local`, then swap dashboard `startTranscription` back to `/api/transcribe/init`
  + direct-to-Deepgram; re-evaluate keeping whisper as a fallback.
- Net-new editor features still unbuilt (each its own project): filler-word detection, speaker
  diarization, Split/Ripple-delete edit model, Captions/Audio/Titles/Settings panels, Export
  (+ size estimate), Share, transcript replace.
- Emoji icons → real SVG icon set (match dashboard's inline `stroke="currentColor"` SVGs).
