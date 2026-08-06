/**
 * Collapses a transcript against the EDL: raw Deepgram times in, post cut
 * times out, with removed time subtracted so a word reported at 2:35 really
 * sits at 2:35 on the final cut (spec _root/0001, AC-11, AC-12).
 *
 * **This lives in rough-cut, not in `@repo/transcript`, on purpose (AC-16).**
 * Applying cuts needs the EDL, and the EDL is this app's private editing
 * model. Sharing it with a package that b-roll also imports would run the
 * dependency the wrong way and weld b-roll to how rough-cut happens to
 * represent an edit today. So the cut is applied here, and the package
 * receives segments that are already post cut and knows nothing about how they
 * got that way.
 *
 * It sits beside `getKeepRanges` and `createTimeRemapper` in `plan.ts` because
 * it is the same arithmetic, with one deliberate difference: the export
 * remapper *drops* a sample that falls inside a cut, while this *clamps* a
 * word that a cut only partly removes. A razor through the middle of a word
 * should still report the part the creator kept, not silently lose it.
 *
 * Pure: no browser APIs and no database. Both surfaces that build a document —
 * the export modal in the browser and `GET /api/projects/:id/transcript` on
 * the server — call this same function, which is what makes their output
 * match field for field.
 */
import type { TranscriptSegment, TranscriptWord as DocumentWord } from "@repo/transcript";
import { minClipSeconds, type VideoFps } from "@repo/transcript/timebase";
import { roundMs, sanitizeWords, type EDL, type Transcript } from "@/lib/edl";
import { getKeepRanges, totalKeptSeconds, type KeepRange } from "@/lib/export/plan";

export interface CollapsedTranscript {
  /** Post cut segments, seconds, zero at the first frame of the final cut. */
  segments: TranscriptSegment[];
  /** Total runtime after cuts. Runtime, not speech — see `duration` below. */
  duration: number;
}

/** A kept range plus where it lands in the output once earlier cuts are removed. */
interface OffsetRange extends KeepRange {
  /** Output time of a source time `t` inside this range is `t + offset`. */
  offset: number;
}

function withOutputOffsets(ranges: KeepRange[]): OffsetRange[] {
  let cumulative = 0;
  return ranges.map((range) => {
    const offset = cumulative - range.start;
    cumulative += range.end - range.start;
    return { ...range, offset };
  });
}

/**
 * The largest surviving fragment of `[start, end)` after the cuts, or null
 * when nothing of it survives.
 *
 * Two cuts inside one word leave two disjoint fragments. AC-11 says the word
 * collapses to its **larger** fragment and never to two entries: the creator
 * said the word once, so the document must report it once, and reporting it
 * twice would put a word on the timeline that was never spoken twice.
 */
function largestSurvivingFragment(
  start: number,
  end: number,
  ranges: OffsetRange[]
): { start: number; end: number; offset: number } | null {
  let best: { start: number; end: number; offset: number } | null = null;
  for (const range of ranges) {
    const from = Math.max(start, range.start);
    const to = Math.min(end, range.end);
    if (to <= from) continue;
    if (!best || to - from > best.end - best.start) {
      best = { start: from, end: to, offset: range.offset };
    }
  }
  return best;
}

/**
 * Segment boundaries inside the kept ranges, in source time.
 *
 * Deepgram's utterance ends are where the speech naturally breaks, so they are
 * what a segment should break on — but a raw `utteranceEnd` is **not** a real
 * word time. Deepgram reports them close to, not equal to, the last word's end
 * (`retake-detection.ts` already has to compare the two with a tolerance for
 * exactly this reason). Using one directly would put a number in the document
 * that no measurement produced, which is the one thing the format promises
 * never to do. So each utterance end is snapped back to the `end` of the last
 * word at or before it, and that real measured time becomes the boundary.
 */
function utteranceBoundaries(
  words: { start: number; end: number }[],
  utteranceEnds: number[] | undefined
): number[] {
  if (!utteranceEnds?.length || words.length === 0) return [];
  const boundaries = new Set<number>();
  for (const utteranceEnd of utteranceEnds) {
    let snapped: number | null = null;
    for (const word of words) {
      if (word.end <= utteranceEnd) snapped = word.end;
      else break;
    }
    if (snapped !== null) boundaries.add(snapped);
  }
  return [...boundaries].sort((a, b) => a - b);
}

/** Splits one kept range at whichever boundaries fall strictly inside it. */
function splitRange(range: OffsetRange, boundaries: number[]): OffsetRange[] {
  const inside = boundaries.filter((b) => b > range.start && b < range.end);
  if (inside.length === 0) return [range];
  const pieces: OffsetRange[] = [];
  let cursor = range.start;
  for (const boundary of inside) {
    pieces.push({ start: cursor, end: boundary, offset: range.offset });
    cursor = boundary;
  }
  pieces.push({ start: cursor, end: range.end, offset: range.offset });
  return pieces;
}

/**
 * Turns a project's raw transcript and EDL into post cut segments.
 *
 * `fps` is required and is never defaulted: the one frame threshold that
 * decides whether a partly cut word survives is a function of the real frame
 * rate, so collapsing at a guessed rate would drop or keep words the creator's
 * actual footage would not.
 */
export function collapseTranscriptToCut(
  edl: EDL,
  transcript: Transcript,
  fps: VideoFps
): CollapsedTranscript {
  const keepRanges = getKeepRanges(edl);
  const duration = roundMs(totalKeptSeconds(keepRanges));
  const ranges = withOutputOffsets(keepRanges);
  const words = sanitizeWords(transcript.words ?? []);

  if (ranges.length === 0 || words.length === 0) {
    return { segments: [], duration };
  }

  // Epsilon because the threshold is compared against a difference of two
  // floats. A remainder of exactly one frame must survive, and
  // `1 - (1 - 1/30)` does not equal `1/30` in binary floating point — without
  // this, a word sitting exactly on the boundary is dropped by rounding error
  // rather than by the rule.
  const minSurvivingSeconds = minClipSeconds(fps) - 1e-9;

  // Clamp every word to what survives, then drop whatever is left too short to
  // occupy a single frame. A sliver below one frame cannot be shown or seeked
  // to at this rate, so reporting it would be reporting a position that does
  // not exist on the creator's timeline.
  const survivors: { source: { start: number; end: number }; word: DocumentWord }[] = [];
  for (const word of words) {
    const fragment = largestSurvivingFragment(word.start, word.end, ranges);
    if (!fragment) continue;
    if (fragment.end - fragment.start < minSurvivingSeconds) continue;
    survivors.push({
      source: { start: fragment.start, end: fragment.end },
      word: {
        word: word.word,
        start: roundMs(fragment.start + fragment.offset),
        end: roundMs(fragment.end + fragment.offset),
        // Passed through exactly as Deepgram measured it. Absent stays absent.
        ...(word.confidence === undefined ? {} : { confidence: word.confidence }),
      },
    });
  }

  const boundaries = utteranceBoundaries(words, transcript.utteranceEnds);
  const pieces = ranges.flatMap((range) => splitRange(range, boundaries));
  const segments: TranscriptSegment[] = [];

  // Walk survivors and pieces together, both already in ascending source
  // order, so every surviving word lands in exactly one segment. A filter per
  // piece would be simpler but could place one word in two segments if a
  // boundary ever fell mid word, and a word the creator said once must appear
  // once.
  let cursor = 0;
  for (const piece of pieces) {
    const inside: typeof survivors = [];
    while (cursor < survivors.length && survivors[cursor].source.start < piece.end) {
      inside.push(survivors[cursor]);
      cursor++;
    }
    // A kept range holding no surviving word carries no speech, so it emits no
    // segment — an empty segment gives the planner nothing and would spend one
    // of the segment count cap's slots. Its time still counts toward
    // `duration`, because duration is runtime and segments are speech.
    if (inside.length === 0) continue;
    // Taken across every word, not from the first and last by array order.
    // Words are ordered by `start`, but adjacent words may overlap (a fast
    // compound like "United States" often reports one word's end past the
    // next word's start), so the last word in the list is not necessarily the
    // one that ends last.
    const earliestStart = Math.min(...inside.map((s) => s.word.start));
    const latestEnd = Math.max(...inside.map((s) => s.word.end));
    segments.push({
      // The boundaries are the piece's own edges in the ordinary case. The
      // min/max is a guard, not a second rule: it only widens if a word's
      // clamped span reached past an edge. Either way the segment can never
      // exclude a word it holds.
      start: Math.min(roundMs(piece.start + piece.offset), earliestStart),
      end: Math.max(roundMs(piece.end + piece.offset), latestEnd),
      text: inside.map((s) => s.word.word).join(" "),
      words: inside.map((s) => s.word),
    });
  }

  return { segments, duration };
}
