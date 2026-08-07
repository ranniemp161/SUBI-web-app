import { describe, it, expect } from "vitest";
import { createProjectSchema, patchProjectSchema } from "./validation";
import {
  MAX_PATCH_TRANSCRIPT_TEXT_CHARS,
  MAX_PATCH_TRANSCRIPT_WORDS,
} from "./transcript-limits";

const word = (i: number) => ({
  word: "w",
  start: i * 0.4,
  end: i * 0.4 + 0.3,
  confidence: 0.98,
});
const transcript = (over: Record<string, unknown> = {}) => ({
  words: [word(0)],
  text: "w",
  duration: 0.3,
  ...over,
});

describe("createProjectSchema — mandatory AI polish (ADR 0004 child 1, AC-2)", () => {
  it("no longer accepts an aiPolish field", () => {
    const result = createProjectSchema.safeParse({
      fileName: "clip.mp4",
      aiPolish: true,
    });
    expect(result.success).toBe(false);
  });

  it("parses without an aiPolish field (the client never sends one)", () => {
    const parsed = createProjectSchema.parse({ fileName: "clip.mp4", durationMs: 5000 });
    expect(parsed).not.toHaveProperty("aiPolish");
  });

  it("still rejects unexpected top-level keys (strictObject)", () => {
    const result = createProjectSchema.safeParse({ fileName: "clip.mp4", bogus: 1 });
    expect(result.success).toBe(false);
  });
});

describe("transcriptSchema — the shape must match Transcript in lib/edl.ts", () => {
  // A zod `object` strips what it doesn't declare. `utteranceEnds` was missing,
  // so the word-alignment PATCH (which round-trips the whole transcript through
  // this schema) silently dropped Deepgram's utterance boundaries, quietly
  // degrading retake detection and the subtitle export to punctuation-only
  // sentence grouping. Nothing failed; the data just went away.
  it("keeps utteranceEnds instead of stripping them", () => {
    const parsed = patchProjectSchema.parse({
      transcript: transcript({ utteranceEnds: [0.3, 1.8] }),
      wordsAligned: true,
    });
    expect(parsed.transcript?.utteranceEnds).toEqual([0.3, 1.8]);
  });

  it("keeps the optional per-word aligned flag", () => {
    const parsed = patchProjectSchema.parse({
      transcript: transcript({ words: [{ ...word(0), aligned: true }] }),
    });
    expect(parsed.transcript?.words[0].aligned).toBe(true);
  });

  it("still accepts a transcript with no utteranceEnds (Deepgram returned none)", () => {
    const parsed = patchProjectSchema.parse({ transcript: transcript() });
    expect(parsed.transcript).not.toHaveProperty("utteranceEnds");
  });
});

describe("transcriptSchema — bounds sit under the platform's request-body cap", () => {
  // The caps used to be 300,000 words / 10 MB of text, about 27 MB. Vercel
  // rejects a body over ~4.5 MB with a bare 413 before zod ever runs, so those
  // numbers promised something that could never arrive.
  it("accepts a transcript at exactly the word cap", () => {
    const words = Array.from({ length: MAX_PATCH_TRANSCRIPT_WORDS }, (_, i) => word(i));
    const result = patchProjectSchema.safeParse({ transcript: transcript({ words }) });
    expect(result.success).toBe(true);
  });

  it("rejects one word past the cap, so the caller gets our 400 not a bare 413", () => {
    const words = Array.from({ length: MAX_PATCH_TRANSCRIPT_WORDS + 1 }, (_, i) => word(i));
    const result = patchProjectSchema.safeParse({ transcript: transcript({ words }) });
    expect(result.success).toBe(false);
  });

  it("rejects text past the character cap", () => {
    const result = patchProjectSchema.safeParse({
      transcript: transcript({ text: "x".repeat(MAX_PATCH_TRANSCRIPT_TEXT_CHARS + 1) }),
    });
    expect(result.success).toBe(false);
  });

  it("a body at both caps stays under Vercel's ~4.5 MB limit", () => {
    // The bound is only honest if the largest thing it accepts actually fits.
    const words = Array.from({ length: MAX_PATCH_TRANSCRIPT_WORDS }, (_, i) => ({
      ...word(i),
      word: "transcription",
      aligned: true,
    }));
    const body = JSON.stringify({
      transcript: {
        words,
        text: "x".repeat(MAX_PATCH_TRANSCRIPT_TEXT_CHARS),
        duration: 9999,
        language: "en",
        utteranceEnds: Array.from({ length: 4000 }, (_, i) => i * 5),
      },
      wordsAligned: true,
    });
    expect(new TextEncoder().encode(body).byteLength).toBeLessThan(4.5 * 1024 * 1024);
  });
});
