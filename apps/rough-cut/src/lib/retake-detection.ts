/**
 * Retake detection: finds sentences the speaker re-recorded (said again,
 * near-verbatim, close together in time) and reports which occurrence to
 * cut and which to keep. Pure, rule-based, runs entirely client-side —
 * no network call, no LLM.
 *
 * Matching is *fuzzy*: two sentences cluster as one retake when their word
 * sequences are similar enough (an order-aware ratio ≥ a threshold), so a take
 * re-recorded with slightly different wording still gets caught. A minimum
 * sentence length and a proximity window keep precision up — short phrases and
 * far-apart coincidences don't count. The similarity threshold is the tuning
 * lever the sensitivity control drives.
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

/** Default fuzzy-match threshold when a caller doesn't pass one (kept local to
 *  avoid importing from edl.ts, which imports this module). */
const DEFAULT_RETAKE_SIMILARITY = 0.8;

interface Sentence {
  start: number;
  end: number;
  normalized: string;
  tokens: string[];
}

/** Length of the longest common subsequence of two token arrays (order-aware). */
function lcsLength(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;

  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1] + 1
          : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Order-aware similarity in [0,1] between two token sequences: 2·LCS / (|a|+|b|)
 * — the classic difflib-style ratio. 1 = identical; it degrades gracefully as
 * words are inserted, dropped, or changed, so near-verbatim retakes score high
 * while genuinely different sentences score low.
 */
function similarityRatio(a: string[], b: string[]): number {
  const total = a.length + b.length;
  if (total === 0) return 1;
  return (2 * lcsLength(a, b)) / total;
}

/** Lowercase, strip punctuation, collapse whitespace — for comparison only. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Group words that share a flush point into one Sentence — shared by both the
 * utterance-boundary and pause-heuristic grouping strategies below.
 */
function flushSentences(
  words: TranscriptWord[],
  shouldFlushAfter: (word: TranscriptWord, index: number) => boolean
): Sentence[] {
  const sentences: Sentence[] = [];
  let current: TranscriptWord[] = [];

  function flush() {
    if (current.length === 0) return;
    const normalized = normalize(current.map((w) => w.word).join(" "));
    sentences.push({
      start: current[0].start,
      end: current[current.length - 1].end,
      normalized,
      tokens: normalized ? normalized.split(" ") : [],
    });
    current = [];
  }

  words.forEach((word, i) => {
    current.push(word);
    if (shouldFlushAfter(word, i)) flush();
  });
  flush();

  return sentences;
}

/**
 * Group words into sentences using Deepgram's real utterance boundaries
 * (`utterances: true`) instead of guessing from a fixed pause length — a
 * sentence break lands exactly where Deepgram detected one acoustically.
 * `utteranceEnds` is ascending; a word flushes the current sentence once its
 * own end reaches the next boundary. EPS absorbs the sub-frame drift between
 * a word's `end` and its utterance's `end` (both pass through the same
 * frame-snap in deepgram.ts, so drift is at most one 1/30s step).
 */
const UTTERANCE_BOUNDARY_EPS = 1 / 30 + 1e-6;

function groupByUtteranceBoundaries(
  words: TranscriptWord[],
  utteranceEnds: number[]
): Sentence[] {
  let boundaryIdx = 0;
  return flushSentences(words, (word, i) => {
    let flushed = false;
    
    // 1. Flush if Deepgram declared an acoustic boundary here
    while (
      boundaryIdx < utteranceEnds.length &&
      word.end >= utteranceEnds[boundaryIdx] - UTTERANCE_BOUNDARY_EPS
    ) {
      boundaryIdx++;
      flushed = true;
    }

    // 2. Fall back to raw word gaps and punctuation to catch breaks 
    //    inside overly long run-on utterances.
    if (!flushed) {
      if (TERMINAL_PUNCTUATION.test(word.word)) {
        flushed = true;
      } else {
        const next = words[i + 1];
        if (next != null && next.start - word.end > SENTENCE_GAP_SECONDS) {
          flushed = true;
        }
      }
    }
    
    return flushed;
  });
}

/** Split a word stream into sentences on long pauses or terminal punctuation —
 *  the fallback when no Deepgram utterance boundaries are available (older
 *  stored transcripts predating the `utterances` option). */
function groupByPauseHeuristic(words: TranscriptWord[]): Sentence[] {
  return flushSentences(words, (word, i) => {
    if (TERMINAL_PUNCTUATION.test(word.word)) return true;
    const next = words[i + 1];
    return next != null && next.start - word.end > SENTENCE_GAP_SECONDS;
  });
}

/**
 * Split a word stream into sentences. Prefers real Deepgram utterance
 * boundaries when the caller has them; falls back to the pause/punctuation
 * heuristic otherwise.
 */
function groupIntoSentences(
  words: TranscriptWord[],
  utteranceEnds?: number[]
): Sentence[] {
  if (utteranceEnds && utteranceEnds.length > 0) {
    return groupByUtteranceBoundaries(words, utteranceEnds);
  }
  return groupByPauseHeuristic(words);
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
 *
 * `minSimilarity` (0..1) is the fuzzy-match threshold: lower catches looser
 * re-records at the cost of precision, higher demands near-identical wording.
 *
 * `utteranceEnds` (optional, ascending) are Deepgram's real utterance-boundary
 * timestamps (`utterances: true`); when present, sentences are grouped by
 * these acoustic boundaries instead of the fixed-pause heuristic.
 */
export function detectRetakes(
  words: TranscriptWord[],
  minSimilarity: number = DEFAULT_RETAKE_SIMILARITY,
  utteranceEnds?: number[]
): RetakeMatch[] {
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

  const sentences = groupIntoSentences(usable, utteranceEnds).filter(
    (s) => s.tokens.length >= RETAKE_MIN_WORDS
  );

  // Cluster near-verbatim repeats. Walk sentences in chronological order and
  // attach each to the best existing cluster it both resembles (similarity ≥
  // threshold) and closely follows (that cluster's newest member is within the
  // proximity window); otherwise it opens a new cluster. Comparing against the
  // newest member lets wording drift across attempts, while the proximity check
  // still breaks runs that are far apart in time.
  const clusters: Sentence[][] = [];

  for (const s of sentences) {
    let best: Sentence[] | null = null;
    let bestRatio = minSimilarity;
    for (const cluster of clusters) {
      const last = cluster[cluster.length - 1];
      if (s.start - last.end > RETAKE_PROXIMITY_SECONDS) continue;
      // Cheap prune: the best achievable ratio is 2·min(len)/(sum len). If even
      // that can't beat the current best, skip the O(n·m) LCS entirely.
      const la = last.tokens.length;
      const lb = s.tokens.length;
      if ((2 * Math.min(la, lb)) / (la + lb) < bestRatio) continue;
      const ratio = similarityRatio(last.tokens, s.tokens);
      if (ratio >= bestRatio) {
        bestRatio = ratio;
        best = cluster;
      }
    }
    if (best) best.push(s);
    else clusters.push([s]);
  }

  const matches: RetakeMatch[] = [];

  for (const cluster of clusters) {
    if (cluster.length < 2) continue;
    // Keep the last take; cut every earlier attempt in the run.
    const kept = cluster[cluster.length - 1];
    for (let j = 0; j < cluster.length - 1; j++) {
      matches.push({
        cutStart: cluster[j].start,
        cutEnd: cluster[j].end,
        keptStart: kept.start,
        keptEnd: kept.end,
      });
    }
  }

  matches.sort((a, b) => a.cutStart - b.cutStart);
  return matches;
}
