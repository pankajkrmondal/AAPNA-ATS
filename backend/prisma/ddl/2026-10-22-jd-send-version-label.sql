-- ============================================================================
-- L07 · Editable JD label (no MRF) (22 Oct 2026)
-- Run with the guarded runner:
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-10-22-jd-send-version-label.sql
-- then: cd backend && npx prisma generate
--
-- Idempotent and additive.
--
-- WHAT
-- ----
-- A JD sent before the hiring manager submits the MRF is an rpa_mrf_jd_send row
-- with mrf_id NULL. It has only a role and a link, so two "Data Analyst" JDs
-- cannot be told apart (RT feedback section 3, second half). Recruiters can now
-- give such a row a short label and a JD date. The MRF page shows
-- "<role> · <label> · <date>" and marks the newest JD date per role "Latest".
--
-- Once an MRF is linked, the MRF's reference and date (N19) name it everywhere
-- and the label becomes read-only; it is kept, not cleared.
-- ============================================================================

ALTER TABLE rpa_mrf_jd_send
  ADD COLUMN IF NOT EXISTS version_label VARCHAR(60) NULL;

ALTER TABLE rpa_mrf_jd_send
  ADD COLUMN IF NOT EXISTS version_date DATE NULL;

COMMENT ON COLUMN rpa_mrf_jd_send.version_label IS
  'L07: recruiter-set label for a JD sent without an MRF (e.g. "v2 - Oct revision"), shown next to the role on the MRF page. Editable only while mrf_id is NULL.';

COMMENT ON COLUMN rpa_mrf_jd_send.version_date IS
  'L07: recruiter-set JD date for a JD sent without an MRF. The newest of COALESCE(version_date, created_at) per role is marked Latest. Editable only while mrf_id is NULL.';
