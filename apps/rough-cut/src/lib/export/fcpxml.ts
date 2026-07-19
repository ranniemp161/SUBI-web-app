/**
 * Pure logic that turns an EDL's "keep" segments into an FCPXML string — the
 * Final Cut Pro X interchange format DaVinci Resolve also reads (Premiere Pro
 * does NOT — it wants FCP7 XML, see `xmeml.ts`). No browser APIs here — this
 * is exercised directly by vitest.
 */
import type { EDL } from "@/lib/edl";
import { getKeepRanges, totalKeptSeconds } from "@/lib/export/plan";
import {
  DEFAULT_FPS,
  isDropFrame,
  minClipSeconds,
  toFrames,
  type VideoFps,
} from "@/lib/export/timebase";
import { escapeXml } from "@/lib/export/xml";

/**
 * Builds an FCPXML string describing the EDL's kept segments as sequential
 * clips, in order, at the source's timebase. Times are exact rationals
 * (`frames * den / num` seconds) so NTSC rates don't drift. Segments shorter
 * than one frame are dropped rather than included as zero-length clips.
 * `sourceOffsetSeconds` (see `detect-embedded-timecode.ts`) shifts only the
 * source-side `start` values and the asset's duration, matching the source
 * media's own embedded start timecode when it doesn't start at zero — clip
 * `offset`/`duration` (the edited sequence position) stay zero-based.
 */
export function buildFcpxml(
  edl: EDL,
  projectTitle: string,
  sourceFilename: string,
  resolution: { width: number; height: number } = { width: 1920, height: 1080 },
  fps: VideoFps = DEFAULT_FPS,
  sourceOffsetSeconds = 0
): string {
  const ranges = getKeepRanges(edl).filter((r) => r.end - r.start >= minClipSeconds(fps));
  const totalFrames = toFrames(totalKeptSeconds(ranges), fps);
  // The asset's duration must bound every clip ref into it, so it has to cover
  // the furthest point any kept range reaches into the source — not the sum of
  // kept durations, which is the edited timeline's length, not the source's.
  const sourceDurationFrames = toFrames(
    Math.max(0, ...ranges.map((r) => r.end)) + sourceOffsetSeconds,
    fps
  );
  const safeTitle = escapeXml(projectTitle);
  const safeSourceFilename = escapeXml(sourceFilename);
  const tcFormat = isDropFrame(fps) ? "DF" : "NDF";
  // A rational FCPXML time value: `frames` frames at fps, in seconds.
  const rational = (frames: number) => `${frames * fps.denominator}/${fps.numerator}s`;
  // FCPX-style rate token: NTSC rates drop the decimal point (29.97 -> "2997").
  const rateToken =
    fps.denominator === 1
      ? String(fps.numerator)
      : (fps.numerator / fps.denominator).toFixed(2).replace(".", "");
  const formatName = `FFVideoFormat${resolution.height}p${rateToken}`;

  let cursorSeconds = 0;
  const clips = ranges
    .map((range) => {
      // Accumulate exact seconds and take the frame difference between the
      // rounded cumulative offsets so the last clip's boundary lands exactly
      // on totalFrames (independent per-range rounding can drift). CMX 3600
      // accumulates the exact-seconds cursor the same way.
      const offsetFrames = toFrames(cursorSeconds, fps);
      const nextCursorSeconds = cursorSeconds + (range.end - range.start);
      const durationFrames = toFrames(nextCursorSeconds, fps) - offsetFrames;
      if (durationFrames <= 0) return null;
      const startFrames = toFrames(range.start + sourceOffsetSeconds, fps);
      const clip = `        <clip name="${safeTitle}" offset="${rational(offsetFrames)}" duration="${rational(durationFrames)}" start="${rational(startFrames)}" tcFormat="${tcFormat}">
          <video ref="r2" offset="${rational(startFrames)}" duration="${rational(durationFrames)}" start="${rational(startFrames)}"/>
        </clip>`;
      cursorSeconds = nextCursorSeconds;
      return clip;
    })
    .filter((clip): clip is string => clip !== null)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r1" name="${formatName}" frameDuration="${rational(1)}" width="${resolution.width}" height="${resolution.height}"/>
    <asset id="r2" name="${safeSourceFilename}" src="file:///${safeSourceFilename}" hasVideo="1" hasAudio="1" format="r1" duration="${rational(sourceDurationFrames)}"/>
  </resources>
  <library>
    <event name="${safeTitle}">
      <project name="${safeTitle}">
        <sequence format="r1" duration="${rational(totalFrames)}" tcStart="${rational(0)}" tcFormat="${tcFormat}">
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
