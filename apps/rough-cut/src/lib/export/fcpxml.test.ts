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
