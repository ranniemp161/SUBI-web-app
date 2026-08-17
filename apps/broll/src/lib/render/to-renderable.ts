import type { SceneSummary } from "@/lib/scenes";
import type { Renderable } from "./renderable";

/**
 * The decoded images a scene may need, by the key each is looked up under.
 *
 * Two maps rather than one because the two are keyed by different things and
 * shared differently. A character cutout is keyed by **emotion** and reused by
 * every scene that picks that emotion, so a project with twelve scenes decodes
 * at most six. An illustration is keyed by **scene id**, because it was
 * generated for that one scene and belongs to nothing else.
 */
export interface SceneBitmaps {
  /** Character cutouts by emotion. */
  characters: Map<string, ImageBitmap>;
  /** Generated illustrations by scene id. */
  objects: Map<string, ImageBitmap>;
}

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
  bitmaps: SceneBitmaps
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
      image: scene.emotion ? (bitmaps.characters.get(scene.emotion) ?? null) : null,
    };
  }

  if (scene.layoutTemplate === "object-full" || scene.layoutTemplate === "object-left") {
    // Same tolerance as a missing cutout, and it matters more here: an
    // illustration is fetched over a signed URL that the studio requests after
    // first paint, so every object scene is briefly imageless by design.
    return {
      template: scene.layoutTemplate,
      scene: { text: scene.overlayText ?? scene.sourceText },
      objectImage: bitmaps.objects.get(scene.id) ?? null,
    };
  }

  if (scene.layoutTemplate === "character-plus-object") {
    return {
      template: "character-plus-object",
      scene: { text: scene.overlayText ?? scene.sourceText },
      image: scene.emotion ? (bitmaps.characters.get(scene.emotion) ?? null) : null,
      objectImage: bitmaps.objects.get(scene.id) ?? null,
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
