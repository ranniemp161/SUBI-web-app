import { describe, expect, it, vi, afterEach } from "vitest";
import { segmentationConfig } from "./segmentation";

/**
 * How the background remover is configured.
 *
 * Worth pinning because every setting here was chosen against a specific
 * measured failure, and each is a one word edit away from being undone by
 * someone who reads the option list and picks the smaller or simpler value.
 */

const originalNavigator = globalThis.navigator;

function withNavigator(value: unknown) {
  Object.defineProperty(globalThis, "navigator", {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    value: originalNavigator,
    configurable: true,
    writable: true,
  });
});

describe("model choice", () => {
  it("uses half precision, not the full model", () => {
    // The default `isnet` pulled roughly 84 MB of weights from a third party CDN
    // in front of a $2.00 charge.
    withNavigator({});
    expect(segmentationConfig().model).toBe("isnet_fp16");
  });

  it("never uses the quantised model", () => {
    // `isnet_quint8` is smaller again and its artefacts land on the cutout edge,
    // which is the one thing this product is judged on at high zoom. Smaller is
    // not automatically better here, and this test is the reason why written
    // down where the change would be made.
    withNavigator({});
    expect(segmentationConfig().model).not.toBe("isnet_quint8");
  });
});

describe("device choice", () => {
  it("asks for the GPU when the browser has WebGPU", () => {
    // Not only speed: the library's worker path is gated behind WebGPU, so this
    // is what keeps inference off the main thread.
    withNavigator({ gpu: {} });
    expect(segmentationConfig().device).toBe("gpu");
  });

  it("falls back to the CPU when it does not", () => {
    withNavigator({});
    expect(segmentationConfig().device).toBe("cpu");
  });

  it("treats a present but null gpu as absent", () => {
    // `"gpu" in navigator` is true for a null value, and asking for a device
    // that is not there fails rather than degrades.
    withNavigator({ gpu: null });
    expect(segmentationConfig().device).toBe("cpu");
  });

  it("does not throw where there is no navigator at all", () => {
    // This module is browser only, but the config function is pure and gets
    // imported into a test runner that has no DOM.
    withNavigator(undefined);
    expect(() => segmentationConfig()).not.toThrow();
  });
});

describe("output and progress", () => {
  it("keeps PNG throughout, because JPEG ringing lands on the cutout edge", () => {
    withNavigator({});
    expect(segmentationConfig().output).toEqual({ format: "image/png" });
  });

  it("omits the progress callback entirely when none is given", () => {
    // Rather than passing undefined, which the library's Zod config schema would
    // have to tolerate.
    withNavigator({});
    expect("progress" in segmentationConfig()).toBe(false);
  });

  it("forwards the library's progress to the caller", () => {
    withNavigator({});
    const onProgress = vi.fn();
    const config = segmentationConfig(onProgress);

    (config as { progress: (k: string, c: number, t: number) => void }).progress(
      "fetch:model",
      12,
      100
    );

    expect(onProgress).toHaveBeenCalledWith({ key: "fetch:model", current: 12, total: 100 });
  });
});
