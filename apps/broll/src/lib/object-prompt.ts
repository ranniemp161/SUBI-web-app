import type { CharacterStyleId } from "./styles";

/**
 * The wording, the caps and the image settings for one generated object
 * illustration (spec `broll/0008`).
 *
 * Pure and network free, exactly like `character-prompt.ts` and for the same
 * reason: the wording is what the feature is, so it should be unit testable
 * without a key. What it deliberately does **not** re-declare is the model, the
 * timeouts or the per-image cost — those are one decision for this app's image
 * generation, and `character-prompt.ts` already owns them. Two files disagreeing
 * about which model is pinned is precisely the drift the monorepo's money rules
 * exist to prevent, one layer down.
 */

/**
 * How the object is drawn, per project style.
 *
 * **Deliberately the same two styles a character has, worded to match.** The
 * whole reason an object is generated rather than pulled from a stock set is
 * that it has to look like it belongs beside the creator's character in the same
 * edit. A castle rendered in some fourth house style would be clip art with
 * extra steps.
 */
const STYLE_DESCRIPTIONS: Record<CharacterStyleId, string> = {
  anime:
    "a clean modern anime illustration, cel shaded, with crisp linework, flat colour fills and minimal gradients",
  "3d-render":
    "a polished 3D render with smooth stylised proportions, soft studio lighting and subtle material shading",
};

/**
 * Flat light grey, no shadow — the same background the character prompt asks
 * for, and load bearing for the same reason.
 *
 * The illustration is background-removed in the browser before it is stored, and
 * a cast shadow survives that removal as a grey smear on exactly the edge the
 * composite is judged by. A floor line does the same thing, and an object is
 * centred in its frame rather than stood on anything, so there is nothing for it
 * to sit on either.
 */
const BACKGROUND =
  "Place the object on a completely flat, even light grey background. No gradient, no vignette, no cast shadow, no floor line, no surface under it, and no scene elements of any kind.";

const FRAMING =
  "Show the whole object, centred, at a slight three-quarter angle, with a small margin of empty space on every side. Nothing may touch or cross the edge of the frame.";

/**
 * What must not be in the picture.
 *
 * Text is first because it is the one that ships a mistake: a generated sign or
 * label is words on screen that nobody said, in a product whose entire promise
 * is that what is on screen came out of the creator's own talk. People are
 * excluded because a figure in an object scene reads as the creator and is not.
 */
const EXCLUSIONS =
  "Do not include any text, letters, numbers, logos, watermarks, labels or signage. Do not include any people, hands or animals. Draw one object and nothing else.";

/**
 * The prompt for one illustration.
 *
 * `subject` is the traced noun phrase off `broll_scenes.object`, which by then
 * has already been proved to appear in the line the scene cites — so this
 * function never has to decide whether the subject is legitimate, only how to
 * draw it.
 */
export function buildObjectPrompt(subject: string, style: CharacterStyleId): string {
  return [
    `Draw ${subject.trim()}, as ${STYLE_DESCRIPTIONS[style]}.`,
    "",
    FRAMING,
    "",
    BACKGROUND,
    "",
    "Light it evenly from the front with soft neutral light and no strong cast shadows.",
    "",
    EXCLUSIONS,
  ].join("\n");
}

/**
 * Square at 1K.
 *
 * Square rather than the character's 3:4, because an object has no reliable
 * orientation: a castle is wide, a rocket is tall, and a square frame wastes the
 * least on either. The alpha trim crops to the drawing afterwards regardless, so
 * the shape here only decides how much of the generated pixel budget lands on
 * the object rather than on background that is about to be removed.
 *
 * The `K` must be uppercase; the API rejects `1k`.
 */
export const OBJECT_ASPECT_RATIO = "1:1" as const;

/**
 * How many illustrations one scene may have generated for it, in total.
 *
 * A cap rather than an allowance of free retries: every one of these is charged,
 * so this is not protecting the balance, it is protecting a creator from a stuck
 * loop of regenerating one castle forty times at real cost. Well above what
 * anyone reasonably needs and well below a runaway.
 */
export const MAX_OBJECT_ATTEMPTS = 8;

/**
 * The longest one image call may take.
 *
 * Shorter than the character run's per-turn budget has to be, because this is
 * one call rather than the sixth of six inside a 300 second ceiling. A creator
 * is waiting on this with a scene open, so a hung call should surface as an
 * error and a refund quickly rather than hold the pane for the better part of a
 * minute.
 */
export const OBJECT_TIMEOUT_MS = 30_000;

/** One retry, matching the character turn. A cold model call fails transiently. */
export const OBJECT_RETRIES = 1;
