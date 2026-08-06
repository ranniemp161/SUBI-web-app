/**
 * Readers: the three ways a transcript document comes into existence from a
 * file (spec _root/0001, AC-3, AC-6, AC-13).
 *
 * - `parseTranscriptDocument` reads a document this repo wrote.
 * - `importSrt` and `importVtt` read a subtitle file from someone who has
 *   never used Rough Cut.
 *
 * The subtitle importers exist to make that second creator representable
 * **honestly**. A subtitle file carries cue timing and nothing else: no frame
 * rate, no confidence, and usually no word timing. So an imported document
 * gets `fps: null` rather than a guessed rate, its words omit `confidence`
 * entirely rather than defaulting it, and word timings are never interpolated
 * from a cue's span. What was not measured is absent.
 */
import {
  MAX_DOCUMENT_BYTES,
  MAX_SEGMENT_COUNT,
  transcriptDocumentSchema,
  type TranscriptDocument,
  type TranscriptSegment,
  type TranscriptWord,
} from "./document";
import { buildTranscriptDocument } from "./build";

/**
 * A file was rejected, with a message naming what it violated. Typed so a
 * route or an upload control can show the reason rather than a generic
 * failure — "which limit did I hit" is the actionable part (AC-13).
 */
export class TranscriptParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptParseError";
  }
}

/** UTF-8 byte length, which is what the byte cap is actually about. */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Rejects an oversized file before any parsing work happens, naming the limit
 * hit. Applied to every reader, not just the JSON one: an oversized SRT is the
 * same abuse shape as an oversized document.
 */
function assertWithinByteCap(text: string): void {
  const bytes = byteLength(text);
  if (bytes > MAX_DOCUMENT_BYTES) {
    throw new TranscriptParseError(
      `Transcript is ${bytes} bytes, over the ${MAX_DOCUMENT_BYTES} byte limit.`
    );
  }
}

function assertWithinSegmentCap(count: number): void {
  if (count > MAX_SEGMENT_COUNT) {
    throw new TranscriptParseError(
      `Transcript has ${count} segments, over the ${MAX_SEGMENT_COUNT} segment limit.`
    );
  }
}

/**
 * Reads and validates a transcript document this repo wrote. Both caps are
 * checked and each names itself; everything else is the schema's job, so the
 * runtime check and the type can never disagree (AC-3).
 */
export function parseTranscriptDocument(text: string): TranscriptDocument {
  assertWithinByteCap(text);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new TranscriptParseError("Transcript is not valid JSON.");
  }

  // Checked before the schema so an over-count file reports the count limit by
  // name, rather than surfacing as a generic array-too-long validation error.
  if (raw !== null && typeof raw === "object" && Array.isArray((raw as { segments?: unknown }).segments)) {
    assertWithinSegmentCap((raw as { segments: unknown[] }).segments.length);
  }

  const result = transcriptDocumentSchema.safeParse(raw);
  if (!result.success) {
    throw new TranscriptParseError(
      `Transcript is not a valid document: ${result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`
    );
  }
  return result.data;
}

/** One parsed subtitle cue, before it becomes a segment. */
interface Cue {
  start: number;
  end: number;
  /** Raw payload lines, still carrying any inline timestamps and tags. */
  lines: string[];
}

/**
 * `HH:MM:SS,mmm` (SRT) or `HH:MM:SS.mmm` / `MM:SS.mmm` (WebVTT) to seconds.
 * Returns null for anything that is not a timestamp, so a caller can tell a
 * timing line from a cue identifier without guessing.
 */
function parseTimestamp(value: string): number | null {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/.exec(value.trim());
  if (!match) return null;
  const [, hours, minutes, seconds, fraction] = match;
  return (
    Number(hours ?? 0) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(fraction.padEnd(3, "0")) / 1000
  );
}

/** The `-->` line of a cue, if this line is one. Settings after the end time are ignored. */
function parseTimingLine(line: string): { start: number; end: number } | null {
  const parts = line.split("-->");
  if (parts.length !== 2) return null;
  const start = parseTimestamp(parts[0]);
  // WebVTT allows cue settings after the end time ("00:00:04.000 align:start").
  const end = parseTimestamp(parts[1].trim().split(/\s+/)[0]);
  if (start === null || end === null) return null;
  return { start, end };
}

/**
 * Splits an SRT or WebVTT body into cues. Shared because the two formats
 * differ only in their timestamp separator and their optional header, both of
 * which are already handled above.
 */
function parseCues(text: string): Cue[] {
  const blocks = text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/^WEBVTT[^\n]*\n/, "")
    .split(/\n{2,}/);

  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    if (lines.length === 0) continue;
    // A cue may lead with an identifier line (a number in SRT, any label in
    // WebVTT); the timing line is whichever one parses as timing.
    const timingIndex = lines.findIndex((line) => parseTimingLine(line) !== null);
    if (timingIndex === -1) continue;
    const timing = parseTimingLine(lines[timingIndex])!;
    const payload = lines.slice(timingIndex + 1);
    if (payload.length === 0) continue;
    cues.push({ start: timing.start, end: timing.end, lines: payload });
  }
  return cues;
}

/** Strips WebVTT styling tags (`<c.classname>`, `<b>`, `<v Name>`) from display text. */
function stripTags(text: string): string {
  return text.replace(/<\/?[a-zA-Z][^>]*>/g, "");
}

const INLINE_TIMESTAMP = /<(\d{1,2}:\d{1,2}:\d{1,2}[.,]\d{1,3}|\d{1,2}:\d{1,2}[.,]\d{1,3})>/g;

/**
 * Reads a WebVTT cue's inline timestamps into words, or returns null when the
 * cue carries none.
 *
 * Each inline timestamp opens a timed run, and that run becomes **one** word
 * entry holding its text verbatim. A run that contains two words stays one
 * entry: splitting it would mean inventing a boundary between them, and the
 * cue never measured one. Deciding this per cue rather than per file is
 * deliberate — a file where only some cues carry inline timestamps parses
 * successfully with words on exactly those cues, because mixed precision is a
 * fact about the file, not an error.
 *
 * No `confidence` is set on any word here: a subtitle file never measured one
 * (AC-6).
 */
function wordsFromInlineTimestamps(cue: Cue): TranscriptWord[] | null {
  const payload = cue.lines.join(" ");
  const matches = [...payload.matchAll(INLINE_TIMESTAMP)];
  if (matches.length === 0) return null;

  const words: TranscriptWord[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const start = parseTimestamp(match[1]);
    if (start === null) continue;
    const from = match.index + match[0].length;
    const to = i + 1 < matches.length ? matches[i + 1].index : payload.length;
    const word = stripTags(payload.slice(from, to)).trim();
    if (word === "") continue;
    // The run ends where the next one starts, or at the cue's own end for the
    // last run. Both are measured times the file supplied.
    const nextStart = i + 1 < matches.length ? parseTimestamp(matches[i + 1][1]) : null;
    const end = nextStart ?? cue.end;
    if (end < start) continue;
    words.push({ word, start, end });
  }
  return words.length > 0 ? words : null;
}

function cueText(cue: Cue): string {
  return stripTags(cue.lines.join(" ").replace(INLINE_TIMESTAMP, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Turns parsed cues into a document. `duration` is the last cue's end — a real
 * time the file supplied, not an estimate of the video's runtime, which a
 * subtitle file simply does not contain.
 */
function documentFromCues(cues: Cue[], withInlineWords: boolean): TranscriptDocument {
  assertWithinSegmentCap(cues.length);

  const segments: TranscriptSegment[] = cues.map((cue) => {
    const words = withInlineWords ? wordsFromInlineTimestamps(cue) : null;
    const segment: TranscriptSegment = {
      start: cue.start,
      end: cue.end,
      text: cueText(cue),
    };
    // Absent, not an empty array: "this cue has no word timing" and "this cue
    // has zero words" are different claims.
    return words ? { ...segment, words } : segment;
  });

  return buildTranscriptDocument({
    segments,
    // No source for a frame rate exists in a subtitle file, so it stays null
    // rather than being guessed.
    fps: null,
    duration: segments.length > 0 ? segments[segments.length - 1].end : 0,
    wordsAligned: false,
    source: { kind: "import", projectId: null, edlFingerprint: null },
  });
}

/**
 * Reads a SubRip (.srt) file. SRT has no inline word timing at all, so every
 * segment comes back without `words` — which is the honest representation, and
 * the shape consumers must handle forever (AC-5).
 */
export function importSrt(text: string): TranscriptDocument {
  assertWithinByteCap(text);
  return documentFromCues(parseCues(text), false);
}

/**
 * Reads a WebVTT (.vtt) file, keeping each cue's own timing and reading inline
 * cue timestamps into words wherever a cue carries them (AC-5, AC-6).
 */
export function importVtt(text: string): TranscriptDocument {
  assertWithinByteCap(text);
  return documentFromCues(parseCues(text), true);
}
