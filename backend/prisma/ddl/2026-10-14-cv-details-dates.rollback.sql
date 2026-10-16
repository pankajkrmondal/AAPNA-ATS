-- ============================================================================
-- ROLLBACK for 2026-10-14-cv-details-dates.sql (N44).
-- Drops the two missing-details date columns and their index. The request
-- dates can be re-derived from rpa_email_log by re-running the forward script;
-- the completion dates recorded since release are LOST.
-- Run with the same guarded runner:
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-10-14-cv-details-dates.rollback.sql
-- Deploy the previous backend build first: the current code reads and writes
-- these columns.
-- ============================================================================

DROP INDEX IF EXISTS idx_rpa_cv_details_completed_at;
ALTER TABLE rpa_cv DROP COLUMN IF EXISTS details_completed_at;
ALTER TABLE rpa_cv DROP COLUMN IF EXISTS details_requested_at;
