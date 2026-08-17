import type { SceneChart, SceneObject } from "./scene-schema";

/**
 * The honesty check: does what this scene puts on screen actually appear in the
 * line the model cited? (spec `broll/0003` AC-54, spec `broll/0008`.)
 *
 * Two traces, one rule. `traceChart` asks it of every number and the unit;
 * `traceObject` asks it of the thing the scene is about to illustrate.
 *
 * **This is the product.** B-Roll's one promise is that what is on screen came
 * out of the creator's own talk, so a creator can publish under their own name
 * without checking each clip by hand. That promise is kept here, by ordinary
 * code that cannot itself hallucinate — not by asking a model to be careful,
 * and not by asking a second model to mark the first one's work.
 *
 * What fails is **dropped, not fixed**: the column is written NULL and the
 * scene survives as a text treatment. Nothing here ever edits a value or a
 * subject into agreement, because a corrected number is still a number nobody
 * said and a corrected subject is still a thing nobody named.
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

/**
 * The words a model adds to make a subject read like English, which the speaker
 * is under no obligation to have said.
 *
 * Kept to articles and the two joining words a noun phrase actually attracts.
 * Anything longer starts excusing adjectives, and an adjective the speaker did
 * not say is exactly what this check is for: "a castle" and "a ruined castle"
 * are different pictures.
 */
const SUBJECT_STOPWORDS = new Set(["a", "an", "the", "of", "and"]);

/**
 * Singular and plural spellings of one word.
 *
 * A speaker says "castles dotted the hillside" and a model quite reasonably
 * proposes "a castle". Refusing that would drop an illustration of something the
 * speaker plainly named, so the comparison is made across both numbers. The rules
 * are the ordinary English ones and are deliberately shallow — this is the same
 * lever `ALIAS_GROUPS` is, to be widened against real transcripts rather than
 * guessed at now.
 */
function wordForms(word: string): string[] {
  const forms = new Set<string>([word]);
  if (word.endsWith("ies") && word.length > 4) forms.add(`${word.slice(0, -3)}y`);
  if (word.endsWith("es") && word.length > 3) forms.add(word.slice(0, -2));
  if (word.endsWith("s") && word.length > 2) forms.add(word.slice(0, -1));
  if (word.endsWith("y") && word.length > 2) forms.add(`${word.slice(0, -1)}ies`);
  forms.add(`${word}s`);
  forms.add(`${word}es`);
  return [...forms];
}

/**
 * Verify that the thing this scene will illustrate is a thing the speaker named
 * (spec `broll/0008`).
 *
 * **Every content word must be there, not merely one.** Requiring one would let
 * "a medieval castle" pass on a line that only says "the medieval period", and
 * an illustration of a castle nobody mentioned is a picture of a claim nobody
 * made — the same failure `traceChart` exists to prevent, in a medium where it is
 * harder to notice. Articles and joining words are dropped first, because those
 * are the model's grammar rather than the speaker's content.
 *
 * A failure **drops the object and keeps the scene**, exactly as a failed chart
 * does. Nothing here ever rewrites a subject into agreement.
 */
export function traceObject(object: SceneObject, utteranceText: string): ChartTrace {
  const raw = resolveSpan(utteranceText, object.source_span);
  if (raw === null) {
    return {
      traced: false,
      reason: "the cited span does not exist in the line it points at",
    };
  }

  const span = normalizeForTrace(raw);
  const words = normalizeForTrace(object.subject)
    // Punctuation the model may bring with a noun phrase is not content.
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !SUBJECT_STOPWORDS.has(word));

  if (words.length === 0) {
    return { traced: false, reason: "the subject names nothing" };
  }

  for (const word of words) {
    if (!wordForms(word).some((form) => containsToken(span, form))) {
      return {
        traced: false,
        reason: `"${object.subject}" is not named in the cited line`,
      };
    }
  }

  return { traced: true };
}
