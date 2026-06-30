# Memory — Rough Cut App — Retake Detection + UX/UI Polish

Last updated: 2026-06-30

## What was built

Two bodies of work this session, both type-check (`npx tsc --noEmit`) and lint
(`npx eslint .`) CLEAN across the whole project. All changes UNCOMMITTED.

### 1. Retake detection (the headline feature — the app's reason to exist)

Goal: a "rough cut" app should auto-cut, not make the user cut by hand. Silence
detection already existed; this adds automatic **repeated-take** detection so a new
project arrives already mostly cut, with the draggable timeline/transcript left as a
touch-up tool. Target: ~90% auto-cut so manual adjustment is minimal.

- **`src/lib/retake-detection.ts`** (NEW) — pure, rule-based, client-side only (no
  network, no LLM — required by the local-first architecture). Exports
  `detectRetakes(words): RetakeMatch[]` and `interface RetakeMatch {cutStart, cutEnd,
  keptStart, keptEnd}`. Algorithm: segment words into sentences (split on >0.5s pause
  OR terminal punctuation), filter to ≥4 words, normalize (lowercase/strip punct/
  collapse ws), group by normalized text, walk chronological occurrences chaining ones
  within a 30s proximity window into "runs", cut every occurrence in a run EXCEPT the
  last (keep the final take). Deliberately conservative — exact-match only, trades
  recall for precision. Tuning constants at top of file are the v2 levers.
- **`src/lib/edl.ts`** — added `buildInitialEDL(words, durationSeconds)`: composes
  `generateInitialEDL` (silence pass) with a loop folding each `detectRetakes` result
  in via `setRangeStatus(edl, cutStart, cutEnd, "cut", "retake")`. `EDLReason` already
  included `"retake"`. Type-only `import type { TranscriptWord }` keeps the
  edl↔retake-detection import cycle runtime-safe.
- **`src/app/(app)/dashboard/[id]/page.tsx`** — call site swapped
  `generateInitialEDL` → `buildInitialEDL` (guarded by `data.edl ?? ...`, so it only
  runs once per project; saved EDLs are untouched). Added `showRetakeReview` state,
  Esc closes it, and a new **`RetakeReviewQueue`** modal component (matches
  `ShortcutsOverlay` style): jump-through "N of M", auto-seeks to each retake, "Keep
  both" calls `onRestoreSegment`, "Accept cut" advances index, empty state when done.
  Added `Check`/`RotateCcw` to the lucide import.
- **`src/components/transcript-panel.tsx`** — new `onOpenRetakeReview` prop;
  `WordSpan` gains `isRetake` → amber strikethrough (`text-amber-400/70
  line-through decoration-amber-400/50`) vs red for silence/manual; suggestion card
  shows live `retakeCount` and its Review button is enabled (amber) only when
  retakes exist, calling `onOpenRetakeReview`.
- **`src/components/timeline-bar.tsx`** — retake clips render amber
  (`border-amber-400/30 bg-amber-950/40`); tooltips humanized per reason ("Retake —
  kept the later take", "Silence — auto-trimmed", "Cut").
- **`ui-registry.md`** — documented the amber retake convention + the rule that cut
  styling now branches on `EDLSegment.reason` (silence/manual=red, retake=amber).

### 2. UX/UI polish pass (done earlier this session, before retake work)

- **Icons**: migrated editor from emoji → **`lucide-react`** (deps added:
  lucide-react, sonner). Conventions documented in `ui-registry.md` (h-4/h-5/h-3.5,
  `fill-current` on Play/Pause, etc.).
- **Toasts**: **`sonner`** `<Toaster position="bottom-center">`, restyled to violet
  tokens. Cut/restore fire toasts with an Undo action button; autosave FAILURE fires
  `toast.error` and deliberately LEAVES status on "Saving…" (it genuinely didn't save
  — the toast is the signal, next edit retries).
- **Accessibility**: global `:focus-visible` violet outline (globals.css `@layer
  base`), `aria-pressed` on toggles, `aria-live` on save status, `role="menu"`/
  `"menuitem"` on context menu, `prefers-reduced-motion` via `motion-safe:` + a CSS
  media query.
- **Resizable transcript panel**: implemented IMPERATIVELY via `transcriptRef` DOM ref
  (width set directly, persisted to `localStorage` key `rc:transcriptWidth`), NOT React
  state — because `react-hooks/set-state-in-effect` forbade the setState-in-effect
  approach and the ref avoids a re-render per drag pixel. `role="separator"` handle,
  MIN_TRANSCRIPT_W=300 / MAX=640.
- **Skeleton/empty states**: `StatusScreen` + `EditorSkeleton` in page.tsx.
- **Timeline scrollbar + waveform** (from a screenshot complaint): custom
  `.timeline-scroll` scrollbar in globals.css (thin, pill thumb, violet on hover, both
  Firefox + WebKit). Audio track `AUDIO_H` 64→104, `WAVE_COLOR` opacity →0.6, new
  `WAVE_GAIN = 2.2` amplitude boost clamped to [-1,1] so quiet audio reads clearly.

## Decisions made

- **Retake detection is rule-based, not LLM** — forced by local-first constraint
  (only audio→Deepgram ever leaves the browser). LLM-assist explicitly deferred to a
  later "v2" (user agreed).
- **Auto-apply, no explicit "Rough Cut" trigger button** — cuts apply on first load;
  user can review/undo. An explicit trigger was considered and deferred.
- **False starts NOT in scope** — only near-verbatim full-sentence repeats are
  detected. Partial/false-start detection is a future lever.
- **Conservative tuning** (exact match, ≥4 words, 30s window) — trade recall for
  precision; better to miss a retake than wrongly cut real content.
- **Cut color now encodes reason**: silence/manual = red, retake = amber, everywhere
  (transcript + timeline). Documented in ui-registry.md.
- **Phases 4 & 5 deliberately SKIPPED** to build retake detection first — this is the
  product's core differentiator (Descript-like auto-cut).
- (carried) EDL = single source of truth, autosaved to Postgres `edl` jsonb; all EDL
  times in SECONDS; editor accent VIOLET / rest of app BLUE (unresolved); video never
  stored server-side; dev server MUST run `npx next dev --webpack` (Turbopack crashes).

## Problems solved

- edl.ts ↔ retake-detection.ts import cycle avoided with `import type` (type-only) in
  retake-detection.ts.
- `RetakeReviewQueue` index management: restoring shrinks the live retake list, so the
  next retake shifts into the same index — index only advances on "Accept cut", and is
  clamped (`Math.min(index, retakes.length-1)`) so it never points past the array.
- (UX pass) Resizable panel hit `react-hooks/set-state-in-effect` → switched from React
  state to an imperative DOM ref (also avoids per-pixel re-render).
- (UX pass) Resisted faking a "saved" status after a failed autosave — kept it honest
  on "Saving…" + error toast.

## Current state

- **Retake detection fully wired and tsc/eslint clean.** New transcripts get silence +
  retake cuts on first load; amber styling + Review queue all functional in code.
- **NOT yet verified in a real browser against a transcript that actually contains
  retakes** — detection ACCURACY is unproven. No automated test exists for the
  algorithm. This is the main open risk.
- Everything UNCOMMITTED. Working tree has: retake-detection.ts (new), edl.ts,
  page.tsx, transcript-panel.tsx, timeline-bar.tsx, globals.css, ui-registry.md,
  video-player.tsx, memory.md, + package.json/lock (lucide-react, sonner).
- Transcription backend STILL the temporary local **faster-whisper** path
  (`/api/transcribe/whisper` + `scripts/transcribe_whisper.py`). Deepgram NOT restored
  — blocked on a client meeting for the correct key+project pairing (meeting hasn't
  happened, timezone mismatch). Secrets NOT stored here.

## Next session starts with

- **Browser-verify retake detection accuracy** on a real transcript containing actual
  re-recorded sentences: confirm repeats get cut amber, the LAST take is the one kept,
  the Review queue ("N of M", Keep both / Accept cut, auto-seek) works, and there are
  no false positives on legitimately-repeated phrasing. Tune the constants in
  retake-detection.ts (SENTENCE_GAP_SECONDS, RETAKE_PROXIMITY_SECONDS, RETAKE_MIN_WORDS)
  if precision/recall is off.
- Then COMMIT this session's work (it's a large uncommitted surface).

## Open questions

- **Detection accuracy unknown** — needs real-data validation; constants may need
  tuning. Consider a fixture-based unit test for `detectRetakes`.
- **False starts / partial repeats** — currently undetected; is that acceptable for the
  90% target or the next lever to pull?
- **Accent unification** — still violet-editor / blue-rest; deferred ("decide later").
- **Deepgram restore** — blocked on client meeting; verify key+project with
  `curl https://api.deepgram.com/v1/projects/:id -H "Authorization: Token $KEY"` BEFORE
  editing `.env.local`, then swap `startTranscription` back to `/api/transcribe/init`.
- Net-new editor features still unbuilt: filler-word detection, speaker diarization,
  Split/Ripple-delete, Captions/Audio/Titles/Settings panels, Export, Share.
