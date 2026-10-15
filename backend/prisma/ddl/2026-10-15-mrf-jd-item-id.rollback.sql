-- ============================================================================
-- ROLLBACK for 2026-10-15-mrf-jd-item-id.sql (N17).
-- Drops the JD file id. Shortlist emails then fall back to the JD link.
-- Run with the same guarded runner:
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-10-15-mrf-jd-item-id.rollback.sql
-- Deploy the previous backend build first: the current code reads and writes this column.
-- ============================================================================

ALTER TABLE rpa_mrf DROP COLUMN IF EXISTS jd_item_id;
