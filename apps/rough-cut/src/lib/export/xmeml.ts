/**
 * Pure logic that turns an EDL's "keep" segments into an FCP7 XML (xmeml)
 * string — the legacy Final Cut Pro 7 interchange format Premiere Pro
 * imports natively (Premiere does NOT read modern `.fcpxml`). Mirrors
 * `fcpxml.ts`/`cmx3600.ts` and shares their frame math so all three formats
 * agree on cut points. No browser APIs here — exercised directly by vitest.
 */
import type { EDL } from "@/lib/edl";
import { getKeepRanges, totalKeptSeconds } from "@/lib/export/plan";
import {
  DEFAULT_FPS,
  formatTimecode,
  isDropFrame,
  minClipSeconds,
  nominalFps,
  toFrames,
  type VideoFps,
} from "@/lib/export/timebase";
import { escapeXml } from "@/lib/export/xml";

/** The xmeml `<rate>` element: integer timebase plus an NTSC flag. */
function rateXml(fps: VideoFps): string {
  const ntsc = fps.denominator === 1001 ? "TRUE" : "FALSE";
  return `<rate><timebase>${nominalFps(fps)}</timebase><ntsc>${ntsc}</ntsc></rate>`;
}

/** A file:// URL for the source filename, encoded per path segment. */
function pathUrl(sourceFilename: string): string {
  return `file://localhost/${encodeURIComponent(sourceFilename)}`;
}

/**
 * Builds an FCP7 XML (xmeml version 4) document describing the EDL's kept
 * segments as one sequence with a video track and a mirrored, linked audio
 * track, at the source's timebase. Segments shorter than one frame are
 * dropped rather than included as zero-length clip items.
 * `sourceOffsetSeconds` (see `detect-embedded-timecode.ts`) shifts only the
 * `in`/`out` source timecodes and the file's declared duration, matching the
 * source media's own embedded start timecode when it doesn't start at zero —
 * `start`/`end` (the edited sequence position) stay zero-based.
 */
export function buildXmeml(
  edl: EDL,
  projectTitle: string,
  sourceFilename: string,
  fps: VideoFps = DEFAULT_FPS,
  resolution: { width: number; height: number } = { width: 1920, height: 1080 },
  sourceOffsetSeconds = 0
): string {
  const ranges = getKeepRanges(edl).filter((r) => r.end - r.start >= minClipSeconds(fps));
  const totalFrames = toFrames(totalKeptSeconds(ranges), fps);
  // Like fcpxml.ts's asset duration: must bound every clip's source in/out,
  // so it covers the furthest point any kept range reaches into the source.
  const sourceDurationFrames = toFrames(
    Math.max(0, ...ranges.map((r) => r.end)) + sourceOffsetSeconds,
    fps
  );
  const safeTitle = escapeXml(projectTitle);
  const safeSourceFilename = escapeXml(sourceFilename);
  const rate = rateXml(fps);
  const displayFormat = isDropFrame(fps) ? "DF" : "NDF";

  // The shared <file> definition, emitted in full inside the first video clip
  // item only; every later clip item references it as <file id="file-1"/>.
  const fileXml = `<file id="file-1">
              <name>${safeSourceFilename}</name>
              <pathurl>${escapeXml(pathUrl(sourceFilename))}</pathurl>
              ${rate}
              <duration>${sourceDurationFrames}</duration>
              <media>
                <video>
                  <samplecharacteristics>
                    ${rate}
                    <width>${resolution.width}</width>
                    <height>${resolution.height}</height>
                  </samplecharacteristics>
                </video>
                <audio>
                  <channelcount>2</channelcount>
                </audio>
              </media>
            </file>`;

  interface ClipFrames {
    index: number;
    inFrames: number;
    outFrames: number;
    startFrames: number;
    endFrames: number;
  }

  // Same accumulated-cursor frame math as fcpxml.ts: record positions come
  // from rounded cumulative offsets so the last clip lands on totalFrames.
  let cursorSeconds = 0;
  const clipFrames: ClipFrames[] = [];
  for (const range of ranges) {
    const startFrames = toFrames(cursorSeconds, fps);
    const nextCursorSeconds = cursorSeconds + (range.end - range.start);
    const endFrames = toFrames(nextCursorSeconds, fps);
    if (endFrames - startFrames <= 0) continue;
    clipFrames.push({
      index: clipFrames.length + 1,
      inFrames: toFrames(range.start + sourceOffsetSeconds, fps),
      outFrames: toFrames(range.end + sourceOffsetSeconds, fps),
      startFrames,
      endFrames,
    });
    cursorSeconds = nextCursorSeconds;
  }

  const clipItem = (c: ClipFrames, mediaType: "video" | "audio") => {
    const idPrefix = mediaType === "video" ? "clipitem" : "clipitem-a";
    const fileRef = mediaType === "video" && c.index === 1 ? fileXml : `<file id="file-1"/>`;
    const sourceTrack =
      mediaType === "audio"
        ? `\n            <sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>`
        : "";
    // Each clipitem lists every member of its link group (video + audio),
    // which is how FCP7 XML expresses A/V-linked clips.
    return `          <clipitem id="${idPrefix}-${c.index}">
            <name>${safeSourceFilename}</name>
            ${rate}
            <start>${c.startFrames}</start>
            <end>${c.endFrames}</end>
            <in>${c.inFrames}</in>
            <out>${c.outFrames}</out>
            ${fileRef}${sourceTrack}
            <link><linkclipref>clipitem-${c.index}</linkclipref><mediatype>video</mediatype></link>
            <link><linkclipref>clipitem-a-${c.index}</linkclipref><mediatype>audio</mediatype></link>
          </clipitem>`;
  };

  const videoClips = clipFrames.map((c) => clipItem(c, "video")).join("\n");
  const audioClips = clipFrames.map((c) => clipItem(c, "audio")).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence id="sequence-1">
    <name>${safeTitle}</name>
    <duration>${totalFrames}</duration>
    ${rate}
    <media>
      <video>
        <format>
          <samplecharacteristics>
            ${rate}
            <width>${resolution.width}</width>
            <height>${resolution.height}</height>
          </samplecharacteristics>
        </format>
        <track>
${videoClips}
        </track>
      </video>
      <audio>
        <track>
${audioClips}
        </track>
      </audio>
    </media>
    <timecode>
      ${rate}
      <string>${formatTimecode(0, fps)}</string>
      <frame>0</frame>
      <displayformat>${displayFormat}</displayformat>
    </timecode>
  </sequence>
</xmeml>
`;
}
