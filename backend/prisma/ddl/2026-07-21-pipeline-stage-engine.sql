-- ============================================================================
-- Phase 3 — Module 1: Stage Engine + Pipeline Tracker
-- Manual DDL — apply directly to PostgreSQL, then run:
--   cd backend && npx prisma db pull && npx prisma generate
-- Per the repo's documented workflow (docs/reference/VENDOR_PROCESS.md §13):
-- the Prisma schema is NEVER hand-edited; it is introspected from the live DB.
--
-- Idempotent, additive, non-destructive — safe to run multiple times.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) rpa_pipeline_stages — stage configuration (admin-customizable, RT ask 2026-07-13)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpa_pipeline_stages (
  id           BIGSERIAL PRIMARY KEY,
  stage_key    VARCHAR(50) NOT NULL UNIQUE,
  label        VARCHAR(150) NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_optional  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  stage_type   VARCHAR(30) NOT NULL DEFAULT 'manual', -- manual | zeko | scheduled_interview | document | offer
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_sort ON rpa_pipeline_stages (sort_order);

-- ----------------------------------------------------------------------------
-- 2) rpa_stage_outcomes — outcome sets per stage (admin-customizable, RT ask 2026-07-13)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpa_stage_outcomes (
  id           BIGSERIAL PRIMARY KEY,
  stage_key    VARCHAR(50) NOT NULL REFERENCES rpa_pipeline_stages (stage_key) ON UPDATE CASCADE,
  outcome_key  VARCHAR(50) NOT NULL, -- e.g. approved | rejected | hold | future_prospect | joined | ...
  label        VARCHAR(150) NOT NULL,
  is_advance   BOOLEAN NOT NULL DEFAULT FALSE, -- only "advance" outcomes move the candidate forward
  is_final     BOOLEAN NOT NULL DEFAULT FALSE, -- closure-type outcome (terminal)
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stage_key, outcome_key)
);
CREATE INDEX IF NOT EXISTS idx_stage_outcomes_stage ON rpa_stage_outcomes (stage_key);

-- ----------------------------------------------------------------------------
-- 3) rpa_outcome_reasons — reason taxonomy for Reject/Hold (mandatory, Q19)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpa_outcome_reasons (
  id           BIGSERIAL PRIMARY KEY,
  stage_key    VARCHAR(50) REFERENCES rpa_pipeline_stages (stage_key) ON UPDATE CASCADE, -- NULL = applies to all stages
  outcome_key  VARCHAR(50) NOT NULL DEFAULT 'rejected', -- typically 'rejected' or 'hold'
  reason_label VARCHAR(255) NOT NULL,
  is_other     BOOLEAN NOT NULL DEFAULT FALSE, -- the free-text "Other reasons" entry (Q19)
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outcome_reasons_stage ON rpa_outcome_reasons (stage_key);

-- ----------------------------------------------------------------------------
-- 4) rpa_stage_email_templates — per stage×outcome email template mapping (RT ask 2026-07-13)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpa_stage_email_templates (
  id           BIGSERIAL PRIMARY KEY,
  stage_key    VARCHAR(50) NOT NULL REFERENCES rpa_pipeline_stages (stage_key) ON UPDATE CASCADE,
  outcome_key  VARCHAR(50) NOT NULL,
  template_id  INTEGER NOT NULL REFERENCES rpa_email_templates (id) ON UPDATE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stage_key, outcome_key)
);

-- ----------------------------------------------------------------------------
-- 5) rpa_candidate_pipeline — one row per candidate-per-MRF journey (Q13: concurrent journeys allowed)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpa_candidate_pipeline (
  id                   BIGSERIAL PRIMARY KEY,
  cv_id                BIGINT,
  mrf_id               BIGINT,
  shortlist_id         INTEGER REFERENCES rpa_shortlisted_candidates (id) ON UPDATE NO ACTION ON DELETE SET NULL,
  current_stage_key    VARCHAR(50) NOT NULL REFERENCES rpa_pipeline_stages (stage_key) ON UPDATE CASCADE,
  current_stage_status VARCHAR(20) NOT NULL DEFAULT 'in_progress', -- in_progress | approved | rejected | hold
  final_outcome        VARCHAR(50), -- one of the 8 closure values, nullable until closed
  source               VARCHAR(30) NOT NULL DEFAULT 'recruiter', -- recruiter | bulk_excel | vendor | screening_shortlist | email_intake
  vendor_email         VARCHAR(255), -- copied from rpa_cv.VendorEmail at creation (Q5 dual-notify)
  is_paused            BOOLEAN NOT NULL DEFAULT FALSE, -- manual pause when another concurrent journey wins (Q13/Q25)
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at            TIMESTAMPTZ
);
-- Postgres treats NULLs as distinct, so a plain UNIQUE(cv_id, mrf_id) would allow
-- duplicate no-MRF journeys for the same candidate. Two partial indexes close this:
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_pipeline_with_mrf
  ON rpa_candidate_pipeline (cv_id, mrf_id) WHERE mrf_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_pipeline_no_mrf
  ON rpa_candidate_pipeline (cv_id) WHERE mrf_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_candidate_pipeline_cv        ON rpa_candidate_pipeline (cv_id);
CREATE INDEX IF NOT EXISTS idx_candidate_pipeline_mrf        ON rpa_candidate_pipeline (mrf_id);
CREATE INDEX IF NOT EXISTS idx_candidate_pipeline_stage      ON rpa_candidate_pipeline (current_stage_key);
CREATE INDEX IF NOT EXISTS idx_candidate_pipeline_vendor     ON rpa_candidate_pipeline (vendor_email);
CREATE INDEX IF NOT EXISTS idx_candidate_pipeline_shortlist  ON rpa_candidate_pipeline (shortlist_id);

-- ----------------------------------------------------------------------------
-- 6) rpa_pipeline_stage_events — append-only audit trail
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpa_pipeline_stage_events (
  id            BIGSERIAL PRIMARY KEY,
  pipeline_id   BIGINT NOT NULL REFERENCES rpa_candidate_pipeline (id) ON UPDATE NO ACTION ON DELETE CASCADE,
  stage_key     VARCHAR(50) NOT NULL,
  event_type    VARCHAR(20) NOT NULL, -- entered | outcome | note | skip
  outcome       VARCHAR(50), -- references rpa_stage_outcomes.outcome_key (not FK — outcome sets are stage-scoped & mutable)
  reason_id     BIGINT REFERENCES rpa_outcome_reasons (id) ON UPDATE NO ACTION ON DELETE SET NULL,
  reason_text   TEXT, -- the typed value when "Other reasons" is picked (Q19: never display the literal word "Other")
  status_label  VARCHAR(255), -- exact legacy text written back to rpa_cv.FinalStatus
  notes         TEXT,
  email_sent    BOOLEAN NOT NULL DEFAULT FALSE,
  email_error   TEXT,
  acted_by      INTEGER REFERENCES rpa_users (id) ON UPDATE NO ACTION ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stage_events_pipeline ON rpa_pipeline_stage_events (pipeline_id);
CREATE INDEX IF NOT EXISTS idx_stage_events_created  ON rpa_pipeline_stage_events (created_at);

-- ----------------------------------------------------------------------------
-- 7) Pre-flight: extend rpa_email_templates.category CHECK constraint
--    (confirmed present in staging-DB-21072026.sql: rpa_email_templates_category_check)
--    Must run before seeding any 'stage_outcome' category templates.
-- ----------------------------------------------------------------------------
ALTER TABLE rpa_email_templates DROP CONSTRAINT IF EXISTS rpa_email_templates_category_check;
ALTER TABLE rpa_email_templates ADD CONSTRAINT rpa_email_templates_category_check
  CHECK (category = ANY (ARRAY[
    'general'::text, 'shortlist'::text, 'interview'::text, 'offer'::text,
    'rejection'::text, 'follow_up'::text, 'onboarding'::text,
    'stage_outcome'::text
  ]));

-- ----------------------------------------------------------------------------
-- Note on rpa_shortlisted_candidates.pipeline_status:
-- Confirmed in staging-DB-21072026.sql as a plain VARCHAR(50) DEFAULT 'shortlisted'
-- with NO CHECK constraint (unlike 03-DEVELOPMENT-PLAN.md's cautious assumption).
-- No DDL needed to add the 'future_prospect' value — it's a free-text column already.
-- ----------------------------------------------------------------------------
