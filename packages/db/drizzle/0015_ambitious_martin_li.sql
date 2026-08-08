-- B-Roll Generator data model (spec docs/specs/broll/0002-data-model).
--
-- Additive only: three new tables, one new enum, one new nullable column on
-- credit_ledger plus its constraints. Deployed code keeps serving traffic
-- against this, and Vercel Preview reads the production branch.
--
-- On the two credit_ledger constraints below: both are added plainly, so each
-- takes a lock for a validation scan of the whole table. That is a deliberate
-- call, the same one migration 0014 made about its index — at this table's
-- size the scan is milliseconds. The NOT VALID + VALIDATE CONSTRAINT split that
-- would avoid it cannot work inside one migration: drizzle-kit runs every
-- pending statement in a single transaction (BEGIN ... COMMIT), so the lock is
-- held until commit either way. Doing it properly needs two migration files
-- applied in two separate db:migrate runs.
--
-- Switch to that two step form if credit_ledger ever passes roughly 1M rows,
-- or if this is ever applied while the apps are under real write load.
CREATE TYPE "public"."broll_render_status" AS ENUM('pending', 'rendered', 'failed');--> statement-breakpoint
CREATE TABLE "broll_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broll_project_id" uuid NOT NULL,
	"emotion" text NOT NULL,
	"r2_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_size" integer NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broll_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source_project_id" uuid,
	"transcript" jsonb NOT NULL,
	"edl_fingerprint" text,
	"duration_ms" integer NOT NULL,
	"style" text NOT NULL,
	"output_width" integer DEFAULT 1920 NOT NULL,
	"output_height" integer DEFAULT 1080 NOT NULL,
	"output_fps_num" integer DEFAULT 30 NOT NULL,
	"output_fps_den" integer DEFAULT 1 NOT NULL,
	"hold_micros" integer,
	"gen_claim_at" timestamp with time zone,
	"plan_runs" integer DEFAULT 0 NOT NULL,
	"last_opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broll_scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broll_project_id" uuid NOT NULL,
	"start_ms" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"source_text" text,
	"source_start_ms" integer,
	"source_end_ms" integer,
	"visual_type" text NOT NULL,
	"emotion" text,
	"layout_template" text NOT NULL,
	"overlay_text" text,
	"chart" jsonb,
	"strength" real,
	"included" boolean DEFAULT true NOT NULL,
	"origin" text DEFAULT 'planner' NOT NULL,
	"render_status" "broll_render_status" DEFAULT 'pending' NOT NULL,
	"rendered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "broll_project_id" uuid;--> statement-breakpoint
ALTER TABLE "broll_assets" ADD CONSTRAINT "broll_assets_broll_project_id_broll_projects_id_fk" FOREIGN KEY ("broll_project_id") REFERENCES "public"."broll_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broll_projects" ADD CONSTRAINT "broll_projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broll_projects" ADD CONSTRAINT "broll_projects_source_project_id_projects_id_fk" FOREIGN KEY ("source_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broll_scenes" ADD CONSTRAINT "broll_scenes_broll_project_id_broll_projects_id_fk" FOREIGN KEY ("broll_project_id") REFERENCES "public"."broll_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "broll_assets_project_emotion_uq" ON "broll_assets" USING btree ("broll_project_id","emotion");--> statement-breakpoint
CREATE INDEX "broll_projects_user_created_idx" ON "broll_projects" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "broll_scenes_project_start_idx" ON "broll_scenes" USING btree ("broll_project_id","start_ms");--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_broll_project_id_broll_projects_id_fk" FOREIGN KEY ("broll_project_id") REFERENCES "public"."broll_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_one_project_ref" CHECK (NOT ("credit_ledger"."project_id" IS NOT NULL AND "credit_ledger"."broll_project_id" IS NOT NULL));