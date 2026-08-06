import { describe, it, expect } from "vitest";
import {
  importSrt,
  importVtt,
  parseTranscriptDocument,
  TranscriptParseError,
} from "./read";
import { buildTranscriptDocument, serializeTranscriptDocument } from "./build";
import { MAX_DOCUMENT_BYTES } from "./document";

const SRT = `1
00:00:01,000 --> 00:00:04,000
Hello there

2
00:00:05,500 --> 00:00:08,250
Second cue
across two lines
`;

const VTT_WITH_INLINE = `WEBVTT

00:00:01.000 --> 00:00:04.000
<00:00:01.000>Hello <00:00:02.000>there

00:00:05.000 --> 00:00:06.000
No inline timing here
`;

describe("parseTranscriptDocument", () => {
  const document = buildTranscriptDocument({
    segments: [{ start: 0, end: 2, text: "hi" }],
    fps: { numerator: 30, denominator: 1 },
    duration: 2,
    wordsAligned: false,
    source: { kind: "rough-cut", projectId: "p1", edlFingerprint: "abc" },
  });

  it("round-trips a document this repo wrote", () => {
    expect(parseTranscriptDocument(serializeTranscriptDocument(document))).toEqual(document);
  });

  it("rejects text that is not JSON", () => {
    expect(() => parseTranscriptDocument("not json")).toThrow(TranscriptParseError);
  });

  it("rejects a file over the byte cap, naming the limit (AC-13)", () => {
    const oversized = JSON.stringify({ padding: "x".repeat(MAX_DOCUMENT_BYTES) });
    expect(() => parseTranscriptDocument(oversized)).toThrow(/byte limit/);
  });

  it("rejects a document over the segment count cap, naming that limit instead (AC-13)", () => {
    const segments = Array.from({ length: 20_001 }, (_, i) => ({
      start: i,
      end: i + 0.5,
      text: "x",
    }));
    expect(() => parseTranscriptDocument(JSON.stringify({ ...document, segments }))).toThrow(
      /segment limit/
    );
  });

  it("reports which field failed rather than a bare failure", () => {
    const broken = JSON.stringify({ ...document, duration: -1 });
    expect(() => parseTranscriptDocument(broken)).toThrow(/duration/);
  });
});

describe("importSrt", () => {
  it("keeps each cue's own timing", () => {
    const document = importSrt(SRT);
    expect(document.segments.map((s) => [s.start, s.end])).toEqual([
      [1, 4],
      [5.5, 8.25],
    ]);
  });

  it("produces no words at all — SRT has no word timing to report (AC-5)", () => {
    for (const segment of importSrt(SRT).segments) {
      expect(segment.words).toBeUndefined();
    }
  });

  it("reports a null frame rate rather than guessing one (AC-6)", () => {
    expect(importSrt(SRT).fps).toBeNull();
  });

  it("marks itself an import with no project and no fingerprint", () => {
    expect(importSrt(SRT).source).toEqual({
      kind: "import",
      projectId: null,
      edlFingerprint: null,
    });
  });

  it("joins a cue's wrapped lines into one text", () => {
    expect(importSrt(SRT).segments[1].text).toBe("Second cue across two lines");
  });

  it("takes duration from the last cue's end, a real supplied time", () => {
    expect(importSrt(SRT).duration).toBe(8.25);
  });

  it("parses an empty file to a valid, empty document (AC-14)", () => {
    const document = importSrt("");
    expect(document.segments).toEqual([]);
    expect(document.duration).toBe(0);
  });

  it("rejects an oversized upload naming the byte limit (AC-13)", () => {
    expect(() => importSrt("x".repeat(MAX_DOCUMENT_BYTES + 1))).toThrow(/byte limit/);
  });
});

describe("importVtt", () => {
  it("reads inline cue timestamps into words", () => {
    const [first] = importVtt(VTT_WITH_INLINE).segments;
    expect(first.words).toEqual([
      { word: "Hello", start: 1, end: 2 },
      { word: "there", start: 2, end: 4 },
    ]);
  });

  it("decides per cue, not per file — a cue with no inline timing gets no words", () => {
    const [, second] = importVtt(VTT_WITH_INLINE).segments;
    expect(second.words).toBeUndefined();
    expect(second.text).toBe("No inline timing here");
  });

  it("omits confidence on every word — a subtitle never measured one (AC-6)", () => {
    for (const word of importVtt(VTT_WITH_INLINE).segments[0].words!) {
      expect(word).not.toHaveProperty("confidence");
    }
  });

  it("strips inline timestamps and styling tags out of the display text", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.000
<00:00:01.000><c.yellow>Styled</c> word
`;
    expect(importVtt(vtt).segments[0].text).toBe("Styled word");
  });

  it("skips a cue identifier line", () => {
    const vtt = `WEBVTT

intro
00:00:01.000 --> 00:00:02.000
Text
`;
    expect(importVtt(vtt).segments).toHaveLength(1);
  });

  it("ignores cue settings after the end time", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.000 align:start position:10%
Text
`;
    expect(importVtt(vtt).segments[0].end).toBe(2);
  });

  it("accepts MM:SS.mmm timestamps", () => {
    const vtt = `WEBVTT

01:30.500 --> 01:32.000
Short form
`;
    expect(importVtt(vtt).segments[0].start).toBe(90.5);
  });

  it("keeps a multi-word timed run as one entry rather than inventing a boundary inside it", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.000
<00:00:01.000>two words <00:00:02.000>then
`;
    expect(importVtt(vtt).segments[0].words).toEqual([
      { word: "two words", start: 1, end: 2 },
      { word: "then", start: 2, end: 3 },
    ]);
  });
});
