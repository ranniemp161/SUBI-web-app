import { describe, it, expect } from "vitest";
import {
  normalizeDeepgram,
  extractDeepgramError,
  DEEPGRAM_MAX_UPLOAD_BYTES,
  type DeepgramResponse,
} from "./deepgram";

describe("normalizeDeepgram", () => {
  it("flattens a well-formed Deepgram response into {words, text, duration, language}", () => {
    const payload: DeepgramResponse = {
      metadata: { duration: 12.5 },
      results: {
        channels: [
          {
            detected_language: "en",
            alternatives: [
              {
                transcript: "hello world",
                words: [
                  { word: "hello", start: 0, end: 0.5, confidence: 0.99 },
                  { word: "world", start: 0.6, end: 1.0, confidence: 0.95 },
                ],
              },
            ],
          },
        ],
      },
    };

    const result = normalizeDeepgram(payload);

    expect(result.text).toBe("hello world");
    expect(result.duration).toBe(12.5);
    expect(result.language).toBe("en");
    expect(result.words).toHaveLength(2);
  });

  it("prefers punctuated_word over word so retake detection sees terminal punctuation", () => {
    const payload: DeepgramResponse = {
      results: {
        channels: [
          {
            alternatives: [
              {
                transcript: "Hello.",
                words: [
                  {
                    word: "hello",
                    punctuated_word: "Hello.",
                    start: 0,
                    end: 0.5,
                    confidence: 0.99,
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const result = normalizeDeepgram(payload);
    expect(result.words[0].word).toBe("Hello.");
  });

  it("falls back to the raw word when punctuated_word is absent", () => {
    const payload: DeepgramResponse = {
      results: {
        channels: [
          {
            alternatives: [
              { transcript: "hi", words: [{ word: "hi", start: 0, end: 0.2, confidence: 0.9 }] },
            ],
          },
        ],
      },
    };

    expect(normalizeDeepgram(payload).words[0].word).toBe("hi");
  });

  // covers AC-2 (child 4): every word start/end is snapped to the 1/30s grid.
  it("snaps word start/end to the nearest 1/30s frame boundary", () => {
    const payload: DeepgramResponse = {
      results: {
        channels: [
          {
            alternatives: [
              {
                transcript: "hi",
                // 0.5183s * 30 = 15.549 -> rounds to 16 -> 16/30 = 0.53333...
                // 1.0 is already exactly on a frame (30/30).
                words: [{ word: "hi", start: 0.5183, end: 1.0, confidence: 0.9 }],
              },
            ],
          },
        ],
      },
    };

    const result = normalizeDeepgram(payload);
    expect(result.words[0].start).toBeCloseTo(16 / 30, 10);
    expect(result.words[0].end).toBeCloseTo(1.0, 10);
  });

  // covers AC-4 (child 4): the snap is idempotent — re-normalizing an
  // already-snapped value must yield the same value.
  it("is idempotent: re-normalizing an already-snapped value is a no-op", () => {
    const once = normalizeDeepgram({
      results: {
        channels: [
          { alternatives: [{ transcript: "hi", words: [{ word: "hi", start: 0.5183, end: 1.237, confidence: 0.9 }] }] },
        ],
      },
    });

    const twice = normalizeDeepgram({
      results: {
        channels: [
          {
            alternatives: [
              {
                transcript: "hi",
                words: [{ word: "hi", start: once.words[0].start, end: once.words[0].end, confidence: 0.9 }],
              },
            ],
          },
        ],
      },
    });

    expect(twice.words[0].start).toBe(once.words[0].start);
    expect(twice.words[0].end).toBe(once.words[0].end);
  });

  it("returns an empty transcript shape when the response has no channels/alternatives", () => {
    const result = normalizeDeepgram({});
    expect(result).toEqual({ words: [], text: "", duration: 0, language: undefined });
  });

  it("returns an empty words array when alternatives.words is missing", () => {
    const result = normalizeDeepgram({
      results: { channels: [{ alternatives: [{ transcript: "x" }] }] },
    });
    expect(result.words).toEqual([]);
    expect(result.text).toBe("x");
  });

  it("defaults duration to 0 when metadata is absent", () => {
    const result = normalizeDeepgram({
      results: { channels: [{ alternatives: [{ transcript: "x", words: [] }] }] },
    });
    expect(result.duration).toBe(0);
  });

  it("handles a zero-duration, zero-word transcript without throwing", () => {
    expect(() => normalizeDeepgram({ metadata: { duration: 0 }, results: { channels: [] } })).not.toThrow();
  });

  // covers AC-1/AC-3 (child 4): utterances requested from Deepgram actually
  // flow through as frame-snapped, ascending boundary end-times, so
  // retake-detection.ts has real acoustic boundaries to consume.
  describe("utteranceEnds", () => {
    it("carries utterance end times through, frame-snapped and ascending", () => {
      const payload: DeepgramResponse = {
        results: {
          channels: [{ alternatives: [{ transcript: "a b c d", words: [] }] }],
          // Out of order and off-grid on purpose — the normalizer must sort
          // and snap, not just pass through.
          utterances: [
            { start: 2.0, end: 3.5183 }, // 105.549 -> rounds to 106 -> 106/30
            { start: 0, end: 1.0 }, // already on-grid
          ],
        },
      };

      const result = normalizeDeepgram(payload);
      expect(result.utteranceEnds).toEqual([1.0, 106 / 30]);
    });

    it("snaps each utterance end to the 1/30s grid", () => {
      const payload: DeepgramResponse = {
        results: {
          channels: [{ alternatives: [{ transcript: "a", words: [] }] }],
          utterances: [{ start: 0, end: 0.5183 }],
        },
      };
      expect(normalizeDeepgram(payload).utteranceEnds).toEqual([16 / 30]);
    });

    it("sorts multiple utterance ends ascending regardless of input order", () => {
      const payload: DeepgramResponse = {
        results: {
          channels: [{ alternatives: [{ transcript: "a", words: [] }] }],
          utterances: [
            { start: 5, end: 6 },
            { start: 0, end: 1 },
            { start: 2, end: 3 },
          ],
        },
      };
      expect(normalizeDeepgram(payload).utteranceEnds).toEqual([1, 3, 6]);
    });

    it("omits utteranceEnds entirely when Deepgram returned no utterances", () => {
      const result = normalizeDeepgram({
        results: { channels: [{ alternatives: [{ transcript: "a", words: [] }] }] },
      });
      expect(result.utteranceEnds).toBeUndefined();
      expect("utteranceEnds" in result).toBe(false);
    });

    it("omits utteranceEnds when Deepgram returned an empty utterances array", () => {
      const result = normalizeDeepgram({
        results: { channels: [{ alternatives: [{ transcript: "a", words: [] }] }], utterances: [] },
      });
      expect(result.utteranceEnds).toBeUndefined();
    });
  });
});

describe("extractDeepgramError", () => {
  it("extracts err_msg from a well-formed Deepgram error body", () => {
    const body = JSON.stringify({ err_code: "INVALID_AUDIO", err_msg: "corrupt audio", request_id: "abc" });
    expect(extractDeepgramError(body)).toBe("corrupt audio");
  });

  it("falls back to reason when err_msg is absent", () => {
    const body = JSON.stringify({ reason: "quota exceeded" });
    expect(extractDeepgramError(body)).toBe("quota exceeded");
  });

  it("falls back to trimmed raw text when the body isn't JSON", () => {
    expect(extractDeepgramError("  plain text failure  ")).toBe("plain text failure");
  });

  it("truncates a very long non-JSON body to 300 characters", () => {
    const long = "x".repeat(500);
    const result = extractDeepgramError(long);
    expect(result).toHaveLength(300);
  });

  it("returns undefined for an empty body", () => {
    expect(extractDeepgramError("")).toBeUndefined();
    expect(extractDeepgramError("   ")).toBeUndefined();
  });

  it("returns undefined when JSON parses but has neither err_msg nor reason", () => {
    expect(extractDeepgramError(JSON.stringify({ request_id: "abc" }))).toBeUndefined();
  });
});

describe("DEEPGRAM_MAX_UPLOAD_BYTES", () => {
  it("is 2 GiB", () => {
    expect(DEEPGRAM_MAX_UPLOAD_BYTES).toBe(2 * 1024 * 1024 * 1024);
  });
});
