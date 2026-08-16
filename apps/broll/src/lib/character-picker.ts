import { CHARACTER_STYLES } from "./styles";

/**
 * What a reuse picker entry shows, and how it labels a style.
 *
 * Pure and dependency free, because both pickers are client components: the one
 * at project setup and the one on a project with no character yet. The shape is
 * shared so a signed thumbnail means the same thing in both, and so neither one
 * has to import from the other's route folder.
 */
export type PickerCharacter = {
  id: string;
  name: string;
  style: string;
  /** A presigned GET for the `neutral` variant. Null only if signing failed. */
  thumbnailUrl: string | null;
};

/**
 * The label for a stored style value.
 *
 * The column is free text, so a character generated before the style list
 * settled can hold something no longer offered. Falling back to the raw value
 * names it rather than showing an empty space.
 */
export function styleLabel(id: string): string {
  return CHARACTER_STYLES.find((style) => style.id === id)?.label ?? id;
}
