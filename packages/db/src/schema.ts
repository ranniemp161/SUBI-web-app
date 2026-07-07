import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clerkId: text("clerk_id").notNull().unique(),
    email: text("email").notNull(),
    /**
     * Cached token balance; the source of
     * truth is SUM(credit_ledger.delta_tokens). The CHECK below is what makes
     * concurrent spends safe without transactions: an overdraft raises 23514
     * and rolls back the whole (single-statement) credit mutation.
     */
    tokens: integer("tokens").notNull().default(0),
    /** Skool community member — receives the monthly credit grant. */
    isMember: boolean("is_member").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [check("users_tokens_nonneg", sql`${t.tokens} >= 0`)]
);

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
  /**
   * Tokens reserved for the in-flight transcription job; NULL when
   * no job holds tokens. Doubles as the double-kickoff gate and as the
   * exactly-once gate for settling (see lib/credits.ts).
   */
  tokensHold: integer("tokens_hold"),
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

/** Why a balance changed — a DB enum so an invalid reason can't be stored. */
export const creditLedgerReasonEnum = pgEnum("credit_ledger_reason", [
  "purchase",
  "transcription",
  "refund",
  "grant",
  "ai_cut",
]);

/**
 * Append-only credit ledger — the source of truth for balances.
 * `users.tokens` is a cache of SUM(delta_tokens) per user; every
 * mutation writes a ledger row and bumps the cache in one atomic statement.
 */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Positive = deposit, negative = charge. */
    deltaTokens: integer("delta_tokens").notNull(),
    reason: creditLedgerReasonEnum("reason").notNull(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    /** Stripe Checkout session id — unique, the webhook idempotency key. */
    stripeEventId: text("stripe_event_id").unique(),
    /** UTC "YYYY-MM" on grant rows; NULL otherwise. */
    monthKey: text("month_key"),
    /**
     * Estimated real-world cost in USD micros (1,000,000 = $1), for
     * validating the blended Deepgram+Gemini pricing assumption against
     * actual usage. NULL on rows written before this tracking existed.
     */
    costMicros: integer("cost_micros"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("credit_ledger_user_created_idx").on(t.userId, t.createdAt),
    // One grant per user per calendar month — concurrent lazy top-ups race
    // safely via ON CONFLICT on this partial index.
    uniqueIndex("credit_ledger_grant_month_uq")
      .on(t.userId, t.monthKey)
      .where(sql`${t.reason} = 'grant'`),
  ]
);

/**
 * Per-member Skool access codes, redeemable once at signup. A redeemed code
 * marks its user a member; the users row itself is the authorization for
 * write routes (see lib/authz.ts).
 */
export const accessCodes = pgTable("access_codes", {
  code: text("code").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  redeemedByUserId: uuid("redeemed_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

/**
 * @deprecated Slated for removal after the Vercel KV migration finishes rolling out.
 * Old containers may still write here during the rolling deploy, so this table
 * MUST remain in the database schema until the next PR.
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
export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
export type AccessCode = typeof accessCodes.$inferSelect;
