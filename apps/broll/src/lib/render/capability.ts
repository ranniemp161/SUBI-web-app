import { canEncodeVideo } from "mediabunny";

/**
 * Can this browser encode the video we are about to sell? (spec `0001` AC-29.)
 *
 * This is checked **at load**, before any Generate or Render control is
 * offered, because the failure it guards against is the expensive one: a user
 * pays for a character set, plans scenes, presses Render, and only then learns
 * their browser cannot encode. AC-29's wording is "nothing fails mid-export
 * after credits are spent", so the gate has to sit in front of the spend, not
 * in front of the encoder.
 *
 * **Probe a candidate list, never hardcode one.** Phase 0 recorded this the
 * hard way: the spike's first run failed on `avc1.42001f`, Baseline level 3.1,
 * which caps at 1280x720 and therefore cannot express 1080p. That looked like
 * "WebCodecs is unavailable" and was really "we asked an invalid question", a
 * vastly more expensive conclusion to get wrong. So we ask about a list, at the
 * real output size, and take the first profile the device accepts.
 */

/**
 * H.264 profiles to try, most capable first. High 4.0 covers 1080p30 and is
 * what Phase 0 measured as hardware accelerated; Main and Baseline are the
 * fallbacks for devices whose encoder is narrower. All are `avc` to mediabunny,
 * which probes the family; the profile strings document the intent and the
 * order.
 */
export const AVC_PROFILE_CANDIDATES = [
  "avc1.640028", // High 4.0
  "avc1.4d0028", // Main 4.0
  "avc1.42e01e", // Baseline 3.0
] as const;

export type RenderCapability =
  | { supported: true }
  | { supported: false; reason: string };

/**
 * Whether this device can encode at `width` x `height`.
 *
 * Returns a reason rather than throwing, because the caller's job is to
 * disable a control and explain why, not to handle an exception. A browser
 * with no WebCodecs at all throws inside `canEncodeVideo`; that is caught here
 * and reported as unsupported, since to the user the two cases are the same.
 */
export async function checkRenderCapability(
  width: number,
  height: number
): Promise<RenderCapability> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return { supported: false, reason: "Output size is not set, so rendering can't be checked." };
  }

  // H.264 requires even dimensions; an odd one is a configuration bug on our
  // side rather than a device limit, and would fail deep inside the encoder.
  if (width % 2 !== 0 || height % 2 !== 0) {
    return {
      supported: false,
      reason: `Output size ${width}x${height} must have even dimensions to encode as H.264.`,
    };
  }

  try {
    if (await canEncodeVideo("avc", { width, height })) {
      return { supported: true };
    }
  } catch {
    return {
      supported: false,
      reason:
        "This browser can't encode video. Rendering needs WebCodecs, which Chrome, Edge and Opera support.",
    };
  }

  return {
    supported: false,
    reason: `This browser can't encode video at ${width}x${height}. Try a smaller output size, or use Chrome or Edge.`,
  };
}
