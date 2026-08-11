import { afterEach, describe, expect, it } from "vitest";
import { CHARACTER_EMOTIONS } from "@/lib/emotions";
import { CHARACTER_STYLES } from "@/lib/styles";
import {
  ACCEPTED_PHOTO_TYPES,
  ASPECT_RATIO,
  DEFAULT_IMAGE_MODEL,
  IMAGE_SIZE,
  MAX_PHOTO_BYTES,
  NEUTRAL_REGEN_WARNING,
  PHOTO_PRIVACY_COPY,
  RUN_BUDGET_MS,
  TURN_ORDER,
  TURN_TIMEOUT_MS,
  buildNeutralRegenPrompt,
  buildTurnOnePrompt,
  buildTurnPrompt,
  describeModelError,
  imageModel,
  isAcceptedPhotoType,
  isPermanentModelFailure,
} from "@/lib/character-prompt";

/**
 * The style descriptions, quoted here rather than imported, so this suite fails
 * if the wording in the module changes without the AC-74 guarantee being
 * re-reasoned. Importing them would make the check tautological.
 */
const STYLE_PHRASES = ["anime illustration", "3D character render"];

afterEach(() => {
  delete process.env.BROLL_IMAGE_MODEL;
});

describe("AC-74: the style is stated on turn 1 and never restated", () => {
  it("states the style on turn 1, for every style offered", () => {
    for (const style of CHARACTER_STYLES) {
      const prompt = buildTurnOnePrompt(style.id);
      const matched = STYLE_PHRASES.some((phrase) => prompt.includes(phrase));
      expect(matched, `turn 1 for ${style.id} should describe the style`).toBe(true);
    }
  });

  it("never restates the style on a later turn, for any emotion", () => {
    // This is the identity mechanism Phase 0 measured, not a brevity choice.
    // Restating the style is what spec 0001 5.4 says invites drift.
    for (const emotion of CHARACTER_EMOTIONS) {
      const prompt = buildTurnPrompt(emotion);
      for (const phrase of STYLE_PHRASES) {
        expect(prompt, `turn for ${emotion} must not restate the style`).not.toContain(
          phrase
        );
      }
    }
  });

  it("never restates the framing, background or lighting on a later turn", () => {
    for (const emotion of CHARACTER_EMOTIONS) {
      const prompt = buildTurnPrompt(emotion);
      expect(prompt).not.toContain("Frame the character from the waist up");
      expect(prompt).not.toContain("Place the character on a completely flat");
      expect(prompt).not.toContain("Light the character evenly from the front");
    }
  });

  it("holds everything but the expression fixed on a later turn", () => {
    const prompt = buildTurnPrompt("happy");
    expect(prompt).toContain("This is the same character");
    expect(prompt).toContain("Everything else stays identical");
  });

  it("does not restate the style when regenerating neutral either", () => {
    const prompt = buildNeutralRegenPrompt();
    for (const phrase of STYLE_PHRASES) expect(prompt).not.toContain(phrase);
  });
});

describe("turn prompts", () => {
  it("gives every emotion a distinct expression descriptor", () => {
    const prompts = CHARACTER_EMOTIONS.map((e) => buildTurnPrompt(e));
    expect(new Set(prompts).size).toBe(CHARACTER_EMOTIONS.length);
  });

  it("describes body language as well as face, for every emotion", () => {
    // At 1K inside a 1080p composite the face alone is too small to carry six
    // distinguishable states, so each descriptor must name the body too.
    const bodyWords = [
      "shoulders",
      "leaning",
      "hand",
      "hands",
      "head",
      "chin",
      "back",
    ];
    for (const emotion of CHARACTER_EMOTIONS) {
      const prompt = buildTurnPrompt(emotion).toLowerCase();
      const hasBody = bodyWords.some((w) => prompt.includes(w));
      expect(hasBody, `${emotion} should describe body language`).toBe(true);
    }
  });

  it("asks turn 1 not to copy the photograph's clothing, lighting or pose", () => {
    const prompt = buildTurnOnePrompt("anime");
    expect(prompt).toContain("Do not copy the photograph's clothing, lighting, background or pose");
  });

  it("asks for plain clothing, because logos and text drift hardest between turns", () => {
    expect(buildTurnOnePrompt("anime")).toContain("no text, no logos and no busy patterns");
  });

  it("forbids a cast shadow, which would survive segmentation as a grey smear", () => {
    expect(buildTurnOnePrompt("3d-render")).toContain("no cast shadow");
  });

  it("asks for margin above the hair, so the alpha trim does not clip the crown", () => {
    expect(buildTurnOnePrompt("anime")).toContain("margin of space above the hair");
  });
});

describe("turn order", () => {
  it("starts with neutral", () => {
    // Load bearing twice over: turn 1 is the only turn that sees the photo, and
    // the stored neutral is the anchor every later regeneration uses.
    expect(TURN_ORDER[0]).toBe("neutral");
  });

  it("is the full emotion set, in the emotions.ts order", () => {
    expect([...TURN_ORDER]).toEqual([...CHARACTER_EMOTIONS]);
  });
});

describe("generation parameters (AC-67)", () => {
  it("pins a portrait 3:4 frame at 1K, with an uppercase K", () => {
    expect(ASPECT_RATIO).toBe("3:4");
    expect(IMAGE_SIZE).toBe("1K");
    expect(IMAGE_SIZE).not.toBe("1k");
  });

  it("defaults to the model Phase 0 proved identity on", () => {
    expect(imageModel()).toBe(DEFAULT_IMAGE_MODEL);
    expect(DEFAULT_IMAGE_MODEL).toBe("gemini-3-pro-image");
  });

  it("lets the model be overridden by env, so a tier change is config", () => {
    process.env.BROLL_IMAGE_MODEL = "gemini-3.1-flash-image";
    expect(imageModel()).toBe("gemini-3.1-flash-image");
  });

  it("falls back to the default when the override is empty rather than making it undefined", () => {
    process.env.BROLL_IMAGE_MODEL = "";
    expect(imageModel()).toBe(DEFAULT_IMAGE_MODEL);
  });

  it("fits six turns plus a retry inside the route's 300 second ceiling", () => {
    expect(RUN_BUDGET_MS).toBeLessThan(300_000);
    expect(TURN_TIMEOUT_MS * 6).toBeLessThanOrEqual(RUN_BUDGET_MS);
  });
});

describe("photo limits", () => {
  it("accepts the formats Gemini takes, including heic from iPhones", () => {
    expect(isAcceptedPhotoType("image/png")).toBe(true);
    expect(isAcceptedPhotoType("image/jpeg")).toBe(true);
    expect(isAcceptedPhotoType("image/heic")).toBe(true);
    expect(ACCEPTED_PHOTO_TYPES).toContain("image/heif");
  });

  it("rejects anything else", () => {
    for (const type of ["image/gif", "application/pdf", "text/plain", "", "image/svg+xml"]) {
      expect(isAcceptedPhotoType(type)).toBe(false);
    }
  });

  it("caps the photo at 10 MB", () => {
    expect(MAX_PHOTO_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("AC-66: the photo privacy copy", () => {
  it("states all three facts, none of which overpromises", () => {
    expect(PHOTO_PRIVACY_COPY).toContain("never stored by us");
    expect(PHOTO_PRIVACY_COPY).toContain("does not use it to train");
    expect(PHOTO_PRIVACY_COPY).toContain("55 days");
  });

  it("does not claim the photo is deleted immediately, which we cannot promise", () => {
    expect(PHOTO_PRIVACY_COPY).not.toMatch(/deleted immediately|never leaves/i);
  });
});

describe("the neutral regeneration warning", () => {
  it("tells the user the drift is one way", () => {
    expect(NEUTRAL_REGEN_WARNING).toContain("further from your photo");
    expect(NEUTRAL_REGEN_WARNING).toContain("generate the set again");
  });
});

describe("describeModelError (AC-67)", () => {
  it("names the model and says retrying will not help, on a 404", () => {
    const message = describeModelError(404, "");
    expect(message).toContain("gemini-3-pro-image");
    expect(message).toContain("BROLL_IMAGE_MODEL");
    expect(message).toContain("Retrying will not fix this");
  });

  it("catches a NOT_FOUND body even when the status is not 404", () => {
    expect(describeModelError(400, '{"error":{"status":"NOT_FOUND"}}')).toContain(
      "not available"
    );
  });

  it("names the overridden model, not the default", () => {
    process.env.BROLL_IMAGE_MODEL = "gemini-9-imaginary";
    expect(describeModelError(404, "")).toContain("gemini-9-imaginary");
  });

  it("treats rate limiting and server errors as retryable, and says nothing was charged", () => {
    expect(describeModelError(429, "")).toMatch(/rate limiting/i);
    expect(describeModelError(503, "")).toContain("Nothing was charged");
  });

  // Captured from the live API on 2026-08-11, trimmed. This exact body was
  // reported to a user as a retired model id, because the old classifier also
  // matched on "the body mentions the model" and this body mentions it six
  // times. It is a billing state, and it is permanent, but for a different
  // reason and with a different fix.
  const QUOTA_BODY = JSON.stringify({
    error: {
      code: 429,
      message:
        "You exceeded your current quota, please check your plan and billing details.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 0, model: gemini-3-pro-image\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3-pro-image",
      status: "RESOURCE_EXHAUSTED",
    },
  });

  it("does not call a quota failure a retired model id", () => {
    const message = describeModelError(429, QUOTA_BODY);
    expect(message).not.toContain("Pin a current model");
    expect(message).toMatch(/billing/i);
    expect(message).toContain("Retrying will not fix this");
  });

  it("still treats an ordinary burst 429 as transient, even when it names the model", () => {
    // A real rate limit names the model too. The zero limit is what separates
    // "your plan excludes this" from "you went too fast".
    const burst = 'Quota exceeded, limit: 60, model: gemini-3-pro-image';
    expect(describeModelError(429, burst)).toMatch(/rate limiting/i);
    expect(isPermanentModelFailure(429, burst)).toBe(false);
  });

  it("classifies the two permanent shapes and nothing else", () => {
    expect(isPermanentModelFailure(404, "")).toBe(true);
    expect(isPermanentModelFailure(400, '{"status":"NOT_FOUND"}')).toBe(true);
    expect(isPermanentModelFailure(429, QUOTA_BODY)).toBe(true);
    expect(isPermanentModelFailure(429, "")).toBe(false);
    expect(isPermanentModelFailure(503, "")).toBe(false);
    // The clause that caused the bug: a body mentioning the model is not, on
    // its own, evidence the model is gone.
    expect(isPermanentModelFailure(500, "gemini-3-pro-image had an error")).toBe(false);
  });

  it("still reassures about the charge on an unrecognised failure", () => {
    expect(describeModelError(400, "something odd")).toContain("Nothing was charged");
  });
});
