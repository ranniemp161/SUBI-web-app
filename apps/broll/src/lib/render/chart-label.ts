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

/**
 * Where a number crosses into compact notation, in digits.
 *
 * Seven digits is a million: `1,240,000` set at a big number's size runs off a
 * 1080 frame, and `1.2M` says the same thing. Compact notation changes the
 * digits and **never** the unit, which is why it lives in this file rather than
 * beside the drawing — the one rule here is that a unit survives to the pixels,
 * and abbreviating is the operation most likely to drop it.
 *
 * It is here rather than in `CHART_FULL_THEME` for a plain mechanical reason:
 * `chart-full.ts` imports this module, so a constant read from there would be a
 * cycle.
 */
const COMPACT_FROM_DIGITS = 7;

/** The suffixes compact notation uses, smallest first. */
const COMPACT_STEPS = [
  { at: 1e12, suffix: "T" },
  { at: 1e9, suffix: "B" },
  { at: 1e6, suffix: "M" },
] as const;

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

  // Seven digits or more is abbreviated. Measured on the magnitude, so a
  // negative million compacts exactly like a positive one.
  const magnitude = Math.abs(value);
  if (magnitude >= 10 ** (COMPACT_FROM_DIGITS - 1)) {
    for (const step of COMPACT_STEPS) {
      if (magnitude < step.at) continue;
      const scaled = value / step.at;
      // One decimal, and no trailing `.0`: `1.2M`, but `5M` rather than `5.0M`.
      const digits = Math.abs(scaled) < 100 ? 1 : 0;
      const text = scaled.toLocaleString("en-US", { maximumFractionDigits: digits });
      return `${text}${step.suffix}`;
    }
  }

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
  return formatChartParts(value, unit).joined;
}

/**
 * The same label, taken apart, for the one caller that sets the unit
 * differently from the number.
 *
 * The single big number sets its unit smaller and in the muted tone, which
 * needs the two drawn as separate `fillText` calls — and therefore needs to
 * know **where** the unit sits relative to the number, which is a question this
 * module already answers and nothing else should answer again. Every other
 * label keeps using `joined`.
 *
 * `where` is `"none"` when the speaker stated no unit, so a caller can tell
 * "no unit" from "a unit that happens to sit after the number" without
 * comparing strings.
 */
export function formatChartParts(
  value: number,
  unit: string | null
): { number: string; unit: string; where: "prefix" | "suffix" | "none"; joined: string } {
  const number = formatChartNumber(value);
  if (number === "") return { number: "", unit: "", where: "none", joined: "" };

  const trimmed = unit?.trim() ?? "";
  if (trimmed === "") return { number, unit: "", where: "none", joined: number };

  const key = trimmed.toLowerCase();

  if (PREFIX_UNITS.has(trimmed)) {
    return { number, unit: trimmed, where: "prefix", joined: `${trimmed}${number}` };
  }
  if (TIGHT_SUFFIX_UNITS.has(key)) {
    return { number, unit: trimmed, where: "suffix", joined: `${number}${trimmed}` };
  }

  // A word, or something we have not seen. Render it rather than lose it.
  return { number, unit: trimmed, where: "suffix", joined: `${number} ${trimmed}` };
}
