import { describe, it, expect } from "vitest";
import { buildUserMessage, buildVerifyUserMessage } from "./ai-rough-cut";
import type { AiCutRange } from "./ai-cuts";
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

function candidate(startWordIndex: number, endWordIndex: number): AiCutRange {
  return { startWordIndex, endWordIndex, category: "retake", modelConfidence: 0.6 };
}

describe("buildVerifyUserMessage", () => {
  it("renders the cut span between delimiters with surrounding context", () => {
    const words = CONTIGUOUS;
    expect(buildVerifyUserMessage(words, [candidate(2, 3)])).toBe(
      "Candidate startWordIndex=2 (category: retake):\nw0 w1 >>>CUT: w2 w3 <<< w4"
    );
  });

  it("includes the note in the header when present", () => {
    const range: AiCutRange = { ...candidate(1, 1), note: "Flubbed take" };
    expect(buildVerifyUserMessage(CONTIGUOUS, [range])).toContain(
      'category: retake, note: "Flubbed take"'
    );
  });

  it("marks the silence entering the cut, outside the delimiter", () => {
    // The regression this pass exists to prevent: without the marker the
    // verifier can't see the 2s reset that justified the cut, and its rubric
    // breaks ties toward restoring.
    const words = [w("a", 0, 1), w("b", 1, 2), w("c", 4, 5), w("d", 5, 6)];
    expect(buildVerifyUserMessage(words, [candidate(2, 3)])).toContain(
      "a b <pause 2.0s> >>>CUT: c d <<<"
    );
  });

  it("marks the silence leaving the cut, outside the delimiter", () => {
    const words = [w("a", 0, 1), w("b", 1, 2), w("c", 2, 3), w("d", 6, 7)];
    expect(buildVerifyUserMessage(words, [candidate(1, 2)])).toContain(
      ">>>CUT: b c <<< <pause 3.0s> d"
    );
  });

  it("marks silences inside the cut span and inside the context", () => {
    const words = [w("a", 0, 1), w("b", 3, 4), w("c", 4, 5), w("d", 8, 9)];
    const message = buildVerifyUserMessage(words, [candidate(1, 3)]);
    expect(message).toContain(">>>CUT: b c <pause 3.0s> d <<<");
    expect(message).toContain("a <pause 2.0s> >>>CUT:");
  });

  it("handles a candidate at the very start with no preceding context", () => {
    expect(buildVerifyUserMessage(CONTIGUOUS, [candidate(0, 1)])).toContain(
      ">>>CUT: w0 w1 <<< w2 w3 w4"
    );
  });

  it("handles a candidate running to the last word without reading past the end", () => {
    expect(buildVerifyUserMessage(CONTIGUOUS, [candidate(3, 4)])).toContain(
      "w0 w1 w2 >>>CUT: w3 w4 <<<"
    );
  });

  it("separates multiple candidates with a blank line", () => {
    const message = buildVerifyUserMessage(CONTIGUOUS, [candidate(1, 1), candidate(3, 3)]);
    expect(message.split("\n\n")).toHaveLength(2);
  });
});
