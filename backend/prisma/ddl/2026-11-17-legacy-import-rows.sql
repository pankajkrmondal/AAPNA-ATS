-- ============================================================================
-- Provenance log for the one-time legacy candidate import (Phase 4).
-- Plan: docs/Phase 4/PLAN-MS-Access-Data-Migration-Mapping.md, section 3.8 (decision 3)
--
-- Apply with the guarded runner (never by hand in a SQL tool):
--   cd backend
--   node scripts/run-ddl.mjs --env .env.staging    --expect-db recruitmentautomationdb     --file prisma/ddl/2026-11-17-legacy-import-rows.sql --dry-run
--   node scripts/run-ddl.mjs --env .env.staging    --expect-db recruitmentautomationdb     --file prisma/ddl/2026-11-17-legacy-import-rows.sql
--   node scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd --file prisma/ddl/2026-11-17-legacy-import-rows.sql
-- Staging FIRST. Idempotent and additive. Rollback: 2026-11-17-legacy-import-rows.rollback.sql
--
-- WHY: Chhaya needs it to be provable which candidates came from MS Access
-- (total and spot-checks), and the visible tag on rpa_cv.last_action_context
-- changes the next time a candidate is touched. This table keeps one row per
-- SOURCE row read: where it came from, what happened to it, and which rpa_cv
-- row it became. It also lets an interrupted run restart without importing a
-- row twice, and makes a batch rollback exact (before-values of every update).
--
-- No screen reads it and the application does not use it: it is written only by
-- backend/scripts/legacy-migration/ and read with plain SQL. For that reason it
-- has NO model in schema.prisma and `prisma generate` is not needed. A later
-- `prisma db pull` will add the model by itself; that is harmless.
--
-- No FK on cv_id: a candidate merged or deleted later in the ATS must not be
-- blocked by, or silently delete, its import history.
--
-- raw_row holds the untouched source row, which is candidate personal data.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rpa_legacy_import_rows (
  id              BIGSERIAL     PRIMARY KEY,
  batch_id        UUID          NOT NULL,
  source_kind     VARCHAR(20)   NOT NULL,
  source_file     VARCHAR(300)  NOT NULL,
  source_table    VARCHAR(200)  NOT NULL,
  source_row_id   VARCHAR(100)  NOT NULL,
  raw_row         JSONB         NOT NULL,
  outcome         VARCHAR(30)   NOT NULL,
  changed_fields  JSONB,
  cv_id           BIGINT,
  warnings        JSONB,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT chk_legacy_import_source_kind CHECK (source_kind IN ('ms_access', 'excel', 'resume')),
  CONSTRAINT chk_legacy_import_outcome CHECK (outcome IN ('inserted', 'merged_in_file', 'updated_existing', 'skipped_blank', 'rejected_min_fields'))
);

COMMENT ON TABLE rpa_legacy_import_rows IS
  'One row per source row read by the one-time legacy import (MS Access, Excel, resumes). Never updated after the import. Phase 4.';

-- One source row is imported once. This is what makes a restarted run safe.
CREATE UNIQUE INDEX IF NOT EXISTS uq_legacy_import_source_row
  ON rpa_legacy_import_rows (source_kind, source_file, source_table, source_row_id);

CREATE INDEX IF NOT EXISTS idx_legacy_import_batch ON rpa_legacy_import_rows (batch_id);
CREATE INDEX IF NOT EXISTS idx_legacy_import_cv ON rpa_legacy_import_rows (cv_id);
