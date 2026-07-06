/**
 * Deterministic repetition detection — the rule-based half of the hybrid
 * repetition strategy. This pass catches *exact* adjacent duplicates (stutters
 * and repeated phrases) mechanically, on every auto build/re-run, with no
 * tokens spent; the AI pass (ai-rough-cut.ts) handles the *semantic* cases —
 * reworded retakes and which-take-wins judgment — that string matching can't.
 *
 * Two rules calibrated on real raw footage (JZ session, 2026-07-04), both
 * keeping the LAST instance (the speaker's final delivery):
 *
 * 1. Word stutters — runs of the same token ("the the", "and and and").
 *    Guards: a punctuated earlier instance ("very, very important") reads as
 *    deliberate emphasis and is kept; an all-capitalized pair ("Duran Duran")
 *    reads as a proper noun and is kept.
 * 2. Phrase repeats — the same 2–8 word n-gram twice in a row. Gated on a
 *    hearable pause between the instances: a re-attempt pauses ("…regardless
 *    of this — regardless of this victorious…"), while fluid run-on repetition
 *    is delivery ("that is leverage that is leverage") and must be kept — a
 *    user-confirmed rule. Fluid cases are left to the AI's judgment.
 */

import type { TranscriptWord } from "./edl";

export interface RepetitionCut {
  /** Seconds — span of the discarded earlier instance(s). */
  cutStart: number;
  cutEnd: number;
  /** Word indices (into the input array) of the cut span, inclusive. */
  startIndex: number;
  endIndex: number;
}

/** Longest phrase (in words) the adjacent-repeat scan looks for. */
const MAX_PHRASE_WORDS = 8;

/** A gap this long between two identical phrases marks a re-attempt, not delivery. */
export const PHRASE_PAUSE_SECONDS = 0.35;

/** Trailing punctuation on a word — the "deliberate emphasis" signal for stutters. */
const TRAILING_PUNCTUATION = /[,.;:!?…—–-]['")\]]*$/;

/** Case/punctuation-insensitive token identity; interior apostrophes/hyphens kept. */
function normalizeToken(word: string): string {
  return word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

const startsCapitalized = (word: string) => /^\p{Lu}/u.test(word);

/**
 * Find repetition cuts in (pre-sanitized, time-ordered) words. Pure and
 * deterministic; returns spans covering the earlier instance(s) only, so
 * applying them always keeps the final delivery.
 */
export function detectRepetitions(words: TranscriptWord[]): RepetitionCut[] {
  const norms = words.map((w) => normalizeToken(w.word));
  const cuts: RepetitionCut[] = [];

  // --- 1) word stutters: runs of one token, keep the last ---
  let i = 0;
  while (i < words.length) {
    let runEnd = i;
    while (
      runEnd + 1 < words.length &&
      norms[runEnd + 1] === norms[i] &&
      norms[i] !== ""
    ) {
      runEnd++;
    }
    if (runEnd > i) {
      // "very, very" — any punctuated earlier instance means deliberate emphasis.
      const deliberate = words
        .slice(i, runEnd)
        .some((w) => TRAILING_PUNCTUATION.test(w.word));
      // "Duran Duran" — an all-capitalized run reads as a proper noun. Single
      // letters ("I I") are exempt: that's a stutter, not a name.
      const properNoun =
        norms[i].length > 1 &&
        words.slice(i, runEnd + 1).every((w) => startsCapitalized(w.word));
      if (!deliberate && !properNoun) {
        cuts.push({
          startIndex: i,
          endIndex: runEnd - 1,
          cutStart: words[i].start,
          cutEnd: words[runEnd - 1].end,
        });
      }
    }
    i = runEnd + 1;
  }

  // --- 2) adjacent phrase repeats, pause-gated; longest phrases first so a
  // long repeat isn't shredded into overlapping shorter ones ---
  const claimed = new Set<number>();
  for (let n = MAX_PHRASE_WORDS; n >= 2; n--) {
    for (let s = 0; s + 2 * n <= words.length; s++) {
      let equal = true;
      for (let k = 0; k < n; k++) {
        if (norms[s + k] === "" || norms[s + k] !== norms[s + n + k]) {
          equal = false;
          break;
        }
      }
      if (!equal) continue;

      // A phrase of one repeated token ("no no" seen as ["no no"] × 2) is the
      // stutter pass's job — skip so the two passes don't double-report.
      if (new Set(norms.slice(s, s + n)).size === 1) continue;

      // Already inside a longer phrase's cut.
      let overlaps = false;
      for (let k = s; k < s + n; k++) {
        if (claimed.has(k)) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;

      // The pause gate: fluid repetition is delivery, keep it.
      const gap = words[s + n].start - words[s + n - 1].end;
      if (gap < PHRASE_PAUSE_SECONDS) continue;

      cuts.push({
        startIndex: s,
        endIndex: s + n - 1,
        cutStart: words[s].start,
        cutEnd: words[s + n - 1].end,
      });
      for (let k = s; k < s + n; k++) claimed.add(k);
      // Continue after this instance — a third take of the same phrase is the
      // next adjacent pair and gets caught (and gated) on a later iteration.
      s += n - 1;
    }
  }

  cuts.sort((a, b) => a.cutStart - b.cutStart);
  return cuts;
}
