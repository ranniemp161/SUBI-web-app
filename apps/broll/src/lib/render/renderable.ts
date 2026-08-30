import { drawCharacterCenterFrame } from "./character-center";
import { drawCharacterLeftFrame } from "./character-left";
import { drawCharacterPlusObjectFrame } from "./character-plus-object";
import { drawChartFullFrame, type ChartFullScene } from "./chart-full";
import type { Render2DContext } from "./context";
import { pushScaleAt } from "./motion";
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
 * Everything a template needs to know about the frame it is drawing into.
 *
 * `durationMs` is the whole clip's length, not the time left, and it is here
 * rather than in each template because **the push is normalised to it**: a four
 * second clip and a ten second one have to finish at the same scale, which is
 * not something a renderer can work out from `elapsedMs` alone. The encoder
 * always knew this number; until spec `0009` the renderer did not.
 */
export interface RenderableFrame {
  width: number;
  height: number;
  /** Time since this scene started, not absolute timeline time. */
  elapsedMs: number;
  /** How long the whole clip runs. */
  durationMs: number;
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
  frame: RenderableFrame
): void {
  // The slow push in, applied once for every template that exists and every
  // template that ever will. Scaling about the frame's centre rather than its
  // origin is what makes it a push rather than a drift toward the corner.
  //
  // `finally` rather than a restore after the switch: each case returns, and
  // the default throws. A transform left on the context would scale the next
  // frame again, and the frame after that.
  const scale = pushScaleAt(frame.elapsedMs, frame.durationMs);
  ctx.save();
  ctx.translate(frame.width / 2, frame.height / 2);
  ctx.scale(scale, scale);
  ctx.translate(-frame.width / 2, -frame.height / 2);

  try {
    drawTemplate(ctx, renderable, frame);
  } finally {
    ctx.restore();
  }
}

function drawTemplate(
  ctx: Render2DContext,
  renderable: Renderable,
  frame: RenderableFrame
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
