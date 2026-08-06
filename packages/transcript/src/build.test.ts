import { describe, it, expect } from "vitest";
import {
  buildTranscriptDocument,
  canonicalFingerprint,
  serializeTranscriptDocument,
} from "./build";
import { formatTimecode } from "./timebase";

const NTSC_2997 = { numerator: 30000, denominator: 1001 };

const baseInput = {
  segments: [{ start: 0, end: 2, text: "hello" }],
  fps: NTSC_2997,
  duration: 2,
  wordsAligned: true,
  source: { kind: "rough-cut" as const, projectId: "p1", edlFingerprint: "abc" },
};

describe("buildTranscriptDocument", () => {
  it("stamps the format version and validates before returning", () => {
    const document = buildTranscriptDocument(baseInput);
    expect(document.version).toBe(1);
    expect(document.segments).toHaveLength(1);
  });

  it("defaults generatedAt to a real clock read", () => {
    const before = Date.now();
    const document = buildTranscriptDocument(baseInput);
    expect(Date.parse(document.generatedAt)).toBeGreaterThanOrEqual(before - 1000);
  });

  it("produces documents identical in every field but generatedAt across two calls (AC-9)", () => {
    const withoutGeneratedAt = (document: Record<string, unknown>) => {
      const copy = { ...document };
      delete copy.generatedAt;
      return copy;
    };
    const a = buildTranscriptDocument({ ...baseInput, generatedAt: "2026-08-05T00:00:00.000Z" });
    const b = buildTranscriptDocument({ ...baseInput, generatedAt: "2026-08-05T09:00:00.000Z" });
    expect(withoutGeneratedAt(a)).toEqual(withoutGeneratedAt(b));
  });

  it("throws rather than emit a document with backwards times", () => {
    expect(() =>
      buildTranscriptDocument({
        ...baseInput,
        segments: [
          { start: 0, end: 5, text: "one" },
          { start: 2, end: 6, text: "two" },
        ],
      })
    ).toThrow();
  });

  it("refuses a rough-cut document with no frame rate rather than serve one without a timebase", () => {
    expect(() => buildTranscriptDocument({ ...baseInput, fps: null })).toThrow();
  });

  it("serializes to parseable JSON", () => {
    const document = buildTranscriptDocument(baseInput);
    expect(JSON.parse(serializeTranscriptDocument(document))).toEqual(document);
  });
});

describe("canonicalFingerprint", () => {
  const segments = [
    { start: 0, end: 1.5, status: "keep", reason: null },
    { start: 1.5, end: 2, status: "cut", reason: "silence" },
  ];

  it("is stable across two builds of the same value", () => {
    expect(canonicalFingerprint(segments)).toBe(canonicalFingerprint(segments));
  });

  it("ignores key order — the same edit serialized differently is the same edit", () => {
    const reordered = segments.map((s) => ({
      reason: s.reason,
      end: s.end,
      status: s.status,
      start: s.start,
    }));
    expect(canonicalFingerprint(reordered)).toBe(canonicalFingerprint(segments));
  });

  it("ignores sub-millisecond float noise, which is not a changed edit", () => {
    const noisy = segments.map((s) => ({ ...s, start: s.start + 0.00004 }));
    expect(canonicalFingerprint(noisy)).toBe(canonicalFingerprint(segments));
  });

  it("changes when a cut boundary really moves", () => {
    const moved = [{ ...segments[0], end: 1.6 }, { ...segments[1], start: 1.6 }];
    expect(canonicalFingerprint(moved)).not.toBe(canonicalFingerprint(segments));
  });

  it("drops undefined keys, so an absent optional flag reads the same as no flag", () => {
    const withUndefined = segments.map((s) => ({ ...s, split: undefined }));
    expect(canonicalFingerprint(withUndefined)).toBe(canonicalFingerprint(segments));
  });
});

describe("timecode naming, the promise the package exists for", () => {
  it("formats a post-cut position as drop-frame timecode at 29.97 (AC-12)", () => {
    // 155s == 2:35 on the final cut; drop-frame uses the ';' separator.
    expect(formatTimecode(155, NTSC_2997)).toMatch(/^00:02:3[45];\d{2}$/);
    expect(formatTimecode(155, NTSC_2997)).toContain(";");
  });
});
