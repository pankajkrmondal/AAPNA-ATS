-- ============================================================================
-- ROLLBACK for 2026-10-14-ceo-round-optional.sql (N24).
-- Makes the CEO round mandatory again. Candidates who already skipped it keep
-- their journeys; only future approvals are affected.
-- Run with the same guarded runner:
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-10-14-ceo-round-optional.rollback.sql
-- ============================================================================

UPDATE rpa_pipeline_stages
SET is_optional = false
WHERE stage_key = 'ceo'
  AND is_optional IS DISTINCT FROM false;
