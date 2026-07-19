import { describe, it, expect, vi, beforeEach } from "vitest";

const getPrimaryVideoTrack = vi.fn();

vi.mock("mediabunny", () => ({
  ALL_FORMATS: [],
  BlobSource: class BlobSourceMock {},
  Input: class InputMock {
    getPrimaryVideoTrack = getPrimaryVideoTrack;
  },
}));

import { detectVideoFps } from "./detect-frame-rate";

const file = new File(["x"], "source.mp4", { type: "video/mp4" });

describe("detectVideoFps", () => {
  beforeEach(() => {
    getPrimaryVideoTrack.mockReset();
  });

  it("snaps the measured average packet rate to a standard rate", async () => {
    getPrimaryVideoTrack.mockResolvedValue({
      computePacketStats: vi.fn().mockResolvedValue({ averagePacketRate: 29.968 }),
    });
    await expect(detectVideoFps(file)).resolves.toEqual({
      numerator: 30000,
      denominator: 1001,
    });
  });

  it("returns null when the file has no video track", async () => {
    getPrimaryVideoTrack.mockResolvedValue(null);
    await expect(detectVideoFps(file)).resolves.toBeNull();
  });

  it("returns null on a zero or non-finite measured rate", async () => {
    getPrimaryVideoTrack.mockResolvedValue({
      computePacketStats: vi.fn().mockResolvedValue({ averagePacketRate: 0 }),
    });
    await expect(detectVideoFps(file)).resolves.toBeNull();
  });

  it("returns null instead of throwing when parsing fails", async () => {
    getPrimaryVideoTrack.mockRejectedValue(new Error("unreadable container"));
    await expect(detectVideoFps(file)).resolves.toBeNull();
  });
});
