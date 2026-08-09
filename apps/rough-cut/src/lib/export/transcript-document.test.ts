import { describe, it, expect } from "vitest";
import { canonicalFingerprint } from "@repo/transcript";
import {
  buildProjectTranscriptDocument,
  subtitleFilename,
  transcriptFilename,
} from "@/lib/export/transcript-document";
import type { EDL, EDLSegment, Transcript, TranscriptWord } from "@/lib/edl";

// The single builder behind both handoff surfaces: the export modal's download
// (browser) and GET /api/projects/:id/transcript (server). Its sibling
// transcript-collapse.ts is covered separately; what is tested here is what
// this file adds on top of the collapse, which is the document envelope and the
// fingerprint.

const FPS_30 = { numerator: 30, denominator: 1 };
const NTSC_2997 = { numerator: 30000, denominator: 1001 };
const AT = "2026-08-09T12:00:00.000Z";

function word(text: string, start: number, end: number): TranscriptWord {
  return { word: text, start, end, confidence: 0.99 };
}

function transcript(words: TranscriptWord[]): Transcript {
  return {
    words,
    text: words.map((w) => w.word).join(" "),
    duration: words.length ? words[words.length - 1].end : 0,
  };
}

/** An EDL from alternating spans: `[start, end, "keep" | "cut"]`. */
function edl(
  spans: [number, number, "keep" | "cut"][],
  extra: Partial<EDL> = {}
): EDL {
  return {
    segments: spans.map(([start, end, status]) => ({
      start,
      end,
      status,
      reason: null,
    })),
    ...extra,
  };
}

/** Everything the two paths must agree on, i.e. the document minus the clock read. */
function withoutGeneratedAt(document: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...document };
  delete copy.generatedAt;
  return copy;
}

function build(overrides: Partial<Parameters<typeof buildProjectTranscriptDocument>[0]> = {}) {
  return buildProjectTranscriptDocument({
    projectId: "project-1",
    edl: edl([
      [0, 2, "keep"],
      [2, 5, "cut"],
      [5, 8, "keep"],
    ]),
    transcript: transcript([word("one", 0, 1), word("after", 6, 7)]),
    fps: FPS_30,
    wordsAligned: true,
    generatedAt: AT,
    ...overrides,
  });
}

describe("buildProjectTranscriptDocument — the document envelope", () => {
  it("carries post-cut timings, not source timings (AC-12)", () => {
    // The 3s cut before "after" is gone, so 6s in the source is 3s on the cut.
    const doc = build();
    const words = doc.segments.flatMap((s) => s.words ?? []);
    expect(words.map((w) => [w.word, w.start])).toEqual([
      ["one", 0],
      ["after", 3],
    ]);
    expect(doc.duration).toBe(5);
  });

  it("carries the exact source frame rate through, never a guess (AC-9)", () => {
    // 29.97 must stay the rational 30000/1001, not collapse to a decimal.
    const doc = build({ fps: NTSC_2997 });
    expect(doc.fps).toEqual(NTSC_2997);
  });

  it("reports whether the word refinement pass has run", () => {
    expect(build({ wordsAligned: true }).wordsAligned).toBe(true);
    expect(build({ wordsAligned: false }).wordsAligned).toBe(false);
  });

  it("names rough-cut and the project as the document's source", () => {
    const doc = build({ projectId: "project-42" });
    expect(doc.source.kind).toBe("rough-cut");
    expect(doc.source.projectId).toBe("project-42");
  });

  it("stamps the supplied generatedAt rather than reading the clock", () => {
    expect(build().generatedAt).toBe(AT);
  });

  it("builds a valid, empty document when nothing is kept", () => {
    // The export modal gates the transcript on the frame rate alone, so a
    // project with every segment cut still has to produce a real document.
    const doc = build({
      edl: edl([[0, 8, "cut"]]),
      transcript: transcript([word("gone", 1, 2)]),
    });
    expect(doc.duration).toBe(0);
    expect(doc.segments.flatMap((s) => s.words ?? [])).toEqual([]);
  });
});

describe("buildProjectTranscriptDocument — one builder serves both paths (AC-9)", () => {
  it("produces byte-identical documents but for generatedAt", () => {
    // This is the entire mechanism behind AC-9: the file a creator downloads
    // and the file b-roll fetches cannot drift, because there is only one
    // builder. The criterion is not that the bytes are reproducible — it is
    // that nothing except the clock read differs.
    const download = build({ generatedAt: "2026-08-09T12:00:00.000Z" });
    const served = build({ generatedAt: "2026-08-09T18:30:00.000Z" });

    expect(download.generatedAt).not.toBe(served.generatedAt);
    expect(withoutGeneratedAt(download)).toEqual(withoutGeneratedAt(served));
  });
});

describe("buildProjectTranscriptDocument — the edit fingerprint", () => {
  it("is scoped to the segments, so an unrelated EDL field does not move it", () => {
    // Phase 3 compares these hashes over time to spot a transcript that no
    // longer matches the edit it came from. A preset the user picked is not a
    // changed edit, so it must not read as one.
    const spans: [number, number, "keep" | "cut"][] = [
      [0, 2, "keep"],
      [2, 5, "cut"],
      [5, 8, "keep"],
    ];
    const plain = build({ edl: edl(spans) });
    const withPreset = build({
      edl: edl(spans, { preset: "balanced" } as Partial<EDL>),
    });
    expect(withPreset.source.edlFingerprint).toBe(plain.source.edlFingerprint);
  });

  it("does not move when an optional key is merely present as undefined", () => {
    const base: EDLSegment[] = [
      { start: 0, end: 2, status: "keep", reason: null },
      { start: 2, end: 8, status: "cut", reason: null },
    ];
    const withUndefined: EDLSegment[] = base.map((s) => ({
      ...s,
      split: undefined,
    }));
    expect(canonicalFingerprint(withUndefined)).toBe(canonicalFingerprint(base));
  });

  it("moves when the cut itself moves", () => {
    const before = build({
      edl: edl([
        [0, 2, "keep"],
        [2, 5, "cut"],
        [5, 8, "keep"],
      ]),
    });
    const after = build({
      edl: edl([
        [0, 3, "keep"],
        [3, 5, "cut"],
        [5, 8, "keep"],
      ]),
    });
    expect(after.source.edlFingerprint).not.toBe(before.source.edlFingerprint);
  });

  it("is stable across two builds of the same edit", () => {
    expect(build().source.edlFingerprint).toBe(build().source.edlFingerprint);
  });
});

describe("filenames", () => {
  it("names the transcript with a .transcript.json suffix", () => {
    expect(transcriptFilename("My Interview")).toBe(
      "My Interview.transcript.json"
    );
  });

  it("names subtitles with the plain base name, not a .transcript. variant", () => {
    // Players and platforms pick up a sidecar subtitle by matching the video's
    // own base name, and these times are already post-cut, so the file lines up
    // with the exported MP4 with no re-syncing.
    expect(subtitleFilename("My Interview", "srt")).toBe("My Interview.srt");
    expect(subtitleFilename("My Interview", "vtt")).toBe("My Interview.vtt");
  });
});
