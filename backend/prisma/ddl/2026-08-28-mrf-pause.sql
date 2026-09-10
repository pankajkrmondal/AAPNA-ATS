-- ============================================================================
-- Requisitions — pause a still-open MRF, with a reason
-- Manual DDL — apply directly to PostgreSQL, then run:
--   cd backend && npx prisma db pull && npx prisma generate
-- Per the repo's documented workflow: the Prisma schema is NEVER hand-edited;
-- it is introspected from the live DB.
--
-- Idempotent, additive, non-destructive — safe to run multiple times.
--
-- WHY
-- ---
-- "Pause a requisition" was scoped in docs/HR-CANDIDATE-PIPELINE-FAQ-AND-GAP-
-- PLAN-2026-08-26.md (gap G1) alongside candidate-level pause (Q33), but never
-- actually shipped: what landed 2026-08-26 was candidate-level pause
-- (rpa_candidate_pipeline.is_paused) plus MRF manual CLOSURE (Q34, closed_at/
-- closure_reason), including a closure reason literally named
-- "on_hold_indefinitely" — which fully closes the requisition via the same
-- irreversible-until-reopened path as budget_withdrawn or role_withdrawn. A
-- recruiter who wants to temporarily stop sourcing for a role without
-- declaring it closed has had no way to do that.
--
-- WHY NOT REUSE closed_at / closure_reason
-- -----------------------------------------
-- Paused and Closed are different facts, same reasoning as filled_at vs
-- closed_at in 2026-08-26-mrf-manual-closure.sql: a paused requisition is
-- still open/active, just temporarily not being sourced against, whereas
-- closed means done. Overloading closure_reason='on_hold_indefinitely' to
-- mean "paused" is exactly the conflation this column set removes — it is
-- indistinguishable from every other closure reason once written, and
-- resuming it means undoing a CLOSE, not a pause.
-- ============================================================================

-- When a human paused this requisition, why, and who. NULL = not paused.
-- Independent of filled_at/closed_at — a paused requisition is still
-- "open"/hiring in every other sense, just excluded from new sourcing while
-- paused_at is set. isMrfPaused() (config/pipelineStages.js) is the one place
-- that reads this.
ALTER TABLE rpa_mrf
  ADD COLUMN IF NOT EXISTS paused_at     TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS paused_reason TEXT        NULL,
  ADD COLUMN IF NOT EXISTS paused_by     INTEGER     NULL;

COMMENT ON COLUMN rpa_mrf.paused_at IS
  'When a human paused this requisition (NULL = not paused). Set/cleared by mrfPause.service.js. Independent of filled_at/closed_at — a paused MRF is still open, just temporarily excluded from new candidate sourcing (getApprovedRoles). Ask isMrfPaused().';

COMMENT ON COLUMN rpa_mrf.paused_reason IS
  'Free-text reason the recruiter gave when pausing. Cleared on resume.';

COMMENT ON COLUMN rpa_mrf.paused_by IS
  'user id that paused this requisition. Cleared on resume.';

-- The hot read is "should this appear for new candidate sourcing?"
-- (getApprovedRoles). Mirrors idx_rpa_mrf_open's shape for the same reason:
-- a partial index whose WHERE doesn't match the query's WHERE is never used.
CREATE INDEX IF NOT EXISTS idx_rpa_mrf_unpaused
  ON rpa_mrf (id)
  WHERE paused_at IS NULL;
