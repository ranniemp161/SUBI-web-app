import { describe, it, expect } from "vitest";
import { buildFcpxml } from "./fcpxml";
import { sanitizeFilename } from "./filename";
import type { EDL } from "@/lib/edl";

describe("buildFcpxml", () => {
  it("includes only kept segments as sequential clips, in order", () => {
    const edl: EDL = {
      segments: [
        { start: 0, end: 5, status: "keep", reason: null },
        { start: 5, end: 8, status: "cut", reason: "silence" },
        { start: 8, end: 12, status: "keep", reason: null },
      ],
    };
    const xml = buildFcpxml(edl, "My Project", "source.mov");
    const clipCount = (xml.match(/<clip /g) ?? []).length;
    expect(clipCount).toBe(2);
    // First clip offset starts at 0, second starts right after the first's duration (no gap).
    expect(xml).toContain('offset="0/30s"');
    expect(xml).toContain('duration="150/30s"'); // 5s at 30fps
    expect(xml).toContain('offset="150/30s"');
  });

  it("drops a kept segment shorter than one frame", () => {
    const edl: EDL = {
      segments: [
        { start: 0, end: 5, status: "keep", reason: null },
        { start: 5, end: 5.01, status: "keep", reason: null }, // < 1/30s
      ],
    };
    const xml = buildFcpxml(edl, "My Project", "source.mov");
    const clipCount = (xml.match(/<clip /g) ?? []).length;
    expect(clipCount).toBe(1);
  });

  it("references the source clip by its original filename", () => {
    const edl: EDL = { segments: [{ start: 0, end: 3, status: "keep", reason: null }] };
    const xml = buildFcpxml(edl, "My Project", "raw-footage.mp4");
    expect(xml).toContain('name="raw-footage.mp4"');
  });

  it("escapes XML-unsafe characters in the project title and filename", () => {
    const edl: EDL = { segments: [{ start: 0, end: 1, status: "keep", reason: null }] };
    const xml = buildFcpxml(edl, 'Tom & Jerry <2>', 'file "final".mov');
    expect(xml).not.toContain("<2>");
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&lt;2&gt;");
    expect(xml).toContain("&quot;final&quot;");
  });

  it("produces an empty spine when nothing is kept", () => {
    const edl: EDL = { segments: [{ start: 0, end: 5, status: "cut", reason: "manual" }] };
    const xml = buildFcpxml(edl, "My Project", "source.mov");
    expect(xml).not.toContain("<clip ");
  });

  it("declares the asset's duration as the furthest point any kept range reaches into the source, not the sum of kept durations", () => {
    // Kept ranges: [0, 2] and [100, 103]. Summed kept duration is 5s, but a
    // clip refs into the source up to 103s — the asset must cover that.
    const edl: EDL = {
      segments: [
        { start: 0, end: 2, status: "keep", reason: null },
        { start: 2, end: 100, status: "cut", reason: "silence" },
        { start: 100, end: 103, status: "keep", reason: null },
      ],
    };
    const xml = buildFcpxml(edl, "My Project", "source.mov");
    const assetMatch = xml.match(/<asset[^>]*duration="(\d+)\/30s"/);
    expect(assetMatch).not.toBeNull();
    expect(Number(assetMatch![1])).toBe(103 * 30);
    // A clip's own <video> start/duration must stay within [0, assetDuration].
    expect(xml).toContain('start="3000/30s"'); // 100s
  });

  it("accumulates clip offsets from exact seconds, matching CMX 3600's rounding, so cut points agree", () => {
    // 3 clips of 1.75 frames each: FCPXML must not sum independently-rounded
    // per-clip frame counts (which would land on frame 6); it must round the
    // cumulative offset once (frame 5), same as CMX 3600.
    const oneAndThreeQuarterFrames = 1.75 / 30;
    const edl: EDL = {
      segments: [
        { start: 0, end: oneAndThreeQuarterFrames, status: "keep", reason: null },
        {
          start: oneAndThreeQuarterFrames,
          end: 2 * oneAndThreeQuarterFrames,
          status: "keep",
          reason: null,
        },
        {
          start: 2 * oneAndThreeQuarterFrames,
          end: 3 * oneAndThreeQuarterFrames,
          status: "keep",
          reason: null,
        },
      ],
    };
    const xml = buildFcpxml(edl, "My Project", "source.mov");
    const offsets = [...xml.matchAll(/offset="(\d+)\/30s"/g)].map((m) => Number(m[1]));
    // Third clip's offset is the cumulative-seconds rounding of 2 * 1.75 frames = 3.5 -> 4, not 2+2=4...
    // The key regression check is the sequence/asset total, which must equal round(3 * 1.75) = 5.
    const totalMatch = xml.match(/<sequence[^>]*duration="(\d+)\/30s"/);
    expect(Number(totalMatch![1])).toBe(5);
    expect(offsets[0]).toBe(0);
  });

  it("uses the provided source resolution instead of a hardcoded 1920x1080", () => {
    const edl: EDL = { segments: [{ start: 0, end: 1, status: "keep", reason: null }] };
    const xml = buildFcpxml(edl, "My Project", "source.mov", { width: 3840, height: 2160 });
    expect(xml).toContain('width="3840" height="2160"');
    expect(xml).not.toContain('width="1920" height="1080"');
  });

  it("defaults to 1920x1080 when no resolution is provided", () => {
    const edl: EDL = { segments: [{ start: 0, end: 1, status: "keep", reason: null }] };
    const xml = buildFcpxml(edl, "My Project", "source.mov");
    expect(xml).toContain('width="1920" height="1080"');
  });
});

describe("sanitizeFilename", () => {
  it("strips characters unsafe for a filename", () => {
    expect(sanitizeFilename('My/Project:Name?"<>|')).toBe("MyProjectName");
  });

  it("collapses internal whitespace and trims", () => {
    expect(sanitizeFilename("  My   Project  ")).toBe("My Project");
  });

  it("falls back to a default name when sanitizing leaves nothing", () => {
    expect(sanitizeFilename('///:::')).toBe("export");
  });
});
