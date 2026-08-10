import type { SceneChart } from "./scene-schema";

/**
 * The honesty check: does every number on this chart actually appear in the
 * line the model cited? (spec `broll/0003` AC-54.)
 *
 * **This is the product.** B-Roll's one promise is that a figure on screen came
 * out of the creator's own talk, so a creator can publish under their own name
 * without checking each chart by hand. That promise is kept here, by ordinary
 * code that cannot itself hallucinate — not by asking a model to be careful,
 * and not by asking a second model to mark the first one's work.
 *
 * A chart that fails is **dropped, not fixed**: `chart` is written NULL and the
 * scene survives as a text treatment. Nothing here ever edits a value into
 * agreement, because a corrected number is still a number nobody said.
 *
 * Pure: no database, no network, no model. That is what makes it testable, and
 * being testable is the only reason to trust it.
 */

/**
 * Equivalent ways of writing the same unit or the same small number.
 *
 * Deliberately a table rather than the two or three pairs the first draft
 * needed, because widening it is the lever if the check proves too strict
 * against real transcripts (spec `0003` Follow-up). Every entry is a set of
 * mutually interchangeable spellings: matching any member counts as matching
 * them all.
 *
 * The integer word forms are here for the same reason the unit pairs are — a
 * speaker who says "three times" has said the number three, and refusing to see
 * it would drop a chart that is completely honest. This is bounded at the small
 * integers people actually say aloud; nobody says "one thousand two hundred".
 */
const ALIAS_GROUPS: readonly (readonly string[])[] = [
  ["%", "percent", "percentage", "per cent"],
  ["x", "times", "fold"],
  ["k", "thousand"],
  ["m", "million"],
  ["b", "billion"],
  ["0", "zero", "none"],
  ["1", "one"],
  ["2", "two"],
  ["3", "three"],
  ["4", "four"],
  ["5", "five"],
  ["6", "six"],
  ["7", "seven"],
  ["8", "eight"],
  ["9", "nine"],
  ["10", "ten"],
  ["11", "eleven"],
  ["12", "twelve"],
];

/** Currency marks are stripped rather than aliased: they precede the number. */
const CURRENCY_MARKS = /[$£€¥₱]/g;

export type ChartTrace =
  | { traced: true }
  /** Why it failed, kept for the rejection the run reports back (AC-24). */
  | { traced: false; reason: string };

/**
 * Fold a piece of text into the form both sides of a comparison are measured
 * in: case folded, whitespace collapsed, thousands separators removed, currency
 * marks removed.
 *
 * The thousands separator rule only fires between digits, so `1,200` becomes
 * `1200` while `eighty, roughly` keeps its comma as a word boundary.
 */
export function normalizeForTrace(text: string): string {
  return text
    .toLowerCase()
    .replace(CURRENCY_MARKS, "")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** `80.0` and `80` are the same claim; `80.5` is not `80`. */
function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  // Trailing `.0` normalized away, everything else left exactly as written.
  return String(value);
}

function aliasesOf(token: string): string[] {
  const group = ALIAS_GROUPS.find((g) => g.includes(token));
  return group ? [...group] : [token];
}

/**
 * Does `needle` appear in `haystack` as a whole token?
 *
 * Digit boundaries matter more than word boundaries here: `\b` would let the
 * value `80` match inside `1802`, and a chart claiming 80 backed by a citation
 * that only ever says 1802 is exactly the fabrication this check exists to
 * catch. A number must not be flanked by another digit or by a decimal point.
 */
function containsToken(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const startsAlnum = /^[a-z0-9]/.test(needle);
  const endsAlnum = /[a-z0-9]$/.test(needle);
  const before = startsAlnum ? "(?<![a-z0-9.])" : "";
  const after = endsAlnum ? "(?![a-z0-9.])" : "";

  return new RegExp(`${before}${escaped}${after}`).test(haystack);
}

/** Any spelling of this token, per the alias table. */
function spanContains(span: string, token: string): boolean {
  return aliasesOf(token).some((alias) => containsToken(span, alias));
}

/**
 * Resolve a chart's cited span against the utterance text it points into.
 *
 * Offsets are trusted only as far as the text allows: an `end_char` past the
 * end is clamped, because a model overshooting the last character of a line it
 * genuinely cited should not cost an honest chart, while a `start_char` past the
 * end is a citation of nothing and fails.
 */
export function resolveSpan(
  utteranceText: string,
  span: { start_char: number; end_char: number }
): string | null {
  const start = span.start_char;
  const end = Math.min(span.end_char, utteranceText.length);
  if (!Number.isInteger(start) || start < 0) return null;
  if (start >= utteranceText.length) return null;
  if (end <= start) return null;
  return utteranceText.slice(start, end);
}

/**
 * Verify every value, and the unit, against the cited span (AC-54).
 *
 * The unit is checked exactly as hard as the values are, and on purpose: a bare
 * `80` beside a bare `20` is a different claim than `80%` beside `20%`, and this
 * product sells the difference.
 */
export function traceChart(chart: SceneChart, utteranceText: string): ChartTrace {
  const raw = resolveSpan(utteranceText, chart.source_span);
  if (raw === null) {
    return {
      traced: false,
      reason: "the cited span does not exist in the line it points at",
    };
  }

  const span = normalizeForTrace(raw);

  for (const value of chart.values) {
    const canonical = canonicalNumber(value);
    if (!canonical || !spanContains(span, canonical)) {
      return {
        traced: false,
        reason: `the value ${value} does not appear in the cited line`,
      };
    }
  }

  if (chart.unit !== null) {
    const unit = normalizeForTrace(chart.unit);
    if (unit.length > 0 && !spanContains(span, unit)) {
      return {
        traced: false,
        reason: `the unit "${chart.unit}" does not appear in the cited line`,
      };
    }
  }

  return { traced: true };
}
