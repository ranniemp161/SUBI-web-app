/**
 * Pure logic that turns an EDL's "keep" segments into an FCPXML string — the
 * Final Cut Pro interchange format DaVinci Resolve and Premiere Pro both
 * read. No browser APIs here — this is exercised directly by vitest.
 */
import type { EDL } from "@/lib/edl";
import { getKeepRanges, totalKeptSeconds } from "@/lib/export/plan";
import { FPS, MIN_CLIP_SECONDS, toFrames } from "@/lib/export/timebase";
/** Escapes XML special characters in element text/attribute content. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Builds an FCPXML string describing the EDL's kept segments as sequential
 * clips, in order, at a fixed 30fps timebase. Segments shorter than one
 * frame are dropped rather than included as zero-length clips.
 */
export function buildFcpxml(edl: EDL, projectTitle: string, sourceFilename: string): string {
  const ranges = getKeepRanges(edl).filter((r) => r.end - r.start >= MIN_CLIP_SECONDS);
  const totalFrames = toFrames(totalKeptSeconds(ranges));
  const safeTitle = escapeXml(projectTitle);
  const safeSourceFilename = escapeXml(sourceFilename);

  let cursorFrames = 0;
  const clips = ranges
    .map((range) => {
      const durationFrames = toFrames(range.end - range.start);
      if (durationFrames <= 0) return null;
      const clip = `        <clip name="${safeTitle}" offset="${cursorFrames}/${FPS}s" duration="${durationFrames}/${FPS}s" start="${toFrames(range.start)}/${FPS}s" tcFormat="NDF">
          <video ref="r2" offset="${toFrames(range.start)}/${FPS}s" duration="${durationFrames}/${FPS}s" start="${toFrames(range.start)}/${FPS}s"/>
        </clip>`;
      cursorFrames += durationFrames;
      return clip;
    })
    .filter((clip): clip is string => clip !== null)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r1" name="FFVideoFormat1080p30" frameDuration="1/${FPS}s" width="1920" height="1080"/>
    <asset id="r2" name="${safeSourceFilename}" src="file:///${safeSourceFilename}" hasVideo="1" hasAudio="1" format="r1" duration="${totalFrames}/${FPS}s"/>
  </resources>
  <library>
    <event name="${safeTitle}">
      <project name="${safeTitle}">
        <sequence format="r1" duration="${totalFrames}/${FPS}s" tcStart="0/${FPS}s" tcFormat="NDF">
          <spine>
${clips}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}
