-- Character reuse across projects (spec `docs/specs/broll/0007-character-reuse`).
--
-- A character stops belonging to one b-roll project and becomes a row the
-- **user** owns. `broll_assets` hangs off the character, `broll_projects` points
-- at one, and the storage prefix and the authorization rule move one level over
-- at the same time.
--
-- **A clean break, on purpose (AC-145).** Every existing `broll_assets` row is
-- deleted rather than carried across. There is no column to move them to, and
-- keeping a second accepted pathname shape alive through the upload route's
-- authorization check costs far more than the sets are worth. The stored objects
-- under the old `broll/<projectId>/` prefix are removed by hand as part of
-- applying this, because no row will reference them afterwards and the sweep
-- cron now scans `broll/characters/` instead.
--
-- The delete runs first so `broll_assets` is empty by the time
-- `broll_character_id` is added NOT NULL with no default.
DELETE FROM "broll_assets";--> statement-breakpoint
CREATE TABLE "broll_characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"style" text NOT NULL,
	"gen_claim_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broll_assets" DROP CONSTRAINT "broll_assets_broll_project_id_broll_projects_id_fk";
--> statement-breakpoint
DROP INDEX "broll_assets_project_emotion_uq";--> statement-breakpoint
ALTER TABLE "broll_projects" ADD COLUMN "broll_character_id" uuid;--> statement-breakpoint
ALTER TABLE "broll_characters" ADD CONSTRAINT "broll_characters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broll_characters_user_created_idx" ON "broll_characters" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "broll_projects" ADD CONSTRAINT "broll_projects_broll_character_id_broll_characters_id_fk" FOREIGN KEY ("broll_character_id") REFERENCES "public"."broll_characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broll_assets" DROP COLUMN "broll_project_id";--> statement-breakpoint
ALTER TABLE "broll_assets" ADD COLUMN "broll_character_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "broll_assets" ADD CONSTRAINT "broll_assets_broll_character_id_broll_characters_id_fk" FOREIGN KEY ("broll_character_id") REFERENCES "public"."broll_characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "broll_assets_character_emotion_uq" ON "broll_assets" USING btree ("broll_character_id","emotion");
