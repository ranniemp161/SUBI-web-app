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
  bigint,
  type AnyPgColumn,
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
     * Cached money balance in USD micros (1,000,000 = $1); the source of
     * truth is SUM(credit_ledger.delta_micros). The CHECK below is what makes
     * concurrent spends safe without transactions: an overdraft raises 23514
     * and rolls back the whole (single-statement) credit mutation.
     */
    balanceMicros: integer("balance_micros").notNull().default(0),
    /** Skool community member — receives the monthly credit grant. */
    isMember: boolean("is_member").notNull().default(true),
    /**
     * Auto-recharge (ADR 0002/0002): buy more automatically off-session when
     * the balance drops below a user-set line. We store only Stripe ids, never
     * card data. Off by default; cannot be enabled without a saved card.
     */
    stripeCustomerId: text("stripe_customer_id").unique(),
    defaultPaymentMethodId: text("default_payment_method_id"),
    autorechargeEnabled: boolean("autorecharge_enabled")
      .notNull()
      .default(false),
    /** Charge when balance_micros drops below this (USD micros). */
    autorechargeThresholdMicros: integer("autorecharge_threshold_micros"),
    /** How much to buy each time (USD micros); validated to exceed the threshold. */
    autorechargeAmountMicros: integer("autorecharge_amount_micros"),
    /** Consecutive off-session decline counter; auto-disables at the cap. */
    autorechargeFailures: integer("autorecharge_failures").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [check("users_balance_micros_nonneg", sql`${t.balanceMicros} >= 0`)]
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
  fileSize: bigint("file_size", { mode: "number" }),
  fileType: text("file_type"),
  durationMs: integer("duration_ms"),
  transcript: jsonb("transcript"),
  transcriptStatus: transcriptStatusEnum("transcript_status")
    .notNull()
    .default("idle"),
  /** Random per-request secret checked on the Deepgram callback — Deepgram callbacks aren't signed. */
  transcriptCallbackToken: text("transcript_callback_token"),
  /**
   * Money (USD micros) reserved for the in-flight transcription job; NULL when
   * no job holds funds. Doubles as the double-kickoff gate and as the
   * exactly-once gate for settling (see lib/credits.ts).
   */
  holdMicros: integer("hold_micros"),
  edl: jsonb("edl"),
  /**
   * Which stored `ai_cut_runs` row is currently applied to the timeline. Null
   * when the project has no runs yet, or its last run was deleted (see ADR
   * 0002-ai-cut-paid-rerun: this can only happen with zero runs remaining).
   */
  activeAiCutRunId: uuid("active_ai_cut_run_id").references(
    (): AnyPgColumn => aiCutRuns.id,
    { onDelete: "set null" }
  ),
  /**
   * Non-null while an AI Cut run is claimed/in-flight for this project; null
   * means idle. Decoupled from the stored runs themselves (ADR
   * 0002-ai-cut-paid-rerun) — a plain UPDATE ... WHERE ai_cut_claim_at IS NULL
   * OR stale is the atomic claim, same shape as `holdMicros` above.
   */
  aiCutClaimAt: timestamp("ai_cut_claim_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Stored AI Cut suggestion runs (ADR 0002-ai-cut-paid-rerun) — up to 3 per
 * project, each a separate paid Gemini pass the user can compare and switch
 * between without losing the others. `projects.activeAiCutRunId` points at
 * whichever one is currently applied to the timeline.
 */
export const aiCutRuns = pgTable(
  "ai_cut_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Per-project, starts at 1, kept contiguous (renumbered on delete). */
    runNumber: integer("run_number").notNull(),
    /** Optional user-provided name/label for this run (ADR 0002 follow-up). */
    name: text("name"),
    /** Same `AiCutRange[]` shape as before (lib/ai-cuts.ts), sanitized server-side. */
    ranges: jsonb("ranges").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("ai_cut_runs_project_run_number_uq").on(
      t.projectId,
      t.runNumber
    ),
  ]
);

/** Why a balance changed — a DB enum so an invalid reason can't be stored. */
export const creditLedgerReasonEnum = pgEnum("credit_ledger_reason", [
  "purchase",
  "transcription",
  "refund",
  "grant",
  "ai_cut",
  // One-time token->USD balance conversion (see migration 0003).
  "conversion",
  // Off-session auto-recharge deposit (child ADR 0002/0002).
  "auto_recharge",
]);

/**
 * Append-only credit ledger — the source of truth for balances.
 * `users.balance_micros` is a cache of SUM(delta_micros) per user; every
 * mutation writes a ledger row and bumps the cache in one atomic statement.
 */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Positive = deposit, negative = charge. USD micros (1,000,000 = $1). */
    deltaMicros: integer("delta_micros").notNull(),
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


/** TypeScript types inferred from the schema for use across the app. */
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
export type AiCutRunRow = typeof aiCutRuns.$inferSelect;
export type NewAiCutRunRow = typeof aiCutRuns.$inferInsert;
