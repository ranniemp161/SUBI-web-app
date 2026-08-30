import { safeAreaInsets } from "@/lib/render/layout";

/**
 * Draws the platform safe area over a preview frame.
 *
 * **This lives in the studio, not in `render/`, and that is the whole point.**
 * The guide must never reach an exported file, and the cheapest way to
 * guarantee that is for the code to sit outside the module the encoder draws
 * through: the worker imports `drawRenderable`, `drawRenderable` reaches no
 * template that can reach this file, so there is no path from an encode to
 * this function. A flag on the frame object would have been one boolean away
 * from being wrong. `no-guide-in-render.test.ts` holds the separation open.
 *
 * What it shows is the margin Reels, Shorts and TikTok paint their own chrome
 * over: the caption block along the bottom, the action rail down the right.
 * A creator seeing the words stop short of the bottom edge should read it as
 * considered rather than as a bug, which is the only reason to draw it at all.
 *
 * Nothing is drawn for a landscape frame, because nothing is reserved there.
 */
export function drawSafeAreaGuide(
  ctx: CanvasRenderingContext2D,
  frame: { width: number; height: number }
): void {
  const inset = safeAreaInsets(frame);
  if (inset.bottom <= 0 && inset.right <= 0) return;

  const lineX = frame.width - inset.right;
  const lineY = frame.height - inset.bottom;

  ctx.save();

  // A wash over the reserved bands, faint enough to read as "something else
  // goes here" rather than as part of the clip. Drawn as two rectangles that
  // overlap in the corner: the double coverage there is deliberate, since the
  // corner is where both platforms' chrome lands.
  ctx.fillStyle = "rgba(255,255,255,0.045)";
  if (inset.bottom > 0) ctx.fillRect(0, lineY, frame.width, inset.bottom);
  if (inset.right > 0) ctx.fillRect(lineX, 0, inset.right, frame.height);

  // The lines themselves, dashed so they cannot be mistaken for a rule the
  // template drew. Scaled off the frame rather than fixed, because this canvas
  // is a few hundred pixels wide while the encode is 1080.
  const scale = Math.min(frame.width, frame.height);
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = Math.max(1, scale * 0.002);
  ctx.setLineDash([scale * 0.02, scale * 0.02]);

  ctx.beginPath();
  if (inset.bottom > 0) {
    ctx.moveTo(0, lineY);
    ctx.lineTo(frame.width, lineY);
  }
  if (inset.right > 0) {
    ctx.moveTo(lineX, 0);
    ctx.lineTo(lineX, frame.height);
  }
  ctx.stroke();

  ctx.restore();
}
