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
} as const;

/**
 * The family every template draws with.
 *
 * **This is a stack, not the brand face, and that is a known gap rather than a
 * choice.** The brief asks for Space Grotesk on headings and DM Sans on body.
 * The app loads both through `next/font/google`, which self hosts them into the
 * build with no stable public URL — so the render **worker** cannot reach them.
 * A worker's `OffscreenCanvas` resolves fonts against `self.fonts`, which starts
 * empty and is not populated by anything the page has loaded, so naming
 * `"Space Grotesk"` here would render correctly in the on page preview and
 * silently fall back in the exported file. Preview and export disagreeing is the
 * one thing `renderable.ts` exists to prevent, so the honest answer until the
 * woff2 files are served from `public/` is a stack that resolves the same way in
 * both places.
 *
 * To finish it: put both faces in `public/fonts/`, register them with `FontFace`
 * in the worker *and* on the page, await `ready` before the first draw, and
 * change this one constant.
 */
export const TYPEFACE = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

/** Paints the ground and its grid. Every template opens with this. */
export function drawBackdrop(
  ctx: {
    fillStyle: string | CanvasGradient | CanvasPattern;
    fillRect: (x: number, y: number, w: number, h: number) => void;
  },
  frame: { width: number; height: number }
): void {
  const { width, height } = frame;

  ctx.fillStyle = BRAND.background;
  ctx.fillRect(0, 0, width, height);

  const short = Math.min(width, height);
  const cell = short * GRID.cellRatio;
  if (cell <= 0) return;

  const lineWidth = Math.max(1, short * GRID.lineRatio);
  ctx.fillStyle = GRID.line;

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
