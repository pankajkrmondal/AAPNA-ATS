-- ============================================================================
-- Phase 3 — Module 3 (part 2 of 2): Interviewer SCORECARD
-- Manual DDL — apply directly to PostgreSQL, then run:
--   cd backend && npx prisma db pull && npx prisma generate
-- Per the repo's documented workflow: the Prisma schema is NEVER hand-edited;
-- it is introspected from the live DB.
--
-- Idempotent, additive, non-destructive — safe to run multiple times.
-- Apply AFTER 2026-07-25-interview-occurrence.sql (that file adds the
-- scorecard_dispatched_at guard these rows are released under).
--
-- Backs the "Interviewer scorecard — Interview Evaluation Format" the panel
-- fills in via an emailed no-login link, for the human rounds Tech1..CEO.
-- A row is created + emailed ONLY once the interview is confirmed 'held'
-- (rpa_interview_schedule.occurrence_status='held'). See
-- docs/phase3/INTERVIEWER-SCORECARD-PLAN.md.
-- ============================================================================

-- One row per (booked interview × recipient). A panel can be several people, so
-- one recipient = one row = one single-use token = one submission.
CREATE TABLE IF NOT EXISTS rpa_interview_scorecard (
  id                 BIGSERIAL PRIMARY KEY,
  schedule_id        BIGINT NOT NULL REFERENCES rpa_interview_schedule (id) ON UPDATE CASCADE ON DELETE CASCADE,
  -- Denormalized so per-candidate report queries never join through the
  -- schedule. Both mirror the schedule row at dispatch time.
  pipeline_id        BIGINT NOT NULL REFERENCES rpa_candidate_pipeline (id) ON UPDATE CASCADE ON DELETE CASCADE,
  stage_key          VARCHAR(50) NOT NULL REFERENCES rpa_pipeline_stages (stage_key) ON UPDATE CASCADE,
  -- 'technical' (Tech1..3, CEO — the shared card) | 'hr' (HR round's own card).
  card_type          VARCHAR(20) NOT NULL DEFAULT 'technical',

  -- Recipient identity — a free-text mailbox, NOT an ATS user.
  recipient_email    VARCHAR(255) NOT NULL,
  recipient_name     VARCHAR(150),
  recipient_role     VARCHAR(20) NOT NULL DEFAULT 'interviewer', -- 'interviewer' | 'hr' | 'ceo'

  -- Single-use no-login token. gen_random_uuid() needs pgcrypto/pg13+ (already
  -- relied on by rpa_email_tracking.tracking_token).
  token              UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  token_expires_at   TIMESTAMPTZ NOT NULL,
  sent_at            TIMESTAMPTZ,
  opened_at          TIMESTAMPTZ,

  -- Shared card ratings — 0.0..5.0 in 0.5 steps.
  communication      NUMERIC(2,1),
  attitude           NUMERIC(2,1),
  final_rating       NUMERIC(2,1),
  recommendation     VARCHAR(20),  -- 'approve' | 'hold' | 'reject' (advisory; RT still decides)
  comments           TEXT,
  recording_url      TEXT,

  -- HR-card-only fields (used when card_type='hr').
  hr_notice_period   VARCHAR(100),
  hr_current_ctc     VARCHAR(100),
  hr_expected_ctc    VARCHAR(100),
  hr_relocation      VARCHAR(100),
  hr_strengths       TEXT,

  -- Submission tracking (the "who + when" requirement).
  status             VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending' | 'submitted' | 'expired'
  submitted_at       TIMESTAMPTZ,
  submitted_ip       VARCHAR(64),
  avg_score          NUMERIC(3,2), -- mean of skill ratings + communication + attitude + final, computed on submit

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scorecard_schedule       ON rpa_interview_scorecard (schedule_id);
CREATE INDEX IF NOT EXISTS idx_scorecard_pipeline       ON rpa_interview_scorecard (pipeline_id);
CREATE INDEX IF NOT EXISTS idx_scorecard_pipeline_stage ON rpa_interview_scorecard (pipeline_id, stage_key);

-- One live token per recipient per interview; a superseded/expired one does not
-- block a fresh dispatch (mirrors the "one live booking" rule on the schedule).
CREATE UNIQUE INDEX IF NOT EXISTS uq_scorecard_live_recipient
  ON rpa_interview_scorecard (schedule_id, recipient_email)
  WHERE status <> 'expired';

-- Flexible skill rows: the card renders ONE skill today, but stores skills as
-- rows so Skill 4/5 can be added later with no migration.
CREATE TABLE IF NOT EXISTS rpa_interview_scorecard_skill (
  id            BIGSERIAL PRIMARY KEY,
  scorecard_id  BIGINT NOT NULL REFERENCES rpa_interview_scorecard (id) ON UPDATE CASCADE ON DELETE CASCADE,
  skill_label   VARCHAR(150) NOT NULL,   -- e.g. "Selenium with Java" (seeded from MRF mandatory_skills, or free text)
  rating        NUMERIC(2,1),            -- 0.0..5.0 half-steps
  remark        VARCHAR(255),
  sort_order    INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_scorecard_skill_card ON rpa_interview_scorecard_skill (scorecard_id);
