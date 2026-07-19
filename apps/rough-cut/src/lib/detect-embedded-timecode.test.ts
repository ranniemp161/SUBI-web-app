import { describe, it, expect, vi } from "vitest";
import type { VideoFps } from "@/lib/export/timebase";

const DEFAULT_FPS: VideoFps = { numerator: 30, denominator: 1 };

interface FakeIsoFile {
  onError?: (module: string, message: string) => void;
  onReady?: (movie: { tracks: Array<{ id: number; codec: string }> }) => void;
  onSamples?: (id: number, user: unknown, samples: Array<{ data?: Uint8Array }>) => void;
  setExtractionOptions: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  appendBuffer: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
}

let nextIsoFile: FakeIsoFile | null = null;

vi.mock("mp4box", () => ({
  createFile: vi.fn(() => nextIsoFile),
}));

import { detectEmbeddedTimecodeOffset } from "./detect-embedded-timecode";

function makeIsoFile(): FakeIsoFile {
  return {
    setExtractionOptions: vi.fn(),
    start: vi.fn(),
    appendBuffer: vi.fn(),
    flush: vi.fn(),
  };
}

function fourByteFrameCount(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, n, false);
  return buf;
}

const file = new File(["x"], "source.mov", { type: "video/quicktime" });

describe("detectEmbeddedTimecodeOffset", () => {
  it("returns the decoded start frame count converted to seconds at the given fps", async () => {
    const isoFile = makeIsoFile();
    nextIsoFile = isoFile;
    isoFile.start.mockImplementation(() => {
      isoFile.onSamples?.(1, undefined, [{ data: fourByteFrameCount(3600) }]); // 3600 frames = 120s at 30fps
    });
    isoFile.appendBuffer.mockImplementation(() => {
      isoFile.onReady?.({ tracks: [{ id: 1, codec: "tmcd" }] });
    });

    await expect(detectEmbeddedTimecodeOffset(file, DEFAULT_FPS)).resolves.toBe(120);
    expect(isoFile.setExtractionOptions).toHaveBeenCalledWith(1, undefined, { nbSamples: 1 });
  });

  it("returns 0 when the file has no tmcd track", async () => {
    const isoFile = makeIsoFile();
    nextIsoFile = isoFile;
    isoFile.appendBuffer.mockImplementation(() => {
      isoFile.onReady?.({ tracks: [{ id: 1, codec: "avc1" }] });
    });

    await expect(detectEmbeddedTimecodeOffset(file, DEFAULT_FPS)).resolves.toBe(0);
  });

  it("returns 0 on a parse error", async () => {
    const isoFile = makeIsoFile();
    nextIsoFile = isoFile;
    isoFile.appendBuffer.mockImplementation(() => {
      isoFile.onError?.("mp4box", "unreadable container");
    });

    await expect(detectEmbeddedTimecodeOffset(file, DEFAULT_FPS)).resolves.toBe(0);
  });

  it("returns 0 for an implausibly large offset instead of trusting a misparsed value", async () => {
    const isoFile = makeIsoFile();
    nextIsoFile = isoFile;
    isoFile.start.mockImplementation(() => {
      // 4294900000 frames at 30fps is ~4.5 years — clearly garbage.
      isoFile.onSamples?.(1, undefined, [{ data: fourByteFrameCount(4294900000) }]);
    });
    isoFile.appendBuffer.mockImplementation(() => {
      isoFile.onReady?.({ tracks: [{ id: 1, codec: "tmcd" }] });
    });

    await expect(detectEmbeddedTimecodeOffset(file, DEFAULT_FPS)).resolves.toBe(0);
  });
});
