import { describe, expect, it } from "vitest";
import { safeAreaInsets } from "@/lib/render/layout";
import { drawSafeAreaGuide } from "./safe-area-guide";

/**
 * The studio's safe area guide: spec `broll/0009` AC-197.
 *
 * The half of AC-197 that matters most, that the guide can never reach an
 * exported file, is held open structurally in
 * `src/lib/render/safe-area.test.ts`: nothing the encoder imports can even name
 * this module. What is left to check here is the guide itself.
 */

type Recorded = { op: string; args: number[] };

/** Just enough of a 2D context to record what the guide asks for. */
function stub(): { ctx: CanvasRenderingContext2D; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    save: () => {},
    restore: () => {},
    setLineDash: (pattern: number[]) => calls.push({ op: "setLineDash", args: pattern }),
    fillRect: (x: number, y: number, w: number, h: number) =>
      calls.push({ op: "fillRect", args: [x, y, w, h] }),
    beginPath: () => calls.push({ op: "beginPath", args: [] }),
    moveTo: (x: number, y: number) => calls.push({ op: "moveTo", args: [x, y] }),
    lineTo: (x: number, y: number) => calls.push({ op: "lineTo", args: [x, y] }),
    stroke: () => calls.push({ op: "stroke", args: [] }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe("drawSafeAreaGuide", () => {
  it("draws nothing at all on a landscape preview", () => {
    // Nothing covers a 16:9 clip, so there is no margin to explain and a guide
    // would just be a line across the picture.
    const { ctx, calls } = stub();
    drawSafeAreaGuide(ctx, { width: 1920, height: 1080 });
    expect(calls).toHaveLength(0);
  });

  it("marks both reserved bands on a portrait preview", () => {
    const frame = { width: 1080, height: 1920 };
    const { ctx, calls } = stub();
    drawSafeAreaGuide(ctx, frame);

    const inset = safeAreaInsets(frame);
    const fills = calls.filter((call) => call.op === "fillRect");
    expect(fills).toHaveLength(2);
    // The caption block along the bottom, then the action rail down the right.
    expect(fills[0].args).toEqual([0, frame.height - inset.bottom, frame.width, inset.bottom]);
    expect(fills[1].args).toEqual([frame.width - inset.right, 0, inset.right, frame.height]);

    // Two lines, and they land on the safe area edges rather than near them.
    const moves = calls.filter((call) => call.op === "moveTo");
    expect(moves.map((call) => call.args)).toEqual([
      [0, frame.height - inset.bottom],
      [frame.width - inset.right, 0],
    ]);
    expect(calls.some((call) => call.op === "stroke")).toBe(true);
  });

  it("dashes the lines, so neither reads as a rule a template drew", () => {
    const { ctx, calls } = stub();
    drawSafeAreaGuide(ctx, { width: 1080, height: 1920 });

    const dash = calls.find((call) => call.op === "setLineDash");
    expect(dash).toBeDefined();
    expect(dash?.args.every((segment) => segment > 0)).toBe(true);
  });

  it("stays visible on a small preview canvas", () => {
    // The studio previews at a few hundred pixels while the encode is 1080, so
    // a line width derived from the frame has to keep a floor of one pixel or
    // the guide disappears at exactly the size a creator actually looks at.
    const { ctx, calls } = stub();
    drawSafeAreaGuide(ctx, { width: 180, height: 320 });
    expect(ctx.lineWidth).toBeGreaterThanOrEqual(1);
    expect(calls.some((call) => call.op === "stroke")).toBe(true);
  });
});
