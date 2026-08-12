/**
 * Chart value labels (spec `0001` AC-34).
 *
 * The rule is one sentence: **a value never renders without the unit the
 * speaker attached to it.** A line saying "80%" must not produce a chart
 * labelled `80`, because 80 and 80% are different claims and the wrong one is
 * a fabricated statistic sitting on the creator's video under their face.
 *
 * The planner already refuses to invent a unit: `chart.unit` is nullable and
 * the schema tells the model never to supply one the line does not contain.
 * This module is the other half of that promise, at draw time. If the unit
 * survived the honesty check, it reaches the pixels.
 *
 * Units arrive as the speaker said them (`%`, `percent`, `x`, `million`, `$`),
 * so placement is decided by shape rather than by a fixed list: currency sits
 * in front, symbols hug the number, words take a space. An unknown unit is
 * still rendered, spaced, rather than dropped. Dropping is the one outcome
 * this file exists to prevent.
 */

/** Units written before the number rather than after it. */
const PREFIX_UNITS = new Set(["$", "£", "€", "¥", "₱"]);

/** Units that hug the number with no space, e.g. `80%`, `3x`, `12°`. */
const TIGHT_SUFFIX_UNITS = new Set(["%", "x", "°", "°c", "°f", "k", "m", "b"]);

/**
 * Formats a number the way a viewer reads it: thousands grouped, and no
 * trailing `.0` on a value the model happened to send as a float. `80.0` and
 * `80` are the same claim, and the honesty check already traces them to the
 * same span.
 */
export function formatChartNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  // Explicit locale: the label must not change with the machine's locale.
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * A chart value rendered with its unit, ready to draw.
 *
 * `unit` null means the speaker stated none, which is the planner's way of
 * saying "this is a bare count". That renders bare, and that is correct: the
 * failure this guards against is a unit being *lost*, never a unit being
 * absent because none was spoken.
 */
export function formatChartValue(value: number, unit: string | null): string {
  const number = formatChartNumber(value);
  if (number === "") return "";

  const trimmed = unit?.trim() ?? "";
  if (trimmed === "") return number;

  const key = trimmed.toLowerCase();

  if (PREFIX_UNITS.has(trimmed)) return `${trimmed}${number}`;
  if (TIGHT_SUFFIX_UNITS.has(key)) return `${number}${trimmed}`;

  // A word, or something we have not seen. Render it rather than lose it.
  return `${number} ${trimmed}`;
}
