/**
 * Client-side filmstrip extraction for the timeline's video track.
 *
 * Seeks a detached <video> element through evenly spaced points of the source
 * and packs the frames into one horizontal strip canvas. The timeline tiles
 * slices of this strip inside clip blocks at render time (CapCut-style), so
 * extraction cost is fixed regardless of zoom level or edits.
 */
export interface Filmstrip {
  /** `count` frames packed side by side, each `thumbWidth` px wide. */
  strip: HTMLCanvasElement;
  count: number;
  thumbWidth: number;
  thumbHeight: number;
  duration: number;
}

const DEFAULT_COUNT = 36;
/** Matches the clip blocks' inner height on the timeline's video track. */
const DEFAULT_THUMB_HEIGHT = 56;
/** A stuck seek (corrupt region, unsupported codec) fails the whole strip. */
const SEEK_TIMEOUT_MS = 10_000;

function nextEvent(
  video: HTMLVideoElement,
  type: keyof HTMLVideoElementEventMap
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for "${type}"`));
    }, SEEK_TIMEOUT_MS);
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(video.error ?? new Error("Video element error"));
    };
    function cleanup() {
      clearTimeout(timer);
      video.removeEventListener(type, onEvent);
      video.removeEventListener("error", onError);
    }
    video.addEventListener(type, onEvent, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

/**
 * Extract a filmstrip from a local video file. Returns null when the file
 * can't be decoded (audio-only, unsupported codec) — the timeline falls back
 * to flat clip blocks. Pass an AbortSignal to stop early (e.g. the user
 * switched projects mid-extraction); an aborted run also resolves null.
 */
export async function extractFilmstrip(
  file: File,
  {
    count = DEFAULT_COUNT,
    thumbHeight = DEFAULT_THUMB_HEIGHT,
    signal,
  }: { count?: number; thumbHeight?: number; signal?: AbortSignal } = {}
): Promise<Filmstrip | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = url;

  try {
    await nextEvent(video, "loadedmetadata");
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0 || !video.videoWidth) {
      return null;
    }

    const aspect = video.videoWidth / video.videoHeight;
    const thumbWidth = Math.max(1, Math.round(thumbHeight * aspect));
    const strip = document.createElement("canvas");
    strip.width = thumbWidth * count;
    strip.height = thumbHeight;
    const ctx = strip.getContext("2d");
    if (!ctx) return null;

    for (let i = 0; i < count; i++) {
      if (signal?.aborted) return null;
      // Sample mid-slot so each thumb represents the span it tiles over, and
      // stay off the exact end of the file where seeks can hang.
      const t = Math.min(((i + 0.5) / count) * duration, Math.max(0, duration - 0.05));
      video.currentTime = t;
      await nextEvent(video, "seeked");
      ctx.drawImage(video, i * thumbWidth, 0, thumbWidth, thumbHeight);
    }

    return { strip, count, thumbWidth, thumbHeight, duration };
  } catch (error) {
    console.error("Failed to extract filmstrip:", error);
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
