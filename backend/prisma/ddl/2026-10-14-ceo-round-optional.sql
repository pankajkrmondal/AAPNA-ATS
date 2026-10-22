-- ============================================================================
-- CEO round optional (N24, Phase 3 "Do Now"). DATA change only, no schema.
-- Plan: docs/Phase 3 Enhancements or Feedback/PLAN-Phase3-Now.md section 4.C, N24
--
-- Apply with the guarded runner (never by hand in a SQL tool):
--   cd backend
--   node scripts/run-ddl.mjs --env .env.staging    --expect-db recruitmentautomationdb     --file prisma/ddl/2026-10-14-ceo-round-optional.sql --dry-run
--   node scripts/run-ddl.mjs --env .env.staging    --expect-db recruitmentautomationdb     --file prisma/ddl/2026-10-14-ceo-round-optional.sql
--   node scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd --file prisma/ddl/2026-10-14-ceo-round-optional.sql
-- No prisma pull is needed (no column changes). Staging FIRST. Idempotent.
-- Rollback: 2026-10-14-ceo-round-optional.rollback.sql
--
-- WHY: RT reported the CEO round as mandatory although many MRFs say "CEO /
-- Management Round: No". Marking the stage optional lets the approve dialog
-- skip it (and Client Round with it) straight to Documents. The server only
-- ever allows skipping optional stages, so this flag is what permits it.
-- Release it TOGETHER with the backend build that carries the skip guard.
-- ============================================================================

UPDATE rpa_pipeline_stages
SET is_optional = true
WHERE stage_key = 'ceo'
  AND is_optional IS DISTINCT FROM true;
