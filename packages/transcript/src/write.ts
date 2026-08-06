/**
 * Writers: a transcript document rendered back out as a subtitle file.
 *
 * These are the mirror of `read.ts`. The document stays the carrier between
 * Rough Cut and B-Roll, because a subtitle file has nowhere to put the frame
 * rate, the per word confidence, or the provenance the planner needs. What a
 * subtitle file is good for is captions, and that is what these produce.
 *
 * The one property worth knowing: a document's times are already post cut,
 * with zero at the first frame of the final cut. So the file these emit lines
 * up with the exported MP4 with no second pass and no re-syncing. Drop the
 * `.srt` beside the `.mp4` and captions work.
 *
 * SRT is lossy on purpose. WebVTT keeps more: inline cue timestamps carry the
 * word grid, and `importVtt` reads exactly that format back, so a document
 * written as VTT round trips with its word timings intact. Neither format can
 * carry `fps`, `confidence`, or `source`, so neither is a substitute for the
 * document itself.
 */
import type { TranscriptDocument, TranscriptSegment } from "./document";

/** Media type for a SubRip file. */
export const SRT_MEDIA_TYPE = "application/x-subrip";
/** Media type for a WebVTT file. */
export const VTT_MEDIA_TYPE = "text/vtt";

/**
 * Seconds as a subtitle timestamp. SRT separates the milliseconds with a
 * comma, WebVTT with a period; that punctuation is the only difference between
 * the two formats' timing lines.
 *
 * Negative input clamps to zero rather than emitting a negative timestamp, and
 * milliseconds are rounded rather than truncated so a cue does not drift a
 * millisecond earlier than the document says.
 */
function formatTimestamp(seconds: number, millisecondSeparator: "," | "."): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const ms = total % 1000;
  const totalSeconds = Math.floor(total / 1000);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mins = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}${millisecondSeparator}${pad(ms, 3)}`;
}

/**
 * A cue with no duration is invalid in both formats and is silently dropped by
 * most players, so a segment that collapsed to a single instant is given a
 * minimum visible span rather than emitted as a zero length cue.
 */
const MIN_CUE_SECONDS = 0.001;

function cueEnd(segment: TranscriptSegment): number {
  return Math.max(segment.end, segment.start + MIN_CUE_SECONDS);
}

/** Segments worth writing as a cue: a caption with no text is nothing to show. */
function displayable(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments.filter((segment) => segment.text.trim() !== "");
}

/**
 * Caption shaping limits. A document's segments run one whole utterance long,
 * which is the right unit for a planner deciding "does this passage deserve a
 * scene" and the wrong unit for text on a screen: a real transcript produced a
 * first segment of twelve and a half seconds carrying thirty five words, which
 * no player can display usefully.
 *
 * These follow ordinary subtitle practice: about forty two characters a line,
 * two lines at most, and a few seconds on screen.
 */
const MAX_LINE_CHARS = 42;
const MAX_CUE_LINES = 2;
const MAX_CUE_CHARS = MAX_LINE_CHARS * MAX_CUE_LINES;
const MAX_CUE_SECONDS = 6;

/**
 * Splits a segment into caption sized cues, breaking only between words.
 *
 * Every boundary this produces is a real measured word time: a cue starts at
 * some word's `start` and ends at some word's `end`. Nothing is interpolated,
 * so the shorter cues are as honest as the long one was.
 *
 * A segment carrying no words (a plain subtitle import, which never had a word
 * grid) cannot be split without inventing a boundary, so it is left whole.
 */
function toCaptionCues(segment: TranscriptSegment): TranscriptSegment[] {
  const words = segment.words;
  if (!words || words.length === 0) return [segment];

  const cues: TranscriptSegment[] = [];
  let current: typeof words = [];
  let chars = 0;

  const flush = () => {
    if (current.length === 0) return;
    cues.push({
      start: current[0].start,
      // Across the whole run, because adjacent words may overlap and the last
      // word is not always the one that ends last.
      end: Math.max(...current.map((w) => w.end)),
      text: current.map((w) => w.word).join(" "),
      words: current,
    });
    current = [];
    chars = 0;
  };

  for (const word of words) {
    const added = chars === 0 ? word.word.length : chars + 1 + word.word.length;
    const tooLong = added > MAX_CUE_CHARS;
    const tooSlow =
      current.length > 0 && word.end - current[0].start > MAX_CUE_SECONDS;
    if (current.length > 0 && (tooLong || tooSlow)) flush();
    current.push(word);
    chars = current.length === 1 ? word.word.length : chars + 1 + word.word.length;
  }
  flush();

  return cues.length > 0 ? cues : [segment];
}

/**
 * Breaks a cue's text across at most two lines at a word boundary, preferring
 * the break nearest the middle so the two lines look balanced rather than one
 * full line above a single trailing word.
 */
function wrapCue(text: string): string {
  if (text.length <= MAX_LINE_CHARS) return text;
  const words = text.split(" ");
  const middle = text.length / 2;
  let best = "";
  let bestDistance = Infinity;
  let bestFitting = "";
  let bestFittingDistance = Infinity;

  for (let i = 1; i < words.length; i++) {
    const head = words.slice(0, i).join(" ");
    const tail = text.slice(head.length + 1);
    const distance = Math.abs(head.length - middle);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = head;
    }
    // Prefer a break where *both* lines clear the limit; the most balanced
    // break alone can leave one line a few characters over.
    if (
      head.length <= MAX_LINE_CHARS &&
      tail.length <= MAX_LINE_CHARS &&
      distance < bestFittingDistance
    ) {
      bestFittingDistance = distance;
      bestFitting = head;
    }
  }

  const head = bestFitting || best;
  return `${head}\n${text.slice(head.length + 1)}`;
}

export interface SubtitleOptions {
  /**
   * Split long segments into caption sized cues at real word boundaries. On by
   * default, because a document's segments are utterance length and unreadable
   * as captions. Turn it off to get exactly one cue per segment.
   */
  captionCues?: boolean;
}

function cuesFor(
  document: TranscriptDocument,
  captionCues: boolean
): TranscriptSegment[] {
  const segments = displayable(document.segments);
  if (!captionCues) return segments;
  return segments.flatMap(toCaptionCues);
}

/**
 * Renders the document as a SubRip (.srt) file, one cue per segment.
 *
 * Everything the format cannot hold is dropped: the frame rate, the word grid,
 * per word confidence, and the provenance. That is the trade a caption file
 * makes, and it is why this is an output format and never the handoff.
 */
export function toSrt(
  document: TranscriptDocument,
  options: SubtitleOptions = {}
): string {
  const segments = cuesFor(document, options.captionCues ?? true);
  if (segments.length === 0) return "";

  return (
    segments
      .map((segment, index) => {
        const start = formatTimestamp(segment.start, ",");
        const end = formatTimestamp(cueEnd(segment), ",");
        // SRT cue numbering is one based and must be contiguous.
        return `${index + 1}\n${start} --> ${end}\n${wrapCue(segment.text.trim())}`;
      })
      .join("\n\n") + "\n"
  );
}

export interface VttOptions extends SubtitleOptions {
  /**
   * Write each word's own timing as an inline cue timestamp, the WebVTT
   * karaoke form. Keeps the word grid a plain caption file would lose, and is
   * read back by `importVtt`. On by default; segments with no words are
   * unaffected either way.
   */
  inlineWordTimings?: boolean;
}

/**
 * A cue's payload, with **every** word preceded by its own timestamp when the
 * segment carries word timings.
 *
 * Including the first word's marker even when it matches the cue's own start
 * looks redundant, and is not. `importVtt` reads words from the markers alone,
 * so text sitting before the first marker is not a timed word to it and is
 * dropped. Skipping that one marker silently lost the opening word of every
 * cue on the way back in. Each marker is the word's real measured start, so
 * writing them all adds no invented number.
 */
function vttCueText(segment: TranscriptSegment, inlineWordTimings: boolean): string {
  const words = segment.words;
  if (!inlineWordTimings || !words || words.length === 0) {
    return segment.text.trim();
  }
  return words
    .map((word) => `<${formatTimestamp(word.start, ".")}>${word.word}`)
    .join(" ")
    .trim();
}

/**
 * Renders the document as a WebVTT (.vtt) file.
 *
 * The richer of the two subtitle outputs: inline cue timestamps preserve every
 * word's own timing, so this round trips through `importVtt` with the word
 * grid intact. `fps`, `confidence`, and `source` still have nowhere to live.
 */
export function toVtt(document: TranscriptDocument, options: VttOptions = {}): string {
  const inlineWordTimings = options.inlineWordTimings ?? true;
  const segments = cuesFor(document, options.captionCues ?? true);

  const cues = segments.map((segment) => {
    const start = formatTimestamp(segment.start, ".");
    const end = formatTimestamp(cueEnd(segment), ".");
    const text = vttCueText(segment, inlineWordTimings);
    // Wrapping only applies to plain text: a line broken in the middle of the
    // inline timestamp form would split a word off from its own marker.
    return `${start} --> ${end}\n${inlineWordTimings && segment.words?.length ? text : wrapCue(text)}`;
  });

  // The WEBVTT header is mandatory, so an empty document is still a valid file.
  return [`WEBVTT`, ...cues].join("\n\n") + "\n";
}
