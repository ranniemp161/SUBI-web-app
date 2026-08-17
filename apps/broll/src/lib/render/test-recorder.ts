import type { DrawableImage, Render2DContext } from "./context";

/**
 * A `Render2DContext` that records what was drawn on it instead of drawing.
 *
 * **One recorder, every template test.** Each of the render test files used to
 * carry its own copy, which was fine while the interface had twenty methods and
 * became a liability the moment it grew: a widened `Render2DContext` failed
 * three files in three places, and the obvious fix — pasting the new methods
 * into each — is how three recorders start disagreeing about what a draw call
 * looks like.
 *
 * Not named `*.test.ts` on purpose, so vitest treats it as a helper rather than
 * as a suite with no assertions in it.
 *
 * What it records is deliberately shallow: the calls that put marks on a frame,
 * with the context state that decides how they look. Path building
 * (`moveTo`/`lineTo`/`arc`) is accepted and dropped, because a test that
 * asserted on path segments would be asserting on the implementation of a
 * shape rather than on the shape.
 */

export type Call =
  | {
      op: "fillRect";
      x: number;
      y: number;
      width: number;
      height: number;
      style: string;
      alpha: number;
    }
  | { op: "fillText"; text: string; x: number; y: number; alpha: number; font: string }
  | {
      op: "drawImage";
      x: number;
      y: number;
      width: number;
      height: number;
      alpha: number;
    }
  | { op: "fill"; style: string; alpha: number }
  | { op: "stroke"; style: string; alpha: number; lineWidth: number }
  | {
      op: "roundRect";
      x: number;
      y: number;
      width: number;
      height: number;
      radii: number | number[] | undefined;
    };

/** The colour stops handed to a gradient, so a test can assert the ramp. */
export type RecordedGradient = {
  kind: "linear" | "radial";
  coords: number[];
  stops: { offset: number; color: string }[];
};

export type Recorder = Render2DContext & {
  calls: Call[];
  gradients: RecordedGradient[];
};

export interface RecorderOptions {
  /**
   * Charge a fixed width per character instead of scaling with the font size.
   *
   * `character-left`'s tests want this: they assert **where line breaks land**
   * relative to a column, so a measure that moves when a theme's size ratio
   * moves would make those assertions about the theme rather than about the
   * wrapping. Everything else wants the size-relative default, which is what
   * actually exercises the shrink-to-fit paths.
   */
  charWidth?: number;
}

export function recorder(options: RecorderOptions = {}): Recorder {
  const calls: Call[] = [];
  const gradients: RecordedGradient[] = [];

  const makeGradient = (kind: "linear" | "radial", coords: number[]): CanvasGradient => {
    const record: RecordedGradient = { kind, coords, stops: [] };
    gradients.push(record);
    return {
      addColorStop(offset: number, color: string) {
        record.stops.push({ offset, color });
      },
    } as unknown as CanvasGradient;
  };

  const ctx: Recorder = {
    calls,
    gradients,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineJoin: "round",
    lineCap: "round",
    font: "",
    textAlign: "left",
    textBaseline: "top",
    globalAlpha: 1,
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    rect() {},
    roundRect(x, y, width, height, radii) {
      calls.push({ op: "roundRect", x, y, width, height, radii });
    },
    clip() {},
    fill() {
      calls.push({ op: "fill", style: String(this.fillStyle), alpha: this.globalAlpha });
    },
    stroke() {
      calls.push({
        op: "stroke",
        style: String(this.strokeStyle),
        alpha: this.globalAlpha,
        lineWidth: this.lineWidth,
      });
    },
    fillRect(x, y, width, height) {
      calls.push({
        op: "fillRect",
        x,
        y,
        width,
        height,
        style: String(this.fillStyle),
        alpha: this.globalAlpha,
      });
    },
    fillText(text, x, y) {
      calls.push({ op: "fillText", text, x, y, alpha: this.globalAlpha, font: this.font });
    },
    measureText(text) {
      // Roughly half an em per character, which is close to a real sans serif.
      // An earlier version charged a tenth of an em and nothing ever wrapped,
      // so the wrapping and shrinking paths were never actually exercised and
      // two tests passed for the wrong reason.
      const size = Number(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 10);
      return {
        width: text.length * (options.charWidth ?? size * 0.5),
        // Cap height and descender as a share of the em, close enough to a real
        // face for optical-centring maths to be exercised rather than skipped.
        actualBoundingBoxAscent: size * 0.72,
        actualBoundingBoxDescent: size * 0.2,
      };
    },
    createLinearGradient(x0, y0, x1, y1) {
      return makeGradient("linear", [x0, y0, x1, y1]);
    },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      return makeGradient("radial", [x0, y0, r0, x1, y1, r1]);
    },
    drawImage(_image, dx, dy, dWidth, dHeight) {
      calls.push({
        op: "drawImage",
        x: dx,
        y: dy,
        width: dWidth,
        height: dHeight,
        alpha: this.globalAlpha,
      });
    },
  };

  return ctx;
}

export const texts = (c: Recorder) =>
  c.calls.filter((x): x is Extract<Call, { op: "fillText" }> => x.op === "fillText");

export const rects = (c: Recorder) =>
  c.calls.filter((x): x is Extract<Call, { op: "fillRect" }> => x.op === "fillRect");

export const images = (c: Recorder) =>
  c.calls.filter((x): x is Extract<Call, { op: "drawImage" }> => x.op === "drawImage");

/** A stand-in bitmap. The layout maths reads `width` and `height` and nothing else. */
export const bitmap = (width: number, height: number): DrawableImage =>
  ({ width, height }) as unknown as DrawableImage;
