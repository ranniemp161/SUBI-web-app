import { describe, it, expect } from "vitest";
import { buildUserMessage } from "./ai-rough-cut";
import type { TranscriptWord } from "./edl";

function w(word: string, start: number, end: number): TranscriptWord {
  return { word, start, end, confidence: 1 };
}

/** Five contiguous one-second words — no gaps, so no markers. */
const CONTIGUOUS: TranscriptWord[] = Array.from({ length: 5 }, (_, i) =>
  w(`w${i}`, i, i + 1)
);

describe("buildUserMessage", () => {
  it("indexes every word in order under a Transcript: header", () => {
    expect(buildUserMessage(CONTIGUOUS)).toBe(
      "Transcript:\n[0]w0 [1]w1 [2]w2 [3]w3 [4]w4"
    );
  });

  it("emits nothing but the header for an empty word list", () => {
    expect(buildUserMessage([])).toBe("Transcript:\n");
  });

  it("marks a silence at or above the 0.5s threshold", () => {
    const words = [w("one", 0, 1), w("two", 1.5, 2)];
    expect(buildUserMessage(words)).toBe("Transcript:\n[0]one <pause 0.5s> [1]two");
  });

  it("leaves a sub-threshold gap unmarked", () => {
    const words = [w("one", 0, 1), w("two", 1.4, 2)];
    expect(buildUserMessage(words)).toBe("Transcript:\n[0]one [1]two");
  });

  it("rounds the pause length to one decimal", () => {
    const words = [w("one", 0, 1), w("two", 3.14159, 4)];
    expect(buildUserMessage(words)).toContain("<pause 2.1s>");
  });

  it("never emits a marker before the first word", () => {
    expect(buildUserMessage([w("only", 5, 6)])).toBe("Transcript:\n[0]only");
  });

  it("emits no marker when words overlap or touch exactly", () => {
    // sanitizeWords clips overlaps upstream, but a trailing word can still end
    // past the next one's start — a negative gap must not print as a pause.
    const words = [w("one", 0, 1.2), w("two", 1, 2)];
    expect(buildUserMessage(words)).toBe("Transcript:\n[0]one [1]two");
  });

  it("keeps indices tied to word position, not token position", () => {
    // The whole contract with sanitizeAiRanges: index N is the Nth word even
    // when markers sit between tokens. Two pauses here must not shift [2].
    const words = [w("a", 0, 1), w("b", 2, 3), w("c", 5, 6)];
    expect(buildUserMessage(words)).toBe(
      "Transcript:\n[0]a <pause 1.0s> [1]b <pause 2.0s> [2]c"
    );
  });

  it("preserves punctuation carried on the word", () => {
    const words = [w("Hello,", 0, 1), w("world.", 1, 2)];
    expect(buildUserMessage(words)).toBe("Transcript:\n[0]Hello, [1]world.");
  });
});
