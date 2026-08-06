/**
 * The one function that turns a project into a transcript document (spec
 * _root/0001, AC-9).
 *
 * Both surfaces call it: the export modal's download, in the browser, and
 * `GET /api/projects/:id/transcript`, on the server. One function serving both
 * is the whole mechanism behind AC-9 — the file a creator downloads and the
 * file b-roll fetches are identical in every field except `generatedAt`, and
 * they stay identical because there is nowhere for them to drift apart.
 *
 * `generatedAt` is the exception because it is a clock read. Two builds at two
 * moments carry two timestamps; the criterion is that one builder serves both
 * paths, not that the bytes are reproducible.
 */
import {
  buildTranscriptDocument,
  canonicalFingerprint,
  type TranscriptDocument,
} from "@repo/transcript";
import type { VideoFps } from "@repo/transcript/timebase";
import type { EDL, Transcript } from "@/lib/edl";
import { collapseTranscriptToCut } from "@/lib/export/transcript-collapse";

export interface ProjectTranscriptInput {
  projectId: string;
  edl: EDL;
  transcript: Transcript;
  /** The source's detected rate. Required — never a guess, never `DEFAULT_FPS`. */
  fps: VideoFps;
  /** Whether the word boundary refinement pass has run (spec 0003). */
  wordsAligned: boolean;
  /** Injectable for tests; both real callers let it default to now. */
  generatedAt?: string;
}

export function buildProjectTranscriptDocument(
  input: ProjectTranscriptInput
): TranscriptDocument {
  const { segments, duration } = collapseTranscriptToCut(
    input.edl,
    input.transcript,
    input.fps
  );

  return buildTranscriptDocument({
    segments,
    duration,
    fps: input.fps,
    wordsAligned: input.wordsAligned,
    generatedAt: input.generatedAt,
    source: {
      kind: "rough-cut",
      projectId: input.projectId,
      // Scoped to the segment list, not the whole EDL and not the whole row:
      // Phase 3 compares these hashes over time to spot a transcript that no
      // longer matches the edit it came from, so the hash must move when the
      // cut moves and stay put when anything else does. An unrelated column
      // write, or an optional `split` flag appearing, is not a changed edit.
      edlFingerprint: canonicalFingerprint(input.edl.segments),
    },
  });
}

/** Filename for the downloaded document, matching the other exports' shape. */
export function transcriptFilename(baseName: string): string {
  return `${baseName}.transcript.json`;
}

/**
 * Filename for a subtitle rendering of the same document.
 *
 * Deliberately the plain `<name>.srt` / `<name>.vtt` rather than a
 * `.transcript.` variant: most players and platforms pick up a sidecar
 * subtitle file by matching the video's own base name, and the document's
 * times are already post cut, so this file lines up with the exported MP4 with
 * no re-syncing.
 */
export function subtitleFilename(baseName: string, extension: "srt" | "vtt"): string {
  return `${baseName}.${extension}`;
}
