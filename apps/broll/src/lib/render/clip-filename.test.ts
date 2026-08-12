import { describe, expect, it } from "vitest";
import { sceneClipFilename } from "./clip-filename";

/** 30fps exactly, the simplest timebase to reason about. */
const FPS_30 = { numerator: 30, denominator: 1 } as const;
/** NTSC 29.97 drop frame, which renders `;` before the frames field. */
const FPS_2997 = { numerator: 30000, denominator: 1001 } as const;
/** PAL. */
const FPS_25 = { numerator: 25, denominator: 1 } as const;

describe("sceneClipFilename", () => {
  it("produces the name the spec gives as its example", () => {
    // AC-33's literal example: scene 4 starting at 2:35.
    expect(sceneClipFilename({ index: 4, startMs: 155_000, fps: FPS_30 })).toBe(
      "scene_04__02-35.mp4"
    );
  });

  it("pads the scene index to two digits and leaves longer ones alone", () => {
    expect(sceneClipFilename({ index: 1, startMs: 0, fps: FPS_30 })).toBe("scene_01__00-00.mp4");
    expect(sceneClipFilename({ index: 12, startMs: 0, fps: FPS_30 })).toBe("scene_12__00-00.mp4");
    expect(sceneClipFilename({ index: 100, startMs: 0, fps: FPS_30 })).toBe("scene_100__00-00.mp4");
  });

  it("omits hours below one hour and restores them at or above it", () => {
    expect(sceneClipFilename({ index: 1, startMs: 3_599_000, fps: FPS_30 })).toBe(
      "scene_01__59-59.mp4"
    );
    // 1:05:03. Without the hours field this would read 65-03, or worse, 05-03.
    expect(sceneClipFilename({ index: 1, startMs: 3_903_000, fps: FPS_30 })).toBe(
      "scene_01__01-05-03.mp4"
    );
  });

  it("never emits a colon or a semicolon, which are illegal in a filename", () => {
    // Drop frame timecode uses `;` as its frames separator, so a naive split on
    // ":" alone would leave the semicolon in the name on NTSC projects.
    for (const fps of [FPS_30, FPS_2997, FPS_25]) {
      const name = sceneClipFilename({ index: 7, startMs: 155_000, fps });
      expect(name).not.toMatch(/[:;]/);
      expect(name).toMatch(/^scene_\d{2,}__[\d-]+\.mp4$/);
    }
  });

  it("rounds to the nearest frame, the repo's one rule, rather than truncating", () => {
    // `secondsToFrame` rounds to the nearest whole frame and is documented as
    // the single rounding rule for the repo, so the label crosses a second at
    // the half frame, not at the second boundary. At 30fps that is frame 89.5,
    // i.e. 2.9833s. Truncating milliseconds instead would put both of these in
    // second 2 and silently disagree with Rough Cut about where the clip goes.
    expect(sceneClipFilename({ index: 1, startMs: 2_983, fps: FPS_30 })).toBe(
      "scene_01__00-02.mp4"
    );
    expect(sceneClipFilename({ index: 1, startMs: 2_984, fps: FPS_30 })).toBe(
      "scene_01__00-03.mp4"
    );
  });

  it("labels a drop frame project by its display timecode, not its real frame count", () => {
    // At 29.97 the display label runs ahead of wall clock, which is the whole
    // point of drop frame. 10 minutes of real time reads as 10:00 exactly.
    expect(sceneClipFilename({ index: 3, startMs: 600_600, fps: FPS_2997 })).toBe(
      "scene_03__10-00.mp4"
    );
  });
});
