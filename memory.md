# Memory — Rough Cut App — EDL Deletion Fix + Manual Timeline Trim

Last updated: 2026-07-01

## What was built

All committed as `23940f1` (plus the highlight/Q-W follow-ups still in the working
tree). `tsc` / `eslint` clean throughout.

**1. Fixed the catastrophic "whole video deleted" bug.** Root cause: the editor built
+ autosaved the initial EDL while the whisper transcript was still empty (whisper runs
in the background), so `buildInitialEDL([], dur)` emitted one full-length silence cut
`[0, dur]`, which got persisted; `data.edl ?? …` then loaded that corpse forever even
after the real transcript arrived.
- `src/lib/edl.ts` — added `sanitizeWords()` (drops non-finite / inverted word times),
  `keepAll()`, a `MIN_INITIAL_KEEP_FRACTION = 0.1` safety floor + empty-words guard in
  `buildInitialEDL` (never auto-deletes the clip), and `generateInitialEDL` now
  sanitizes internally.
- `src/lib/retake-detection.ts` — same inline word filter (kept inline, NOT importing
  from edl.ts, to preserve the type-only boundary / avoid the import cycle).
- `src/app/(app)/dashboard/[id]/page.tsx` — autosave gated on a new `hasEditedRef` (set
  in `applyEdl` / `undo` / `redo` / `handleTrimStart`) so an auto-built EDL is never
  persisted until a real user edit; the initial build only runs when
  `transcriptStatus === "ready"`; on load, a saved EDL with `keptDuration <= 0` is
  treated as corrupt and rebuilt.
- One-off DB heal: nulled the `edl` of the corrupted `0502.mov` row in Neon so it
  rebuilds from the good transcript.

**2. Manual timeline trimming (Q / W).** `cutToPlayhead("left"|"right")` in page.tsx
trims the kept clip under the playhead up to / from the playhead (Premiere-style), via
`setRangeStatus(... "cut","manual")` through `applyEdl` (undo + autosave + Undo toast).
Wired `Q` / `W` into the keydown switch, added a `?`-overlay entry. Also added enabled
**Cut left / Cut right** toolbar buttons in `src/components/timeline-bar.tsx` (new
`onCutToPlayhead` prop, `ArrowLeftToLine` / `ArrowRightToLine` icons, new `actionBtn`
style).

**3. Active-word highlight.** `src/components/transcript-panel.tsx` — currently-playing
word is now a solid `bg-violet-600 text-white shadow-sm ring-1 ring-violet-300/60`
karaoke highlight (was faint `bg-violet-500/20`). Moved into the non-cut branch so
`text-white` wins; `violet-600` (not 500) for WCAG AA contrast + token consistency; no
`font-medium` (avoids width jitter); selection/match backgrounds gated `!isActive`.
Documented in `ui-registry.md`.

## Decisions made

- Initial EDL must never auto-delete the clip — keep-all fallback when no usable words
  or kept < 10%.
- Never persist an auto-generated EDL; only user edits get saved (`hasEditedRef`). A
  saved EDL now implies user intent.
- True "Split" (a persistent keep|keep boundary) does NOT fit this EDL — `mergeAdjacent`
  collapses adjacent same-status segments. Q/W cuts sidestep that; real splits would
  need explicit clip boundaries (separate larger effort). "Split" / "Ripple delete"
  toolbar buttons stay disabled placeholders.
- Active-word highlight chose `violet-600` to satisfy both AA contrast and the
  documented solid-accent token.
- (carried) EDL = single source of truth, times in SECONDS, autosaved to Postgres `edl`
  jsonb; rule-based only (no LLM); dev server MUST be `npx next dev --webpack`.

## Problems solved

- **Black screen on the editor = NOT a code bug.** Two dev-env issues found in
  `.next/dev/logs/next-development.log`: (a) **Clerk infinite redirect loop from system
  clock skew** — local clock ~7s behind real time → JWT `iat` "in the future" → Clerk
  refresh/redirect loop → blank page. Fix: sync the Windows clock (Settings → Time &
  language → Sync now, or admin `w32tm /resync /force`), restart dev server,
  hard-reload, sign out/in if needed. (b) one-time React "useEffect deps array changed
  size" — HMR artifact from adding `cutToPlayhead` to the keydown effect deps (5→6);
  harmless on a fresh load, cleared by a dev-server restart.
- Earlier wrong theory (zero word timestamps) was disproved by querying Neon directly —
  words were valid; the corrupted EDL was the issue.

## Current state

- All EDL fixes + Q/W trim + toolbar buttons + active highlight are implemented, compile
  clean, and the bulk is committed (`23940f1`).
- `0502.mov` healed; reloading rebuilds a proper ~67-segment cut (~72% kept).
- **Blocked from visual verification by the Clerk / clock-skew redirect loop** — the
  editor can't mount until the system clock is synced. No browser confirmation yet of
  Q/W, the toolbar buttons, or the highlight.
- Retake-detection accuracy still unproven on real re-recorded content (carried over);
  no unit tests for `detectRetakes` / `sanitizeWords` / `buildInitialEDL`.
- Transcription still the temporary local faster-whisper path; Deepgram not restored
  (blocked on client meeting). Secrets not stored here.

## Next session starts with

- Sync the system clock, restart `npx next dev --webpack`, hard-reload, and **visually
  verify in the browser**: the editor mounts; Q/W + Cut left/right toolbar buttons trim
  correctly (red "manual" cuts, undo works); active-word highlight reads well;
  `0502.mov` shows the rebuilt timeline (not 0:00).
- Then commit the working-tree follow-ups (highlight `violet-600`, Q/W, toolbar buttons)
  with a message that actually names them.

## Open questions

- Optionally harden the keydown effect against the HMR deps-size warning (e.g., a
  latest-handler ref) — asked the user, awaiting answer.
- Add fixture unit tests for `detectRetakes` / `buildInitialEDL` / `sanitizeWords`?
- Retake detection accuracy + false-starts (carried). Accent unification violet/blue
  (carried). Deepgram restore (carried, blocked on client meeting).
- Net-new editor features still unbuilt: real Split / Ripple-delete (needs a clip-
  boundary model), filler-word detection, speaker diarization, Captions/Audio/Titles/
  Settings panels, Export, Share.
