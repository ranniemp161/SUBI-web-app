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
// AI polish is mandatory for every new project (ADR 0004 child 1) — the
// server hardcodes `aiPolishRequested: true` on insert, so there is no
// `aiPolish` field here; a client that still sends one gets a 400.
export const createProjectSchema = z.strictObject({
  fileName: z.string().min(1).max(500),
  durationMs: durationMsSchema.nullable().optional(),
  fileSize: z.number().min(0).max(100 * 1024 * 1024 * 1024).nullable().optional(),
  fileType: z.string().max(100).nullable().optional(),
});

// JSON Patch schema for efficient EDL updates. Discriminated on `op` so the
// inferred type lines up field-for-field with rfc6902's `Operation` union
// (each op has different required fields — e.g. "move"/"copy" need `from`,
// not `value`) instead of collapsing to one loose shape `applyPatch` rejects.
const jsonPatchOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), path: z.string(), value: z.any() }),
  z.object({ op: z.literal("remove"), path: z.string() }),
  z.object({ op: z.literal("replace"), path: z.string(), value: z.any() }),
  z.object({ op: z.literal("move"), path: z.string(), from: z.string() }),
  z.object({ op: z.literal("copy"), path: z.string(), from: z.string() }),
  z.object({ op: z.literal("test"), path: z.string(), value: z.any() }),
]);

// PATCH /api/projects/:id — every field optional; only those present are
// applied. strictObject rejects unexpected top-level keys.
export const patchProjectSchema = z.strictObject({
  edl: edlSchema.optional(),
  edlPatch: z.array(jsonPatchOperationSchema).max(10_000).optional(),
  transcript: transcriptSchema.optional(),
  durationMs: durationMsSchema.nullable().optional(),
  fileName: z.string().min(1).max(500).optional(),
  fileSize: z.number().min(0).max(100 * 1024 * 1024 * 1024).nullable().optional(),
  fileType: z.string().max(100).nullable().optional(),
});
