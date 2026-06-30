/**
 * Retake detection: finds sentences the speaker re-recorded (said again,
 * near-verbatim, close together in time) and reports which occurrence to
 * cut and which to keep. Pure, rule-based, runs entirely client-side —
 * no network call, no LLM.
 *
 * Deliberately conservative: exact normalized match only (no fuzzy/semantic
 * matching), a minimum sentence length, and a proximity window. Trades recall
 * for precision — a few real retakes slip through uncut rather than risk
 * wrongly cutting real content. Loosening this is a deliberate v2 lever.
 */

import type { TranscriptWord } from "./edl";

/** A pause longer than this between words starts a new sentence. */
const SENTENCE_GAP_SECONDS = 0.5;

/** Word also ends a sentence if it closes with terminal punctuation. */
const TERMINAL_PUNCTUATION = /[.!?]["')\]]*$/;

/** Two occurrences of the same sentence only count as a retake if this close together. */
const RETAKE_PROXIMITY_SECONDS = 30;

/** Sentences shorter than this are excluded — short phrases ("yeah", "okay so")
 *  repeat constantly without being retakes. */
const RETAKE_MIN_WORDS = 4;

interface Sentence {
  start: number;
  end: number;
  normalized: string;
}

/** Lowercase, strip punctuation, collapse whitespace — for comparison only. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split a word stream into sentences on long pauses or terminal punctuation. */
function groupIntoSentences(words: TranscriptWord[]): Sentence[] {
  const sentences: Sentence[] = [];
  let current: TranscriptWord[] = [];

  function flush() {
    if (current.length === 0) return;
    sentences.push({
      start: current[0].start,
      end: current[current.length - 1].end,
      normalized: normalize(current.map((w) => w.word).join(" ")),
    });
    current = [];
  }

  for (const word of words) {
    const prev = current[current.length - 1];
    if (prev && word.start - prev.end > SENTENCE_GAP_SECONDS) flush();
    current.push(word);
    if (TERMINAL_PUNCTUATION.test(word.word)) flush();
  }
  flush();

  return sentences;
}

export interface RetakeMatch {
  cutStart: number;
  cutEnd: number;
  keptStart: number;
  keptEnd: number;
}

/**
 * Find retakes: sentences repeated near-verbatim within RETAKE_PROXIMITY_SECONDS
 * of each other. Chains of 3+ repeats are resolved to keep only the last
 * occurrence — everything earlier in the chain is reported as a cut.
 */
export function detectRetakes(words: TranscriptWord[]): RetakeMatch[] {
  // Self-defense: drop words with unusable timing (null/NaN timestamps coerce
  // to 0 and corrupt the sentence grouping). Kept inline rather than importing
  // edl.ts's sanitizeWords to preserve the type-only import boundary between
  // these two modules. Callers (buildInitialEDL) already pass clean words.
  const usable = words
    .filter(
      (w) =>
        Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start
    )
    .sort((a, b) => a.start - b.start);

  const sentences = groupIntoSentences(usable).filter(
    (s) => s.normalized.split(" ").filter(Boolean).length >= RETAKE_MIN_WORDS
  );

  // Group by normalized text; within each group, sentences are already in
  // chronological order (words are), so consecutive entries are chronological.
  const byText = new Map<string, Sentence[]>();
  for (const sentence of sentences) {
    const bucket = byText.get(sentence.normalized);
    if (bucket) bucket.push(sentence);
    else byText.set(sentence.normalized, [sentence]);
  }

  const matches: RetakeMatch[] = [];

  for (const occurrences of byText.values()) {
    if (occurrences.length < 2) continue;

    // Walk consecutive occurrences, chaining ones within the proximity window
    // into one retake run. A run breaks the window check (or a gap too large)
    // and ends the cluster; everything but the run's last occurrence is cut.
    let runStart = 0;
    for (let i = 1; i <= occurrences.length; i++) {
      const prev = occurrences[i - 1];
      const curr = occurrences[i];
      const withinWindow = curr !== undefined && curr.start - prev.end <= RETAKE_PROXIMITY_SECONDS;
      if (withinWindow) continue;

      if (i - 1 > runStart) {
        const kept = occurrences[i - 1];
        for (let j = runStart; j < i - 1; j++) {
          matches.push({
            cutStart: occurrences[j].start,
            cutEnd: occurrences[j].end,
            keptStart: kept.start,
            keptEnd: kept.end,
          });
        }
      }
      runStart = i;
    }
  }

  matches.sort((a, b) => a.cutStart - b.cutStart);
  return matches;
}
