-- ============================================================================
-- ROLLBACK for 2026-10-21-candidate-mrf-tags.sql.
-- Run with the same guarded runner:
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-10-21-candidate-mrf-tags.rollback.sql
--
-- First deploy the previous backend build: the JD-tagging build writes these
-- tables on every upload, shortlist and Change JD and would fail without them.
--
-- What is lost: every JD tag (the backfilled ones can be rebuilt by re-running
-- the forward file; upload tags cannot), the JD of duplicates still waiting
-- for a merge, and the JD shown on upload jobs. Shortlists and journeys are
-- untouched.
-- ============================================================================

DROP INDEX IF EXISTS uq_shortlist_cv_mrf;

ALTER TABLE rpa_upload_jobs DROP COLUMN IF EXISTS mrf_id;
ALTER TABLE rpa_cv_tmp      DROP COLUMN IF EXISTS mrf_id;

DROP TABLE IF EXISTS rpa_candidate_mrf_tags;
