import { describe, it, expect } from "vitest";
import type { TranscriptSegment } from "@repo/transcript";
import {
  mergeSegmentsIntoUtterances,
  formatUtterancesForPrompt,
  formatClock,
  UTTERANCE_GAP_MS,
} from "./utterances";

/** Seconds in, because that is what a transcript document stores. */
function seg(start: number, end: number, text: string): TranscriptSegment {
  return { start, end, text };
}

describe("mergeSegmentsIntoUtterances", () => {
  it("returns nothing for an empty transcript", () => {
    // A document with zero segments is structurally valid — refusing to plan
    // against one is the planner's judgement, not the merge's.
    expect(mergeSegmentsIntoUtterances([])).toEqual([]);
  });

  it("leaves a Ruff Cut handoff alone: one segment per utterance already", () => {
    const utterances = mergeSegmentsIntoUtterances([
      seg(0, 4, "We cut fuel imports by eighty percent."),
      seg(4.2, 9, "That took three years."),
    ]);

    expect(utterances).toEqual([
      { index: 0, text: "We cut fuel imports by eighty percent.", startMs: 0, endMs: 4000 },
      { index: 1, text: "That took three years.", startMs: 4200, endMs: 9000 },
    ]);
  });

  it("merges caption cues that carry no terminal punctuation", () => {
    // The subtitle upload shape: one cue every couple of seconds, split
    // mid-sentence, and only the last cue carries the full stop.
    const utterances = mergeSegmentsIntoUtterances([
      seg(0, 2, "we cut fuel imports"),
      seg(2.1, 4, "by eighty percent"),
      seg(4.05, 6, "over three years."),
    ]);

    expect(utterances).toHaveLength(1);
    expect(utterances[0]).toEqual({
      index: 0,
      text: "we cut fuel imports by eighty percent over three years.",
      startMs: 0,
      endMs: 6000,
    });
  });

  it("splits on sentence ending punctuation even when the gap is tiny", () => {
    const utterances = mergeSegmentsIntoUtterances([
      seg(0, 2, "That is the whole point."),
      seg(2.01, 4, "so here is what we did"),
    ]);

    expect(utterances.map((u) => u.text)).toEqual([
      "That is the whole point.",
      "so here is what we did",
    ]);
  });

  it.each([".", "?", "!", "…"])("treats %s as a sentence ending", (mark) => {
    const utterances = mergeSegmentsIntoUtterances([
      seg(0, 2, `is that right${mark}`),
      seg(2.01, 4, "apparently so"),
    ]);

    expect(utterances).toHaveLength(2);
  });

  it("splits on a long pause even mid sentence, with no punctuation anywhere", () => {
    const utterances = mergeSegmentsIntoUtterances([
      seg(0, 2, "and the thing about that is"),
      // 900ms of silence, past the 700ms threshold
      seg(2.9, 5, "we never actually measured it"),
    ]);

    expect(utterances.map((u) => u.text)).toEqual([
      "and the thing about that is",
      "we never actually measured it",
    ]);
  });

  it("does not split on a gap exactly at the threshold — it must be exceeded", () => {
    const gapSeconds = UTTERANCE_GAP_MS / 1000;
    const utterances = mergeSegmentsIntoUtterances([
      seg(0, 2, "and the thing about that is"),
      seg(2 + gapSeconds, 5, "we never measured it"),
    ]);

    expect(utterances).toHaveLength(1);
  });

  it("takes the first member's start and the last member's end", () => {
    const utterances = mergeSegmentsIntoUtterances([
      seg(10.4, 12, "one"),
      seg(12.1, 14, "two"),
      seg(14.05, 17.6, "three."),
    ]);

    expect(utterances[0].startMs).toBe(10400);
    expect(utterances[0].endMs).toBe(17600);
  });

  it("joins members with exactly one space, whatever padding they carried", () => {
    const utterances = mergeSegmentsIntoUtterances([
      seg(0, 2, "  we cut  "),
      seg(2.1, 4, "  fuel imports."),
    ]);

    expect(utterances[0].text).toBe("we cut fuel imports.");
  });

  it("drops empty utterances and keeps the indexes contiguous", () => {
    // A cue holding only a musical note or stripped markup merges to nothing.
    // It must not occupy an index, because the index is how the model cites a
    // line and a blank line identifies nothing.
    const utterances = mergeSegmentsIntoUtterances([
      seg(0, 2, "first line."),
      seg(3, 4, "   "),
      seg(6, 8, "second line."),
    ]);

    expect(utterances.map((u) => u.index)).toEqual([0, 1]);
    expect(utterances.map((u) => u.text)).toEqual(["first line.", "second line."]);
  });

  it("collapses a whole caption transcript to roughly utterance density (AC-48)", () => {
    // The measured problem, in miniature: twelve cues of about two seconds
    // each, three sentences between them. The planner's scene target and its
    // scene labels both assume this output shape, not the input one.
    const cues: TranscriptSegment[] = [];
    const sentences = [
      ["the first thing", "we noticed was", "the cost."],
      ["then the second", "problem showed up", "in the numbers."],
      ["and after that", "everything else", "got easier."],
    ];
    let t = 0;
    for (const sentence of sentences) {
      for (const part of sentence) {
        cues.push(seg(t, t + 1.8, part));
        t += 2;
      }
      t += 1; // a real pause between sentences
    }

    const utterances = mergeSegmentsIntoUtterances(cues);

    expect(cues).toHaveLength(9);
    expect(utterances).toHaveLength(3);
    expect(utterances[1].text).toBe("then the second problem showed up in the numbers.");
  });
});

describe("the unpunctuated auto-caption case (project 0620)", () => {
  /**
   * The real shape that broke the first live run: no punctuation anywhere, and
   * cues that butt up against each other so no gap ever exceeds the threshold.
   */
  function autoCaptions(count: number, secondsEach = 2.3): TranscriptSegment[] {
    const words = "one of the most powerful men in the government said this week";
    return Array.from({ length: count }, (_, i) =>
      seg(i * secondsEach, (i + 1) * secondsEach, words)
    );
  }

  it("does not collapse a whole transcript into one line", () => {
    // Before the length backstop this returned exactly 1, the model was handed
    // a single numbered item, and eleven of twelve proposed scenes cited lines
    // that did not exist.
    const utterances = mergeSegmentsIntoUtterances(autoCaptions(254));

    expect(utterances.length).toBeGreaterThan(1);
  });

  it("segments 9:46 of unpunctuated speech into a plannable number of lines", () => {
    // 254 cues over roughly 9:46, the real project's shape.
    const utterances = mergeSegmentsIntoUtterances(autoCaptions(254, 2.31));

    // Enough lines that a target of about 12 scenes has real choices to make,
    // and few enough that each is a recognisable moment rather than a fragment.
    expect(utterances.length).toBeGreaterThan(20);
    expect(utterances.length).toBeLessThan(120);
  });

  it("gives every utterance a contiguous index the model can cite", () => {
    const utterances = mergeSegmentsIntoUtterances(autoCaptions(60));

    expect(utterances.map((u) => u.index)).toEqual(
      utterances.map((_, i) => i)
    );
  });

  it("keeps each line short enough to identify the moment", () => {
    const utterances = mergeSegmentsIntoUtterances(autoCaptions(254));

    for (const utterance of utterances) {
      expect(utterance.endMs - utterance.startMs).toBeLessThan(15_000);
    }
  });

  it("leaves a punctuated handoff unaffected by the length backstop", () => {
    // Ruff Cut's own density is about one utterance per twelve seconds, so a
    // punctuated document never reaches the cap: punctuation still decides.
    const utterances = mergeSegmentsIntoUtterances([
      seg(0, 11, "We cut fuel imports by eighty percent."),
      seg(11.2, 22, "That took three years."),
    ]);

    expect(utterances).toHaveLength(2);
    expect(utterances[0].text).toBe("We cut fuel imports by eighty percent.");
  });

  it("still prefers a real sentence ending over the backstop", () => {
    const utterances = mergeSegmentsIntoUtterances([
      seg(0, 3, "a short thought."),
      seg(3.1, 6, "and then another one."),
    ]);

    expect(utterances.map((u) => u.text)).toEqual([
      "a short thought.",
      "and then another one.",
    ]);
  });
});

describe("formatUtterancesForPrompt", () => {
  it("numbers every line and stamps its timecode", () => {
    const utterances = mergeSegmentsIntoUtterances([
      seg(0, 2, "first line."),
      seg(125, 130, "much later."),
    ]);

    expect(formatUtterancesForPrompt(utterances)).toBe(
      "[0] (0:00) first line.\n[1] (2:05) much later."
    );
  });
});

describe("formatClock", () => {
  it.each([
    [0, "0:00"],
    [2_350, "0:02"],
    [155_000, "2:35"],
    [3_600_000, "1:00:00"],
    [3_755_000, "1:02:35"],
  ])("renders %ims as %s", (ms, expected) => {
    expect(formatClock(ms)).toBe(expected);
  });
});
