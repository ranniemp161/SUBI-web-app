import { describe, it, expect } from "vitest";
import { toSrt, toVtt } from "./write";
import { buildTranscriptDocument } from "./build";
import { importSrt, importVtt } from "./read";
import type { TranscriptSegment } from "./document";

function doc(segments: TranscriptSegment[]) {
  return buildTranscriptDocument({
    segments,
    fps: { numerator: 30000, denominator: 1001 },
    duration: segments.length ? segments[segments.length - 1].end : 0,
    wordsAligned: true,
    source: { kind: "rough-cut", projectId: "p1", edlFingerprint: "abc" },
    generatedAt: "2026-08-06T00:00:00.000Z",
  });
}

const WITH_WORDS = doc([
  {
    start: 1,
    end: 4,
    text: "Hello there",
    words: [
      { word: "Hello", start: 1, end: 2, confidence: 0.9 },
      { word: "there", start: 2, end: 4, confidence: 0.8 },
    ],
  },
  { start: 5.5, end: 8.25, text: "Second cue" },
]);

describe("toSrt", () => {
  it("writes one numbered cue per segment with comma-separated milliseconds", () => {
    expect(toSrt(WITH_WORDS)).toBe(
      "1\n" +
        "00:00:01,000 --> 00:00:04,000\n" +
        "Hello there\n" +
        "\n" +
        "2\n" +
        "00:00:05,500 --> 00:00:08,250\n" +
        "Second cue\n"
    );
  });

  it("splits a long segment into caption sized cues at real word boundaries", () => {
    // A document's segments run a whole utterance long, which is the right
    // unit for the planner and unreadable on screen. A real transcript's first
    // segment was 12.5 seconds and 35 words on one line.
    const words = Array.from({ length: 40 }, (_, i) => ({
      word: `word${i}`,
      start: i * 0.4,
      end: i * 0.4 + 0.3,
    }));
    const srt = toSrt(
      doc([{ start: 0, end: 16, text: words.map((w) => w.word).join(" "), words }])
    );

    const cues = srt.trim().split("\n\n");
    expect(cues.length).toBeGreaterThan(1);

    for (const cue of cues) {
      const [, timing, ...textLines] = cue.split("\n");
      // At most two lines, each within the readable width.
      expect(textLines.length).toBeLessThanOrEqual(2);
      for (const line of textLines) expect(line.length).toBeLessThanOrEqual(42);

      // Every boundary is a real word time, never an interpolated one.
      const [from, to] = timing.split(" --> ");
      const seconds = (t: string) => {
        const [h, m, rest] = t.split(":");
        const [s, ms] = rest.split(",");
        return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
      };
      expect(words.some((w) => Math.abs(w.start - seconds(from)) < 1e-6)).toBe(true);
      expect(words.some((w) => Math.abs(w.end - seconds(to)) < 1e-6)).toBe(true);
      // And no cue lingers on screen.
      expect(seconds(to) - seconds(from)).toBeLessThanOrEqual(6);
    }
  });

  it("leaves a wordless segment whole, since splitting it would invent a boundary", () => {
    const long = "a ".repeat(60).trim();
    const srt = toSrt(doc([{ start: 0, end: 30, text: long }]));
    expect(srt.trim().split("\n\n")).toHaveLength(1);
  });

  it("emits one cue per segment when caption shaping is turned off", () => {
    const words = Array.from({ length: 40 }, (_, i) => ({
      word: `word${i}`,
      start: i * 0.4,
      end: i * 0.4 + 0.3,
    }));
    const srt = toSrt(
      doc([{ start: 0, end: 16, text: words.map((w) => w.word).join(" "), words }]),
      { captionCues: false }
    );
    expect(srt.trim().split("\n\n")).toHaveLength(1);
  });

  it("numbers cues contiguously from one, even when a segment is skipped", () => {
    const srt = toSrt(doc([
      { start: 0, end: 1, text: "one" },
      { start: 1, end: 2, text: "   " },
      { start: 2, end: 3, text: "two" },
    ]));
    expect(srt).toMatch(/^1\n/);
    expect(srt).toContain("\n2\n");
    expect(srt).not.toContain("\n3\n");
  });

  it("pads hours past the one hour mark", () => {
    expect(toSrt(doc([{ start: 3661.5, end: 3662, text: "late" }]))).toContain(
      "01:01:01,500 --> 01:01:02,000"
    );
  });

  it("gives a zero length segment a visible cue rather than an invalid one", () => {
    expect(toSrt(doc([{ start: 2, end: 2, text: "instant" }]))).toContain(
      "00:00:02,000 --> 00:00:02,001"
    );
  });

  it("writes an empty string for a document with no segments", () => {
    expect(toSrt(doc([]))).toBe("");
  });

  it("round-trips back through importSrt with the same cue times", () => {
    const reparsed = importSrt(toSrt(WITH_WORDS));
    expect(reparsed.segments.map((s) => [s.start, s.end, s.text])).toEqual([
      [1, 4, "Hello there"],
      [5.5, 8.25, "Second cue"],
    ]);
    // The format cannot carry these, so the reparsed document is honest about
    // not having them rather than inventing them.
    expect(reparsed.fps).toBeNull();
    expect(reparsed.segments[0].words).toBeUndefined();
  });
});

describe("toVtt", () => {
  it("writes the mandatory header and period-separated milliseconds", () => {
    const vtt = toVtt(WITH_WORDS);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:00:01.000 --> 00:00:04.000");
  });

  it("marks every word, including the one that opens the cue", () => {
    // The leading marker looks redundant against the cue's own start time, but
    // importVtt reads words from markers alone — text before the first marker
    // is not a word to it, so omitting it drops the opening word on the way
    // back in.
    expect(toVtt(WITH_WORDS)).toContain("<00:00:01.000>Hello <00:00:02.000>there");
  });

  it("marks a first word that starts after its cue does", () => {
    const vtt = toVtt(
      doc([
        {
          start: 1,
          end: 3,
          text: "late",
          words: [{ word: "late", start: 1.5, end: 3 }],
        },
      ])
    );
    expect(vtt).toContain("<00:00:01.500>late");
  });

  it("leaves a segment with no words as plain text", () => {
    expect(toVtt(WITH_WORDS)).toContain("\nSecond cue");
  });

  it("omits word timings when asked for plain cues", () => {
    const vtt = toVtt(WITH_WORDS, { inlineWordTimings: false });
    expect(vtt).toContain("\nHello there");
    expect(vtt).not.toContain("<00:00:02.000>");
  });

  it("stays a valid file when the document has no segments", () => {
    expect(toVtt(doc([]))).toBe("WEBVTT\n");
  });

  it("round-trips through importVtt with the word grid intact", () => {
    const reparsed = importVtt(toVtt(WITH_WORDS));
    expect(reparsed.segments[0].words).toEqual([
      { word: "Hello", start: 1, end: 2 },
      { word: "there", start: 2, end: 4 },
    ]);
    // Confidence is measured, and WebVTT has nowhere to record it, so it is
    // gone rather than defaulted on the way back in.
    expect(reparsed.segments[0].words![0]).not.toHaveProperty("confidence");
  });

  it("keeps overlapping words readable, the shape real speech produces", () => {
    const overlapping = doc([
      {
        start: 0.765,
        end: 1.29,
        text: "United States",
        words: [
          { word: "United", start: 0.765, end: 0.865 },
          { word: "States", start: 0.765, end: 1.29 },
        ],
      },
    ]);
    expect(toVtt(overlapping)).toContain("<00:00:00.765>United <00:00:00.765>States");
  });
});
