ALTER TABLE "access_codes" DISABLE ROW LEVEL SECURITY;-->statement-breakpoint
-- Rename rather than DROP so historical redemption data is preserved.
-- To fully remove the table after verifying nothing depends on it:
--   ALTER TABLE "_access_codes_deleted" RENAME TO "access_codes";  (rollback)
--   DROP TABLE "_access_codes_deleted";                            (final cleanup)
ALTER TABLE "access_codes" RENAME TO "_access_codes_deleted";-->statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "is_member" SET DEFAULT true;