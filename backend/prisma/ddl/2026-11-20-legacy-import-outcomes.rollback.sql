-- ============================================================================
-- ROLLBACK for 2026-11-20-legacy-import-outcomes.sql: back to the five Stage 1 outcome values.
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-11-20-legacy-import-outcomes.rollback.sql
--
-- FAILS (and changes nothing) while any row carries one of the Stage 3 values.
-- First roll back every Stage 3 batch with backend/scripts/legacy-migration-resumes/5-rollback-batch.mjs.
-- Apply to both databases, so check-schema-parity.mjs stays MATCH.
-- ============================================================================

ALTER TABLE rpa_legacy_import_rows DROP CONSTRAINT IF EXISTS chk_legacy_import_outcome;

ALTER TABLE rpa_legacy_import_rows ADD CONSTRAINT chk_legacy_import_outcome CHECK (outcome IN (
  'inserted', 'merged_in_file', 'updated_existing', 'skipped_blank', 'rejected_min_fields'
));
