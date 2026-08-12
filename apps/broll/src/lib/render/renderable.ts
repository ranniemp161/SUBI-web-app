import { drawCharacterCenterFrame } from "./character-center";
import { drawCharacterLeftFrame } from "./character-left";
import { drawChartFullFrame, type ChartFullScene } from "./chart-full";
import type { Render2DContext } from "./context";
import { drawTextCardFrame } from "./text-card";

/**
 * One scene, in the form both the page preview and the encoder draw from.
 *
 * There is exactly one `switch` on template in the app, and it is here. The
 * preview, the worker and anything later all call `drawRenderable`, so adding a
 * template means adding one case rather than finding every place that draws.
 * That matters because the preview and the render must never disagree: what
 * the creator judges on screen has to be what lands in the file.
 */
export type Renderable =
  | { template: "chart-full"; scene: ChartFullScene }
  | { template: "text-card"; scene: { text: string | null } }
  | {
      template: "character-left" | "character-center";
      scene: { text: string | null };
      /** Already decoded. Null draws the text alone rather than failing. */
      image: ImageBitmap | null;
    };

/** Which templates can be drawn today. The rest of the plan is still listed only. */
export const RENDERABLE_TEMPLATES = [
  "chart-full",
  "character-left",
  "character-center",
  "text-card",
] as const;

/** Whether a scene's template has a renderer yet. */
export function isRenderableTemplate(template: string): boolean {
  return (RENDERABLE_TEMPLATES as readonly string[]).includes(template);
}

/** Draws one frame of whichever template this scene is. */
export function drawRenderable(
  ctx: Render2DContext,
  renderable: Renderable,
  frame: { width: number; height: number; elapsedMs: number }
): void {
  switch (renderable.template) {
    case "character-left":
      drawCharacterLeftFrame(ctx, { text: renderable.scene.text, image: renderable.image }, frame);
      return;
    case "character-center":
      drawCharacterCenterFrame(ctx, { text: renderable.scene.text, image: renderable.image }, frame);
      return;
    case "text-card":
      drawTextCardFrame(ctx, renderable.scene, frame);
      return;
    default:
      drawChartFullFrame(ctx, renderable.scene, frame);
  }
}
