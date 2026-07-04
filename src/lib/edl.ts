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
}

export interface Transcript {
  words: TranscriptWord[];
  text: string;
  duration: number;
  language?: string;
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
 * Drop transcript words with unusable timing before they reach the EDL math.
 * ASR output can contain null/NaN word timestamps; those
 * coerce to 0 in arithmetic, which collapses every gap check and leaves
 * `prevEnd` stuck at 0 — so the trailing-gap branch marks the entire clip as
 * one giant "silence" cut. Keep only finite, forward-ordered words.
 */
export function sanitizeWords(words: TranscriptWord[]): TranscriptWord[] {
  return words
    .filter(
      (w) =>
        Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start
    )
    .sort((a, b) => a.start - b.start);
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
  settings: DetectionSettings
): EDL {
  let edl = generateInitialEDL(clean, durationSeconds, settings);
  // Repetitions before retakes: where a full retake span covers a stutter,
  // the later retake pass re-labels it — the broader diagnosis wins.
  for (const rep of detectRepetitions(clean)) {
    edl = setRangeStatus(edl, rep.cutStart, rep.cutEnd, "cut", "repetition");
  }
  for (const retake of detectRetakes(clean, settings.retakeSimilarity)) {
    edl = setRangeStatus(edl, retake.cutStart, retake.cutEnd, "cut", "retake");
  }
  return edl;
}

export function buildInitialEDL(
  words: TranscriptWord[],
  durationSeconds: number,
  settings: DetectionSettings = DEFAULT_SETTINGS
): EDL {
  const clean = sanitizeWords(words);

  // No usable word timing → we can't trust any cut. Keep everything rather
  // than guess (a degenerate transcript must never auto-delete the video).
  if (clean.length === 0 || durationSeconds <= 0) {
    return keepAll(durationSeconds);
  }

  const edl = buildAutoLayer(clean, durationSeconds, settings);

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

/** Cut the time range spanned by the given words (manual cut, e.g. via Delete key). */
export function cutWords(edl: EDL, words: TranscriptWord[]): EDL {
  if (words.length === 0) return edl;

  const start = Math.min(...words.map((w) => w.start));
  const end = Math.max(...words.map((w) => w.end));

  return setRangeStatus(edl, start, end, "cut", "manual");
}

/**
 * Cut each word's own time range, leaving everything between the words
 * untouched. `cutWords` cuts one span from the first word to the last — right
 * for a contiguous transcript selection, catastrophic for scattered words
 * (fillers dotted through a video would take all the speech between them).
 */
export function cutEachWord(edl: EDL, words: TranscriptWord[]): EDL {
  let next = edl;
  for (const w of words) {
    next = setRangeStatus(next, w.start, w.end, "cut", "manual");
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
  settings: DetectionSettings = DEFAULT_SETTINGS
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
  let next = buildAutoLayer(clean, durationSeconds, settings);

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
  const EPS = 1e-4;
  const segments: EDLSegment[] = [];
  let didSplit = false;

  for (const seg of edl.segments) {
    if (
      seg.status === "keep" &&
      timeSec > seg.start + EPS &&
      timeSec < seg.end - EPS
    ) {
      segments.push({ ...seg, end: timeSec });
      segments.push({ ...seg, start: timeSec, split: true });
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
  const clamped = Math.min(Math.max(newBoundaryTime, min), max);

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
