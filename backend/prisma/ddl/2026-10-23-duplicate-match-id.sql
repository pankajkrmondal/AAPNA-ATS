-- ============================================================================
-- L09 · Upload duplicate Review: old vs new comparison (23 Oct 2026)
-- Run with the guarded runner:
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-10-23-duplicate-match-id.sql
-- then: cd backend && npx prisma generate
--
-- Idempotent and additive.
--
-- WHAT
-- ----
-- An HR or vendor upload that matches an existing candidate (by email or phone)
-- is staged in rpa_cv_tmp for the recruiter's Merge / Cancel. Which candidate it
-- matched was thrown away, so the Review window could only show the NEW upload,
-- and the merge re-ran the match (with LIMIT 1 and no ORDER BY, so with several
-- matches it could pick a different candidate). This keeps the matched id, so
-- the Review window compares "already in the ATS" with "this upload" field by
-- field, and the merge updates the candidate the recruiter was shown.
--
-- No foreign key on purpose: the merge re-checks that the candidate still
-- exists and falls back to matching again, so a deleted candidate must not
-- block or cascade into the review queue.
-- ============================================================================

ALTER TABLE rpa_cv_tmp
  ADD COLUMN IF NOT EXISTS matched_cv_id BIGINT NULL;

COMMENT ON COLUMN rpa_cv_tmp.matched_cv_id IS
  'L09: the existing rpa_cv candidate this staged duplicate matched at upload (email or phone). Shown side by side in the Review window; the merge updates this candidate while it still exists. NULL for rows staged before 23 Oct 2026.';
