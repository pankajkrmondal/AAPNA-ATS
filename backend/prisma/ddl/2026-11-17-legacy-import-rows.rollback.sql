-- ============================================================================
-- ROLLBACK for 2026-11-17-legacy-import-rows.sql.
-- Run with the same guarded runner:
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-11-17-legacy-import-rows.rollback.sql
--
-- The application does not read this table, so nothing in the ATS breaks.
--
-- What is lost: the record of which candidates came from the legacy import and
-- the before-values needed to undo its updates. So FIRST undo every import
-- batch with backend/scripts/legacy-migration/4-rollback-batch.mjs, or accept
-- that the imported candidates stay in rpa_cv with no history.
-- ============================================================================

DROP TABLE IF EXISTS rpa_legacy_import_rows;
