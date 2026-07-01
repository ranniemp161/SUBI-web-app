/**
 * Shared Deepgram response handling, used by both the synchronous transcribe
 * path (deepgram route reads the transcript inline) and the asynchronous one
 * (callback route receives it via POST). Keeping the normalizer in one place
 * means both paths produce the identical editor-ready shape.
 */

/** The subset of Deepgram's pre-recorded response we read. */
export interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  /** Word with capitalization + terminal punctuation (present with smart_format/punctuate). */
  punctuated_word?: string;
}

export interface DeepgramResponse {
  metadata?: { duration?: number };
  results?: {
    channels?: {
      detected_language?: string;
      alternatives?: { transcript?: string; words?: DeepgramWord[] }[];
    }[];
  };
}

/** Our stored transcript shape — what the editor (and edl.ts) consume. */
export interface NormalizedTranscript {
  words: { word: string; start: number; end: number; confidence: number }[];
  text: string;
  duration: number;
  language?: string;
}

/**
 * Flatten Deepgram's nested response into the flat {words, text, duration}
 * shape the editor expects (identical to what the local whisper script emits).
 * `punctuated_word` is preferred so retake detection's sentence-splitter still
 * sees terminal punctuation.
 */
export function normalizeDeepgram(payload: DeepgramResponse): NormalizedTranscript {
  const channel = payload?.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  const words = (alt?.words ?? []).map((w) => ({
    word: w.punctuated_word ?? w.word,
    start: w.start,
    end: w.end,
    confidence: w.confidence,
  }));
  return {
    words,
    text: alt?.transcript ?? "",
    duration: payload?.metadata?.duration ?? 0,
    language: channel?.detected_language,
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
