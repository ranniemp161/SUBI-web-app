/**
 * AI rough-cut suggestions — the shared, pure half of the feature.
 *
 * Gemini (see `ai-rough-cut.ts`, server-only) reads the transcript and returns
 * spans of speech mistakes as *word-index ranges* into `sanitizeWords(words)`.
 * Indices, not timestamps: the model is shown indexed words and asked to point
 * back at them, which it does reliably — timestamps it would have to invent.
 *
 * Everything here runs on both sides: the server validates model output with
 * `sanitizeAiRanges` before storing it, and the editor maps the stored ranges
 * onto the EDL with `applyAiCuts`. Both sides derive indices from the same
 * deterministic `sanitizeWords` pass, so they always agree.
 */

import { z } from "zod";
import {
  sanitizeWords,
  setRangeStatus,
  buildInitialEDL,
  keptDuration,
  MIN_INITIAL_KEEP_FRACTION,
  type DetectionSettings,
  type EDL,
  type TranscriptWord,
} from "./edl";

export const AI_CUT_CATEGORIES = [
  "false_start",
  "retake",
  "stumble",
  "repetition",
  /**
   * Spoken production notes and off-script asides: "insert clip No. 3 here",
   * "start again", words to someone off camera. Cut from playback, but the
   * transcript panel still shows them struck-through/as pills — they double as
   * B-roll markers the human editor needs to see.
   */
  "direction",
] as const;

export type AiCutCategory = (typeof AI_CUT_CATEGORIES)[number];

/** One span the AI wants removed. Indices are inclusive, into sanitizeWords(words). */
export interface AiCutRange {
  startWordIndex: number;
  endWordIndex: number;
  category: AiCutCategory;
  /** Model's one-line justification — surfaced in tooltips, never load-bearing. */
  note?: string;
}

/** The stored shape (projects.ai_cuts): validated ranges plus provenance. */
export interface AiCuts {
  ranges: AiCutRange[];
  model: string;
  createdAt: string;
}

const aiCutRangeSchema = z.object({
  startWordIndex: z.number().int().min(0),
  endWordIndex: z.number().int().min(0),
  category: z.enum(AI_CUT_CATEGORIES),
  note: z.string().max(500).optional(),
});

/** Upper bound on stored ranges — far past any real edit, guards a runaway model. */
const MAX_AI_RANGES = 2000;

/**
 * Turn raw model output (untrusted JSON) into ranges that are safe to store
 * and apply: drop malformed entries, clamp ends to the word count, drop
 * inverted or out-of-range spans, then sort and coalesce overlaps so counts
 * stay honest. Never throws — worthless input just yields [].
 */
export function sanitizeAiRanges(candidates: unknown, wordCount: number): AiCutRange[] {
  if (!Array.isArray(candidates) || wordCount <= 0) return [];

  const valid: AiCutRange[] = [];
  for (const candidate of candidates) {
    const parsed = aiCutRangeSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const range = parsed.data;
    if (range.startWordIndex >= wordCount) continue;
    const endWordIndex = Math.min(range.endWordIndex, wordCount - 1);
    if (endWordIndex < range.startWordIndex) continue;
    valid.push({ ...range, endWordIndex });
  }

  valid.sort((a, b) => a.startWordIndex - b.startWordIndex);

  // Overlapping/adjacent spans would merge into one cut segment anyway —
  // coalesce them here so ranges.length matches what the user actually sees.
  const merged: AiCutRange[] = [];
  for (const range of valid) {
    const last = merged[merged.length - 1];
    if (last && range.startWordIndex <= last.endWordIndex + 1) {
      last.endWordIndex = Math.max(last.endWordIndex, range.endWordIndex);
    } else {
      merged.push({ ...range });
    }
  }

  return merged.slice(0, MAX_AI_RANGES);
}

/**
 * Layer stored AI cuts onto an EDL as ordinary restorable cuts (reason "ai").
 * The user's explicit restores (protectedKeeps) are re-applied afterwards, so
 * the AI can never re-cut something the user deliberately brought back.
 * Ranges that no longer resolve to words are skipped, never an error.
 */
export function applyAiCuts(
  edl: EDL,
  aiCuts: AiCuts | null | undefined,
  words: TranscriptWord[]
): EDL {
  if (!aiCuts || aiCuts.ranges.length === 0) return edl;

  const clean = sanitizeWords(words);
  let next = edl;

  for (const range of aiCuts.ranges) {
    const startWord = clean[range.startWordIndex];
    const endWord = clean[range.endWordIndex];
    if (!startWord || !endWord) continue;
    next = setRangeStatus(next, startWord.start, endWord.end, "cut", "ai");
  }

  for (const kept of edl.protectedKeeps ?? []) {
    next = setRangeStatus(next, kept.start, kept.end, "keep", null);
  }

  return next;
}

/**
 * The initial auto-build with the AI layer on top: heuristic silence + retake
 * pass, then the stored AI cuts. The same keep-fraction floor as
 * `buildInitialEDL` applies to the *combined* result — if the AI layer would
 * push the cut past it, the AI layer alone is dropped (the heuristic base
 * already passed its own floor).
 */
export function buildInitialEDLWithAi(
  words: TranscriptWord[],
  durationSeconds: number,
  aiCuts: AiCuts | null | undefined,
  settings?: DetectionSettings
): EDL {
  const base = buildInitialEDL(words, durationSeconds, settings);
  const withAi = applyAiCuts(base, aiCuts, words);
  if (keptDuration(withAi) < durationSeconds * MIN_INITIAL_KEEP_FRACTION) {
    return base;
  }
  return withAi;
}
