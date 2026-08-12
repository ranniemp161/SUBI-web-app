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
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  rect(x: number, y: number, width: number, height: number): void;
  clip(): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
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
 */
export interface DrawableImage {
  readonly width: number;
  readonly height: number;
}
