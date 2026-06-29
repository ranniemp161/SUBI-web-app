import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

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
  /** "idle" | "processing" | "ready" | "failed" */
  transcriptStatus: text("transcript_status").notNull().default("idle"),
  /** Random per-request secret checked on the Deepgram callback — Deepgram callbacks aren't signed. */
  transcriptCallbackToken: text("transcript_callback_token"),
  edl: jsonb("edl"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** TypeScript types inferred from the schema for use across the app. */
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
