/**
 * Shared frame math for NLE export formats (FCPXML, CMX 3600 EDL), so both
 * formats agree exactly on where every cut falls — one place to get the
 * timebase wrong, not two.
 */

/** Fixed timebase assumption, matching the app's existing frame-snap logic (ADR 0004). */
export const FPS = 30;
/** Shortest duration (seconds) worth keeping as its own clip/event at FPS. */
export const MIN_CLIP_SECONDS = 1 / FPS;

export function toFrames(seconds: number): number {
  return Math.round(seconds * FPS);
}

/** Formats seconds as an `HH:MM:SS:FF` non-drop-frame timecode at FPS. */
export function formatTimecode(seconds: number): string {
  const totalFrames = toFrames(seconds);
  const frames = totalFrames % FPS;
  const totalSeconds = Math.floor(totalFrames / FPS);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mins = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}:${pad(frames)}`;
}
