/**
 * Pure logic that turns an EDL's "keep" segments into a CMX 3600 EDL string —
 * a plain-text interchange format almost every video editor reads. No
 * browser APIs here — this is exercised directly by vitest. Mirrors
 * `fcpxml.ts`'s structure and shares its frame math and filename sanitizing
 * so the two formats always agree on cut points.
 */
import type { EDL } from "@/lib/edl";
import { getKeepRanges } from "@/lib/export/plan";
import {
  DEFAULT_FPS,
  formatTimecode,
  isDropFrame,
  minClipSeconds,
  type VideoFps,
} from "@/lib/export/timebase";

/** Conventional reel name for file-based/auxiliary sources when no real reel exists. */
const FALLBACK_REEL_NAME = "AX";

/** Strips C0 control characters (newlines, tabs, etc.) that would break the fixed-line CMX 3600 format. */
function stripControlChars(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/g, "");
}

/**
 * Derives a fixed-width 8-character uppercase reel name from the source
 * filename. Right-padded with spaces so the CMX 3600 event line's reel field
 * is always the same width regardless of source name.
 */
function reelName(sourceFilename: string): string {
  const cleaned = sourceFilename.replace(/[^a-zA-Z0-9]/g, "");
  const upper = cleaned.toUpperCase().slice(0, 8);
  const base = upper.length > 0 ? upper : FALLBACK_REEL_NAME;
  return base.padEnd(8, " ");
}

/**
 * Builds a CMX 3600 EDL string describing the EDL's kept segments as
 * sequential events, in order, at the source's timebase (drop-frame timecode
 * for the NTSC 29.97/59.94 rates). Segments shorter than one frame are
 * dropped rather than included as zero-length events. `sourceOffsetSeconds`
 * (see `detect-embedded-timecode.ts`) shifts only the source in/out
 * timecodes, matching the source media's own embedded start timecode when
 * it doesn't start at zero — record timecodes stay a zero-based edited
 * timeline regardless.
 */
export function buildCmx3600Edl(
  edl: EDL,
  projectTitle: string,
  sourceFilename: string,
  fps: VideoFps = DEFAULT_FPS,
  sourceOffsetSeconds = 0
): string {
  const minSeconds = minClipSeconds(fps);
  const ranges = getKeepRanges(edl).filter((r) => r.end - r.start >= minSeconds);
  const reel = reelName(sourceFilename);
  const safeTitle = stripControlChars(projectTitle);
  const safeSourceFilename = stripControlChars(sourceFilename);
  const frameCountMode = isDropFrame(fps) ? "DROP FRAME" : "NON-DROP FRAME";

  let recordCursor = 0;
  const events = ranges
    .map((range, index) => {
      const duration = range.end - range.start;
      if (duration <= 0) return null;
      const eventNumber = String(index + 1).padStart(3, "0");
      const sourceIn = formatTimecode(range.start + sourceOffsetSeconds, fps);
      const sourceOut = formatTimecode(range.end + sourceOffsetSeconds, fps);
      const recordIn = formatTimecode(recordCursor, fps);
      recordCursor += duration;
      const recordOut = formatTimecode(recordCursor, fps);
      return `${eventNumber}  ${reel}      V     C        ${sourceIn} ${sourceOut} ${recordIn} ${recordOut}\n* FROM CLIP NAME: ${safeSourceFilename}`;
    })
    .filter((event): event is string => event !== null)
    .join("\n");

  return `TITLE: ${safeTitle}\nFCM: ${frameCountMode}\n\n${events}\n`;
}
