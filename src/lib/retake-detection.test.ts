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
