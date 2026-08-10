/**
 * The character emotion variants a project's set is generated in.
 *
 * Pure and dependency free for the same reason `styles.ts` is: the review gate
 * and the scene list are client components, and importing anything that reaches
 * the database from there would bundle server code into the browser.
 *
 * **These six, not "six to eight".** The design brief
 * (`docs/specs/broll/design-prompt.md` B3) names exactly these and then hedges
 * the count; Phase 0 measured multi turn identity holding across **six**
 * emotions in both styles, and six is the number that has evidence behind it.
 * The planner is the first thing to need the vocabulary fixed, because it
 * writes `broll_scenes.emotion` and a scene naming a variant the character
 * pipeline never generates is a scene that cannot be composited.
 *
 * This is therefore a contract in both directions: Phase 2's character pipeline
 * must generate exactly this set, and Phase 4's compositor may assume it. Adding
 * one is a product decision plus a segmentation check, not a line in this array.
 */
export const CHARACTER_EMOTIONS = [
  "neutral",
  "happy",
  "surprised",
  "thoughtful",
  "skeptical",
  "excited",
] as const;

export type CharacterEmotion = (typeof CHARACTER_EMOTIONS)[number];

export function isCharacterEmotion(value: string): value is CharacterEmotion {
  return (CHARACTER_EMOTIONS as readonly string[]).includes(value);
}
