import "server-only";
import { reportError } from "@repo/server-shared/observability";
import {
  IMAGE_SIZE,
  describeModelError,
  imageModel,
  isPermanentModelFailure,
} from "./character-prompt";
import {
  OBJECT_ASPECT_RATIO,
  OBJECT_RETRIES,
  OBJECT_TIMEOUT_MS,
  buildObjectPrompt,
} from "./object-prompt";

/**
 * One Gemini image call for one object illustration (spec `broll/0008`).
 *
 * Server only because it holds `GEMINI_API_KEY`. The wording lives in
 * `object-prompt.ts`, which is pure and unit tested; this file owns the network,
 * the timeout and the retry, and nothing else — the same division
 * `character.ts` / `character-prompt.ts` already has.
 *
 * **One call, not a chain.** The character pipeline is six turns because it has
 * to hold one identity across six expressions, each anchored on the picture
 * before it. An object has no identity to hold: it is drawn once from a noun, in
 * the one flat 2D look every object shares, and if the creator does not like it
 * they generate another. That is
 * the whole reason this file is fifty lines rather than three hundred.
 *
 * The model, the size and the cost figure are deliberately **not** re-declared
 * here. They are one decision for this app's image generation and
 * `character-prompt.ts` owns them; a second pinned model id is how two code
 * paths quietly start billing at different rates.
 */

export type ObjectErrorCode = "not_configured" | "model_unavailable" | "failed";

export class ObjectError extends Error {
  readonly code: ObjectErrorCode;

  constructor(code: ObjectErrorCode, message: string) {
    super(message);
    this.name = "ObjectError";
    this.code = code;
  }
}

export function isObjectGenerationConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

type GeminiImageResponse = {
  candidates?: {
    content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] };
    finishReason?: string;
  }[];
};

function endpoint(): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${imageModel()}:generateContent`;
}

/** One image call. Returns the PNG the model produced, base64, or throws. */
async function callImageModel(prompt: string, signal: AbortSignal): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ObjectError(
      "not_configured",
      "Illustration generation isn't configured on this server."
    );
  }

  let response: Response;
  try {
    response = await fetch(endpoint(), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          imageConfig: { aspectRatio: OBJECT_ASPECT_RATIO, imageSize: IMAGE_SIZE },
        },
      }),
      signal,
    });
  } catch (error) {
    // An abort is our own timeout firing rather than a vendor fault, and it has
    // to stay distinguishable so the retry can tell the two apart.
    if (signal.aborted) throw new ObjectError("failed", "The image call timed out.");
    reportError("Object image request failed", error);
    throw new ObjectError("failed", "Could not reach the image service.");
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    // The same two predicates the character path uses, so a zero free-tier quota
    // is described as permanent and treated as permanent in both places.
    const code: ObjectErrorCode = isPermanentModelFailure(response.status, body)
      ? "model_unavailable"
      : "failed";
    reportError("Object image rejected by Gemini", new Error(body.slice(0, 500)), {
      status: response.status,
      code,
    });
    throw new ObjectError(code, describeModelError(response.status, body));
  }

  const payload = (await response.json()) as GeminiImageResponse;
  const candidate = payload.candidates?.[0];
  const image = candidate?.content?.parts?.find((part) => part.inlineData?.data);

  if (!image?.inlineData?.data) {
    // A refusal answers 200 with no image part, so this is a real outcome the
    // creator can act on rather than a defensive branch.
    throw new ObjectError(
      "failed",
      candidate?.finishReason && candidate.finishReason !== "STOP"
        ? `The image service stopped early (${candidate.finishReason}) and returned no picture.`
        : "The image service returned no picture for that subject."
    );
  }

  return image.inlineData.data;
}

export type GeneratedObject = {
  /** The generated PNG, base64, exactly as the vendor returned it. */
  png: string;
  /** How many images this run bought, retries included — for `cost_micros`. */
  images: number;
};

/**
 * Draw one object: try once, retry once, then give up.
 *
 * `model_unavailable` is deliberately **not** retried, matching the character
 * turn: a retired model id or a zero quota is not a transient fault, and
 * retrying burns another thirty seconds to reach the same answer while a creator
 * watches a scene pane.
 */
export async function generateObjectImage(input: {
  subject: string;
}): Promise<GeneratedObject> {
  const prompt = buildObjectPrompt(input.subject);
  let lastError: unknown;
  let images = 0;

  for (let attempt = 0; attempt <= OBJECT_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OBJECT_TIMEOUT_MS);

    try {
      const png = await callImageModel(prompt, controller.signal);
      // Counted on the way out: a call the vendor refused with a status produced
      // no image and cost nothing, while a call that answered did.
      images += 1;
      return { png, images };
    } catch (error) {
      lastError = error;
      if (error instanceof ObjectError && error.code === "model_unavailable") throw error;
      // A call abandoned at the timeout may well have finished at the vendor and
      // been billed. Counting it is the conservative side of an unknowable
      // answer, and the only side that cannot flatter our own margin figures.
      if (controller.signal.aborted) images += 1;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof ObjectError
    ? lastError
    : new ObjectError("failed", "The image service failed twice. Try again.");
}
