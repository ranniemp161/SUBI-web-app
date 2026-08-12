import { beforeEach, describe, expect, it, vi } from "vitest";

const canEncodeVideo = vi.fn();
vi.mock("mediabunny", () => ({ canEncodeVideo: (...args: unknown[]) => canEncodeVideo(...args) }));

const { AVC_PROFILE_CANDIDATES, checkRenderCapability } = await import("./capability");

beforeEach(() => {
  canEncodeVideo.mockReset();
});

describe("checkRenderCapability", () => {
  it("reports supported when the device accepts the output size", async () => {
    canEncodeVideo.mockResolvedValue(true);
    await expect(checkRenderCapability(1080, 1920)).resolves.toEqual({ supported: true });
  });

  it("asks about the real output size, not a fixed one", async () => {
    // Phase 0's lesson: the spike failed because it asked about a profile that
    // could not express the size it wanted. The size must reach the probe.
    canEncodeVideo.mockResolvedValue(true);
    await checkRenderCapability(1080, 1920);
    expect(canEncodeVideo).toHaveBeenCalledWith("avc", { width: 1080, height: 1920 });
  });

  it("explains itself when the device refuses that size", async () => {
    canEncodeVideo.mockResolvedValue(false);
    const result = await checkRenderCapability(3840, 2160);
    expect(result.supported).toBe(false);
    if (result.supported) throw new Error("unreachable");
    // The message has to name the size, or the user cannot act on it.
    expect(result.reason).toContain("3840x2160");
  });

  it("treats a browser with no WebCodecs as unsupported rather than throwing", async () => {
    // Safari and Firefox throw here rather than resolving false. To the user
    // the two cases are identical, so the caller must not have to catch.
    canEncodeVideo.mockRejectedValue(new TypeError("VideoEncoder is not defined"));
    const result = await checkRenderCapability(1080, 1920);
    expect(result.supported).toBe(false);
    if (result.supported) throw new Error("unreachable");
    expect(result.reason).toMatch(/WebCodecs/i);
  });

  it("rejects odd dimensions before asking the device", async () => {
    // H.264 needs even dimensions. An odd one is our bug, not a device limit,
    // and would otherwise fail deep inside the encoder mid render.
    const result = await checkRenderCapability(1081, 1920);
    expect(result.supported).toBe(false);
    expect(canEncodeVideo).not.toHaveBeenCalled();
  });

  it("rejects a missing or nonsense size before asking the device", async () => {
    for (const [w, h] of [
      [0, 1920],
      [1080, 0],
      [-1080, 1920],
      [1080.5, 1920],
    ]) {
      const result = await checkRenderCapability(w, h);
      expect(result.supported).toBe(false);
    }
    expect(canEncodeVideo).not.toHaveBeenCalled();
  });

  it("lists H.264 profiles most capable first", () => {
    // The order is the contract: High 4.0 is what Phase 0 measured as hardware
    // accelerated, and Baseline 3.0 last because it cannot express 1080p.
    expect(AVC_PROFILE_CANDIDATES[0]).toBe("avc1.640028");
    expect(AVC_PROFILE_CANDIDATES).toContain("avc1.42e01e");
    expect(AVC_PROFILE_CANDIDATES).not.toContain("avc1.42001f");
  });
});
