/**
 * How strong the planner thought a scene was, in something a creator can read
 * at a glance (spec `broll/0006` AC-98).
 *
 * The whole screen exists so twenty scenes can be judged at about two seconds
 * each, and `0.62` is not a two second read. A word is. The thresholds live
 * here and nowhere else, so the meter, the word and every test that asserts
 * against them read one source rather than three copies that drift.
 *
 * Pure and dependency free on purpose: `scenes.ts` is `server-only`, so a
 * client component cannot reach a constant that lives beside the query.
 *
 * **The numbers are untuned**, exactly like `SCENES_PER_MINUTE` in the planner.
 * They are a reasonable split of a 0 to 1 score and nothing more. Spec `0003`
 * AC-28's selectivity tuning should revisit the score and these words together:
 * moving the score without the words that describe it just relabels the same
 * distribution.
 */

/** At or above this a scene reads as `strong`. */
export const STRENGTH_STRONG = 0.7;

/** At or above this a scene reads as `fair`. Below it, `weak`. */
export const STRENGTH_FAIR = 0.4;

/** How many segments the meter draws. */
export const STRENGTH_METER_STEPS = 4;

export type StrengthBand = "strong" | "fair" | "weak";

/**
 * The word for a score, or null when there is no score at all.
 *
 * Null is the manual scene case and it must stay distinguishable from a low
 * score. A scene the creator added by hand was never ranked, and showing it as
 * `weak` (or as zero) would read as the planner having judged it and found it
 * worthless (spec `0005` AC-84).
 */
export function strengthBand(strength: number | null): StrengthBand | null {
  if (strength === null || Number.isNaN(strength)) return null;
  if (strength >= STRENGTH_STRONG) return "strong";
  if (strength >= STRENGTH_FAIR) return "fair";
  return "weak";
}

/**
 * How many of the meter's segments are filled, for a score.
 *
 * A scored scene always fills at least one, so the weakest scene still reads as
 * "ranked low" rather than as "not ranked", which is what an empty meter beside
 * a manual scene's absent meter would say.
 */
export function strengthSteps(strength: number | null): number {
  if (strength === null || Number.isNaN(strength)) return 0;
  const clamped = Math.min(1, Math.max(0, strength));
  return Math.max(1, Math.ceil(clamped * STRENGTH_METER_STEPS));
}
