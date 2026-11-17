-- ============================================================================
-- ROLLBACK for 2026-11-17-legacy-source-label.sql (legacy source label/filter).
-- Run with the guarded runner:
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-11-17-legacy-source-label.rollback.sql
--
-- First deploy the previous backend build: this build reads and writes the
-- columns on every candidate search, view, export, duplicate merge and email
-- intake, and Prisma fails on a database without them.
--
-- Data lost: the label on each candidate, including which labels the ATS has
-- since removed. rpa_legacy_import_rows is not touched, so applying the
-- forward file again restores the labels from it (except that it cannot know
-- which ones were removed through a manual path; see the forward file's guard).
-- ============================================================================

DROP INDEX IF EXISTS idx_rpa_cv_legacy_source;
ALTER TABLE rpa_cv DROP CONSTRAINT IF EXISTS chk_rpa_cv_legacy_relation;
ALTER TABLE rpa_cv DROP CONSTRAINT IF EXISTS chk_rpa_cv_legacy_source;
ALTER TABLE rpa_cv DROP COLUMN IF EXISTS legacy_relation;
ALTER TABLE rpa_cv DROP COLUMN IF EXISTS legacy_source;
