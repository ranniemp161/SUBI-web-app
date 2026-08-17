-- Object scenes: the subject, its rejection note, and the generated
-- illustration that draws it (spec broll/0008).
--
-- Every column is nullable or defaulted, so this is backward compatible by
-- construction: deployed code that knows nothing about them keeps serving
-- traffic against this schema, which is the rule while Preview reads production.
--
-- `object` mirrors `chart`, down to the jsonb and the NULL-is-the-common-case
-- reading: most lines name nothing depictable. `object_rejection_reason` mirrors
-- `chart_rejection_reason` and exists for the same reason — once `object` is
-- NULL, a scene the planner meant as text and a scene whose subject failed its
-- trace are the same row.
--
-- `object_attempt` counts illustrations drawn and is what the next pathname is
-- minted from. A redraw writes a NEW path rather than overwriting: Vercel's CDN
-- caches blobs for up to a month, so writing in place would serve the creator
-- back the very illustration they just paid to replace.
--
-- Runs after 0019, which adds the ledger reason this feature charges under, and
-- in a SEPARATE `db:migrate` run — see the note in that file.
ALTER TABLE "broll_scenes" ADD COLUMN "object" jsonb;--> statement-breakpoint
ALTER TABLE "broll_scenes" ADD COLUMN "object_rejection_reason" text;--> statement-breakpoint
ALTER TABLE "broll_scenes" ADD COLUMN "object_asset_path" text;--> statement-breakpoint
ALTER TABLE "broll_scenes" ADD COLUMN "object_attempt" integer DEFAULT 0 NOT NULL;
