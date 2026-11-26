-- ============================================================================
-- Stage 3 (resumes): more outcome values for rpa_legacy_import_rows.
-- Plan: docs/Phase 4/PLAN-Legacy-Migration-Stage2-3-Excel-Naukri-Resumes.md, 5.7 and decision S20.
--
-- Apply with the guarded runner, to BOTH databases on the same day (plan 2.1, principle 1):
--   cd backend
--   node scripts/run-ddl.mjs --env .env.staging    --expect-db recruitmentautomationdb     --file prisma/ddl/2026-11-20-legacy-import-outcomes.sql --dry-run
--   node scripts/run-ddl.mjs --env .env.staging    --expect-db recruitmentautomationdb     --file prisma/ddl/2026-11-20-legacy-import-outcomes.sql
--   node scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd --file prisma/ddl/2026-11-20-legacy-import-outcomes.sql --dry-run
--   node scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd --file prisma/ddl/2026-11-20-legacy-import-outcomes.sql
-- Then: node scripts/check-schema-parity.mjs --a staging --b production  -> MATCH
--
-- Additive: the five Stage 1 values stay; every existing row still satisfies the constraint.
-- New values:
--   rejected_no_email          resume with no valid email (HR Upload's rule, plan 5.4 step 5)
--   rejected_unreadable        corrupt or password-protected file; no text even from the scanned reader
--   skipped_duplicate_file     byte-identical copy (same SHA-256) of a file already recorded
--   skipped_unsupported_type   file type not imported (RTF, PPTX, and anything else not PDF/DOCX/DOC/image; S20)
--   review_identity_conflict   matches a candidate by email/phone but the name clearly differs (plan 3.1)
-- No table or column changes; no prisma generate needed (the table has no Prisma model).
-- Rollback: 2026-11-20-legacy-import-outcomes.rollback.sql
-- ============================================================================

ALTER TABLE rpa_legacy_import_rows DROP CONSTRAINT IF EXISTS chk_legacy_import_outcome;

ALTER TABLE rpa_legacy_import_rows ADD CONSTRAINT chk_legacy_import_outcome CHECK (outcome IN (
  'inserted', 'merged_in_file', 'updated_existing', 'skipped_blank', 'rejected_min_fields',
  'rejected_no_email', 'rejected_unreadable', 'skipped_duplicate_file', 'skipped_unsupported_type', 'review_identity_conflict'
));
