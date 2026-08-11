import "server-only";
import { reportError } from "@repo/server-shared/observability";
import { CHARACTER_EMOTIONS, type CharacterEmotion } from "./emotions";
import type { CharacterStyleId } from "./styles";
import {
  ASPECT_RATIO,
  IMAGE_SIZE,
  RETRIES_PER_TURN,
  RUN_BUDGET_MS,
  TURN_TIMEOUT_MS,
  buildNeutralRegenPrompt,
  buildTurnOnePrompt,
  buildTurnPrompt,
  describeModelError,
  imageModel,
  isPermanentModelFailure,
} from "./character-prompt";

/**
 * The multi turn character chain: six Gemini image calls, each anchored on the
 * previous picture (spec `broll/0004`).
 *
 * Server only because it holds `GEMINI_API_KEY`. The wording it sends lives in
 * `character-prompt.ts`, which is pure and unit tested; this file owns the
 * network, the timeouts and the retry, and nothing else.
 *
 * Plain `fetch` to the REST API rather than an SDK, matching `planner.ts` and
 * `apps/rough-cut/src/lib/ai-rough-cut.ts`: one endpoint, one request shape, and
 * a dependency tree and a test story that stay trivial.
 *
 * **The reference photo passes through here and is never written down**
 * (AC-22). It arrives as a base64 string in one request body, becomes one
 * `inlineData` part on turn 1, and goes out of scope when that turn returns.
 * Nothing in this file logs a part, and the usage log below deliberately prints
 * counts rather than content.
 */

/** Where an image comes from and what it is, in the shape Gemini wants. */
export type InlineImage = {
  mimeType: string;
  /** Base64, no data URL prefix. */
  data: string;
};

export type GeneratedTurn = {
  emotion: CharacterEmotion;
  /** The generated PNG, base64, exactly as the vendor returned it (AC-19). */
  png: string;
  /** How many images this turn bought, retries included. */
  images: number;
};

export type CharacterErrorCode =
  | "not_configured"
  | "model_unavailable"
  | "budget_exhausted"
  | "failed";

export class CharacterError extends Error {
  readonly code: CharacterErrorCode;

  constructor(code: CharacterErrorCode, message: string) {
    super(message);
    this.name = "CharacterError";
    this.code = code;
  }
}

export function isCharacterConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Bytes to base64, the form both Gemini's `inlineData` and our own stream lines
 * use.
 *
 * Chunked because `String.fromCharCode(...bytes)` on a ten megabyte photo blows
 * the argument limit and throws, and the Edge runtime has no `Buffer` to reach
 * for instead. Thirty two kilobytes a chunk is comfortably under every engine's
 * limit and costs nothing measurable at these sizes.
 */
export function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return btoa(binary);
}

type GeminiImageResponse = {
  candidates?: {
    content?: {
      parts?: { inlineData?: { mimeType?: string; data?: string } }[];
    };
    finishReason?: string;
  }[];
};

function endpoint(): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${imageModel()}:generateContent`;
}

/**
 * Strip anything that looks like image bytes out of a string before it is
 * logged (AC-22).
 *
 * The vendor's error body is genuinely useful for debugging a rejected call, and
 * turn 1's request carried the reference photo. Google's error bodies are JSON
 * error objects rather than echoes of the request, so today this removes
 * nothing — which is exactly why it is here. AC-22 says the photo reaches no log
 * line, and "the vendor does not currently echo it" is an assumption about
 * someone else's API, not a property of ours.
 *
 * Two hundred characters is far below any real image payload and far above any
 * identifier, token or model id that might legitimately appear in an error.
 */
export function redactImageData(text: string): string {
  return text.replace(/[A-Za-z0-9+/]{200,}={0,2}/g, "[image bytes removed]");
}

/**
 * One image call. Returns the PNG the model produced, or throws.
 *
 * The parts arrive in the order Gemini reads them: the anchor image first, then
 * the instruction. That order is the whole multi turn mechanism — the text says
 * "this is the same character", and "this" is the part before it.
 */
async function callImageModel(
  parts: ({ text: string } | { inlineData: InlineImage })[],
  signal: AbortSignal
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new CharacterError(
      "not_configured",
      "Character generation isn't configured on this server."
    );
  }

  let response: Response;
  try {
    response = await fetch(endpoint(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          // Both pinned in one module, and the `K` is uppercase because the API
          // rejects `1k` (AC-67).
          imageConfig: { aspectRatio: ASPECT_RATIO, imageSize: IMAGE_SIZE },
        },
      }),
      signal,
    });
  } catch (error) {
    // An abort is the timeout or the run budget firing, not a vendor fault, and
    // it must stay distinguishable so the retry logic can tell them apart.
    if (signal.aborted) throw new CharacterError("failed", "The image call timed out.");
    reportError("Character image request failed", error);
    throw new CharacterError("failed", "Could not reach the image service.");
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const message = describeModelError(response.status, body);
    // The same predicate the message is built from, so the code and the wording
    // can never disagree. They did: a zero free tier quota was described as
    // permanent and then retried anyway.
    const code: CharacterErrorCode = isPermanentModelFailure(response.status, body)
      ? "model_unavailable"
      : "failed";
    reportError(
      "Character image rejected by Gemini",
      new Error(redactImageData(body).slice(0, 500)),
      { status: response.status, code }
    );
    throw new CharacterError(code, message);
  }

  const payload = (await response.json()) as GeminiImageResponse;
  const candidate = payload.candidates?.[0];
  const image = candidate?.content?.parts?.find((part) => part.inlineData?.data);

  if (!image?.inlineData?.data) {
    // A refusal (a safety block on a face photo is the likeliest cause) answers
    // 200 with no image part, so this is a real user facing outcome rather than
    // a defensive branch.
    throw new CharacterError(
      "failed",
      candidate?.finishReason && candidate.finishReason !== "STOP"
        ? `The image service stopped early (${candidate.finishReason}) and returned no picture.`
        : "The image service returned no picture. Try a clearer, front facing photo."
    );
  }

  return image.inlineData.data;
}

/**
 * One turn with the retry the spec fixes: try once, retry once, then give up
 * (AC-62). A second failure is the caller's signal to abort the whole set.
 *
 * `model_unavailable` is deliberately **not** retried. A retired model id is not
 * a transient fault, and retrying it burns forty more seconds of a two hundred
 * and forty second budget to reach the same answer.
 */
async function runTurnWithRetry(
  parts: ({ text: string } | { inlineData: InlineImage })[],
  deadline: number
): Promise<{ png: string; images: number }> {
  let lastError: unknown;
  let images = 0;

  for (let attempt = 0; attempt <= RETRIES_PER_TURN; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new CharacterError(
        "budget_exhausted",
        "The generation ran out of time. Nothing was charged; try again."
      );
    }

    // The per turn timeout bounds one hung call; the run budget bounds the whole
    // set. Taking the smaller of the two is what stops a stall on turn six from
    // running past the route's own ceiling and truncating the stream.
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(TURN_TIMEOUT_MS, remaining)
    );

    try {
      const png = await callImageModel(parts, controller.signal);
      // Counted on the way out, not on the way in: a call the vendor refused
      // with a status produced no image and cost nothing, while a call that
      // answered did (AC-16).
      images += 1;
      return { png, images };
    } catch (error) {
      lastError = error;
      if (error instanceof CharacterError && error.code === "model_unavailable") {
        throw error;
      }
      // A call we abandoned at the timeout may well have finished at the vendor
      // and been billed. Counting it is the conservative side of an unknowable
      // answer, and the only side that cannot flatter our own margin figures.
      if (controller.signal.aborted) images += 1;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof CharacterError
    ? lastError
    : new CharacterError("failed", "The image service failed twice. Try again.");
}

/**
 * The whole set: turn 1 from the photograph, then five turns each anchored on
 * the previous output image (AC-74, AC-21).
 *
 * `onTurn` is awaited, so the caller can push each image down its stream before
 * the next call starts. That is what makes variants populate progressively
 * instead of arriving in one lump at the end.
 *
 * Throws on the first turn that fails twice. Nothing partial is returned,
 * because a partial set is exactly what invariant 3 forbids: the caller stores
 * six or it stores none.
 */
export async function runCharacterChain(input: {
  style: CharacterStyleId;
  photo: InlineImage;
  onTurn: (turn: GeneratedTurn) => Promise<void> | void;
}): Promise<{ images: number }> {
  const deadline = Date.now() + RUN_BUDGET_MS;
  let images = 0;

  // Turn 1 is the only turn that sees the photograph, and the only one that
  // states the style. Every later turn anchors on the picture before it, which
  // is the identity mechanism Phase 0 measured (AC-74).
  let anchor: InlineImage = input.photo;

  for (let turn = 0; turn < CHARACTER_EMOTIONS.length; turn += 1) {
    const emotion = CHARACTER_EMOTIONS[turn];
    const prompt =
      turn === 0 ? buildTurnOnePrompt(input.style) : buildTurnPrompt(emotion);

    const result = await runTurnWithRetry(
      [{ inlineData: anchor }, { text: prompt }],
      deadline
    );
    images += result.images;

    await input.onTurn({ emotion, png: result.png, images });

    anchor = { mimeType: "image/png", data: result.png };
  }

  console.log(
    `[broll-character] set complete model=${imageModel()} images=${images} size=${IMAGE_SIZE} ratio=${ASPECT_RATIO}`
  );

  return { images };
}

/**
 * Regenerate one variant, anchored on the stored `neutral` cutout (AC-64).
 *
 * `neutral` regenerating itself is the one case that needs its own wording: the
 * blanket rule is circular there, and the original photograph is gone by then
 * because it is never persisted (AC-22). See `buildNeutralRegenPrompt`.
 */
export async function regenerateVariant(input: {
  emotion: CharacterEmotion;
  anchor: InlineImage;
}): Promise<GeneratedTurn> {
  const deadline = Date.now() + TURN_TIMEOUT_MS * (RETRIES_PER_TURN + 1);

  const prompt =
    input.emotion === "neutral"
      ? buildNeutralRegenPrompt()
      : buildTurnPrompt(input.emotion);

  const { png, images } = await runTurnWithRetry(
    [{ inlineData: input.anchor }, { text: prompt }],
    deadline
  );

  return { emotion: input.emotion, png, images };
}
