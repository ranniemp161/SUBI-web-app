/**
 * EDL (Edit Decision List) types and pure helper functions.
 *
 * Times throughout this module are in seconds (matching the transcript's
 * word timestamps), not milliseconds — convert at the UI boundary where
 * `durationMs` (stored in Postgres) is involved.
 */

import { detectRetakes } from "./retake-detection";
import { detectRepetitions } from "./repetition-detection";

/** A single transcribed word with timing, matching the Deepgram response shape. */
export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  /**
   * True once the word-boundary refinement pass (spec
   * 0003-word-boundary-timestamp-refinement) has tightened this word's
   * `start`/`end` against the real decoded audio. Absent or false means
   * `start`/`end` are still Deepgram's original estimate (either the pass
   * hasn't run yet, or it ran but found no confident boundary for this word).
   */
  aligned?: boolean;
}

export interface Transcript {
  words: TranscriptWord[];
  text: string;
  duration: number;
  language?: string;
  /** Deepgram utterance-boundary end times (ascending) — see retake-detection.ts. */
  utteranceEnds?: number[];
}

export type EDLReason = "silence" | "retake" | "repetition" | "manual" | "ai" | null;

export interface EDLSegment {
  start: number;
  end: number;
  status: "keep" | "cut";
  reason: EDLReason;
  /**
   * A user-created razor boundary begins here. The segment plays back
   * identically to a non-split one — the flag exists only so `mergeAdjacent`
   * won't fuse this segment into a same-status/reason left neighbour, keeping
   * the two halves of a split as independently editable clips.
   */
  split?: boolean;
}

export interface TimeRange {
  start: number;
  end: number;
}

export interface EDL {
  segments: EDLSegment[];
  /**
   * The sensitivity preset the auto rough cut last ran at, persisted in the
   * saved EDL so a reload restores the user's choice. Optional — auto-built and
   * older EDLs omit it, and the value only influences a future re-run.
   */
  sensitivity?: SensitivityLevel;
  /**
   * Ranges the user explicitly kept — restored auto-cuts, or the kept side of a
   * pinned trim. Stored out-of-band (not as a segment reason) so restored spans
   * still merge seamlessly into neighbouring clips, while `reRoughCut` can still
   * honour them and not re-cut what the user deliberately kept.
   */
  protectedKeeps?: TimeRange[];
}

/**
 * Tunable detection thresholds. Silence is inferred from word-gap timing
 * (Deepgram timestamps are trusted), retakes from fuzzy sentence similarity.
 * Surfaced in the studio as a three-way sensitivity control.
 */
export interface DetectionSettings {
  /** A gap between words longer than this (seconds) is flagged as dead air. */
  silenceGapSeconds: number;
  /** Breath left on each side of a silence cut so word onsets/tails aren't clipped. */
  silencePadSeconds: number;
  /** Minimum token-sequence similarity [0..1] for two sentences to count as one retake. */
  retakeSimilarity: number;
}

export type SensitivityLevel = "aggressive" | "balanced" | "light";

export const SENSITIVITY_PRESETS: Record<SensitivityLevel, DetectionSettings> = {
  aggressive: { silenceGapSeconds: 0.5, silencePadSeconds: 0.06, retakeSimilarity: 0.72 },
  balanced: { silenceGapSeconds: 0.7, silencePadSeconds: 0.1, retakeSimilarity: 0.8 },
  light: { silenceGapSeconds: 1.2, silencePadSeconds: 0.15, retakeSimilarity: 0.88 },
};

export const DEFAULT_SENSITIVITY: SensitivityLevel = "balanced";

/** The settings used when a caller doesn't specify one. */
const DEFAULT_SETTINGS = SENSITIVITY_PRESETS[DEFAULT_SENSITIVITY];

/**
 * An initial auto-build that would keep less than this fraction of the clip is
 * treated as a data problem (e.g. missing word timestamps), not a real edit —
 * we fall back to keep-all rather than silently delete the whole video.
 */
export const MIN_INITIAL_KEEP_FRACTION = 0.1;

/**
 * Drop transcript words with unusable timing before they reach the EDL math,
 * and clip each word's end so it never runs past the next word's start.
 * ASR output can contain null/NaN word timestamps; those coerce to 0 in
 * arithmetic, which collapses every gap check and leaves `prevEnd` stuck at
 * 0 — so the trailing-gap branch marks the entire clip as one giant
 * "silence" cut. Keep only finite, forward-ordered words.
 *
 * Deepgram's per-word timestamps also aren't guaranteed non-overlapping — a
 * fast compound proper noun ("Donald Trump") routinely reports the first
 * word's end a beat past the second word's own start. Left uncorrected, a
 * cut aimed at one word bleeds into its neighbour (and, if the *previous*
 * word overlaps forward instead, the clamp meant to protect that neighbour
 * can push the cut's start past the target word's own `start` entirely —
 * leaving a segment that's genuinely "cut" but no longer contains the word
 * whose deletion created it, desyncing the transcript's strikethrough from
 * the timeline). Clipping here, once, is what every downstream consumer
 * (cutting, silence-gap detection, restore) relies on to see clean,
 * non-overlapping words.
 */
export function sanitizeWords(words: TranscriptWord[]): TranscriptWord[] {
  const clean = words
    .filter(
      (w) =>
        Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start
    )
    .sort((a, b) => a.start - b.start);

  for (let i = 0; i < clean.length - 1; i++) {
    const next = clean[i + 1];
    if (clean[i].end > next.start && next.start > clean[i].start) {
      clean[i] = { ...clean[i], end: next.start };
    }
  }

  return clean;
}

/**
 * Round a time (seconds) to the millisecond grid word timestamps already
 * live on (see deepgram.ts's `roundMs`). Every cut/restore/trim/split path
 * that computes a new boundary funnels through this, so the playhead, the
 * active word highlight, and the cut boundary agree at the millisecond
 * (AC-9) instead of drifting from unrounded floating-point arithmetic.
 */
export function roundMs(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/** A single "keep" segment spanning the whole clip — the safe fallback. */
function keepAll(durationSeconds: number): EDL {
  return {
    segments: [
      { start: 0, end: Math.max(durationSeconds, 0), status: "keep", reason: null },
    ],
  };
}

/** Merge adjacent segments that share the same status/reason and touch end-to-end. */
function mergeAdjacent(segments: EDLSegment[]): EDLSegment[] {
  const merged: EDLSegment[] = [];

  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (
      last &&
      !seg.split &&
      last.status === seg.status &&
      last.reason === seg.reason &&
      Math.abs(last.end - seg.start) < 1e-6
    ) {
      last.end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }

  return merged;
}

/**
 * Build the initial EDL from a transcript: everything is "keep" except
 * gaps between words longer than SILENCE_GAP_SECONDS, which are "cut".
 */
export function generateInitialEDL(
  words: TranscriptWord[],
  durationSeconds: number,
  settings: DetectionSettings = DEFAULT_SETTINGS
): EDL {
  const cuts: { start: number; end: number }[] = [];
  let prevEnd = 0;

  // Pad the cut inward from any speech-adjacent edge so it doesn't clip the tail
  // of the previous word or the onset of the next. The file's own start (0) and
  // end (duration) aren't speech, so they're left unpadded — no tiny slivers.
  const pushSilenceCut = (from: number, to: number) => {
    const start = from > 0 ? from + settings.silencePadSeconds : from;
    const end = to < durationSeconds ? to - settings.silencePadSeconds : to;
    if (end > start) cuts.push({ start, end });
  };

  for (const word of sanitizeWords(words)) {
    if (word.start - prevEnd > settings.silenceGapSeconds) {
      pushSilenceCut(prevEnd, word.start);
    }
    prevEnd = Math.max(prevEnd, word.end);
  }

  if (durationSeconds - prevEnd > settings.silenceGapSeconds) {
    pushSilenceCut(prevEnd, durationSeconds);
  }

  const segments: EDLSegment[] = [];
  let cursor = 0;

  for (const cut of cuts) {
    if (cut.start > cursor) {
      segments.push({ start: cursor, end: cut.start, status: "keep", reason: null });
    }
    segments.push({ start: cut.start, end: cut.end, status: "cut", reason: "silence" });
    cursor = cut.end;
  }

  if (durationSeconds > cursor) {
    segments.push({ start: cursor, end: durationSeconds, status: "keep", reason: null });
  }

  return { segments };
}

/**
 * Build the initial EDL for a fresh transcript: silence pass (generateInitialEDL)
 * composed with the retake-detection pass, so a new project arrives already
 * mostly cut. Only ever called once per project — see the `data.edl ?? ...`
 * guard at the call site, which skips this entirely once an EDL is saved.
 */
/**
 * The pure auto layer: silence pass composed with retake detection, no safety
 * floor. Shared by the initial build and by re-run. Assumes pre-sanitized,
 * non-empty words and a positive duration.
 */
function buildAutoLayer(
  clean: TranscriptWord[],
  durationSeconds: number,
  settings: DetectionSettings,
  utteranceEnds?: number[]
): EDL {
  let edl = generateInitialEDL(clean, durationSeconds, settings);
  // Repetitions before retakes: where a full retake span covers a stutter,
  // the later retake pass re-labels it — the broader diagnosis wins.
  for (const rep of detectRepetitions(clean)) {
    edl = setRangeStatus(edl, rep.cutStart, rep.cutEnd, "cut", "repetition");
  }
  for (const retake of detectRetakes(clean, settings.retakeSimilarity, utteranceEnds)) {
    edl = setRangeStatus(edl, retake.cutStart, retake.cutEnd, "cut", "retake");
  }
  return edl;
}

export function buildInitialEDL(
  words: TranscriptWord[],
  durationSeconds: number,
  settings: DetectionSettings = DEFAULT_SETTINGS,
  utteranceEnds?: number[]
): EDL {
  const clean = sanitizeWords(words);

  // No usable word timing → we can't trust any cut. Keep everything rather
  // than guess (a degenerate transcript must never auto-delete the video).
  if (clean.length === 0 || durationSeconds <= 0) {
    return keepAll(durationSeconds);
  }

  const edl = buildAutoLayer(clean, durationSeconds, settings, utteranceEnds);

  // Safety floor for the *first* build only: an auto-cut that removes nearly the
  // whole clip is almost certainly bad input (e.g. missing timestamps), not a
  // real edit. A deliberate re-run bypasses this — the user picked the
  // sensitivity, and applyEdl still refuses a fully-empty timeline.
  if (keptDuration(edl) < durationSeconds * MIN_INITIAL_KEEP_FRACTION) {
    return keepAll(durationSeconds);
  }

  return edl;
}

/**
 * Re-mark the range [startSec, endSec) with a new status/reason, splitting
 * and merging existing segments as needed. Used for both cuts and restores.
 */
export function setRangeStatus(
  edl: EDL,
  startSec: number,
  endSec: number,
  status: "keep" | "cut",
  reason: EDLReason
): EDL {
  const result: EDLSegment[] = [];

  for (const seg of edl.segments) {
    if (seg.end <= startSec || seg.start >= endSec) {
      result.push(seg);
      continue;
    }

    // Left remainder keeps seg.start, so a razor boundary there is still real.
    if (seg.start < startSec) {
      result.push({ ...seg, end: startSec });
    }

    // The re-marked middle is a brand-new span — never inherits a razor flag.
    result.push({
      start: Math.max(seg.start, startSec),
      end: Math.min(seg.end, endSec),
      status,
      reason,
    });

    // Right remainder now starts at the cut edge, not the original razor point,
    // so drop `split` — otherwise a phantom boundary lingers there.
    if (seg.end > endSec) {
      result.push({ ...seg, start: endSec, split: undefined });
    }
  }

  result.sort((a, b) => a.start - b.start);

  // A manual cut un-protects whatever it covers: drop the range from
  // protectedKeeps so a later re-run doesn't try to force-keep a span the user
  // has since deliberately cut. Only manual cuts do this — auto silence/retake
  // cuts and restores must leave the protected list intact.
  const protectedKeeps =
    status === "cut" && reason === "manual"
      ? subtractProtectedRange(edl.protectedKeeps, startSec, endSec)
      : edl.protectedKeeps;

  return { ...edl, segments: mergeAdjacent(result), protectedKeeps };
}

/**
 * Span covering every segment of `next` that isn't present verbatim in
 * `prev` — a tight bound on where an edit actually landed. Null when the two
 * EDLs are segment-identical.
 */
export function changedSpan(prev: EDL, next: EDL): TimeRange | null {
  const keys = new Set(
    prev.segments.map((s) => `${s.start}|${s.end}|${s.status}|${s.reason}`)
  );
  let start = Infinity;
  let end = -Infinity;
  for (const s of next.segments) {
    if (keys.has(`${s.start}|${s.end}|${s.status}|${s.reason}`)) continue;
    start = Math.min(start, s.start);
    end = Math.max(end, s.end);
  }
  return start < end ? { start, end } : null;
}

/**
 * Sweep out cut residue: kept segments sitting between two cuts that contain
 * no transcript word (a genuine word — even a short one like "yes" — is never
 * absorbed) and aren't protected by a user restore, regardless of duration.
 * A wordless gap flanked by two cuts has nothing spoken left in it, whether
 * it's a pad-width sliver (silence cuts are padded inward by
 * silencePadSeconds, which traps a pad-width "keep" next to an adjacent
 * word-boundary cut) or a natural pause the user just cut both flanking words
 * around — either way there's no content left to justify keeping it playable.
 * Each sliver takes its left neighbour's status/reason so mergeAdjacent heals
 * it into that cut.
 *
 * `span` bounds the sweep to where the triggering edit landed (see
 * changedSpan): only slivers overlapping it are touched, so a tiny keep the
 * user deliberately trimmed elsewhere can never be absorbed by an unrelated
 * later edit. Passing `null` no-ops; omitting it sweeps the whole timeline.
 */
export function absorbCutResidue(
  edl: EDL,
  words: TranscriptWord[],
  span?: TimeRange | null
): EDL {
  if (span === null) return edl;
  const clean = sanitizeWords(words);
  const segs = edl.segments;
  let changed = false;

  const result = segs.map((seg, i) => {
    if (seg.status !== "keep") return seg;
    if (span && (seg.end <= span.start || seg.start >= span.end)) return seg;
    const left = segs[i - 1];
    const right = segs[i + 1];
    if (left?.status !== "cut" || right?.status !== "cut") return seg;
    // A sliver with real speech in it is never absorbed, at any duration —
    // only a wordless gap flanked by two cuts (nothing spoken left in it once
    // both neighbors are cut) is unambiguous residue, so MAX_RESIDUE_SECONDS
    // doesn't gate that case either.
    const hasWord = clean.some((w) => w.start < seg.end && w.end > seg.start);
    if (hasWord) return seg;
    const isProtected = (edl.protectedKeeps ?? []).some(
      (r) => r.start < seg.end && r.end > seg.start
    );
    if (isProtected) return seg;
    changed = true;
    return { ...seg, status: "cut" as const, reason: left.reason, split: undefined };
  });

  return changed ? { ...edl, segments: mergeAdjacent(result) } : edl;
}

/**
 * Outward pad applied to a manual word cut. Deepgram's word boundaries mark
 * the ASR's best-guess timestamp, not the true acoustic edge — a leading
 * glide ("w-") or trailing consonant release ("-ld") routinely bleeds a few
 * tens of milliseconds past `start`/`end`, so cutting exactly at the
 * timestamp leaves an audible fragment of the "deleted" word on either side.
 * Padding outward (the opposite direction from `silencePadSeconds`, which
 * pads a silence cut inward to protect adjacent speech) swallows that slop.
 * Clamped per-cut against the nearest surviving word so it can never bite
 * into a neighbour, including in fast, back-to-back speech.
 */
export const WORD_CUT_PAD_SECONDS = 0.05;

/**
 * Widen [start, end) by `pad` on each side, then pull back in wherever that
 * would cross into a neighbouring word from `allWords` (every word being cut
 * in this same operation is passed in `excluded` so it's never mistaken for
 * a neighbour of itself). The padding must never eat real speech, only the
 * ASR slop right at the cut's own edges.
 *
 * A neighbour is assigned to the "before" or "after" side by which half of
 * [start, end)'s own midpoint it falls on, not by whether it's cleanly
 * outside [start, end) — Deepgram's word timestamps aren't guaranteed
 * non-overlapping, especially for a fast compound proper noun ("Donald
 * Trump"), so a neighbour's start can land *before* this word's own
 * (mis-measured) end. Clamping only against neighbours strictly outside
 * [start, end) would miss exactly that case and let the cut bleed into the
 * next word entirely — not just its padding.
 */
function clampWordCutRange(
  allWords: TranscriptWord[],
  excluded: TranscriptWord[],
  start: number,
  end: number,
  pad: number
): TimeRange {
  const isExcluded = new Set(excluded);
  const selectionMid = (start + end) / 2;
  let prevBoundary = -Infinity;
  let nextBoundary = Infinity;
  for (const w of allWords) {
    if (isExcluded.has(w)) continue;
    if ((w.start + w.end) / 2 <= selectionMid) {
      prevBoundary = Math.max(prevBoundary, w.end);
    } else {
      nextBoundary = Math.min(nextBoundary, w.start);
    }
  }
  const clampedStart = Math.max(start - pad, prevBoundary);
  // clampedEnd can land below the raw (unpadded) `end` when a neighbour's
  // own timestamp already overlapped it — shrinking to the true boundary,
  // not just refusing to extend further into it.
  const clampedEnd = Math.max(Math.min(end + pad, nextBoundary), clampedStart);

  // Hard invariant, enforced last: whatever the neighbour math above worked
  // out, the cut must never end up narrower than [start, end) — the exact
  // span of the word(s) the user selected. `sanitizeWords` already resolves
  // genuine overlap with a real neighbour at the source (clipping each
  // word's own `end`/`start` against its adjacent word before this function
  // ever runs), so shrinking past the selection's own edges here should
  // never be *necessary* for that reason. Enforcing it directly closes the
  // whole bug class regardless of the exact path that could otherwise defeat
  // it — a cut is worthless if it doesn't cover the word it was aimed at.
  const safeStart = Math.min(clampedStart, start);
  const safeEnd = Math.max(clampedEnd, end);

  // This invariant should be unreachable given a complete, sanitized
  // `allWords` — if it ever fires, the neighbour-clamp math above was wrong
  // for real data we haven't seen in testing, not just a theoretical case.
  // Logging the actual inputs here is the only way to get real numbers to
  // debug it with, rather than guessing again from a screenshot.
  if (safeStart !== clampedStart || safeEnd !== clampedEnd) {
    console.warn(
      "clampWordCutRange: neighbour clamp would have cut narrower than the selected word(s) — widened back out.",
      { start, end, pad, clampedStart, clampedEnd, safeStart, safeEnd }
    );
  }

  // Round to the millisecond grid word timestamps already live on —
  // floating-point addition/subtraction here would otherwise introduce
  // sub-millisecond drift that compounds across repeated cuts, undo/redo,
  // and re-runs.
  return { start: roundMs(safeStart), end: roundMs(safeEnd) };
}

/**
 * Look up each of `words`' counterpart in `clean` (a `sanitizeWords` result)
 * by `start` — the one field clipping never touches — so a word whose `end`
 * got clipped for overlapping its neighbour is matched to that corrected
 * copy rather than its original (unclipped, reference-stale) self.
 */
function toCleanWords(clean: TranscriptWord[], words: TranscriptWord[]): TranscriptWord[] {
  const byStart = new Map(clean.map((w) => [w.start, w]));
  return words.map((w) => byStart.get(w.start) ?? w);
}

/**
 * Cut the time range spanned by the given words (manual cut, e.g. via Delete
 * key). `allWords` is the full transcript, used to clamp the outward pad
 * against real neighbouring speech and to correct for any overlap between
 * the selected words' own timestamps and an adjacent word's (see
 * `sanitizeWords`) — using the selected words' raw, uncorrected span here
 * would reintroduce exactly the bleed that correction fixes.
 */
export function cutWords(
  edl: EDL,
  words: TranscriptWord[],
  allWords: TranscriptWord[]
): EDL {
  if (words.length === 0) return edl;

  const clean = sanitizeWords(allWords);
  const cleanWords = toCleanWords(clean, words);
  const start = Math.min(...cleanWords.map((w) => w.start));
  const end = Math.max(...cleanWords.map((w) => w.end));
  const clamped = clampWordCutRange(clean, cleanWords, start, end, WORD_CUT_PAD_SECONDS);

  return setRangeStatus(edl, clamped.start, clamped.end, "cut", "manual");
}

/**
 * Cut each word's own time range, leaving everything between the words
 * untouched. `cutWords` cuts one span from the first word to the last — right
 * for a contiguous transcript selection, catastrophic for scattered words
 * (fillers dotted through a video would take all the speech between them).
 * `allWords` is the full transcript, used to clamp each word's outward pad
 * against its real neighbours and to correct each word's own span for
 * overlap with a neighbour (see `sanitizeWords`).
 */
export function cutEachWord(
  edl: EDL,
  words: TranscriptWord[],
  allWords: TranscriptWord[]
): EDL {
  const clean = sanitizeWords(allWords);
  const cleanWords = toCleanWords(clean, words);
  let next = edl;
  for (const w of cleanWords) {
    const clamped = clampWordCutRange(clean, [w], w.start, w.end, WORD_CUT_PAD_SECONDS);
    next = setRangeStatus(next, clamped.start, clamped.end, "cut", "manual");
  }
  return next;
}

/** Add a range to a protected-keep list, keeping it sorted and coalesced. */
function addProtectedRange(
  ranges: TimeRange[] | undefined,
  start: number,
  end: number
): TimeRange[] {
  const merged: TimeRange[] = [];
  const all = [...(ranges ?? []), { start, end }].sort((a, b) => a.start - b.start);
  for (const r of all) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 1e-6) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

/**
 * Remove [start, end) from a protected-keep list, clipping any range it overlaps
 * (and dropping ranges it fully covers). This is what un-protects a span: a later
 * manual cut over a previously-restored region drops it from protection, so the
 * list stays honest and doesn't grow with stale entries the user has since cut.
 */
function subtractProtectedRange(
  ranges: TimeRange[] | undefined,
  start: number,
  end: number
): TimeRange[] | undefined {
  if (!ranges) return ranges;
  const result: TimeRange[] = [];
  for (const r of ranges) {
    if (r.end <= start || r.start >= end) {
      result.push(r); // no overlap
      continue;
    }
    if (r.start < start) result.push({ start: r.start, end: start }); // left remainder
    if (r.end > end) result.push({ start: end, end: r.end }); // right remainder
  }
  return result.length > 0 ? result : undefined;
}

/**
 * Restore a cut segment back to "keep". The span merges seamlessly into its
 * neighbours (reason:null, so the timeline heals into one clip) and is also
 * recorded in `protectedKeeps` so a later `reRoughCut` won't re-cut what the
 * user deliberately brought back.
 */
export function restoreSegment(edl: EDL, segment: EDLSegment): EDL {
  const kept = setRangeStatus(edl, segment.start, segment.end, "keep", null);
  return {
    ...kept,
    protectedKeeps: addProtectedRange(edl.protectedKeeps, segment.start, segment.end),
  };
}

/**
 * Pin a just-dragged boundary so the trim survives re-run. `originalBoundary` is
 * where the boundary sat before the drag; the boundary now sits at the shared
 * edge of segments[leftIndex] / its right neighbour.
 *
 * Whichever side is a cut is re-marked reason "manual" (captured by reRoughCut).
 * If the drag *grew the kept side* (dragged into a cut, revealing content), only
 * the newly-revealed sliver — the span between the old and new boundary — is
 * added to protectedKeeps, so re-run won't re-cut just that bit without freezing
 * the entire neighbouring clip. A keep|keep boundary is a razor split (preserved
 * via its `split` flag), so it's left untouched.
 */
export function pinTrimmedBoundary(
  edl: EDL,
  leftIndex: number,
  originalBoundary: number
): EDL {
  const left = edl.segments[leftIndex];
  const right = edl.segments[leftIndex + 1];
  if (!left || !right) return edl;
  if (left.status === "keep" && right.status === "keep") return edl;

  const newBoundary = left.end; // == right.start after a trim

  // Re-mark whichever side is a cut as manual. setRangeStatus also drops these
  // ranges from protectedKeeps, so a boundary dragged deeper into a kept clip
  // un-protects the part it just cut.
  let next = edl;
  for (const seg of [{ ...left }, { ...right }]) {
    if (seg.status === "cut") {
      next = setRangeStatus(next, seg.start, seg.end, "cut", "manual");
    }
  }

  // Protect only the sliver the drag revealed on the kept side (between the old
  // and new boundary) — and only when the kept side actually grew.
  const keptGrew =
    (left.status === "keep" && newBoundary > originalBoundary) ||
    (right.status === "keep" && newBoundary < originalBoundary);
  const lo = Math.min(originalBoundary, newBoundary);
  const hi = Math.max(originalBoundary, newBoundary);
  if (keptGrew && hi - lo > 1e-6) {
    next = { ...next, protectedKeeps: addProtectedRange(next.protectedKeeps, lo, hi) };
  }

  return next;
}

/**
 * Re-run the automatic rough cut at new settings while preserving the user's
 * manual work. Manual cuts and razor splits (read off the segments) and
 * protected keeps (the out-of-band range list) are lifted off the current EDL;
 * the silence + retake layer is regenerated fresh from the transcript; then the
 * manual layer is re-applied on top (manual always wins) and the splits
 * re-inserted wherever they still fall inside a kept clip.
 */
export function reRoughCut(
  edl: EDL,
  words: TranscriptWord[],
  durationSeconds: number,
  settings: DetectionSettings = DEFAULT_SETTINGS,
  utteranceEnds?: number[]
): EDL {
  const clean = sanitizeWords(words);
  // Nothing to regenerate from → leave the current edit untouched rather than
  // risk wiping it from a degenerate transcript.
  if (clean.length === 0 || durationSeconds <= 0) return edl;

  const manualCuts = edl.segments.filter(
    (s) => s.status === "cut" && s.reason === "manual"
  );
  const protectedKeeps = edl.protectedKeeps ?? [];
  const splitPoints = edl.segments.filter((s) => s.split).map((s) => s.start);

  // Floor-free: an explicit re-run at a chosen sensitivity is allowed to cut
  // deep; applyEdl is the guard against a fully-empty timeline.
  let next = buildAutoLayer(clean, durationSeconds, settings, utteranceEnds);

  // Manual layer wins over the freshly generated auto layer.
  for (const r of protectedKeeps) {
    next = setRangeStatus(next, r.start, r.end, "keep", null);
  }
  for (const seg of manualCuts) {
    next = setRangeStatus(next, seg.start, seg.end, "cut", "manual");
  }
  // Re-insert razor boundaries; splitAt no-ops any that no longer land inside a
  // kept clip (e.g. the boundary now sits within a regenerated cut).
  for (const t of splitPoints) {
    next = splitAt(next, t);
  }

  // Carry forward the out-of-band fields the fresh build didn't produce.
  return { ...next, protectedKeeps, sensitivity: edl.sensitivity };
}

/**
 * Razor: insert a persistent boundary at `timeSec`, dividing the kept clip that
 * contains it into two independent clips. The right half is flagged `split` so
 * `mergeAdjacent` (which would otherwise treat the touching same-status halves
 * as one) keeps them apart, leaving each separately cuttable / trimmable.
 *
 * Only kept clips are razorable — splitting a "cut" span is meaningless (both
 * halves are skipped on playback either way). No-op when the time lands on (or
 * within EPS of) an existing boundary, or outside every kept clip.
 */
export function splitAt(edl: EDL, timeSec: number): EDL {
  const time = roundMs(timeSec);
  const EPS = 1e-4;
  const segments: EDLSegment[] = [];
  let didSplit = false;

  for (const seg of edl.segments) {
    if (
      seg.status === "keep" &&
      time > seg.start + EPS &&
      time < seg.end - EPS
    ) {
      segments.push({ ...seg, end: time });
      segments.push({ ...seg, start: time, split: true });
      didSplit = true;
    } else {
      segments.push(seg);
    }
  }

  return didSplit ? { ...edl, segments } : edl;
}

/** Smallest a segment is allowed to shrink to when trimming a shared boundary. */
export const MIN_SEGMENT_SECONDS = 0.05;

/**
 * Drag the shared boundary between segments[leftIndex] and segments[leftIndex + 1]
 * to a new time, shrinking one and growing the other. Clamped so neither segment
 * can invert or collapse below MIN_SEGMENT_SECONDS.
 */
export function trimBoundary(edl: EDL, leftIndex: number, newBoundaryTime: number): EDL {
  const left = edl.segments[leftIndex];
  const right = edl.segments[leftIndex + 1];
  if (!left || !right) return edl;

  const min = left.start + MIN_SEGMENT_SECONDS;
  const max = right.end - MIN_SEGMENT_SECONDS;
  const clamped = roundMs(Math.min(Math.max(newBoundaryTime, min), max));

  const segments = edl.segments.map((seg, i) => {
    if (i === leftIndex) return { ...seg, end: clamped };
    if (i === leftIndex + 1) return { ...seg, start: clamped };
    return seg;
  });

  return { ...edl, segments };
}

/** Find the EDL segment containing a given time, if any. */
// The filler tokens Deepgram emits with filler_words enabled, plus common
// spelling variants. Deliberately excludes real words ("like", "well", "so")
// and meaningful interjections ("ah", "oh", "huh") — a false cut is worse
// than a missed filler.
const FILLER_WORDS = new Set([
  "uh",
  "uhh",
  "um",
  "umm",
  "uhm",
  "er",
  "erm",
  "hm",
  "hmm",
  "mm",
  "mmm",
  "mhm",
  "mhmm",
  "mm-mm",
  "uh-uh",
  "uh-huh",
  "nuh-uh",
]);

/** Whether a transcript word is a disfluency ("um", "uh", …), ignoring case and punctuation. */
export function isFillerWord(word: string): boolean {
  const normalized = word.toLowerCase().replace(/^[^a-z]+|[^a-z-]+$/g, "");
  return FILLER_WORDS.has(normalized);
}

/** All transcript words that are fillers and currently inside kept segments. */
export function findFillerWords(edl: EDL, words: TranscriptWord[]): TranscriptWord[] {
  return words.filter(
    (w) => isFillerWord(w.word) && findSegmentAt(edl, w.start)?.status === "keep"
  );
}

/** A paragraph of consecutive transcript words: [startIndex, endIndex] inclusive. */
export interface WordParagraph {
  startIndex: number;
  endIndex: number;
}

// Paragraph breaks: a spoken pause this long starts a new paragraph…
const PARAGRAPH_GAP_SECONDS = 1.0;
// …or, past this many words, the next sentence end does…
const PARAGRAPH_SOFT_WORD_LIMIT = 50;
// …or, with no punctuation at all, force a break here.
const PARAGRAPH_HARD_WORD_LIMIT = 100;

const SENTENCE_END_RE = /[.!?]["'”’)]?$/;

/**
 * Group transcript words into readable paragraphs (Descript-style) instead of
 * one wall of text. Breaks on long spoken pauses, and on sentence ends once a
 * paragraph gets long. Returns inclusive index ranges into `words`.
 */
export function groupWordsIntoParagraphs(words: TranscriptWord[]): WordParagraph[] {
  const paragraphs: WordParagraph[] = [];
  let start = 0;
  for (let i = 1; i < words.length; i++) {
    const count = i - start;
    const gap = words[i].start - words[i - 1].end;
    const sentenceEnded = SENTENCE_END_RE.test(words[i - 1].word);
    const shouldBreak =
      gap >= PARAGRAPH_GAP_SECONDS ||
      (count >= PARAGRAPH_SOFT_WORD_LIMIT && sentenceEnded) ||
      count >= PARAGRAPH_HARD_WORD_LIMIT;
    if (shouldBreak) {
      paragraphs.push({ startIndex: start, endIndex: i - 1 });
      start = i;
    }
  }
  if (words.length > 0) paragraphs.push({ startIndex: start, endIndex: words.length - 1 });
  return paragraphs;
}

export function findSegmentAt(edl: EDL, timeSec: number): EDLSegment | undefined {
  return edl.segments.find((seg) => timeSec >= seg.start && timeSec < seg.end);
}

/**
 * Index of the word being spoken at `timeSec`, or -1 when the playhead sits in
 * an inter-word gap (silence). `words` are ascending by `start`, so this binary
 * searches instead of scanning — it runs on every rAF frame while playing, and
 * an O(n) scan let the highlight visibly trail the O(1) timeline playhead on
 * long transcripts. Semantics match the previous `findIndex`: a word is active
 * for `start <= timeSec < end`.
 */
export function findActiveWordIndex(
  words: TranscriptWord[],
  timeSec: number
): number {
  let lo = 0;
  let hi = words.length - 1;
  let candidate = -1;
  // Find the last word whose start <= timeSec.
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= timeSec) {
      candidate = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // Active only if the playhead is still inside that word (not past its end).
  return candidate >= 0 && timeSec < words[candidate].end ? candidate : -1;
}

/**
 * Given the current playback time, return the time to jump to if it falls
 * inside a "cut" segment (the start of the next "keep" segment), or null
 * if playback should continue normally.
 */
export function nextPlaybackTime(edl: EDL, timeSec: number): number | null {
  const current = findSegmentAt(edl, timeSec);
  if (!current || current.status === "keep") return null;

  const next = edl.segments.find(
    (seg) => seg.status === "keep" && seg.start >= current.end
  );

  return next ? next.start : null;
}

/**
 * Given the current playback time, return the time continuous playback should
 * stop at, or null to keep playing. Playback stops (at the end of the last
 * kept segment) once the playhead is inside a trailing cut, or past every
 * segment, with no kept content ahead — without this, a cut at the very end of
 * the timeline plays through to the end of the file, because nextPlaybackTime
 * has no "keep" segment to skip to and reports "continue normally".
 */
export function stopPlaybackTime(edl: EDL, timeSec: number): number | null {
  const current = findSegmentAt(edl, timeSec);
  if (current?.status === "keep") return null;
  // Inside a cut, anything from its end onward counts as "ahead"; past every
  // segment, everything from the playhead onward does.
  const from = current ? current.end : timeSec;
  const keepAhead = edl.segments.some(
    (seg) => seg.status === "keep" && seg.start >= from
  );
  if (keepAhead) return null;
  const keeps = edl.segments.filter((seg) => seg.status === "keep");
  if (keeps.length === 0) return null;
  return Math.max(...keeps.map((seg) => seg.end));
}

/**
 * Extend the EDL with a trailing "cut" segment when the real media file runs
 * longer than the timeline. The EDL is sized from the transcript's duration
 * (Deepgram's decoded audio length), which can land short of the video track —
 * that uncovered tail otherwise paints filmstrip/waveform "residue" past the
 * last clip that can't be selected, deleted, or restored. Gaps below
 * MIN_SEGMENT_SECONDS are ignored (too small to be a segment; playback-stop
 * handles them). Returns the same EDL instance when nothing changes.
 */
export function extendToMediaDuration(edl: EDL, mediaDurationSeconds: number): EDL {
  if (!Number.isFinite(mediaDurationSeconds)) return edl;
  if (edl.segments.length === 0) return edl;
  const total = totalDuration(edl);
  if (mediaDurationSeconds - total <= MIN_SEGMENT_SECONDS + 1e-6) return edl;
  return {
    ...edl,
    segments: mergeAdjacent([
      ...edl.segments,
      { start: total, end: mediaDurationSeconds, status: "cut", reason: "silence" },
    ]),
  };
}

export function totalDuration(edl: EDL): number {
  if (edl.segments.length === 0) return 0;
  return Math.max(...edl.segments.map((s) => s.end));
}

export function keptDuration(edl: EDL): number {
  return edl.segments
    .filter((s) => s.status === "keep")
    .reduce((sum, s) => sum + (s.end - s.start), 0);
}

export function cutDuration(edl: EDL): number {
  return edl.segments
    .filter((s) => s.status === "cut")
    .reduce((sum, s) => sum + (s.end - s.start), 0);
}
