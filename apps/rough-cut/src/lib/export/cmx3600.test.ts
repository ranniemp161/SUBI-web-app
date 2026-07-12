import { describe, it, expect } from "vitest";
import { buildCmx3600Edl } from "./cmx3600";
import { buildFcpxml } from "./fcpxml";
import { toFrames } from "./timebase";
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

    const ranges = getKeepRanges(edl).filter((r) => r.end - r.start >= 1 / 30);
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
