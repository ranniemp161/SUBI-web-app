import { LAYOUT_TEMPLATES, type LayoutTemplate, type VisualType } from "./scene-schema";
import { RENDERABLE_TEMPLATES } from "./render/renderable";

/**
 * Which template a scene may become, and what `visual_type` follows from it
 * (spec `broll/0005` AC-75, AC-76, AC-93).
 *
 * Pure and browser safe, like `scene-limits.ts` and for the same reason: the
 * picker in the scene list and the PATCH route must agree about what is
 * offerable, and the only way to guarantee that is one module both import.
 * A picker that offers what the route refuses is a control that fails after the
 * click, which is worse than not offering it.
 */

/** The templates that composite a character, and therefore carry an emotion. */
export const CHARACTER_TEMPLATES = ["character-left", "character-center"] as const;

export function isCharacterTemplate(template: string): boolean {
  return (CHARACTER_TEMPLATES as readonly string[]).includes(template);
}

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
 * What is on screen, derived from the layout (AC-76).
 *
 * **`visual_type` is never accepted from a client.** Two writable fields
 * encoding the same fact is a contradiction waiting to be stored: a request
 * could say `text-card` and `character` together, and every later reader would
 * have to guess which one meant it.
 *
 * Total over all six templates, including the two with no renderer, because the
 * planner writes those and a derivation with a hole in it is a derivation that
 * cannot be trusted as one.
 */
export function visualTypeForTemplate(template: LayoutTemplate): VisualType {
  switch (template) {
    case "character-left":
    case "character-center":
    case "character-plus-chart":
      return "character";
    case "chart-full":
    case "split-compare":
      return "infographic";
    default:
      return "text";
  }
}

/**
 * The templates this particular scene can actually be drawn as (AC-75).
 *
 * Three gates, and each one exists because the alternative is a scene that
 * renders to nothing:
 *
 * - `RENDERABLE_TEMPLATES` — a template with no drawer is never offered. Two of
 *   the six have none today.
 * - a chart — `chart-full` with no chart draws an empty frame. A scene whose
 *   chart the honesty check dropped is exactly this case, which is why the
 *   downgrade note matters (AC-87).
 * - a committed character set — a character template with no cutout draws its
 *   text alone, which is a text card wearing the wrong name.
 *
 * Offering rather than rejecting is the point: a creator never picks something
 * that then fails. The route re-checks anyway, because a list rendered a minute
 * ago is not an authorization.
 */
export function templateOptionsFor(input: {
  hasChart: boolean;
  hasCharacterSet: boolean;
}): LayoutTemplate[] {
  return RENDERABLE_TEMPLATES.filter((template) => {
    if (template === "chart-full") return input.hasChart;
    if (isCharacterTemplate(template)) return input.hasCharacterSet;
    return true;
  });
}

/** Whether this scene may be switched to this template. The route's own gate. */
export function canUseTemplate(
  template: LayoutTemplate,
  input: { hasChart: boolean; hasCharacterSet: boolean }
): boolean {
  return templateOptionsFor(input).includes(template);
}
