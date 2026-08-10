import type { TranscriptSegment } from "@repo/transcript";

/**
 * Merge transcript segments into utterances, the unit the planner reasons in
 * (spec `broll/0003` AC-48).
 *
 * **Why this exists.** The two intake paths hand us different shapes and both
 * are correct. A Ruff Cut handoff already carries one segment per utterance
 * (measured: 33 segments over 6:35). A subtitle upload carries one segment per
 * caption cue (measured: 228 segments over 8:12, roughly one every two
 * seconds). The planner assumes the utterance shape in two places — the
 * `ceil(runtime × 1.2)` scene target, and the requirement that each scene's
 * label identifies its source line. A cue reading "was the deadline" identifies
 * nothing. So both paths converge here before anything is planned.
 *
 * Pure and dependency free: no database, no network, no `server-only`. The
 * merge is the piece most likely to need tuning against real speech, so it is
 * also the piece that must be cheap to unit test.
 */

/**
 * A pause at or below this is inside one utterance; a longer one ends it.
 *
 * **Provisional at 700ms and unmeasured** (spec `0003` Follow-up). The obvious
 * reference points are Rough Cut's own thresholds, both calibrated on real
 * speech: `PAUSE_MARKER_SECONDS` (0.5s, the silence worth telling the AI Cut
 * model about) and `PHRASE_PAUSE_SECONDS` (0.35s, the gap that separates a
 * restart from fluid repetition). This sits above both on purpose — those two
 * split *within* a thought, and an utterance boundary is a coarser thing — but
 * "above both" is reasoning, not measurement. Tune it against both intake
 * paths before trusting it.
 */
export const UTTERANCE_GAP_MS = 700;

/**
 * An utterance also ends once it has run this long, whatever the text and the
 * gaps say.
 *
 * **This exists because the first live run against project `0620` produced one
 * utterance for the entire 9:46 transcript.** Auto-captions carry no
 * punctuation at all and their cues butt up against each other, so neither of
 * the other two signals ever fired: 254 cues merged into a single line, the
 * model was handed one numbered item, and eleven of the twelve scenes it
 * proposed cited lines that did not exist. Two signals cannot segment a
 * transcript that offers neither of them, and that transcript is precisely the
 * case AC-48 exists to handle.
 *
 * Twelve seconds is the measured Ruff Cut utterance density (roughly one
 * segment per twelve seconds, from the skeleton's own measurement), so a
 * punctuated handoff never reaches this cap and is unaffected. It only ever
 * fires on the shape that would otherwise not be split at all.
 */
export const MAX_UTTERANCE_MS = 12_000;

/**
 * Sentence ending punctuation. A segment whose text ends in one of these closes
 * its utterance regardless of the gap that follows.
 */
const SENTENCE_ENDINGS = [".", "?", "!", "…"];

/**
 * One whole thought, with the timing of the segments it was built from.
 *
 * `index` is the position in the returned list, and it is the planner's whole
 * addressing scheme: the model cites an utterance by index and never restates
 * its timing, so a scene's `source_start_ms` comes from this merge rather than
 * from anything the model wrote. A model cannot misreport a number it was never
 * asked to produce.
 */
export type Utterance = {
  index: number;
  text: string;
  startMs: number;
  endMs: number;
};

/** Seconds in the document, milliseconds everywhere the database is involved. */
function toMs(seconds: number): number {
  return Math.round(seconds * 1000);
}

function endsSentence(text: string): boolean {
  const trimmed = text.trimEnd();
  return SENTENCE_ENDINGS.some((mark) => trimmed.endsWith(mark));
}

/**
 * Group consecutive segments into utterances.
 *
 * A boundary falls after a segment when **either** signal fires (spec `0003`,
 * Value sourcing): its text ends a sentence, **or** the gap to the next segment
 * exceeds `UTTERANCE_GAP_MS`. Either alone is sufficient, which is what makes
 * this work on both paths — a caption cue with no terminal punctuation still
 * ends on a pause, and a pause mid sentence still splits.
 *
 * Utterances that merge to empty text are dropped: they carry no line a user
 * could recognise, so proposing a scene against one is meaningless. Indexes are
 * assigned after that drop, so they are always contiguous over what the model
 * actually sees.
 */
export function mergeSegmentsIntoUtterances(
  segments: readonly TranscriptSegment[]
): Utterance[] {
  const utterances: Utterance[] = [];

  // Written as an explicit loop rather than a reduce: the boundary test needs
  // both the current segment and the next one, and the flush needs the members
  // it collected, which reads worse threaded through an accumulator.
  let group: TranscriptSegment[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    group.push(segment);

    const next = segments[i + 1];
    const gapMs = next ? toMs(next.start) - toMs(segment.end) : Infinity;
    const elapsedMs = toMs(segment.end) - toMs(group[0].start);
    const boundary =
      !next ||
      endsSentence(segment.text) ||
      gapMs > UTTERANCE_GAP_MS ||
      // The backstop for a transcript offering neither of the other signals.
      elapsedMs >= MAX_UTTERANCE_MS;
    if (!boundary) continue;

    const text = group
      .map((s) => s.text.trim())
      .filter((t) => t.length > 0)
      .join(" ");

    if (text.length > 0) {
      utterances.push({
        index: utterances.length,
        text,
        startMs: toMs(group[0].start),
        endMs: toMs(group[group.length - 1].end),
      });
    }

    group = [];
  }

  return utterances;
}

/**
 * Render the merged transcript the way the model sees it: one numbered line per
 * utterance, with its start timecode.
 *
 * The index is the contract. Every scene the model returns cites one of these
 * numbers, and the planner resolves timing and provenance from the utterance
 * that number names rather than from anything the model wrote back.
 */
export function formatUtterancesForPrompt(
  utterances: readonly Utterance[]
): string {
  return utterances
    .map((u) => `[${u.index}] (${formatClock(u.startMs)}) ${u.text}`)
    .join("\n");
}

/** `2:35`, or `1:02:35` once past an hour. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}
