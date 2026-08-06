/**
 * `@repo/transcript` — the transcript document that carries timing between
 * Rough Cut and B-Roll, plus the frame arithmetic behind it (spec _root/0001).
 *
 * The package owns both ends of the *document*: shaping, validating, hashing,
 * serializing, and parsing. It does **not** own the cut. Turning raw Deepgram
 * times into post cut times needs the EDL, and the EDL is Rough Cut's private
 * editing model, so Rough Cut collapses first and hands this package segments
 * that are already post cut. Nothing here knows what an EDL is.
 *
 * The frame math lives here because B-Roll's whole promise is that a clip
 * labelled 2:35 sits at 2:35 on the creator's finished edit. Two
 * implementations of that arithmetic is the single easiest way to break the
 * product silently, so there is one, and both apps import it.
 */
export {
  secondsToFrame,
  msToFrame,
  frameToSeconds,
  frameToMs,
  frameDurationSeconds,
  type VideoFps,
} from "./frame-math";

export {
  DEFAULT_FPS,
  snapToStandardFps,
  nominalFps,
  isDropFrame,
  toFrames,
  minClipSeconds,
  formatTimecode,
} from "./timebase";

export {
  TRANSCRIPT_DOCUMENT_VERSION,
  MAX_DOCUMENT_BYTES,
  MAX_SEGMENT_COUNT,
  videoFpsSchema,
  transcriptWordSchema,
  transcriptSegmentSchema,
  transcriptSourceSchema,
  transcriptDocumentSchema,
  type TranscriptDocument,
  type TranscriptSegment,
  type TranscriptWord,
  type TranscriptSource,
  type TranscriptFps,
} from "./document";

export {
  buildTranscriptDocument,
  serializeTranscriptDocument,
  canonicalFingerprint,
  TRANSCRIPT_MEDIA_TYPE,
  type BuildTranscriptDocumentInput,
} from "./build";

export {
  parseTranscriptDocument,
  importSrt,
  importVtt,
  TranscriptParseError,
} from "./read";

export {
  toSrt,
  toVtt,
  SRT_MEDIA_TYPE,
  VTT_MEDIA_TYPE,
  type SubtitleOptions,
  type VttOptions,
} from "./write";
