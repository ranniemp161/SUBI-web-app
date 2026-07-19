import { describe, it, expect } from "vitest";
import { buildCmx3600Edl } from "./cmx3600";
import { buildFcpxml } from "./fcpxml";
import { minClipSeconds, toFrames, type VideoFps } from "./timebase";
import { getKeepRanges, totalKeptSeconds } from "./plan";
import type { EDL } from "@/lib/edl";

describe("buildCmx3600Edl", () => {
  it("includes only kept segments as sequential, back-to-back events, in order", () => {
    const edl: EDL = {
      segments: [
        { start: 0, end: 5, status: "keep", reason: null },
        { start: 5, end: 8, status: "cut", reason: "silence" },
        { start: 8, end: 12, status: "keep", reason: null },
      ],
    };
    const doc = buildCmx3600Edl(edl, "My Project", "source.mov");
    const eventLines = doc.split("\n").filter((line) => /^\d{3}\s/.test(line));
    expect(eventLines).toHaveLength(2);
    // First event's record in is 00:00:00:00, second starts right where the first ends (no gap).
    expect(eventLines[0]).toContain("00:00:00:00 00:00:05:00");
    expect(eventLines[1]).toContain("00:00:05:00 00:00:09:00");
  });

  it("drops a kept segment shorter than one frame", () => {
    const edl: EDL = {
      segments: [
        { start: 0, end: 5, status: "keep", reason: null },
        { start: 5, end: 5.01, status: "keep", reason: null }, // < 1/30s
      ],
    };
    const doc = buildCmx3600Edl(edl, "My Project", "source.mov");
    const eventLines = doc.split("\n").filter((line) => /^\d{3}\s/.test(line));
    expect(eventLines).toHaveLength(1);
  });

  it("references the source clip by its original filename in the FROM CLIP NAME comment", () => {
    const edl: EDL = { segments: [{ start: 0, end: 3, status: "keep", reason: null }] };
    const doc = buildCmx3600Edl(edl, "My Project", "raw-footage.mp4");
    expect(doc).toContain("* FROM CLIP NAME: raw-footage.mp4");
  });

  it("derives an 8-character, uppercased reel name from the source filename", () => {
    const edl: EDL = { segments: [{ start: 0, end: 3, status: "keep", reason: null }] };
    const doc = buildCmx3600Edl(edl, "My Project", "raw-footage-long-name.mp4");
    expect(doc).toContain("RAWFOOTA");
  });

  it("falls back to AX when the source filename sanitizes to nothing", () => {
    const edl: EDL = { segments: [{ start: 0, end: 3, status: "keep", reason: null }] };
    const doc = buildCmx3600Edl(edl, "My Project", "///:::");
    expect(doc).toContain(" AX ");
  });

  it("includes a TITLE and FCM header", () => {
    const edl: EDL = { segments: [{ start: 0, end: 3, status: "keep", reason: null }] };
    const doc = buildCmx3600Edl(edl, "Tom & Jerry", "source.mov");
    expect(doc).toContain("TITLE: Tom & Jerry");
    expect(doc).toContain("FCM: NON-DROP FRAME");
  });

  it("produces no events when nothing is kept", () => {
    const edl: EDL = { segments: [{ start: 0, end: 5, status: "cut", reason: "manual" }] };
    const doc = buildCmx3600Edl(edl, "My Project", "source.mov");
    const eventLines = doc.split("\n").filter((line) => /^\d{3}\s/.test(line));
    expect(eventLines).toHaveLength(0);
  });

  it("strips control characters from the title so a newline can't inject an extra line", () => {
    const edl: EDL = { segments: [{ start: 0, end: 3, status: "keep", reason: null }] };
    const doc = buildCmx3600Edl(edl, "My Project\nFCM: DROP FRAME", "source.mov");
    const lines = doc.split("\n");
    expect(lines[0]).toBe("TITLE: My ProjectFCM: DROP FRAME");
    expect(lines[1]).toBe("FCM: NON-DROP FRAME");
  });

  it("strips control characters from the source filename in FROM CLIP NAME", () => {
    const edl: EDL = { segments: [{ start: 0, end: 3, status: "keep", reason: null }] };
    const doc = buildCmx3600Edl(edl, "My Project", "source\n.mov");
    expect(doc).toContain("* FROM CLIP NAME: source.mov");
  });

  describe("at a detected source frame rate", () => {
    const NTSC_2997: VideoFps = { numerator: 30000, denominator: 1001 };
    const PAL_25: VideoFps = { numerator: 25, denominator: 1 };

    it("emits drop-frame timecode with an FCM: DROP FRAME header at 29.97", () => {
      // 90s at 29.97 = round(90 * 30000/1001) = 2697 real frames; the minute
      // boundary skips two labels, so the display frame is 2699 -> 00:01:29;29
      // (drop-frame timecode tracks wall-clock time).
      const edl: EDL = { segments: [{ start: 0, end: 90, status: "keep", reason: null }] };
      const doc = buildCmx3600Edl(edl, "My Project", "source.mov", NTSC_2997);
      expect(doc).toContain("FCM: DROP FRAME");
      const eventLine = doc.split("\n").find((line) => /^\d{3}\s/.test(line));
      expect(eventLine).toContain("00:00:00;00 00:01:29;29");
    });

    it("stays non-drop-frame with ':' separators at 25fps", () => {
      const edl: EDL = { segments: [{ start: 0, end: 65, status: "keep", reason: null }] };
      const doc = buildCmx3600Edl(edl, "My Project", "source.mov", PAL_25);
      expect(doc).toContain("FCM: NON-DROP FRAME");
      expect(doc).toContain("00:00:00:00 00:01:05:00");
    });
  });

  describe("with a source timecode offset", () => {
    it("shifts only the source in/out timecodes, not the record timecodes", () => {
      const edl: EDL = {
        segments: [
          { start: 0, end: 5, status: "keep", reason: null },
          { start: 5, end: 8, status: "cut", reason: "silence" },
          { start: 8, end: 12, status: "keep", reason: null },
        ],
      };
      // Offset of 1 hour, matching a source with a 01:00:00:00 embedded start.
      const doc = buildCmx3600Edl(edl, "My Project", "source.mov", undefined, 3600);
      const eventLines = doc.split("\n").filter((line) => /^\d{3}\s/.test(line));
      expect(eventLines[0]).toContain("01:00:00:00 01:00:05:00 00:00:00:00 00:00:05:00");
      expect(eventLines[1]).toContain("01:00:08:00 01:00:12:00 00:00:05:00 00:00:09:00");
    });

    it("defaults to no offset", () => {
      const edl: EDL = { segments: [{ start: 0, end: 3, status: "keep", reason: null }] };
      const doc = buildCmx3600Edl(edl, "My Project", "source.mov");
      expect(doc).toContain("00:00:00:00 00:00:03:00");
    });
  });
});

describe("FCPXML and CMX 3600 EDL cross-format consistency", () => {
  it("report the same total kept duration and the same number of clips/events", () => {
    const edl: EDL = {
      segments: [
        { start: 0, end: 5, status: "keep", reason: null },
        { start: 5, end: 8, status: "cut", reason: "silence" },
        { start: 8, end: 12, status: "keep", reason: null },
        { start: 12, end: 12.02, status: "keep", reason: null }, // < 1/30s, dropped from both
      ],
    };

    const xml = buildFcpxml(edl, "My Project", "source.mov");
    const doc = buildCmx3600Edl(edl, "My Project", "source.mov");

    const clipCount = (xml.match(/<clip /g) ?? []).length;
    const eventCount = doc.split("\n").filter((line) => /^\d{3}\s/.test(line)).length;
    expect(clipCount).toBe(eventCount);

    const ranges = getKeepRanges(edl).filter((r) => r.end - r.start >= minClipSeconds());
    const expectedTotalFrames = toFrames(totalKeptSeconds(ranges));
    expect(xml).toContain(`duration="${expectedTotalFrames}/30s"`);

    const lastEventLine = doc
      .split("\n")
      .filter((line) => /^\d{3}\s/.test(line))
      .pop();
    const lastRecordOut = lastEventLine?.split(/\s+/).pop();
    const [hh, mm, ss, ff] = lastRecordOut!.split(":").map(Number);
    const finalFrames = ((hh * 60 + mm) * 60 + ss) * 30 + ff;
    expect(finalFrames).toBe(expectedTotalFrames);
  });
});
