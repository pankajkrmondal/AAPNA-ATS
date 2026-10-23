-- ============================================================================
-- ROLLBACK for 2026-10-22-jd-send-version-label.sql (L07 Editable JD label).
-- Run with the guarded runner:
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-10-22-jd-send-version-label.rollback.sql
--
-- First deploy the previous backend build: this build reads and writes both
-- columns, and Prisma selects them on every MRF list.
--
-- Data lost: every JD label and JD date recruiters have set.
-- ============================================================================

ALTER TABLE rpa_mrf_jd_send DROP COLUMN IF EXISTS version_date;
ALTER TABLE rpa_mrf_jd_send DROP COLUMN IF EXISTS version_label;
