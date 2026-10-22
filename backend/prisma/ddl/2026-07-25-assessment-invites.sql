-- ============================================================================
-- Phase 3 — Module 2 extension: Evalground invite/deadline tracking +
-- "Marks Scored" capture for auto-advance/auto-reject.
-- Manual DDL — apply directly to PostgreSQL, then run:
--   cd backend && npx prisma db pull && npx prisma generate
-- Per docs/reference/VENDOR_PROCESS.md §13: schema.prisma is NEVER hand-edited.
--
-- Idempotent, additive, non-destructive — safe to run multiple times.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) rpa_assessment_invites — one row per invite ATTEMPT (re-invite = new row,
--    never an overwrite, so multiple attempts per candidate stay trackable).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpa_assessment_invites (
  id            BIGSERIAL PRIMARY KEY,
  pipeline_id   BIGINT NOT NULL REFERENCES rpa_candidate_pipeline (id) ON UPDATE NO ACTION ON DELETE CASCADE,
  method        VARCHAR(20) NOT NULL, -- 'email' | 'manual'
  subject       TEXT, -- only populated for method='email'
  body          TEXT, -- only populated for method='email'
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline_days INTEGER NOT NULL, -- snapshot of assessment_deadline_days at send time
  deadline_at   TIMESTAMPTZ NOT NULL, -- sent_at + deadline_days, stored directly for simple cron querying
  reminded_at   TIMESTAMPTZ, -- set once the overdue bell notification fires for THIS invite
  created_by    INTEGER REFERENCES rpa_users (id) ON UPDATE NO ACTION ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assessment_invites_pipeline  ON rpa_assessment_invites (pipeline_id);
CREATE INDEX IF NOT EXISTS idx_assessment_invites_sent_at   ON rpa_assessment_invites (pipeline_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessment_invites_overdue   ON rpa_assessment_invites (deadline_at) WHERE reminded_at IS NULL;

-- ----------------------------------------------------------------------------
-- 2) rpa_assessment_results.overall_marks_scored — Evalground's literal "Marks
--    Scored" column: a raw total-marks count across the whole test, NOT the
--    Percentage column and NOT the vendor's own Result column. Drives the new
--    auto-advance/auto-reject gate (see assessmentImport.service.js). Not
--    normalized across different tests with different total possible marks —
--    accepted tradeoff, confirmed with the product owner.
-- ----------------------------------------------------------------------------
ALTER TABLE rpa_assessment_results ADD COLUMN IF NOT EXISTS overall_marks_scored NUMERIC(8,2);
