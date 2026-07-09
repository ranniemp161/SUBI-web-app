import { describe, it, expect } from "vitest";
import { detectRetakes } from "./retake-detection";
import type { TranscriptWord } from "./edl";

/**
 * Build a spoken sentence starting at `start` seconds: words spaced 0.35s apart
 * (0.1s gaps, under the 0.5s sentence break) with a period on the last word so
 * the sentence flushes cleanly. Punctuation is stripped by normalization, so it
 * only affects grouping, not matching.
 */
function say(text: string, start: number): TranscriptWord[] {
  const parts = text.split(" ");
  let t = start;
  return parts.map((p, i) => {
    const word = { word: i === parts.length - 1 ? `${p}.` : p, start: t, end: t + 0.25, confidence: 1 };
    t += 0.35;
    return word;
  });
}

/** Same as `say`, but no terminal punctuation on the last word — for cases
 *  that must rely on a real utterance boundary rather than punctuation. */
function sayNoPeriod(text: string, start: number): TranscriptWord[] {
  const parts = text.split(" ");
  let t = start;
  return parts.map((p) => {
    const word = { word: p, start: t, end: t + 0.25, confidence: 1 };
    t += 0.35;
    return word;
  });
}

describe("detectRetakes (fuzzy)", () => {
  it("clusters near-verbatim re-records that differ by a word", () => {
    const words = [
      ...say("africa needs to wake up now", 0),
      ...say("africa really needs to wake up now", 10),
    ];
    const matches = detectRetakes(words);
    expect(matches).toHaveLength(1);
    // The earlier attempt is cut; the later, fuller take is kept.
    expect(matches[0].cutStart).toBeCloseTo(0, 5);
    expect(matches[0].keptStart).toBeCloseTo(10, 5);
  });

  it("does not match genuinely different sentences", () => {
    const words = [
      ...say("africa needs to wake up now", 0),
      ...say("europe should probably go back home", 10),
    ];
    expect(detectRetakes(words)).toHaveLength(0);
  });

  it("keeps only the last take in a chain of three", () => {
    const words = [
      ...say("the quick brown fox jumps", 0),
      ...say("the quick brown fox jumps", 5),
      ...say("the quick brown fox jumps", 10),
    ];
    const matches = detectRetakes(words);
    expect(matches).toHaveLength(2);
    for (const m of matches) expect(m.keptStart).toBeCloseTo(10, 5);
  });

  it("does not pair occurrences outside the proximity window", () => {
    const words = [
      ...say("the quick brown fox jumps", 0),
      ...say("the quick brown fox jumps", 100),
    ];
    expect(detectRetakes(words)).toHaveLength(0);
  });

  it("ignores short phrases below the minimum word count", () => {
    const words = [...say("yeah okay so", 0), ...say("yeah okay so", 5)];
    expect(detectRetakes(words)).toHaveLength(0);
  });

  it("respects a stricter similarity threshold", () => {
    const words = [
      ...say("africa needs to wake up now", 0),
      ...say("africa really needs to wake up now", 10),
    ];
    // At 0.95 the one-word insertion (ratio ≈ 0.92) no longer qualifies.
    expect(detectRetakes(words, 0.95)).toHaveLength(0);
  });
});

describe("detectRetakes — Deepgram utterance boundaries", () => {
  it("finds a fast re-take (no pause, no punctuation) only when given the real utterance boundary", () => {
    // Two takes spoken back-to-back with a 0.05s gap — well under the 0.5s
    // pause-heuristic threshold — and no terminal punctuation. A human editor
    // (and Deepgram's acoustic boundary detector) still hears two sentences;
    // the fixed-pause heuristic can't tell, and glues them into one.
    const take1 = sayNoPeriod("africa needs to wake up now", 0);
    const gapStart = take1[take1.length - 1].end + 0.05;
    const take2 = sayNoPeriod("africa really needs to wake up now", gapStart);
    const words = [...take1, ...take2];

    // Without utterance info, the heuristic sees one glued 12-word run —
    // nothing to compare against, so no retake is found.
    expect(detectRetakes(words)).toHaveLength(0);

    // With the real boundary at the end of take1, the two takes split apart
    // and the retake is caught.
    const utteranceEnds = [take1[take1.length - 1].end];
    const matches = detectRetakes(words, undefined, utteranceEnds);
    expect(matches).toHaveLength(1);
    expect(matches[0].cutStart).toBeCloseTo(take1[0].start, 5);
    expect(matches[0].keptStart).toBeCloseTo(take2[0].start, 5);
  });

  it("still finds an ordinary retake when utterance boundaries are given", () => {
    const take1 = say("africa needs to wake up now", 0);
    const take2 = say("africa really needs to wake up now", 10);
    const utteranceEnds = [take1[take1.length - 1].end, take2[take2.length - 1].end];
    const matches = detectRetakes([...take1, ...take2], undefined, utteranceEnds);
    expect(matches).toHaveLength(1);
    expect(matches[0].cutStart).toBeCloseTo(0, 5);
    expect(matches[0].keptStart).toBeCloseTo(10, 5);
  });

  it("keeps only the last take in a chain of three, driven by utterance boundaries", () => {
    const takes = [
      sayNoPeriod("the quick brown fox jumps", 0),
      sayNoPeriod("the quick brown fox jumps", 3),
      sayNoPeriod("the quick brown fox jumps", 6),
    ];
    const utteranceEnds = takes.map((t) => t[t.length - 1].end);
    const matches = detectRetakes(takes.flat(), undefined, utteranceEnds);
    expect(matches).toHaveLength(2);
    for (const m of matches) expect(m.keptStart).toBeCloseTo(6, 5);
  });
});
