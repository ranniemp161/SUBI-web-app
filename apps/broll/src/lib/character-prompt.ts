import { CHARACTER_EMOTIONS, type CharacterEmotion } from "@/lib/emotions";
import type { CharacterStyleId } from "@/lib/styles";

/**
 * The multi turn character generation prompt (spec `broll/0004`, the Character
 * prompt section, which this file implements verbatim).
 *
 * **This reconstructs the lost `broll-generator-spec.md` §8.1.** That document
 * was never checked in and is gone; spec `0002` already paid this cost once by
 * rebuilding the data model column by column. What survived of §8.1 was four
 * sentences in spec `0001` §5.4: later turns anchor on the previous *output*
 * image, the style is not restated, re feeding the original photo invites drift,
 * and a single variant regenerates from the stored neutral. Phase 0 measured
 * that this approach holds identity across six emotions in both shipping styles.
 *
 * **Phase 0 did not measure these sentences.** The approach is proven; this
 * exact wording is a first draft and is the one thing here no test can judge.
 * Look at real output for both styles before the price goes live (spec `0004`
 * Follow up).
 *
 * Pure and network free on purpose, so the wording is unit testable and so
 * AC-74 (the style is stated once, never restated) is a fact the suite asserts
 * rather than a habit the author intended.
 */

/**
 * Stated on turn 1 only. Restating it on a later turn is what spec `0001` §5.4
 * warns invites drift, and AC-74 makes that a checkable property.
 */
const STYLE_DESCRIPTIONS: Record<CharacterStyleId, string> = {
  anime:
    "a clean modern anime illustration, cel shaded, with crisp linework, flat colour fills and minimal gradients",
  "3d-render":
    "a polished 3D character render with smooth stylised proportions, soft studio lighting and subtle subsurface skin shading",
};

/**
 * Upper body, waist up: enough face for six expressions to read differently at
 * 1K, enough body for a gesture. A template can crop tighter later; it cannot
 * invent body that was never generated.
 *
 * The margin above the hair is not cosmetic. A character cropped at the crown
 * alpha trims badly, and the trim is what every template positions against.
 */
const FRAMING =
  "Frame the character from the waist up, centred and facing the viewer, with the head and shoulders fully inside the frame and a small margin of space above the hair.";

/**
 * Flat light grey, established by Phase 0 as what segments cleanly.
 *
 * "No cast shadow" is load bearing rather than tidy: a shadow survives
 * background removal as a grey smear on exactly the character edge the product
 * is judged by.
 */
const BACKGROUND =
  "Place the character on a completely flat, even light grey background. No gradient, no vignette, no cast shadow, no floor line, and no scene elements of any kind.";

const LIGHTING =
  "Light the character evenly from the front with soft neutral light and no strong cast shadows.";

/**
 * One per emotion. Each names the **face and the body**, because at 1K inside a
 * composited 1080p frame the face alone is too small to carry six
 * distinguishable states, and six variants that read the same defeat the set.
 */
const EXPRESSION_DESCRIPTORS: Record<CharacterEmotion, string> = {
  neutral: "relaxed and attentive, mouth closed, looking directly at the viewer",
  happy: "a warm genuine smile with the eyes creasing slightly, shoulders relaxed",
  surprised: "eyebrows raised, eyes wide, mouth slightly open, leaning back a little",
  thoughtful:
    "eyes directed slightly up and away, one hand near the chin, brow lightly furrowed",
  skeptical:
    "one eyebrow raised, head tilted slightly, mouth set in a flat line, chin drawn back",
  excited:
    "a broad open smile, eyes bright and wide, leaning slightly toward the viewer, hands open",
};

/**
 * Turn 1: the only turn that sees the photograph, and the only turn that states
 * the style.
 *
 * The plain clothing instruction is not cosmetic either. Text, logos and busy
 * patterns are the details that drift hardest between turns, and six variants
 * that disagree about the writing on the shirt read as six different people.
 */
export function buildTurnOnePrompt(style: CharacterStyleId): string {
  return [
    `Create a character based on the person in this photograph, drawn as ${STYLE_DESCRIPTIONS[style]}.`,
    "",
    "Keep the person's recognisable features: face shape, hair colour and style, skin tone, eye colour, and any glasses or facial hair. Do not copy the photograph's clothing, lighting, background or pose.",
    "",
    "Dress the character in simple plain clothing with no text, no logos and no busy patterns.",
    "",
    FRAMING,
    "",
    `Expression: ${EXPRESSION_DESCRIPTORS.neutral}`,
    "",
    BACKGROUND,
    "",
    LIGHTING,
  ].join("\n");
}

/**
 * Turns 2 to 6, and a regeneration of any variant that is not `neutral`.
 *
 * The style, framing, background and lighting are deliberately **absent**. This
 * is the identity mechanism Phase 0 measured, not a brevity choice, which is why
 * `character-prompt.test.ts` asserts their absence (AC-74).
 */
export function buildTurnPrompt(emotion: CharacterEmotion): string {
  return [
    "This is the same character. Change only the facial expression and the body language that goes with it.",
    "",
    `New expression: ${EXPRESSION_DESCRIPTORS[emotion]}`,
    "",
    "Everything else stays identical: the same face, the same hair, the same clothing, the same framing, the same flat light grey background and the same lighting. Do not restyle the character, do not move the camera, and do not add anything to the background.",
  ].join("\n");
}

/**
 * Regenerating `neutral` itself, the one case the blanket rule cannot cover.
 *
 * Every other emotion regenerates by anchoring on the stored `neutral`. For
 * `neutral` that is circular, and the original photograph is gone by then
 * because it is never persisted (AC-22). So it anchors on the *current* stored
 * neutral, read before it is replaced, and asks for a fresh take rather than a
 * changed expression.
 *
 * **This drifts and cannot be undone.** Each regeneration anchors on the last
 * one, so the character walks away from the photograph a step at a time with no
 * way back. The only recovery is a full re run with a fresh upload, which is a
 * new charge (AC-65). `NEUTRAL_REGEN_WARNING` is the copy that must sit on the
 * control.
 */
export function buildNeutralRegenPrompt(): string {
  return [
    "This is the same character. Produce a fresh version of this same character with the same relaxed, attentive neutral expression, keeping the face, hair, clothing, framing, background and lighting identical.",
    "",
    "Vary only the fine detail of the drawing.",
  ].join("\n");
}

/**
 * How many free single-variant regenerations one project gets (AC-64).
 *
 * **Twelve is arithmetic, not measurement.** Spec `0001` §8.1 sized it as two
 * redraws per emotion against the set price's margin, and that section asks for
 * it to be re-sized against real usage; spec `0004`'s Follow up carries the
 * question. It is enforced *before* the Gemini call, so the cap costs nothing to
 * hit.
 *
 * Counted as `SUM(attempt) - COUNT(*)` across the project's assets rather than
 * stored, so it cannot drift from the rows it describes. Lives here rather than
 * in `assets.ts` because the review gate has to show what is left, and
 * `assets.ts` is server only.
 */
export const MAX_REGENERATIONS = 12;

export const NEUTRAL_REGEN_WARNING =
  "Redrawing your base character moves it a little further from your photo each time. To start over from the photo, generate the set again.";

/**
 * Turn order is `CHARACTER_EMOTIONS`, which starts with `neutral`. That is load
 * bearing in two directions: turn 1 is the only turn that sees the photograph,
 * and the stored `neutral` is what every later regeneration anchors on. If that
 * array is ever reordered so `neutral` is not first, the regeneration path loses
 * its anchor, which is why the test asserts it here as well as in `emotions.ts`.
 */
export const TURN_ORDER: readonly CharacterEmotion[] = CHARACTER_EMOTIONS;

/**
 * The image model. Env overridable so a tier change, or the
 * `gemini-3.1-flash-image` comparison spec `0001` open question 7 defers, is a
 * Vercel env change rather than a code change (AC-67).
 *
 * Identity was proven at Pro in Phase 0. Verified current 2026-08-10; spec
 * `0001` §8.1 says plainly that model ids and prices both rot, so re check
 * rather than trusting this line.
 */
export const DEFAULT_IMAGE_MODEL = "gemini-3-pro-image";

export function imageModel(): string {
  return process.env.BROLL_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
}

/**
 * 3:4 portrait at 1K.
 *
 * Portrait because an upper body character fills it, so the alpha trim discards
 * little and the stored PNG is close to the generated one. 1K rather than the 2K
 * spec `0001` §8.1 advises: 2K is free in dollars at Pro but not in seconds, and
 * every image streams to the browser as base64 before it is segmented. 1K is
 * already more than a 1080p composite needs.
 *
 * The `K` must be uppercase; the API rejects `1k`.
 */
export const ASPECT_RATIO = "3:4" as const;
export const IMAGE_SIZE = "1K" as const;

/**
 * What one generated image really costs us, in USD micros (AC-16).
 *
 * The retail price of a set is flat, so this never touches a balance. It
 * populates `credit_ledger.cost_micros`, which is margin reporting, and margin
 * reporting is what the $2.00 price will be re-judged against.
 *
 * $0.134 an image is the `gemini-3-pro-image` Pro tier figure that
 * `BROLL_CHARACTER_SET_COST_MICROS` in `@repo/billing/pricing` is already built
 * from ("six images at the Pro tier's $0.134 plus roughly $0.03 of multi turn
 * image input"). Counting the images a run **actually** produced is what makes
 * the settled figure real usage rather than the estimate written at reserve: a
 * turn that had to be retried genuinely bought a seventh image, and a run that
 * aborted at turn five genuinely bought five.
 *
 * **This rate rots.** Spec `0001` §8.1 says so plainly about every model id and
 * price in it, and spec `0004`'s Follow up asks for a re check before the price
 * goes live. It is deliberately not env overridable: a cost figure that varies
 * per environment makes the margin data across environments incomparable, which
 * is the one thing it exists to be.
 */
export const IMAGE_OUTPUT_COST_MICROS = 134_000;

/**
 * Six turns plus at most one retry has to fit inside the route's 300 second
 * ceiling. 40 seconds a turn bounds a hung call, and the run budget aborts the
 * whole thing before the platform does, so a stall surfaces as our error rather
 * than a truncated stream.
 */
export const TURN_TIMEOUT_MS = 40_000;
export const RUN_BUDGET_MS = 240_000;
export const RETRIES_PER_TURN = 1;

/**
 * The reference photo caps.
 *
 * All five formats are ones Gemini accepts. `heic` and `heif` are included
 * deliberately even though most non Safari browsers cannot render a local
 * preview of them: iPhones shoot heic by default, and rejecting the format the
 * likeliest camera produces would be a worse failure than a missing thumbnail.
 * The upload control skips the preview for those rather than refusing the file.
 */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_PHOTO_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export function isAcceptedPhotoType(type: string): boolean {
  return (ACCEPTED_PHOTO_TYPES as readonly string[]).includes(type);
}

/**
 * What the user is told before the file picker (AC-66).
 *
 * Every clause is verifiable as of 2026-08-10 and none overpromises. The 55 days
 * is Google's published paid tier log retention and is the one part not ours to
 * control, which is exactly why it is named rather than glossed as "deleted
 * immediately".
 */
export const PHOTO_PRIVACY_COPY =
  "Your photo is sent to Google's Gemini API to generate your character, and is never stored by us. Google does not use it to train their models, and deletes it from their logs within 55 days. We keep only the generated character images, never the photo.";

/**
 * Turn a vendor failure into something a human can act on (AC-67).
 *
 * Mirrors `planner.ts`'s translation and exists for the same reason: a retired
 * model id surfacing as a raw 404 reads as a transient glitch, so someone
 * retries it forever. Naming the model and saying it needs a code or config
 * change is the difference between a five minute fix and an afternoon.
 */
/**
 * Is this failure one that retrying can never clear?
 *
 * The single place that question is answered, because it used to be answered
 * twice and the two answers disagreed. `character.ts` picked the error **code**
 * from `404 || NOT_FOUND` while `describeModelError` picked the **message** from
 * a third, looser clause, `body.includes(model)`. That clause matched far more
 * than it meant to: Google's 429 quota body names the model six times, so every
 * rate limit and every out of quota answer was described to the user as a
 * retired model id, telling them to change `BROLL_IMAGE_MODEL` (which cannot
 * help) while the retry logic went on retrying it (which also cannot help).
 *
 * Two shapes are permanent, both measured against the live API on 2026-08-11:
 *
 * 1. A retired or misspelled id answers **404** with `"status": "NOT_FOUND"` and
 *    `models/<id> is not found for API version v1beta`. The status and the
 *    `NOT_FOUND` marker are enough on their own; nothing else is needed.
 * 2. A model the key's plan does not include answers **429** with
 *    `free_tier ... limit: 0`. A zero quota is a billing state, not a burst, so
 *    waiting never clears it. This is the one 429 that is not transient, and
 *    treating it as one is how someone spends an afternoon retrying.
 */
export function isPermanentModelFailure(status: number, body: string): boolean {
  if (status === 404 || body.includes("NOT_FOUND")) return true;
  return status === 429 && body.includes("free_tier") && body.includes("limit: 0");
}

export function describeModelError(status: number, body: string): string {
  const model = imageModel();

  if (status === 429 && isPermanentModelFailure(status, body)) {
    return `The image model (${model}) is not included in this API key's plan — its free tier quota for this model is 0. Enable billing on the key's Google Cloud project, or point BROLL_IMAGE_MODEL at a model the key can call. Retrying will not fix this.`;
  }
  if (isPermanentModelFailure(status, body)) {
    return `The image model (${model}) is not available. Pin a current model with BROLL_IMAGE_MODEL, or update the default. Retrying will not fix this.`;
  }
  if (status === 429) {
    return "The image service is rate limiting us right now. Wait a minute and try again.";
  }
  if (status >= 500) {
    return "The image service had an error. Nothing was charged; try again.";
  }
  return "The image service rejected the request. Nothing was charged.";
}
