import type { SceneSummary } from "@/lib/scenes";
import type { Renderable } from "./renderable";

/**
 * The drawable form of a scene, or null when its template has no renderer yet.
 *
 * **One mapping, three surfaces** (spec `broll/0006`). The row still, the detail
 * pane's preview and the encoder all go through this function and then through
 * `drawRenderable`. It used to sit inside `plan-panel.tsx` because only that
 * component and the batch needed it; the studio adds a third caller, and a
 * second copy of this mapping is exactly how what a creator judges on screen
 * stops matching what lands in the file.
 *
 * A type only import of `SceneSummary`, which is erased at build time, so this
 * module stays browser safe even though `scenes.ts` is `server-only`.
 */
export function toRenderable(
  scene: SceneSummary,
  bitmaps: Map<string, ImageBitmap>
): Renderable | null {
  if (scene.layoutTemplate === "chart-full" && scene.chart) {
    return {
      template: "chart-full",
      scene: {
        // `type` decides the shape. Dropping it here drew every chart as bars,
        // which turned a single statistic into a one bar bar chart.
        type: scene.chart.type,
        title: scene.chart.title,
        values: scene.chart.values,
        labels: scene.chart.labels,
        unit: scene.chart.unit,
      },
    };
  }

  if (
    scene.layoutTemplate === "character-left" ||
    scene.layoutTemplate === "character-center"
  ) {
    // A scene whose cutout has not loaded still renders: the text carries it,
    // and waiting would leave the row blank for no gain. The still redraws when
    // the bitmap lands (AC-100).
    return {
      template: scene.layoutTemplate,
      scene: { text: scene.overlayText ?? scene.sourceText },
      image: scene.emotion ? (bitmaps.get(scene.emotion) ?? null) : null,
    };
  }

  if (scene.layoutTemplate === "text-card") {
    return {
      template: "text-card",
      scene: { text: scene.overlayText ?? scene.sourceText },
    };
  }

  return null;
}
