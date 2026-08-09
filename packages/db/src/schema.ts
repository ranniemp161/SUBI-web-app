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
  real,
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
    /**
     * Member — receives the monthly credit grant. Defaults to false: only the
     * allowlisted demo email (MEMBER_ALLOWLIST_EMAIL, set in provisionUser)
     * is granted membership; everyone else pays via Stripe.
     */
    isMember: boolean("is_member").notNull().default(false),
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
   * Whether the user asked (and agreed to pay) for the AI polish pass at upload
   * time (ADR 0003 child 1). Set from the upload confirm panel's toggle when the
   * row is created; the single thing that decides whether the studio's automatic
   * AI attempt fires on open. Flips to false, atomically, the instant any AI Cut
   * claim succeeds for this project (automatic or manual — see claimAiCutSlot),
   * so exactly one automatic attempt can ever fire. Defaults false so every row
   * that predates this column (and every project uploaded with the toggle off)
   * is inert under the auto-fire logic.
   */
  aiPolishRequested: boolean("ai_polish_requested").notNull().default(false),
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
  /**
   * Whether the client-side word boundary refinement pass (spec
   * 0003-word-boundary-timestamp-refinement) has completed once for this
   * project. Set true by the client after the pass finishes (successfully or
   * with some words falling back to their raw Deepgram timestamp) so it never
   * re-runs on a later reselect. Defaults false so every pre-existing row
   * picks up refinement on its next reselect.
   */
  wordsAligned: boolean("words_aligned").notNull().default(false),
  /**
   * The source video's detected frame rate as an exact rational, so NTSC
   * 29.97 stays 30000/1001 and long-timeline timecode never drifts (spec
   * _root/0001, AC-7). Written by the browser when the user reselects the
   * source file and `detectVideoFps` resolves.
   *
   * Rough Cut itself does not read these — it already has the rate in session
   * state. They exist so the rate survives the tab: the transcript route
   * (`GET /api/projects/:id/transcript`, which B-Roll calls) runs on the
   * server with no source file in hand, and a transcript without a timebase is
   * a transcript whose timecodes cannot be trusted. NULL on every project not
   * reselected since this shipped, and the route refuses rather than guessing.
   */
  sourceFpsNum: integer("source_fps_num"),
  sourceFpsDen: integer("source_fps_den"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (t) => [
  /**
   * The dashboard's only list query: this user's projects, newest first, one
   * keyset page at a time (`listProjectPage`, rough-cut's lib/projects.ts).
   *
   * Postgres does not index a foreign-key column for you, so before this there
   * was no index on `user_id` at all and every page was a sequential scan plus
   * a sort. The column order matches the query: equality on `user_id` first,
   * then `created_at` to satisfy both the range predicate and the ORDER BY.
   * `id` is the keyset tiebreak and is covered by the primary key.
   *
   * Same shape as `credit_ledger_user_created_idx` below, for the same reason.
   */
  index("projects_user_created_idx").on(t.userId, t.createdAt),
]);

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
  /**
   * B-Roll spends (spec `broll/0002`, AC-44). These ship in their own migration,
   * separate from `0015` which added the tables: the repo's rule is add, deploy,
   * then use, and a value must exist in the live enum before any deployed code
   * writes it. Nothing in a migration statement uses them — only application
   * code does, later — so this is the deploy-ordering rule, not a Postgres one.
   */
  "broll_character_set",
  "broll_plan_rerun",
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
    /**
     * B-Roll's project attribution (spec `broll/0002`). A second nullable FK
     * rather than reusing `project_id`, because that one points at *rough-cut's*
     * `projects` table and a b-roll spend row cannot live there. Leaving it NULL
     * instead would forfeit per-project attribution, the refund path, and the
     * audit trail for half the ecosystem.
     *
     * A polymorphic `(source_app, source_id)` pair scales better past ~5 apps
     * and is the likely eventual shape. At app #2 a real FK is the better trade:
     * it keeps referential integrity, and reshaping an append-only money ledger
     * only gets harder. Revisit when a third spending app appears.
     */
    brollProjectId: uuid("broll_project_id").references(
      (): AnyPgColumn => brollProjects.id,
      { onDelete: "set null" }
    ),
    /**
     * The generic idempotency slot — **not** Stripe-specific, despite the name.
     *
     * Four writers share it, and the values are namespaced so they cannot
     * collide:
     *   - `depositPurchase`      Stripe Checkout session id  (`cs_…`)
     *   - `depositAutoRecharge`  Stripe PaymentIntent id     (`pi_…`)
     *   - `chargeAiCut`          `ai_cut:<key>`
     *   - `refundAiCut`          `ai_cut_refund:<key>`
     *
     * The name predates the last two and is now wrong, but it stays. Renaming
     * it is a three-deploy expand/contract: every writer builds its statement
     * in raw SQL (`@repo/billing`'s ledger, wallet's autorecharge), so between
     * the migration and the deploy every ledger INSERT would fail — purchases,
     * charges, refunds and auto-recharge all at once. A better column name is
     * not worth a billing outage window. Reviewed and deliberately declined;
     * see `packages/billing/AGENTS.md`.
     */
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
    /**
     * A row belongs to at most one project, in at most one app. Both NULL stays
     * legal: a purchase, a grant, and the token->USD conversion point at no
     * project at all.
     *
     * Added as a plain constraint, which takes a lock for the duration of a
     * validation scan of the whole table. Deliberate, and the same call
     * migration `0014` made about its index: at this table's size the scan is
     * milliseconds. The `NOT VALID` + `VALIDATE CONSTRAINT` split that avoids it
     * does NOT work inside one drizzle migration — drizzle-kit runs every
     * pending statement in a single transaction, so the lock is held to COMMIT
     * either way. Doing it properly needs two migrations applied in two separate
     * runs. Switch to that if `credit_ledger` ever passes ~1M rows.
     */
    check(
      "credit_ledger_one_project_ref",
      sql`NOT (${t.projectId} IS NOT NULL AND ${t.brollProjectId} IS NOT NULL)`
    ),
  ]
);


/* ------------------------------------------------------------------ *
 * B-Roll Generator (apps/broll) — spec `docs/specs/broll/0002-data-model`
 *
 * Prefixed `broll_` because the lost app-internal spec named these tables
 * `projects`, `assets` and `scenes`, which collide with rough-cut's. The
 * shared `users` row carries identity and balance for both apps; b-roll adds
 * no user table and no `credits` column.
 * ------------------------------------------------------------------ */

/** Per-scene render outcome — a DB enum so an invalid state can't be stored. */
export const brollRenderStatusEnum = pgEnum("broll_render_status", [
  "pending",
  "rendered",
  "failed",
]);

/**
 * A b-roll batch: one source transcript, one character style, and the scenes
 * planned from it. The creator's uploaded reference photo is deliberately NOT
 * here and NOT in object storage — it is their real face, and it is only ever a
 * Turn-1 input, since every later generation turn anchors on the previous
 * output image.
 */
export const brollProjects = pgTable(
  "broll_projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /**
     * The rough-cut project this transcript came from, when it came from one.
     * **Nullable on purpose**: b-roll also accepts a plain SRT/VTT upload from
     * someone who never used rough-cut, and that path must work without
     * coupling the two apps' lifecycles.
     */
    sourceProjectId: uuid("source_project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    /**
     * The whole `@repo/transcript` document (word-level, post-EDL). Stored
     * rather than refetched because of the nullable FK above: an uploaded SRT
     * has no origin to fetch from.
     *
     * **Never select this column in a list query.** A document is capped at
     * 5 MB, so a page of twelve projects that selects it moves up to 60 MB over
     * the HTTP driver for data no list displays. Nothing in the database
     * enforces that; it is a convention (spec `broll/0002` AC-39).
     */
    transcript: jsonb("transcript").notNull(),
    /**
     * Lifted out of the stored document so the transcript-staleness check can
     * compare without parsing 5 MB. No staleness policy is decided yet (open
     * question 1 of the b-roll high level design, Phase 3); this only reserves
     * the ability to answer it.
     */
    edlFingerprint: text("edl_fingerprint"),
    /** Read constantly (the planner's scene-count multiplier, project cards) — not worth parsing the document for. */
    durationMs: integer("duration_ms").notNull(),
    /** Character style (anime, 3D, …). One per project, chosen at setup. */
    style: text("style").notNull(),
    outputWidth: integer("output_width").notNull().default(1920),
    outputHeight: integer("output_height").notNull().default(1080),
    /** Output frame rate as an exact rational, so 29.97 stays 30000/1001. */
    outputFpsNum: integer("output_fps_num").notNull().default(30),
    outputFpsDen: integer("output_fps_den").notNull().default(1),
    /**
     * Money (USD micros) reserved before the Gemini call; NULL when no
     * generation holds funds. Same double duty as `projects.hold_micros`: it is
     * also the exactly-once gate for settling. Reserving *before* the external
     * call is what makes the `users_balance_micros_nonneg` CHECK reject an
     * overdraft before the images are paid for.
     */
    holdMicros: integer("hold_micros"),
    /**
     * Non-null while a character generation is claimed/in-flight. A plain
     * UPDATE ... WHERE gen_claim_at IS NULL OR stale is the atomic claim, the
     * same shape as `projects.ai_cut_claim_at`. Without it a double-click on
     * Generate is a double charge.
     *
     * B-roll's stale window is 10 minutes, NOT `@repo/billing`'s
     * `STALE_HOLD_MS` (10s, sized for transcription): a character set takes
     * ~110s, so 10s would reclaim a run that is still going and charge twice.
     */
    genClaimAt: timestamp("gen_claim_at", { withTimezone: true }),
    /**
     * How many scene-planning runs this project has had. The **only** value
     * that separates a bundled first run from a charged re-run, so a wrong
     * answer here is a billing bug, not a cosmetic one.
     */
    planRuns: integer("plan_runs").notNull().default(0),
    /**
     * Present from day one so an R2 retention policy is possible later without
     * a painful backfill. Character images are permanent recurring cost and no
     * retention policy is decided yet; storage cost compounds silently.
     */
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // The dashboard's list query, same shape and same reason as
    // `projects_user_created_idx`: equality on user_id, then created_at for
    // both the keyset range predicate and the ORDER BY.
    index("broll_projects_user_created_idx").on(t.userId, t.createdAt),
  ]
);

/**
 * One transparent character PNG per emotion, in R2. Regenerating a variant
 * replaces the row in place and deletes the object it superseded, so stored
 * objects stay bounded at one per emotion — history would grow object storage
 * without limit against a retention policy that does not exist yet.
 */
export const brollAssets = pgTable(
  "broll_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brollProjectId: uuid("broll_project_id")
      .notNull()
      .references(() => brollProjects.id, { onDelete: "cascade" }),
    /**
     * Plain text, not a pgEnum, unlike every other constrained value in this
     * file. Phase 0 found that one out-of-enum emotion failed a whole plan and
     * discarded every valid scene with it, and drew the rule: strict about
     * claims, lenient about shape. An emotion label is not a truth claim, and
     * the set of six to eight is still being tuned.
     */
    emotion: text("emotion").notNull(),
    /**
     * Stored, not derived from the project id and emotion, precisely so the key
     * can carry a random element. A derivable key is a guessable key once you
     * know the project id, and these are served by presigned URL.
     */
    r2Key: text("r2_key").notNull(),
    /**
     * The **alpha-trimmed** dimensions, not the generation frame's. Background
     * removal returns an image the size of its input, so an untrimmed character
     * generated in a landscape frame is a mostly-empty PNG and every template
     * then scales and positions empty canvas. Stored so a template can position
     * without downloading the image.
     */
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    /** Storage accounting, so the deferred retention decision has data when it is made. */
    byteSize: integer("byte_size").notNull(),
    /** Bumped on regenerate, so a replaced image cannot serve from a cache. */
    attempt: integer("attempt").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // What makes replace-in-place actually true rather than merely intended.
    uniqueIndex("broll_assets_project_emotion_uq").on(
      t.brollProjectId,
      t.emotion
    ),
  ]
);

/**
 * A planned cutaway: where it lands, what triggered it, and how it renders.
 * Scenes carry no stored number — they sort by `start_ms`, and the number in an
 * exported filename (`scene_04__02-35.mp4`) is computed from that order at
 * export. Storing one would mean renumbering the whole project every time a
 * scene is excluded or added by hand, which is routine here.
 */
export const brollScenes = pgTable(
  "broll_scenes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brollProjectId: uuid("broll_project_id")
      .notNull()
      .references(() => brollProjects.id, { onDelete: "cascade" }),
    /** Timecode on the creator's final cut, and the sort key. */
    startMs: integer("start_ms").notNull(),
    durationMs: integer("duration_ms").notNull(),
    /**
     * The verbatim transcript line that triggered this scene — what makes a
     * scene identifiable when a user is scanning twenty of them in two seconds
     * each ("oh, that's the fuel imports bit").
     *
     * These three and `strength` are **NULL exactly when `origin = 'manual'`**:
     * a scene the user added by hand at a chosen timecode has no line behind it
     * and no planner score, which is the whole point of the origin field.
     */
    sourceText: text("source_text"),
    sourceStartMs: integer("source_start_ms"),
    sourceEndMs: integer("source_end_ms"),
    /** character | infographic | text. */
    visualType: text("visual_type").notNull(),
    /** Which character variant to composite; NULL on a chart-only or text-only scene. */
    emotion: text("emotion"),
    /** One of the six fixed templates (character-left, chart-full, …). */
    layoutTemplate: text("layout_template").notNull(),
    overlayText: text("overlay_text"),
    /**
     * `{type, title, values, labels, unit, source_span}`, or NULL.
     *
     * **NULL is the meaningful case, never an error**: a transcript that
     * quantifies only vaguely ("most", "a huge share") must yield no chart and
     * fall back to text. `unit` is load-bearing and is traced to the source span
     * exactly like the values are — a bare `80` next to a bare `20` is a
     * different claim than `80%` and `20%`, and this product sells numeric
     * honesty.
     */
    chart: jsonb("chart"),
    /**
     * The planner's confidence, 0 to 1. Kept for display and for retuning the
     * planner later — deliberately NOT used to decide `included`, because no
     * threshold has any evidence behind it yet.
     */
    strength: real("strength"),
    /**
     * Whether this scene is in the batch. Written by the planner directly, then
     * owned by the user. Two fields rather than one because they answer
     * different questions: what the model thought, and what the user decided.
     */
    included: boolean("included").notNull().default(true),
    /** planner | manual. Gates the four nullable columns above. */
    origin: text("origin").notNull().default("planner"),
    /**
     * Rendering runs in the user's browser and is free, so only the settled
     * outcome is worth a row — no progress percentage. Persisted at all so the
     * batch export screen survives a reload and the dashboard card can say
     * something true.
     */
    renderStatus: brollRenderStatusEnum("render_status")
      .notNull()
      .default("pending"),
    renderedAt: timestamp("rendered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // The Scene Studio list query and the export order in one.
    index("broll_scenes_project_start_idx").on(t.brollProjectId, t.startMs),
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
export type BrollProject = typeof brollProjects.$inferSelect;
export type NewBrollProject = typeof brollProjects.$inferInsert;
export type BrollAsset = typeof brollAssets.$inferSelect;
export type NewBrollAsset = typeof brollAssets.$inferInsert;
export type BrollScene = typeof brollScenes.$inferSelect;
export type NewBrollScene = typeof brollScenes.$inferInsert;
