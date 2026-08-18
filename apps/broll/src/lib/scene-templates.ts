import {
  LAYOUT_TEMPLATES,
  isCharacterTemplate,
  isObjectTemplate,
  type LayoutTemplate,
} from "./scene-schema";
import { RENDERABLE_TEMPLATES } from "./render/renderable";

/**
 * Which template a scene may become, and what follows from that choice
 * (spec `broll/0005` AC-75, AC-76, AC-93).
 *
 * Pure and browser safe, like `scene-limits.ts` and for the same reason: the
 * picker in the scene list and the PATCH route must agree about what is
 * offerable, and the only way to guarantee that is one module both import.
 * A picker that offers what the route refuses is a control that fails after the
 * click, which is worse than not offering it.
 *
 * **What is here and what is not.** The groupings and the `visual_type`
 * derivation are facts about templates that need no knowledge of what can be
 * drawn, and they live in `scene-schema.ts` so the planner can read them without
 * pulling `RENDERABLE_TEMPLATES` — and with it every canvas drawer — into its
 * server bundle. They are re-exported here, so a caller still has one module to
 * look in and there is still one definition. What genuinely belongs here is the
 * part that has to know which templates render: the offer gate and the blocker.
 */
export {
  CHARACTER_TEMPLATES,
  OBJECT_TEMPLATES,
  isCharacterTemplate,
  isObjectTemplate,
  visualTypeForTemplate,
} from "./scene-schema";

export function isLayoutTemplate(value: string): value is LayoutTemplate {
  return (LAYOUT_TEMPLATES as readonly string[]).includes(value);
}

/** The templates that actually draw a chart, and therefore show its numbers. */
export const CHART_TEMPLATES = ["chart-full", "character-plus-chart"] as const;

/**
 * Whether this scene will draw a chart as it stands (spec `broll/0006` AC-105).
 *
 * **One predicate, three readers**: the row's `chart traced` marker, the chart
 * filter chip, and the citation in the detail pane. Keyed off the current
 * template as well as the column, because a scene restyled away from a chart
 * template keeps its `chart` value and simply stops showing those numbers
 * (spec `0005` AC-86). A row promising a traced chart beside a detail pane
 * showing no citation would be worse than showing neither, and a chip that
 * disagrees with both is the same bug wearing a third face.
 */
export function sceneDrawsChart(scene: {
  layoutTemplate: string;
  chart: unknown | null;
}): boolean {
  return (
    scene.chart !== null &&
    (CHART_TEMPLATES as readonly string[]).includes(scene.layoutTemplate)
  );
}

/**
 * The templates this particular scene can actually be drawn as (AC-75).
 *
 * Three gates, and each one exists because the alternative is a scene that
 * renders to nothing:
 *
 * - `RENDERABLE_TEMPLATES` — a template with no drawer is never offered. Two of
 *   the nine have none today.
 * - a chart — `chart-full` with no chart draws an empty frame. A scene whose
 *   chart the honesty check dropped is exactly this case, which is why the
 *   downgrade note matters (AC-87).
 * - a committed character set — a character template with no cutout draws its
 *   text alone, which is a text card wearing the wrong name.
 * - a traced subject — an object template on a scene that names nothing has
 *   nothing to illustrate, and no prompt to generate from.
 *
 * **The object gate is the subject, not the image** (spec `broll/0008`). An
 * illustration is generated on demand, so gating on the image would hide the
 * template that carries the button that generates it, and no creator could ever
 * reach one. A missing image is a *blocker* with a way out, which is a different
 * thing from a template that could never work — the same split a character
 * template already has between "no character set" and "no emotion picked".
 *
 * Offering rather than rejecting is the point: a creator never picks something
 * that then fails. The route re-checks anyway, because a list rendered a minute
 * ago is not an authorization.
 */
export type TemplateCapabilities = {
  hasChart: boolean;
  hasCharacterSet: boolean;
  /** Whether this scene carries a subject that survived the trace. */
  hasObject: boolean;
};

export function templateOptionsFor(input: TemplateCapabilities): LayoutTemplate[] {
  return RENDERABLE_TEMPLATES.filter((template) => {
    if (template === "chart-full") return input.hasChart;
    // Checked before the character gate, so `character-plus-object` has to
    // satisfy both rather than whichever is asked first.
    if (isObjectTemplate(template) && !input.hasObject) return false;
    if (isCharacterTemplate(template)) return input.hasCharacterSet;
    return true;
  });
}

/** Whether this scene may be switched to this template. The route's own gate. */
export function canUseTemplate(
  template: LayoutTemplate,
  input: TemplateCapabilities
): boolean {
  return templateOptionsFor(input).includes(template);
}

/**
 * Why this scene cannot be rendered right now, or null if it can (spec
 * `broll/0007` AC-138).
 *
 * **The input is `committedEmotions`, and that choice is the whole feature.**
 * The obvious alternative is to ask whether the cutout bitmap is in hand, and it
 * is wrong: bitmaps are decoded asynchronously and the map starts empty, so
 * every character scene would announce that it needs a character for the first
 * moment of every page load and then silently take it back. `committedEmotions`
 * comes from the server, off `broll_assets` for the attached character, and it
 * is already a prop on the studio shell — so it is settled before the first
 * paint and says something true about the project rather than about the network.
 *
 * **Derived, never stored.** Attaching a character makes every blocked scene
 * renderable again with no re-plan and no write, because there was never a
 * column recording the block — which is exactly what AC-138 asks for.
 *
 * This does **not** replace the missing-cutout fallback inside the templates
 * themselves. A character template handed no image still draws its text rather
 * than failing, and that stays: it covers a bitmap that failed to decode, which
 * is a different thing from a project that has no character at all.
 */
export type SceneBlocker = {
  /** For the UI to branch on without matching prose. */
  code:
    | "no_character"
    | "missing_emotion"
    | "no_emotion_chosen"
    /** The scene has a subject but no illustration generated for it yet. */
    | "no_object_image";
  /** Shown to the creator, on the row and in the detail pane. */
  reason: string;
  /**
   * Whether the creator can clear this from the detail pane by spending, rather
   * than by attaching a character or picking an emotion (spec `broll/0008`).
   * The studio bar counts these to offer one batch generate before an export.
   */
  fixableByGenerating?: boolean;
};

export function sceneBlocker(
  scene: {
    layoutTemplate: string;
    emotion: string | null;
    /** Null until an illustration has been generated for this scene. */
    objectAssetPath?: string | null;
  },
  project: { committedEmotions: readonly string[] }
): SceneBlocker | null {
  // An object template needs an image before it can draw, and unlike the
  // character blocks below this one is cleared from the scene itself.
  if (isObjectTemplate(scene.layoutTemplate) && !scene.objectAssetPath) {
    return {
      code: "no_object_image",
      reason: "This scene draws an object, and none has been generated yet.",
      fixableByGenerating: true,
    };
  }

  // Only character templates can be blocked the remaining ways. A text card and
  // a chart need nothing from the character set, which is what makes them the
  // templates a faceless project can still cut b-roll with.
  if (!isCharacterTemplate(scene.layoutTemplate)) return null;

  if (project.committedEmotions.length === 0) {
    return {
      code: "no_character",
      reason: "This scene draws a character, and the project has none attached.",
    };
  }

  if (!scene.emotion) {
    return {
      code: "no_emotion_chosen",
      reason: "This scene draws a character but no emotion is picked.",
    };
  }

  if (!project.committedEmotions.includes(scene.emotion)) {
    return {
      code: "missing_emotion",
      reason: `The character has no ${scene.emotion} image, so this scene has nothing to draw.`,
    };
  }

  return null;
}
