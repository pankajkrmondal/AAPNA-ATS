-- ============================================================================
-- Legacy source label and filter on Search Candidate (Phase 4, 17 Nov 2026)
-- Scope: docs/Phase 4/SCOPE-Legacy-Source-Label-and-Filter.md
--
-- Apply with the guarded runner (never by hand in a SQL tool):
--   cd backend
--   node scripts/run-ddl.mjs --env .env.staging    --expect-db recruitmentautomationdb     --file prisma/ddl/2026-11-17-legacy-source-label.sql --dry-run
--   node scripts/run-ddl.mjs --env .env.staging    --expect-db recruitmentautomationdb     --file prisma/ddl/2026-11-17-legacy-source-label.sql
--   node scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd --file prisma/ddl/2026-11-17-legacy-source-label.sql
-- then: cd backend && npx prisma generate
-- Staging FIRST. Needs 2026-11-17-legacy-import-rows.sql applied before it.
-- Rollback: 2026-11-17-legacy-source-label.rollback.sql
--
-- ORDER: apply this BEFORE deploying the backend build that knows the columns.
-- Prisma selects every column of rpa_cv, so that build fails on a database
-- without them.
--
-- WHAT
-- ----
-- legacy_source    which legacy import the candidate is in: 'ms_access', later
--                  'excel' and 'resume' (same words as
--                  rpa_legacy_import_rows.source_kind). NULL for everyone else.
-- legacy_relation  'imported': the import created the candidate (label "MS Access").
--                  'matched':  the candidate was already in the ATS and the import
--                              only filled empty fields (label "Also in MS Access").
--
-- Both are set by the import script and cleared by the ATS when a fresh resume
-- arrives for the candidate (HR Upload / Vendor Upload duplicate merge, email
-- intake). A manual edit keeps them. rpa_legacy_import_rows stays the full,
-- unchanged record either way.
--
-- Idempotent and additive. The backfill only fills candidates that have no
-- label yet and have not had a fresh resume since their import, so running
-- this file again never puts back a label the ATS removed.
-- ============================================================================

ALTER TABLE rpa_cv ADD COLUMN IF NOT EXISTS legacy_source   VARCHAR(20) NULL;
ALTER TABLE rpa_cv ADD COLUMN IF NOT EXISTS legacy_relation VARCHAR(20) NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rpa_cv_legacy_source') THEN
    ALTER TABLE rpa_cv ADD CONSTRAINT chk_rpa_cv_legacy_source
      CHECK (legacy_source IS NULL OR legacy_source IN ('ms_access', 'excel', 'resume'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rpa_cv_legacy_relation') THEN
    ALTER TABLE rpa_cv ADD CONSTRAINT chk_rpa_cv_legacy_relation
      CHECK ((legacy_source IS NULL AND legacy_relation IS NULL)
          OR (legacy_source IS NOT NULL AND legacy_relation IN ('imported', 'matched')));
  END IF;
END $$;

COMMENT ON COLUMN rpa_cv.legacy_source IS
  'Phase 4: legacy import this candidate is in (ms_access, excel, resume). Label and filter on Search Candidate. Cleared when a fresh resume is uploaded or merged. Full record: rpa_legacy_import_rows.';
COMMENT ON COLUMN rpa_cv.legacy_relation IS
  'Phase 4: imported = created by the legacy import; matched = already in the ATS, the import filled empty fields. NULL when legacy_source is NULL.';

CREATE INDEX IF NOT EXISTS idx_rpa_cv_legacy_source ON rpa_cv (legacy_source) WHERE legacy_source IS NOT NULL;

-- ── Backfill from the provenance table ───────────────────────────────────
-- Per candidate: the earliest import that touched it decides the source;
-- 'inserted' wins over 'updated_existing' within that source.
-- Skipped: candidates that already carry a label, and candidates whose last
-- action after the import was a fresh resume (duplicate merge or email
-- intake), because the ATS removes the label in that case.
WITH firsts AS (
  SELECT DISTINCT ON (r.cv_id)
         r.cv_id,
         r.source_kind,
         CASE WHEN bool_or(r.outcome = 'inserted') OVER (PARTITION BY r.cv_id, r.source_kind)
              THEN 'imported' ELSE 'matched' END AS relation,
         max(r.created_at) OVER (PARTITION BY r.cv_id) AS last_import_at
  FROM rpa_legacy_import_rows r
  WHERE r.cv_id IS NOT NULL
    AND r.outcome IN ('inserted', 'updated_existing')
  ORDER BY r.cv_id, r.created_at, r.id
)
UPDATE rpa_cv cv
SET legacy_source = f.source_kind,
    legacy_relation = f.relation
FROM firsts f
WHERE cv.id = f.cv_id
  AND cv.legacy_source IS NULL
  AND NOT (cv.last_action_context IN ('duplicate_merge', 'email_intake')
           -- "modifiedAt" is a timestamp WITHOUT time zone that Prisma writes in UTC.
           AND cv."modifiedAt" > (f.last_import_at AT TIME ZONE 'UTC'));
