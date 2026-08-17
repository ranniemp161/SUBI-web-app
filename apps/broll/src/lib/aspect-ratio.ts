/**
 * The frame shapes a project can be cut in.
 *
 * **The database has always been able to express this** — `broll_projects`
 * carries `output_width` and `output_height` as their own columns, defaulting
 * to 1920x1080 (spec `broll/0002`) — and nothing had ever set them to anything
 * else, so every project in existence is landscape by default rather than by
 * decision. This module is what makes the choice reachable.
 *
 * Pure and dependency free on purpose: the new project form is a client
 * component and imports this directly, the same reason `styles.ts` is pure.
 */

/** The id stored in a form and validated on the server. Never a raw dimension. */
export const ASPECT_RATIOS = ["landscape", "portrait"] as const;

export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const DEFAULT_ASPECT_RATIO: AspectRatio = "landscape";

interface AspectRatioOption {
  /** What the picker shows. */
  label: string;
  /** The ratio itself, because "16:9" is what a creator recognises. */
  ratio: string;
  /** Where the clips are going, which is the real reason to pick one. */
  hint: string;
  width: number;
  height: number;
}

/**
 * **1080p in both orientations, and deliberately not 4K.** Rendering happens in
 * the creator's browser through WebCodecs, so the frame size is a cost they pay
 * in encode time and memory on their own laptop. `capability.ts` probes H.264
 * profiles at the real output size and takes the first the device accepts,
 * which is what stops a portrait frame silently failing on a device whose
 * profile list only covers landscape 1080p.
 */
export const ASPECT_RATIO_OPTIONS: Record<AspectRatio, AspectRatioOption> = {
  landscape: {
    label: "Landscape",
    ratio: "16:9",
    hint: "YouTube, and most talking-head edits",
    width: 1920,
    height: 1080,
  },
  portrait: {
    label: "Vertical",
    ratio: "9:16",
    hint: "Shorts, Reels and TikTok",
    width: 1080,
    height: 1920,
  },
};

export function isAspectRatio(value: string): value is AspectRatio {
  return (ASPECT_RATIOS as readonly string[]).includes(value);
}

/**
 * The stored dimensions for a ratio, falling back to landscape.
 *
 * The fallback is not laxity: this is called on the server with a string that
 * came from a form, and an unknown value means a stale client rather than an
 * attack, since neither dimension is a security boundary. Landscape is what
 * every project got before the picker existed, so an unrecognised value lands
 * on the behaviour that was already there.
 */
export function outputSizeFor(value: string | undefined | null): {
  width: number;
  height: number;
} {
  const key = value && isAspectRatio(value) ? value : DEFAULT_ASPECT_RATIO;
  const { width, height } = ASPECT_RATIO_OPTIONS[key];
  return { width, height };
}
