/**
 * The character styles a project can be generated in.
 *
 * Pure and dependency free on purpose, the same reason
 * `apps/rough-cut/src/lib/blob-path.ts` is: the create form is a client
 * component and needs this list, and importing anything that reaches the
 * database from there would bundle server code into the browser.
 *
 * **These two are the ones Phase 0 actually measured.** Segmentation was
 * verified clean at high zoom on `anime` and `3D render`, and multi turn
 * identity was verified holding across a six emotion set in both. The design
 * brief says "anime, 3D, and a few others"; the others have no evidence behind
 * them yet, so they are not offered rather than guessed at. Adding one is a
 * product decision plus a segmentation check, not a line in this array.
 */
export const CHARACTER_STYLES = [
  { id: "anime", label: "Anime" },
  { id: "3d-render", label: "3D render" },
] as const;

export type CharacterStyleId = (typeof CHARACTER_STYLES)[number]["id"];

export function isCharacterStyle(value: string): value is CharacterStyleId {
  return CHARACTER_STYLES.some((s) => s.id === value);
}
