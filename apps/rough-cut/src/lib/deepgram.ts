/**
 * Shared Deepgram response handling, used by both the synchronous transcribe
 * path (deepgram route reads the transcript inline) and the asynchronous one
 * (callback route receives it via POST). Keeping the normalizer in one place
 * means both paths produce the identical editor-ready shape.
 */

/**
 * Deepgram's documented max size for a pre-recorded direct file upload (~2 GB).
 * We stream the raw file to Deepgram, so this limit applies. Confirm against
 * your current Deepgram plan/docs before relying on the exact value.
 */
export const DEEPGRAM_MAX_UPLOAD_BYTES =
  Number(process.env.DEEPGRAM_MAX_UPLOAD_BYTES) || 2 * 1024 * 1024 * 1024;

/** The subset of Deepgram's pre-recorded response we read. */
export interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  /** Word with capitalization + terminal punctuation (present with smart_format/punctuate). */
  punctuated_word?: string;
}

/** One Deepgram utterance — a natural spoken segment (pause- or sentence-bounded). */
export interface DeepgramUtterance {
  start: number;
  end: number;
}

export interface DeepgramResponse {
  metadata?: { duration?: number };
  results?: {
    channels?: {
      detected_language?: string;
      alternatives?: { transcript?: string; words?: DeepgramWord[] }[];
    }[];
    /** Present only when the request sets `utterances: true`. */
    utterances?: DeepgramUtterance[];
  };
}

/** Our stored transcript shape — what the editor (and edl.ts) consume. */
export interface NormalizedTranscript {
  words: { word: string; start: number; end: number; confidence: number }[];
  text: string;
  duration: number;
  language?: string;
  /**
   * Utterance boundaries (end times, frame-snapped, ascending) from Deepgram's
   * `utterances: true` option — real acoustic phrase/sentence breaks. Consumed
   * by retake-detection.ts to group words into sentences instead of guessing
   * from a fixed pause length. Omitted when Deepgram returned none (e.g. an
   * empty transcript), so older stored transcripts without this field fall
   * back to the pause-based heuristic.
   */
  utteranceEnds?: number[];
}

// Word timestamps keep Deepgram's native precision (rounded to the millisecond
// here at the one chokepoint both transcription paths flow through, only to keep
// floats clean). We deliberately do NOT quantize to a fixed frame grid: the
// transcript highlight is compared against the video element's continuous
// `currentTime`, so any fixed-fps snap would offset the active-word boundary
// from the real audio by up to ~one frame on non-30fps sources. Frame-alignment
// where it actually matters — EDL cut boundaries and NLE-interchange export — is
// owned downstream by the *detected* source fps (`detectVideoFps` +
// `timebase.ts`), not by a heuristic at ingestion.
const roundMs = (seconds: number) => Math.round(seconds * 1000) / 1000;

/**
 * Flatten Deepgram's nested response into the flat {words, text, duration}
 * shape the editor expects.
 * `punctuated_word` is preferred so retake detection's sentence-splitter still
 * sees terminal punctuation.
 */
export function normalizeDeepgram(payload: DeepgramResponse): NormalizedTranscript {
  const channel = payload?.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  const words = (alt?.words ?? []).map((w) => ({
    word: w.punctuated_word ?? w.word,
    start: roundMs(w.start),
    end: roundMs(w.end),
    confidence: w.confidence,
  }));
  const utterances = payload?.results?.utterances;
  // Ends only, ascending — that's all retake-detection needs to mark a
  // boundary. Rounded through the same millisecond grid as words so a boundary
  // and an adjacent word's `end` compare cleanly in one consistent timebase.
  const utteranceEnds = utterances?.length
    ? utterances.map((u) => roundMs(u.end)).sort((a, b) => a - b)
    : undefined;
  return {
    words,
    text: alt?.transcript ?? "",
    duration: payload?.metadata?.duration ?? 0,
    language: channel?.detected_language,
    ...(utteranceEnds ? { utteranceEnds } : {}),
  };
}

/**
 * Pull the human-readable reason out of a Deepgram error body so it can be
 * surfaced to the client. Deepgram returns `{ err_code, err_msg, request_id }`;
 * fall back to raw text otherwise.
 */
export function extractDeepgramError(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { err_msg?: string; reason?: string };
    return parsed.err_msg || parsed.reason || undefined;
  } catch {
    return body.trim().slice(0, 300) || undefined;
  }
}
