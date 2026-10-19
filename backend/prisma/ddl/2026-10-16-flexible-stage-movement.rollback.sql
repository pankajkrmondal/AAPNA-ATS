-- ============================================================================
-- ROLLBACK for 2026-10-16-flexible-stage-movement.sql.
-- Run with the same guarded runner:
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-10-16-flexible-stage-movement.rollback.sql
--
-- First set FLEXIBLE_STAGES_ENABLED=false AND deploy the previous backend
-- build: the flexible-stages build writes rpa_pipeline_stage_state on every
-- stage change and would fail without it.
--
-- What is lost: the per-stage state (rebuildable by re-running the forward
-- file), the from-stage of 'moved' events (the readable notes text stays), and
-- the Evalground withdraw marks (a withdrawn invite then reads as open again).
-- 'moved' events themselves are kept; they are history.
-- ============================================================================

DROP TABLE IF EXISTS rpa_pipeline_stage_state;

ALTER TABLE rpa_pipeline_stage_events DROP COLUMN IF EXISTS from_stage_key;

ALTER TABLE rpa_assessment_invites DROP COLUMN IF EXISTS withdraw_reason;
ALTER TABLE rpa_assessment_invites DROP COLUMN IF EXISTS withdrawn_by;
ALTER TABLE rpa_assessment_invites DROP COLUMN IF EXISTS withdrawn_at;
