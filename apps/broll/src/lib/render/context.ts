/**
 * The drawing surface every template renders through.
 *
 * It is the subset of a real 2D context the renderers actually use, which is
 * what lets the tests pass a recorder and assert on draw calls with no canvas
 * and no browser. It has to stay assignable **from**
 * `OffscreenCanvasRenderingContext2D` and `CanvasRenderingContext2D`, so the
 * property types carry the browser's full unions even where our code only ever
 * assigns a string.
 *
 * One interface for all templates on purpose. Two interfaces describing the
 * same canvas drift, and the preview and the encoder both have to accept
 * whatever this says.
 *
 * **Narrow by default, widened deliberately.** This started as the twenty-odd
 * primitives the first four templates happened to need, and that narrowness is
 * a feature: every method here is one more thing the test recorder has to
 * implement, so the list should describe what the renderers draw with rather
 * than everything a canvas can do. It gained gradients, shadows, `roundRect`,
 * curves, transforms and real text metrics when the clip design pass needed
 * them — nothing in a rounded bar, a gradient scrim, a vignette or an optically
 * centred line is expressible without those. Add to it when a template needs
 * something, not in anticipation.
 */
export interface Render2DContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  /**
   * Soft shadows and glows. Four properties rather than one because that is how
   * the canvas models it, and `shadowColor` must be set before `shadowBlur` has
   * any effect — a blur with a transparent colour draws nothing, which is an
   * easy way to spend fill time on an invisible result.
   *
   * **Every use has to be undone.** These are context state, not draw
   * parameters, so a shadow left set bleeds onto everything drawn afterwards,
   * including the next frame — the same class of bug as a stray `globalAlpha`.
   * Set them inside a `save()`/`restore()` pair.
   */
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  /** Radians, about the current origin — so it is almost always paired with `translate`. */
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  /** Quadratic curve, for rounding a polyline without a second path library. */
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number
  ): void;
  rect(x: number, y: number, width: number, height: number): void;
  /**
   * A rounded rectangle in one call.
   *
   * The browser's signature takes a number **or** a list of radii, which is what
   * lets a bar be rounded at the top and square where it meets its baseline.
   */
  roundRect(
    x: number,
    y: number,
    width: number,
    height: number,
    radii?: number | number[]
  ): void;
  clip(): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  /**
   * Text metrics.
   *
   * `width` is what wrapping needs. The two ascent fields are what **optical**
   * vertical centring needs: `textBaseline` alignment centres on the font's
   * declared box, which is not where the ink actually sits, so a line of caps
   * centred that way reads low. Both are optional because the structural
   * recorder in the tests supplies only `width`, and because a browser may omit
   * them for a font it had to synthesise.
   */
  measureText(text: string): {
    width: number;
    actualBoundingBoxAscent?: number;
    actualBoundingBoxDescent?: number;
  };
  /**
   * A linear gradient between two points, in the current user space.
   *
   * Returned rather than applied: it is assigned to `fillStyle` or
   * `strokeStyle`, so a caller builds one and uses it like any other paint.
   */
  createLinearGradient(
    x0: number,
    y0: number,
    x1: number,
    y1: number
  ): CanvasGradient;
  /** A radial gradient, for a vignette or a glow behind a figure. */
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number
  ): CanvasGradient;
  drawImage(
    image: DrawableImage,
    dx: number,
    dy: number,
    dWidth: number,
    dHeight: number
  ): void;
}

/**
 * An already decoded image, ready to draw.
 *
 * The renderers never fetch. They take a decoded bitmap and put it on the
 * canvas, so drawing stays a pure function of its inputs and the loading (a
 * signed URL, a network round trip, a decode) belongs to the caller. That is
 * what keeps the encoder and the preview able to share one renderer while
 * fetching in whatever way suits each.
 *
 * These are the concrete sources a real `drawImage` accepts, rather than a
 * structural `{ width, height }`. A structural type reads more testable and is
 * wrong: it would make this interface impossible for a real canvas context to
 * satisfy, because the browser's `drawImage` accepts only these. Every one of
 * them carries `width` and `height`, which is all the layout maths reads.
 */
export type DrawableImage =
  | ImageBitmap
  | HTMLImageElement
  | HTMLCanvasElement
  | OffscreenCanvas;
