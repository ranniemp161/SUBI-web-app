/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

// Parameters omitted rather than underscore-prefixed: the repo's lint rule
// treats an unused mock argument as a warning, and `--max-warnings=0` makes
// that a failure. The assertions below only need the call count.
const startRender = vi.hoisted(() =>
  vi.fn(() => ({ done: Promise.resolve(new ArrayBuffer(8)) }))
);

vi.mock("@/lib/render/run-render", () => ({ startRender }));
vi.mock("@/lib/render/zip", () => ({ buildZip: vi.fn(() => new Uint8Array([1, 2, 3])) }));
vi.mock("@/lib/render/clip-filename", () => ({
  sceneClipFilename: vi.fn(() => "0000-scene.mp4"),
}));

const { useRenderQueue } = await import("./use-render-queue");
import type { RenderJob } from "./use-render-queue";

/**
 * The queue's refusal of a scene that cannot draw (spec `broll/0007` AC-138).
 *
 * The criterion this file exists for is the batch one: **a run containing scenes
 * with no character still hands over every clip that could be made.** That is
 * the same promise AC-32 makes about a clip that fails mid encode, and it is not
 * observable from any single component — only from the queue every entry point
 * goes through.
 */

const OUTPUT = { width: 1920, height: 1080, fps: { numerator: 30, denominator: 1 } };

function job(id: string, blockedReason?: string): RenderJob {
  return {
    id,
    index: 1,
    startMs: 0,
    durationMs: 4000,
    renderable: { template: "text-card", scene: { text: "hello" } },
    blockedReason,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("a blocked scene", () => {
  it("never reaches an encoder", async () => {
    const { result } = renderHook(() => useRenderQueue(OUTPUT));

    await act(async () => {
      result.current.enqueue([job("a", "This scene draws a character, and the project has none.")]);
    });

    expect(startRender).not.toHaveBeenCalled();
    expect(result.current.states.a).toEqual({
      phase: "blocked",
      message: "This scene draws a character, and the project has none.",
    });
  });

  it("is told apart from a failure, because retrying one and not the other helps", async () => {
    const { result } = renderHook(() => useRenderQueue(OUTPUT));
    await act(async () => {
      result.current.enqueue([job("a", "no character")]);
    });

    expect(result.current.states.a?.phase).toBe("blocked");
    expect(result.current.states.a?.phase).not.toBe("failed");
    // Not counted as a failure either, or the bar would offer a retry that
    // cannot possibly change the outcome.
    expect(result.current.failedIds).not.toContain("a");
  });

  it("does not flip the queue into running when it is the only job", async () => {
    // A batch that will never start must not leave the bar claiming a render is
    // in flight, with a cancel button that cancels nothing.
    const { result } = renderHook(() => useRenderQueue(OUTPUT));
    await act(async () => {
      result.current.enqueue([job("a", "no character")]);
    });

    expect(result.current.running).toBe(false);
    expect(result.current.currentId).toBeNull();
  });
});

describe("a batch holding both kinds", () => {
  it("renders every scene that can be made and skips the rest (AC-138, AC-32)", async () => {
    const { result } = renderHook(() => useRenderQueue(OUTPUT));

    await act(async () => {
      result.current.enqueue([
        job("ok-1"),
        job("blocked-1", "no character"),
        job("ok-2"),
        job("blocked-2", "no character"),
      ]);
    });

    // The two that could be made were made; the two that could not were not.
    expect(startRender).toHaveBeenCalledTimes(2);
    expect(result.current.states["ok-1"]?.phase).toBe("done");
    expect(result.current.states["ok-2"]?.phase).toBe("done");
    expect(result.current.states["blocked-1"]?.phase).toBe("blocked");
    expect(result.current.states["blocked-2"]?.phase).toBe("blocked");
    expect(result.current.readyCount).toBe(2);
  });

  it("marks the skipped scenes immediately rather than when the batch reaches them", async () => {
    // The creator has to be able to see which scenes are being left out while
    // the run is still going, not only once it finishes.
    const { result } = renderHook(() => useRenderQueue(OUTPUT));

    await act(async () => {
      result.current.enqueue([job("blocked-1", "no character"), job("ok-1")]);
    });

    expect(result.current.states["blocked-1"]?.phase).toBe("blocked");
  });
});
