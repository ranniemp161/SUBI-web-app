import { describe, it, expect } from "vitest";
import { buildXmeml } from "./xmeml";
import { buildCmx3600Edl } from "./cmx3600";
import type { EDL } from "@/lib/edl";
import type { VideoFps } from "./timebase";

const NTSC_2997: VideoFps = { numerator: 30000, denominator: 1001 };
const PAL_25: VideoFps = { numerator: 25, denominator: 1 };

describe("buildXmeml", () => {
  it("emits an xmeml version 4 document", () => {
    const edl: EDL = { segments: [{ start: 0, end: 3, status: "keep", reason: null }] };
    const xml = buildXmeml(edl, "My Project", "source.mov");
    expect(xml).toContain("<!DOCTYPE xmeml>");
    expect(xml).toContain('<xmeml version="4">');
    expect(xml).toContain("<name>My Project</name>");
  });

  it("includes only kept segments as linked video and audio clip items", () => {
    const edl: EDL = {
      segments: [
        { start: 0, end: 5, status: "keep", reason: null },
        { start: 5, end: 8, status: "cut", reason: "silence" },
        { start: 8, end: 12, status: "keep", reason: null },
      ],
    };
    const xml = buildXmeml(edl, "My Project", "source.mov");
    expect(xml.match(/<clipitem id="clipitem-\d+">/g)).toHaveLength(2);
    expect(xml.match(/<clipitem id="clipitem-a-\d+">/g)).toHaveLength(2);
    // Sequential record positions with no gap: 0-150, then 150-270 at 30fps.
    expect(xml).toContain("<start>0</start>");
    expect(xml).toContain("<end>150</end>");
    expect(xml).toContain("<start>150</start>");
    expect(xml).toContain("<end>270</end>");
    // Source in/out preserve the original source position.
    expect(xml).toContain("<in>240</in>"); // 8s * 30
    expect(xml).toContain("<out>360</out>"); // 12s * 30
  });

  it("drops a kept segment shorter than one frame", () => {
    const edl: EDL = {
      segments: [
        { start: 0, end: 5, status: "keep", reason: null },
        { start: 5, end: 5.01, status: "keep", reason: null }, // < 1/30s
      ],
    };
    const xml = buildXmeml(edl, "My Project", "source.mov");
    expect(xml.match(/<clipitem id="clipitem-\d+">/g)).toHaveLength(1);
  });

  it("declares an NTSC rate with the integer timebase at 29.97", () => {
    const edl: EDL = { segments: [{ start: 0, end: 3, status: "keep", reason: null }] };
    const xml = buildXmeml(edl, "My Project", "source.mov", NTSC_2997);
    expect(xml).toContain("<timebase>30</timebase><ntsc>TRUE</ntsc>");
    expect(xml).toContain("<displayformat>DF</displayformat>");
  });

  it("declares a non-NTSC rate at 25fps", () => {
    const edl: EDL = { segments: [{ start: 0, end: 3, status: "keep", reason: null }] };
    const xml = buildXmeml(edl, "My Project", "source.mov", PAL_25);
    expect(xml).toContain("<timebase>25</timebase><ntsc>FALSE</ntsc>");
    expect(xml).toContain("<displayformat>NDF</displayformat>");
  });

  it("agrees with the CMX 3600 EDL on every cut point for the same EDL", () => {
    const edl: EDL = {
      segments: [
        { start: 0.4, end: 5.2, status: "keep", reason: null },
        { start: 5.2, end: 8, status: "cut", reason: "silence" },
        { start: 8.13, end: 12.71, status: "keep", reason: null },
      ],
    };
    const fps = PAL_25;
    const xml = buildXmeml(edl, "My Project", "source.mov", fps);
    const doc = buildCmx3600Edl(edl, "My Project", "source.mov", fps);

    // Parse the EDL's source in/out timecodes back to frames at 25fps.
    const eventLines = doc.split("\n").filter((line) => /^\d{3}\s/.test(line));
    const toFrameCount = (tc: string) => {
      const [hh, mm, ss, ff] = tc.split(":").map(Number);
      return ((hh * 60 + mm) * 60 + ss) * 25 + ff;
    };
    for (const line of eventLines) {
      const tcs = line.match(/\d{2}:\d{2}:\d{2}:\d{2}/g)!;
      expect(xml).toContain(`<in>${toFrameCount(tcs[0])}</in>`);
      expect(xml).toContain(`<out>${toFrameCount(tcs[1])}</out>`);
      expect(xml).toContain(`<start>${toFrameCount(tcs[2])}</start>`);
      expect(xml).toContain(`<end>${toFrameCount(tcs[3])}</end>`);
    }
  });

  it("escapes XML-unsafe characters in the title and filename, including the pathurl", () => {
    const edl: EDL = { segments: [{ start: 0, end: 1, status: "keep", reason: null }] };
    const xml = buildXmeml(edl, "Tom & Jerry <2>", 'file "final".mov');
    expect(xml).not.toContain("<2>");
    expect(xml).toContain("Tom &amp; Jerry &lt;2&gt;");
    expect(xml).toContain("&quot;final&quot;");
    // The pathurl percent-encodes the filename.
    expect(xml).toContain("<pathurl>file://localhost/file%20%22final%22.mov</pathurl>");
  });

  it("defines the shared file once and references it from later clip items", () => {
    const edl: EDL = {
      segments: [
        { start: 0, end: 2, status: "keep", reason: null },
        { start: 4, end: 6, status: "keep", reason: null },
      ],
    };
    const xml = buildXmeml(edl, "My Project", "source.mov");
    expect(xml.match(/<file id="file-1">/g)).toHaveLength(1);
    expect((xml.match(/<file id="file-1"\/>/g) ?? []).length).toBeGreaterThan(0);
  });

  describe("with a source timecode offset", () => {
    it("shifts in/out and the file duration, not start/end", () => {
      const edl: EDL = { segments: [{ start: 0, end: 5, status: "keep", reason: null }] };
      const xml = buildXmeml(edl, "My Project", "source.mov", undefined, undefined, 3600);
      expect(xml).toContain("<start>0</start>"); // sequence position stays zero-based
      expect(xml).toContain("<in>108000</in>"); // (0 + 3600)s * 30fps
      expect(xml).toContain("<out>108150</out>"); // (5 + 3600)s * 30fps
      expect(xml).toContain(`<duration>${(5 + 3600) * 30}</duration>`);
    });
  });

  it("uses the provided source resolution", () => {
    const edl: EDL = { segments: [{ start: 0, end: 1, status: "keep", reason: null }] };
    const xml = buildXmeml(edl, "My Project", "source.mov", undefined, {
      width: 3840,
      height: 2160,
    });
    expect(xml).toContain("<width>3840</width>");
    expect(xml).toContain("<height>2160</height>");
  });
});
