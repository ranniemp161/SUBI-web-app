-- Completes the retirement of `access_codes` that migration 0008 intended.
--
-- 0008 was never applied to production: its DDL was superseded by a db:push,
-- which syncs schema.ts but cannot infer a rename, so the table was left in
-- place while 0009 and 0010 went in around it. 0008 is now recorded as applied
-- (its other statement, the is_member default, was subsequently set by 0009),
-- and the one piece that never ran is expressed here as a forward migration.
--
-- Renamed rather than dropped so historical redemption data survives. To finish
-- the removal later, once nothing is confirmed to reference it:
--   DROP TABLE "_access_codes_deleted";
-- To roll this back:
--   ALTER TABLE "_access_codes_deleted" RENAME TO "access_codes";
--
-- IF EXISTS on both statements so this is safe to run against a database where
-- the rename already happened (e.g. one built from 0008 rather than push).
ALTER TABLE IF EXISTS "access_codes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE IF EXISTS "access_codes" RENAME TO "_access_codes_deleted";
