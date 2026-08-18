import type { Render2DContext } from "./context";

/**
 * The palette and surface treatment every rendered clip draws with.
 *
 * **This exists because the output did not look like the product.** Each
 * template carried its own invented palette — a navy `#0b0f19` ground and a
 * periwinkle `#5b8cff` figure — and none of those values appear anywhere in this
 * ecosystem. `design-prompt.md` is explicit that this app is the fourth in a
 * family and says "do not introduce new hues", which the templates had done
 * three times over. The clip is the thing a creator actually publishes, so it is
 * the one surface where looking like a sibling matters most, and it was the one
 * surface nobody had styled.
 *
 * Every constant here comes from `design-prompt.md` §A. The per template theme
 * objects still exist and still hold each template's own geometry — the ratios,
 * the timings, the entrance curves — they just stop inventing colour.
 */

/** The ecosystem palette, verbatim from the brief. Do not add hues. */
export const BRAND = {
  /** Page ground. Pure black rather than the surface grey: a clip is cut into
   *  someone else's timeline, and black is the one ground that composites
   *  cleanly against any footage on either side of it. */
  background: "#000000",
  surface: "#0c0c0e",
  /** Inputs, secondary fills, dividers — here, the unfilled part of a bar. */
  surfaceAlt: "#2c2c2c",
  foreground: "#ffffff",
  muted: "#aaaaaa",
  /** Key Yellow. The brand, and the figure in every chart. */
  accent: "#fffc00",
  /** Text *on* yellow. White on yellow fails contrast; this is not optional. */
  accentForeground: "#111111",
  /** Interactive Blue. The second series, never a third hue. */
  blue: "#2997ff",
} as const;

/**
 * The series ramp for a chart with more than one value.
 *
 * **Two hues and their shades, plus neutrals — no third hue.** A pie needs six
 * distinguishable slices and the brief forbids inventing colours, so this walks
 * Key Yellow and Interactive Blue through light and dark rather than reaching
 * for green and orange. Ordered so adjacent slices always differ in lightness as
 * well as hue, which is what keeps them apart for a viewer who cannot separate
 * yellow from blue — and the slices carry text labels regardless, because the
 * brief forbids encoding meaning in colour alone.
 */
export const SERIES = [
  BRAND.accent,
  BRAND.blue,
  "#ffffff",
  "#b3b000",
  "#1c6cb8",
  BRAND.muted,
] as const;

/**
 * The 40px grid from the brief's surface treatment, expressed as a ratio.
 *
 * The brief specifies 40px lines behind hero and empty areas; a clip frame is
 * the largest hero area this product has. Held as a share of the frame's short
 * edge so a 9:16 clip gets the same visual density as a 16:9 one rather than a
 * grid twice as fine.
 *
 * **Line weight is deliberately not 1px.** A one pixel line at 8% white is
 * exactly the kind of high frequency, low contrast detail H.264 spends no bits
 * on and then rings around, so it arrives in the exported file as shimmer rather
 * than as a grid. Two pixels at 1080p survives the encoder.
 */
export const GRID = {
  /** Cell size as a share of the short edge: 1/27 is 40px at 1080. */
  cellRatio: 1 / 27,
  /** Line width as a share of the short edge, floored at 1 device pixel. */
  lineRatio: 2 / 1080,
  line: "rgba(255,255,255,0.08)",
  /**
   * Where the grid starts fading, as a share of the half diagonal.
   *
   * Full strength through the middle of the frame and gone by the corners. On
   * a pure black ground an ordinary vignette has nothing to darken, so the grid
   * is the only thing in the backdrop that can carry one — and fading it is
   * what stops the grid reading as wallpaper rather than as depth.
   */
  fadeStartRatio: 0.55,
  /** What the grid fades to at the corners: the same white, fully transparent. */
  lineEdge: "rgba(255,255,255,0)",
} as const;

/**
 * The soft glow that separates a figure from the ground behind it.
 *
 * A dark cutout on black loses its edges — dark hair against the backdrop is
 * the case that shows it. The brief already sanctions this treatment: its
 * `--accent-shadow` is "glow behind brand elements", in Key Yellow.
 *
 * **Key Yellow, written as `rgba` rather than referencing `BRAND.accent`,**
 * because a gradient stop needs a per-stop alpha and the palette holds hex. The
 * channels are `#fffc00` and a test holds them to it, so this stays one colour
 * with the brand rather than becoming a second, drifting yellow.
 *
 * Alpha is well under the brief's 0.25. At the strength a screen can carry,
 * an 8 bit H.264 encode bands a wide soft gradient on dark ground, and banding
 * reads as a fault rather than as a choice.
 */
export const GLOW = {
  /** Radius as a share of the short edge. Wide enough to separate a figure
   *  without reading as a spotlight aimed at it. */
  radiusRatio: 0.42,
  alpha: 0.1,
  color: "rgba(255,252,0,1)",
  edge: "rgba(255,252,0,0)",
} as const;

/**
 * What every family name here falls back to.
 *
 * Named rather than a bare `sans-serif` so a realm that failed to register the
 * brand faces still lands somewhere deliberate, and so the preview and the
 * encode fall back **identically** — the two run in different realms, and a
 * fallback that resolved differently in each would be the exact preview/export
 * divergence the brand faces are being loaded to avoid.
 */
const FALLBACK_STACK = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

/**
 * The two faces a clip is set in, per the brief's §A.
 *
 * **Registered by `render/fonts.ts`, on the page and in the worker both**, and
 * awaited before the first draw. Until that landed these were one constant
 * naming a system stack, because a worker's `OffscreenCanvas` resolves against
 * `self.fonts` and nothing populated it — so naming a brand family rendered
 * correctly in the preview and silently fell back in the exported file.
 *
 * The split follows the brief rather than being invented here: Space Grotesk on
 * headings and on numeric data, DM Sans on body. In a clip, `DISPLAY` is the
 * words the frame is *about* — the speaker's line burned on screen, a chart's
 * title, the one big number — and `BODY` is what supports them, which is the
 * labels around a chart's marks. A clip that used one face for both would be
 * legible and would not look like the rest of the ecosystem.
 */
export const DISPLAY_TYPEFACE = `"Space Grotesk", ${FALLBACK_STACK}`;
export const BODY_TYPEFACE = `"DM Sans", ${FALLBACK_STACK}`;

/**
 * The default family, kept under its original name so a template that has no
 * opinion still draws in something brand-correct.
 *
 * Display rather than body: every existing call site was burning short, large,
 * load-bearing text, which is what `DISPLAY_TYPEFACE` is for.
 */
export const TYPEFACE = DISPLAY_TYPEFACE;

/**
 * The paint the grid lines are filled with: full strength through the middle of
 * the frame, transparent by the corners.
 *
 * Measured against the **half diagonal** rather than the short edge, so the
 * fade reaches the corners in both orientations instead of dying before them in
 * one and short of them in the other.
 */
function gridPaint(
  ctx: Pick<Render2DContext, "createRadialGradient">,
  width: number,
  height: number
): CanvasGradient {
  const cx = width / 2;
  const cy = height / 2;
  const halfDiagonal = Math.hypot(width, height) / 2;

  const paint = ctx.createRadialGradient(
    cx,
    cy,
    halfDiagonal * GRID.fadeStartRatio,
    cx,
    cy,
    halfDiagonal
  );
  paint.addColorStop(0, GRID.line);
  paint.addColorStop(1, GRID.lineEdge);
  return paint;
}

/**
 * Paints the ground and its grid. Every template opens with this.
 *
 * The grid is drawn through **one radial gradient per frame** rather than a
 * flat colour, which is the whole of the frame's vignette. One gradient built
 * once and assigned to `fillStyle` fades every line the same way, so this costs
 * a single gradient regardless of how many lines the frame has.
 */
export function drawBackdrop(
  ctx: Pick<Render2DContext, "fillStyle" | "fillRect" | "createRadialGradient">,
  frame: { width: number; height: number }
): void {
  const { width, height } = frame;

  ctx.fillStyle = BRAND.background;
  ctx.fillRect(0, 0, width, height);

  const short = Math.min(width, height);
  const cell = short * GRID.cellRatio;
  if (cell <= 0) return;

  const lineWidth = Math.max(1, short * GRID.lineRatio);
  ctx.fillStyle = gridPaint(ctx, width, height);

  // Drawn as thin rects rather than stroked paths: a stroke centres on the
  // coordinate and lands on a half pixel, which is what makes a grid look like
  // it has two different line weights depending on where it fell.
  for (let x = cell; x < width; x += cell) {
    ctx.fillRect(Math.round(x), 0, lineWidth, height);
  }
  for (let y = cell; y < height; y += cell) {
    ctx.fillRect(0, Math.round(y), width, lineWidth);
  }
}
