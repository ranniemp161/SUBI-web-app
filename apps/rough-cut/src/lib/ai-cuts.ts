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
  /** Model's own certainty (0-1) that this span is genuinely a mistake. */
  modelConfidence?: number;
}

/** The shape produced by one AI Cut pass: validated ranges plus provenance. */
export interface AiCuts {
  ranges: AiCutRange[];
  model: string;
  createdAt: string;
}

/**
 * One stored, versioned run (table `ai_cut_runs`, ADR 0002-ai-cut-paid-rerun).
 * Structurally an `AiCuts` plus its id and position, so `applyAiCuts` accepts
 * either shape unchanged.
 */
export interface AiCutRun extends AiCuts {
  id: string;
  runNumber: number;
  name?: string | null;
}

const aiCutRangeSchema = z.object({
  startWordIndex: z.number().int().min(0),
  endWordIndex: z.number().int().min(0),
  category: z.enum(AI_CUT_CATEGORIES),
  note: z.string().max(500).optional(),
  modelConfidence: z.number().min(0).max(1).optional(),
});

/** Upper bound on stored ranges — far past any real edit, guards a runaway model. */
const MAX_AI_RANGES = 2000;

/**
 * Below this average Deepgram word confidence, a proposed cut is dropped
 * rather than applied. A garbled ASR read can look like a stumble/retake to
 * Gemini even when the speaker said nothing wrong — this enforces the same
 * "if unsure, keep" fallback the model's own rubric states, using a signal
 * (ASR certainty about what was said) the model never sees.
 */
const MIN_CUT_CONFIDENCE = 0.5;

/**
 * Below this self-rated confidence (the "modelConfidence" field Gemini
 * returns per cut), a proposed cut is dropped. A different signal from
 * MIN_CUT_CONFIDENCE: that one catches the ASR mishearing what was said,
 * this one catches Gemini hearing correctly but misjudging intent on a
 * genuinely ambiguous span. A range missing the field entirely still
 * passes — fail toward keeping, same as an absent ASR confidence would.
 */
export const MIN_MODEL_CONFIDENCE = 0.5;

/**
 * Turn raw model output (untrusted JSON) into ranges that are safe to store
 * and apply: drop malformed entries, clamp ends to the word count, drop
 * inverted or out-of-range spans, drop spans the ASR itself wasn't confident
 * about, drop spans Gemini itself wasn't confident about, then sort and
 * coalesce overlaps so counts stay honest. Never throws — worthless input
 * just yields [].
 */
export function sanitizeAiRanges(candidates: unknown, words: TranscriptWord[]): AiCutRange[] {
  const wordCount = words.length;
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

  const confident = merged.filter((range) => {
    let sum = 0;
    let count = 0;
    for (let i = range.startWordIndex; i <= range.endWordIndex; i++) {
      sum += words[i].confidence;
      count++;
    }
    return count > 0 && sum / count >= MIN_CUT_CONFIDENCE;
  });

  const modelConfident = confident.filter(
    (range) => range.modelConfidence === undefined || range.modelConfidence >= MIN_MODEL_CONFIDENCE
  );

  return modelConfident.slice(0, MAX_AI_RANGES);
}

/**
 * Pick ranges worth a second look by the self-verification pass
 * (`verifyBorderlineCuts`, `ai-rough-cut.ts`): the model rated them above
 * the drop floor but below `maxConfidence` — confident enough to survive
 * `sanitizeAiRanges`, not confident enough to trust outright. Ranges with no
 * `modelConfidence` at all are skipped — there's no score to call borderline.
 * `limit` bounds how many get sent for verification in one run.
 */
export function selectBorderlineRanges(
  ranges: AiCutRange[],
  maxConfidence: number,
  limit: number
): AiCutRange[] {
  return ranges
    .filter(
      (range) =>
        range.modelConfidence !== undefined &&
        range.modelConfidence >= MIN_MODEL_CONFIDENCE &&
        range.modelConfidence < maxConfidence
    )
    .slice(0, limit);
}

/**
 * Apply the verification pass's verdicts: drop any range the model flagged
 * to restore, keep everything else untouched. `startWordIndex` is a safe
 * key here — ranges are already sorted/coalesced by `sanitizeAiRanges`, so
 * it's unique per range.
 */
export function applyVerifyVerdicts(
  ranges: AiCutRange[],
  restoreStartIndices: Set<number>
): AiCutRange[] {
  return ranges.filter((range) => !restoreStartIndices.has(range.startWordIndex));
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

