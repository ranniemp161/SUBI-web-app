import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

/** Transcript pipeline states — a DB enum so an invalid status can't be stored. */
export const transcriptStatusEnum = pgEnum("transcript_status", [
  "idle",
  "processing",
  "ready",
  "failed",
]);

/**
 * Users table — linked to Clerk via clerk_id.
 *
 * We maintain our own user record so we can establish foreign key
 * relationships with projects and any future tables.
 */
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Projects table — stores metadata, transcript, and edit decisions.
 *
 * The video file itself is never stored on the server.
 * `transcript` holds the raw Deepgram JSON response (word-level timestamps).
 * `edl` holds the user's cut decisions as a JSON array of segments.
 */
export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  durationMs: integer("duration_ms"),
  transcript: jsonb("transcript"),
  transcriptStatus: transcriptStatusEnum("transcript_status")
    .notNull()
    .default("idle"),
  /** Random per-request secret checked on the Deepgram callback — Deepgram callbacks aren't signed. */
  transcriptCallbackToken: text("transcript_callback_token"),
  edl: jsonb("edl"),
  /** AI rough-cut suggestions (shape: AiCuts in lib/ai-cuts.ts), written server-side only. */
  aiCuts: jsonb("ai_cuts"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Fixed-window rate-limit counters, one row per (bucket + user) key. Kept in
 * Postgres rather than an external store so it needs no extra infra and works
 * regardless of how many app instances run. See `lib/rate-limit.ts`.
 */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** TypeScript types inferred from the schema for use across the app. */
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
