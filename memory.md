# Memory — Rough Cut App — Detection Quality Upgrade (silence/retakes) + Turbopack fix

Last updated: 2026-07-01

## What was built

Session focused on making the auto rough cut actually cut silences and repetitive
phrases, plus fixing why the app/scrollbar looked broken. All changes are **staged
but NOT committed** (working tree). 25 tests pass, tsc + eslint clean.

**1. Detection-quality upgrade (pure logic).**
- `src/lib/edl.ts`: silence threshold went from a flat 2s to tunable presets
  (Balanced 0.7s) with inward edge padding (0.1s) that does NOT pad the file's own
  start/end. Added `DetectionSettings`, `SENSITIVITY_PRESETS`
  (aggressive/balanced/light → silenceGap+pad+retakeSimilarity),
  `DEFAULT_SENSITIVITY="balanced"`.
- `src/lib/retake-detection.ts`: replaced exact-string retake matching with
  **fuzzy** clustering — order-aware LCS ratio (`2·LCS/(|a|+|b|)`), threshold from
  settings (0.8 balanced). Keeps the LAST take in a chain; length-ratio prune
  before LCS.

**2. `reRoughCut` + "Re-run rough cut"** — regenerates silence+retake at chosen
sensitivity while preserving manual edits. Manual layer = manual cuts
(`reason:"manual"`), razor splits (`split` flag), and **protected keeps** (new
out-of-band `EDL.protectedKeeps: {start,end}[]` range list).

**3. Review fixes (all 4 from /review addressed).**
- #1 Restore no longer fragments timeline: `restoreSegment` writes `reason:null`
  (seamless merge) + records the range in `protectedKeeps`. Transforms
  (`setRangeStatus`/`splitAt`/`trimBoundary`) now return `{...edl, segments}` so
  top-level fields (protectedKeeps, sensitivity) ride through edits + undo/redo.
- #2 Trims survive re-run: new `pinTrimmedBoundary(edl, leftIndex)` — cut side →
  `reason:"manual"`, kept side → protectedKeeps. Wired via new `onTrimEnd` prop on
  `timeline-bar.tsx` (fires on boundary pointer-up if the drag moved) →
  `handleTrimEnd` in page (bare setEdl, no extra undo push).
- #3 Aggressive can cut deep: extracted floor-free `buildAutoLayer`; keep-all
  safety floor now guards ONLY the first build; `reRoughCut` bypasses it
  (applyEdl empty-guard is the net).
- #4 Perf: length-ratio prune in retake clustering.

**4. UI (`src/app/(app)/dashboard/[id]/page.tsx`):** Sensitivity segmented control
(Light/Balanced/Aggressive) + "Re-run rough cut" button in the bottom status bar.
Sensitivity persisted into saved EDL (autosave merges `{...edl, sensitivity}`),
restored on load.

**5. package.json:** `"dev"` script changed to `next dev --webpack`.

## Decisions made

- **Deepgram is the LIVE transcription path** (confirmed by user), NOT
  faster-whisper — prior memory was stale. So the detection fix is purely
  algorithmic; no acoustic silence / ASR work needed.
- Scope of "repetitive phrases" = re-recorded TAKES (fuzzy), not fillers/rambling.
  Filler-word removal + semantic trimming explicitly deferred.
- Protected keeps stored as an out-of-band range list (NOT a keep segment reason)
  specifically so restores merge cleanly AND survive re-run — this is why a
  keep-reason approach was rejected.
- Sensitivity is tunable NOW via UI (not hard-coded).

## Problems solved

- **Scrollbar "reverted" mystery:** the slim violet scrollbar CSS was never lost —
  it's in `globals.css` `.transcript-scroll`. The running dev server had been
  launched with plain `next dev` = **Turbopack** (the Next 16 default), under which
  this project's global CSS renders as the native OS bar. Fix = run with
  `--webpack`. Killed the Turbopack server, restarted webpack, and changed the
  `dev` script so it can't recur. THIS is why the project's rule is "dev server
  MUST be `npx next dev --webpack`."
- **Clerk black-screen / redirect loop:** confirmed root cause = Windows clock
  skew. Was **+7.6s** ahead. `w32tm /resync` needs admin (Access denied from the
  tool shell) → ran elevated via `Start-Process -Verb RunAs` (UAC prompt), now
  within ms of real time.

## Current state

- Dev server RUNNING under webpack on http://localhost:3000 (background task,
  banner reads `Next.js 16.2.9 (webpack)`).
- All rough-cut work **staged, not committed**. 25/25 vitest, tsc clean, eslint
  clean.
- **No live browser verification yet** of the new Sensitivity/Re-run/trim-pin/
  restore-heal behavior — verified via tests only.
- Deepgram live; no secrets stored here.

## Next session starts with

1. Hard-reload http://localhost:3000, open a project, and VISUALLY VERIFY:
   Sensitivity (Light/Balanced/Aggressive) + "Re-run rough cut" cuts more silence
   & fuzzy retakes; a manual cut survives re-run; restore heals to ONE clip AND
   survives re-run; a timeline boundary trim survives re-run; the slim violet
   transcript scrollbar is back.
2. **Commit** the whole upgrade (edl.ts, retake-detection.ts,
   retake-detection.test.ts, edl.test.ts, timeline-bar.tsx, page.tsx,
   package.json) on a branch + open PR. (Note: the earlier `62b21ec`
   select-and-delete follow-up PR was still never opened; `gh` still not
   authenticated.)

## Open questions

- Relabel the tool-rail "Silence" badge (currently counts ALL cut segments, not
  just silence)? Offered, not decided.
- Preset values (0.7s silence / 0.8 similarity, etc.) are first-guess — may need
  tuning after reviewing real footage.
- Still deferred: filler-word detection, semantic/rambling trim, Deepgram-specific
  tuning, and Phase 5 WebCodecs export (the big missing pillar — the app can
  preview a cut but cannot render an MP4 yet).
- (carried) Follow-up PR for `62b21ec`; `gh auth login` still pending (user-run,
  interactive).
