-- ============================================================================
-- MRF JD file id (N17, Phase 3 "Do Now" section C)
-- Plan: docs/Phase 3 Enhancements or Feedback/PLAN-Phase3-Now.md section 4.C, N17
--
-- Apply with the guarded runner (never by hand in a SQL tool):
--   cd backend
--   node scripts/run-ddl.mjs --env .env.staging    --expect-db recruitmentautomationdb     --file prisma/ddl/2026-10-15-mrf-jd-item-id.sql --dry-run
--   node scripts/run-ddl.mjs --env .env.staging    --expect-db recruitmentautomationdb     --file prisma/ddl/2026-10-15-mrf-jd-item-id.sql
--   node scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd --file prisma/ddl/2026-10-15-mrf-jd-item-id.sql
-- then stop the server and worker and run `npm run prisma:pull && npm run prisma:generate`.
-- Staging FIRST. Idempotent and additive: re-running changes nothing.
-- Rollback: 2026-10-15-mrf-jd-item-id.rollback.sql
--
-- WHY: keyword shortlist emails attach the MRF's JD file. The upload kept only
-- the file's web link; downloading by OneDrive item id is reliable, the link is
-- not always readable by the app. Older MRFs keep NULL and fall back to the link.
-- ============================================================================

ALTER TABLE rpa_mrf ADD COLUMN IF NOT EXISTS jd_item_id VARCHAR(512);

COMMENT ON COLUMN rpa_mrf.jd_item_id IS
  'OneDrive drive item id of the uploaded JD file (attach_jd). Used to attach the JD to keyword shortlist emails. '
  'NULL for MRFs uploaded before this column existed; those fall back to jd_document_link.';
