/**
 * Pure logic that turns an EDL's "keep" segments into a CMX 3600 EDL string —
 * a plain-text interchange format almost every video editor reads. No
 * browser APIs here — this is exercised directly by vitest. Mirrors
 * `fcpxml.ts`'s structure and shares its frame math and filename sanitizing
 * so the two formats always agree on cut points.
 */
import type { EDL } from "@/lib/edl";
import { getKeepRanges } from "@/lib/export/plan";
import { MIN_CLIP_SECONDS, formatTimecode } from "@/lib/export/timebase";

/** Conventional reel name for file-based/auxiliary sources when no real reel exists. */
const FALLBACK_REEL_NAME = "AX";

/** Strips C0 control characters (newlines, tabs, etc.) that would break the fixed-line CMX 3600 format. */
function stripControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f]/g, "");
}

/** Derives an 8-character, uppercased reel name from the source filename. */
function reelName(sourceFilename: string): string {
  const cleaned = sourceFilename.replace(/[^a-zA-Z0-9]/g, "");
  const upper = cleaned.toUpperCase().slice(0, 8);
  return upper.length > 0 ? upper : FALLBACK_REEL_NAME;
}

/**
 * Builds a CMX 3600 EDL string describing the EDL's kept segments as
 * sequential events, in order, at a fixed 30fps timebase. Segments shorter
 * than one frame are dropped rather than included as zero-length events.
 */
export function buildCmx3600Edl(edl: EDL, projectTitle: string, sourceFilename: string): string {
  const ranges = getKeepRanges(edl).filter((r) => r.end - r.start >= MIN_CLIP_SECONDS);
  const reel = reelName(sourceFilename);
  const safeTitle = stripControlChars(projectTitle);
  const safeSourceFilename = stripControlChars(sourceFilename);

  let recordCursor = 0;
  const events = ranges
    .map((range, index) => {
      const duration = range.end - range.start;
      if (duration <= 0) return null;
      const eventNumber = String(index + 1).padStart(3, "0");
      const sourceIn = formatTimecode(range.start);
      const sourceOut = formatTimecode(range.end);
      const recordIn = formatTimecode(recordCursor);
      recordCursor += duration;
      const recordOut = formatTimecode(recordCursor);
      return `${eventNumber}  ${reel}      V     C        ${sourceIn} ${sourceOut} ${recordIn} ${recordOut}\n* FROM CLIP NAME: ${safeSourceFilename}`;
    })
    .filter((event): event is string => event !== null)
    .join("\n");

  return `TITLE: ${safeTitle}\nFCM: NON-DROP FRAME\n\n${events}\n`;
}
