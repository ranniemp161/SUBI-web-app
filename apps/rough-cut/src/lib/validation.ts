/**
 * Zod schemas for the untrusted request bodies that reach the database.
 *
 * The project's transcript and EDL land in Postgres jsonb columns, so the API
 * boundary is the one place client-supplied JSON must be shape- and size-checked
 * before it's persisted. Shapes mirror the types in `lib/edl.ts`; the array
 * caps are deliberately generous (well past any real recording) — they exist to
 * reject absurd or malicious payloads, not to constrain legitimate use.
 */
import { z } from "zod";

// Matches TranscriptWord in lib/edl.ts.
const transcriptWordSchema = z.object({
  word: z.string().max(1000),
  start: z.number(),
  end: z.number(),
  confidence: z.number(),
});

// Full transcript blob. Normally written server-side by the transcription
// routes; validated here in case a client ever sends one back via PATCH.
export const transcriptSchema = z.object({
  words: z.array(transcriptWordSchema).max(300_000),
  text: z.string().max(10_000_000),
  duration: z.number(),
  language: z.string().max(100).optional(),
});

const sensitivitySchema = z.enum(["aggressive", "balanced", "light"]);

const edlSegmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  status: z.enum(["keep", "cut"]),
  reason: z.enum(["silence", "retake", "repetition", "manual", "ai"]).nullable(),
  split: z.boolean().optional(),
});

const timeRangeSchema = z.object({ start: z.number(), end: z.number() });

export const edlSchema = z.object({
  segments: z.array(edlSegmentSchema).max(100_000),
  sensitivity: sensitivitySchema.optional(),
  protectedKeeps: z.array(timeRangeSchema).max(100_000).optional(),
});

// The DB column is `integer`; round to protect against a fractional
// milliseconds value from the browser's `video.duration * 1000`.
const durationMsSchema = z
  .number()
  .min(0)
  .max(360_000_000) // ~100h — a sane upper bound for a single upload
  .transform((v) => Math.round(v));

// POST /api/projects. strictObject rejects unexpected top-level keys.
export const createProjectSchema = z.strictObject({
  fileName: z.string().min(1).max(500),
  durationMs: durationMsSchema.nullable().optional(),
  fileSize: z.number().min(0).max(100 * 1024 * 1024 * 1024).nullable().optional(),
  fileType: z.string().max(100).nullable().optional(),
});

// PATCH /api/projects/:id — every field optional; only those present are
// applied. strictObject rejects unexpected top-level keys.
export const patchProjectSchema = z.strictObject({
  edl: edlSchema.optional(),
  transcript: transcriptSchema.optional(),
  durationMs: durationMsSchema.nullable().optional(),
  fileName: z.string().min(1).max(500).optional(),
  fileSize: z.number().min(0).max(100 * 1024 * 1024 * 1024).nullable().optional(),
  fileType: z.string().max(100).nullable().optional(),
});
