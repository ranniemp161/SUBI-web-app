-- AI Cut paid re-run (ADR 0002-ai-cut-paid-rerun): replace the single stored
-- `projects.ai_cuts` result with versioned runs. A project can hold up to 3
-- stored AI Cut runs at once, each a separate paid Gemini pass; the user can
-- preview and switch which one is active without losing the others.
CREATE TABLE "ai_cut_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"run_number" integer NOT NULL,
	"ranges" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "active_ai_cut_run_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "ai_cut_claim_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_cut_runs" ADD CONSTRAINT "ai_cut_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_active_ai_cut_run_id_ai_cut_runs_id_fk" FOREIGN KEY ("active_ai_cut_run_id") REFERENCES "public"."ai_cut_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_cut_runs_project_run_number_uq" ON "ai_cut_runs" USING btree ("project_id","run_number");
--> statement-breakpoint
-- Backfill: any project with a non-empty stored ai_cuts result becomes run 1
-- of that project's ai_cut_runs, and that run becomes the active one.
WITH backfill AS (
	INSERT INTO "ai_cut_runs" ("project_id", "run_number", "ranges", "model", "created_at")
	SELECT "id", 1, "ai_cuts"->'ranges', COALESCE("ai_cuts"->>'model', 'unknown'),
		COALESCE(("ai_cuts"->>'createdAt')::timestamptz, now())
	FROM "projects"
	WHERE "ai_cuts" IS NOT NULL AND jsonb_array_length("ai_cuts"->'ranges') > 0
	RETURNING "id", "project_id"
)
UPDATE "projects" p
SET "active_ai_cut_run_id" = b."id"
FROM backfill b
WHERE p."id" = b."project_id";
--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "ai_cuts";
