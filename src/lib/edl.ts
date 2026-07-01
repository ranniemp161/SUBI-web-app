/**
 * EDL (Edit Decision List) types and pure helper functions.
 *
 * Times throughout this module are in seconds (matching the transcript's
 * word timestamps), not milliseconds — convert at the UI boundary where
 * `durationMs` (stored in Postgres) is involved.
 */

import { detectRetakes } from "./retake-detection";

/** A single transcribed word with timing, matching the Deepgram/whisper response shape. */
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

export type EDLReason = "silence" | "retake" | "manual" | null;

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

export interface EDL {
  segments: EDLSegment[];
}

/** Gaps between words longer than this are flagged as dead air. */
const SILENCE_GAP_SECONDS = 2;

/**
 * An initial auto-build that would keep less than this fraction of the clip is
 * treated as a data problem (e.g. missing word timestamps), not a real edit —
 * we fall back to keep-all rather than silently delete the whole video.
 */
const MIN_INITIAL_KEEP_FRACTION = 0.1;

/**
 * Drop transcript words with unusable timing before they reach the EDL math.
 * ASR (faster-whisper especially) can return null/NaN word timestamps; those
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
  durationSeconds: number
): EDL {
  const cuts: { start: number; end: number }[] = [];
  let prevEnd = 0;

  for (const word of sanitizeWords(words)) {
    if (word.start - prevEnd > SILENCE_GAP_SECONDS) {
      cuts.push({ start: prevEnd, end: word.start });
    }
    prevEnd = Math.max(prevEnd, word.end);
  }

  if (durationSeconds - prevEnd > SILENCE_GAP_SECONDS) {
    cuts.push({ start: prevEnd, end: durationSeconds });
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
export function buildInitialEDL(words: TranscriptWord[], durationSeconds: number): EDL {
  const clean = sanitizeWords(words);

  // No usable word timing → we can't trust any cut. Keep everything rather
  // than guess (a degenerate transcript must never auto-delete the video).
  if (clean.length === 0 || durationSeconds <= 0) {
    return keepAll(durationSeconds);
  }

  let edl = generateInitialEDL(clean, durationSeconds);
  for (const retake of detectRetakes(clean)) {
    edl = setRangeStatus(edl, retake.cutStart, retake.cutEnd, "cut", "retake");
  }

  // Safety floor: an initial auto-cut that removes (nearly) the whole clip is
  // almost certainly bad input, not a real edit. Refuse it and keep everything.
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

  return { segments: mergeAdjacent(result) };
}

/** Cut the time range spanned by the given words (manual cut, e.g. via Delete key). */
export function cutWords(edl: EDL, words: TranscriptWord[]): EDL {
  if (words.length === 0) return edl;

  const start = Math.min(...words.map((w) => w.start));
  const end = Math.max(...words.map((w) => w.end));

  return setRangeStatus(edl, start, end, "cut", "manual");
}

/** Restore a cut segment back to "keep". */
export function restoreSegment(edl: EDL, segment: EDLSegment): EDL {
  return setRangeStatus(edl, segment.start, segment.end, "keep", null);
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

  return didSplit ? { segments } : edl;
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

  return { segments };
}

/** Find the EDL segment containing a given time, if any. */
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
