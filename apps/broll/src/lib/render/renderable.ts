import { drawCharacterCenterFrame } from "./character-center";
import { drawCharacterLeftFrame } from "./character-left";
import { drawCharacterPlusObjectFrame } from "./character-plus-object";
import { drawChartFullFrame, type ChartFullScene } from "./chart-full";
import type { Render2DContext } from "./context";
import { drawObjectFullFrame } from "./object-full";
import { drawObjectLeftFrame } from "./object-left";
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
    }
  | {
      template: "object-full" | "object-left";
      scene: { text: string | null };
      /** The generated illustration, already decoded. */
      objectImage: ImageBitmap | null;
    }
  | {
      template: "character-plus-object";
      scene: { text: string | null };
      /** The chosen emotion's cutout. */
      image: ImageBitmap | null;
      /** The generated illustration. */
      objectImage: ImageBitmap | null;
    };

/** Which templates can be drawn today. The rest of the plan is still listed only. */
export const RENDERABLE_TEMPLATES = [
  "chart-full",
  "character-left",
  "character-center",
  "text-card",
  "object-full",
  "object-left",
  "character-plus-object",
] as const;

/** Whether a scene's template has a renderer yet. */
export function isRenderableTemplate(template: string): boolean {
  return (RENDERABLE_TEMPLATES as readonly string[]).includes(template);
}

/**
 * Draws one frame of whichever template this scene is.
 *
 * **Exhaustive on purpose, with no `default`.** This switch used to end in a
 * `default` that drew `chart-full`, so a template added to the union without a
 * case here drew a chart instead of failing — a silent wrong answer in the one
 * place the preview and the encoder are supposed to be identical. The `never`
 * assignment below turns that into a compile error instead.
 */
export function drawRenderable(
  ctx: Render2DContext,
  renderable: Renderable,
  frame: { width: number; height: number; elapsedMs: number }
): void {
  switch (renderable.template) {
    case "chart-full":
      drawChartFullFrame(ctx, renderable.scene, frame);
      return;
    case "character-left":
      drawCharacterLeftFrame(ctx, { text: renderable.scene.text, image: renderable.image }, frame);
      return;
    case "character-center":
      drawCharacterCenterFrame(ctx, { text: renderable.scene.text, image: renderable.image }, frame);
      return;
    case "text-card":
      drawTextCardFrame(ctx, renderable.scene, frame);
      return;
    case "object-full":
      drawObjectFullFrame(
        ctx,
        { text: renderable.scene.text, image: renderable.objectImage },
        frame
      );
      return;
    case "object-left":
      drawObjectLeftFrame(
        ctx,
        { text: renderable.scene.text, image: renderable.objectImage },
        frame
      );
      return;
    case "character-plus-object":
      drawCharacterPlusObjectFrame(
        ctx,
        {
          text: renderable.scene.text,
          image: renderable.image,
          objectImage: renderable.objectImage,
        },
        frame
      );
      return;
    default: {
      const unreachable: never = renderable;
      throw new Error(
        `no renderer for template ${String((unreachable as { template?: string }).template)}`
      );
    }
  }
}
