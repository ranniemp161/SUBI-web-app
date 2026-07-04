import { describe, it, expect } from "vitest";
import { detectRepetitions, PHRASE_PAUSE_SECONDS } from "./repetition-detection";
import type { TranscriptWord } from "./edl";

/**
 * Build contiguous words from tokens; each word 0.2s long, 0.05s apart.
 * A token of `null` inserts an extra pause (a re-attempt gap) before the next word.
 */
function seq(...tokens: (string | null)[]): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  let t = 0;
  for (const token of tokens) {
    if (token === null) {
      t += PHRASE_PAUSE_SECONDS + 0.1;
      continue;
    }
    words.push({ word: token, start: t, end: t + 0.2, confidence: 1 });
    t += 0.25;
  }
  return words;
}

/** The cut spans as token-index pairs, for compact assertions. */
const spans = (words: TranscriptWord[]) =>
  detectRepetitions(words).map((c) => [c.startIndex, c.endIndex]);

describe("detectRepetitions — word stutters", () => {
  it("cuts the first of a doubled word, keeping the last", () => {
    expect(spans(seq("cut", "the", "the", "clip"))).toEqual([[1, 1]]);
  });

  it("cuts all but the last of a longer run", () => {
    expect(spans(seq("no", "the", "the", "the", "clip"))).toEqual([[1, 2]]);
  });

  it("matches case- and punctuation-insensitively", () => {
    // "The the" at a sentence start — same token once normalized.
    expect(spans(seq("The", "the", "clip"))).toEqual([[0, 0]]);
  });

  it("keeps punctuated repetition — deliberate emphasis", () => {
    // Deepgram writes emphasis with the comma: "very, very important".
    expect(spans(seq("it's", "very,", "very", "important"))).toEqual([]);
  });

  it("keeps an all-capitalized pair — proper noun", () => {
    expect(spans(seq("listening", "to", "Duran", "Duran", "tonight"))).toEqual([]);
  });

  it('still cuts a stuttered "I I" despite capitalization', () => {
    expect(spans(seq("and", "I", "I", "think"))).toEqual([[1, 1]]);
  });

  it("returns nothing for clean speech or empty input", () => {
    expect(spans(seq("a", "clean", "sentence"))).toEqual([]);
    expect(spans([])).toEqual([]);
  });
});

describe("detectRepetitions — phrase repeats (pause-gated)", () => {
  it("cuts the first instance when a pause separates the repeats", () => {
    expect(
      spans(seq("and", "it", "makes", null, "and", "it", "makes", "them", "weak"))
    ).toEqual([[0, 2]]);
  });

  it("keeps fluid run-on repetition — delivery, not a re-attempt", () => {
    expect(
      spans(seq("that", "is", "leverage", "that", "is", "leverage"))
    ).toEqual([]);
  });

  it("keeps different phrases that merely rhyme in shape", () => {
    expect(
      spans(seq("who", "marched", null, "who", "protested", "are", "victims"))
    ).toEqual([]);
  });

  it("cuts the first two of a triple take, keeping the final read", () => {
    expect(
      spans(
        seq(
          "or", "is", "it", "just", "a", "booby", "prize",
          null,
          "or", "is", "it", "just", "a", "booby", "prize",
          null,
          "or", "is", "it", "just", "a", "booby", "prize"
        )
      )
    ).toEqual([
      [0, 6],
      [7, 13],
    ]);
  });

  it("normalizes punctuation across instances", () => {
    expect(
      spans(seq("regardless", "of", "this.", null, "Regardless", "of", "this", "victory"))
    ).toEqual([[0, 2]]);
  });

  it("prefers the longest matching phrase over shorter sub-phrases", () => {
    const cuts = spans(
      seq("we", "need", "to", "get", null, "we", "need", "to", "get", "nuance")
    );
    expect(cuts).toEqual([[0, 3]]);
  });
});
