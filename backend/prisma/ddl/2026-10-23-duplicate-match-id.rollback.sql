-- ============================================================================
-- ROLLBACK for 2026-10-23-duplicate-match-id.sql (L09 duplicate compare).
-- Run with the guarded runner:
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-10-23-duplicate-match-id.rollback.sql
--
-- First deploy the previous backend build: this build writes the column on
-- every duplicate upload and reads it in the Review window and the merge.
--
-- Data lost: which candidate each pending duplicate matched. The merge falls
-- back to matching by email / phone again, as before.
-- ============================================================================

ALTER TABLE rpa_cv_tmp DROP COLUMN IF EXISTS matched_cv_id;
