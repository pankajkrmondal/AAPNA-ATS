-- ############################################################################
-- STEP 2 of the production deployment - ALL 23 FEATURE DDL FILES, IN ORDER
--
-- GENERATED FILE - do not edit. Regenerate by concatenating backend/prisma/ddl/*.sql
-- in filename order, excluding 2026-09-09-prod-parity-backfill.sql (that is STEP 3).
--
-- HOW TO RUN IN pgAdmin
--   1. Confirm the Query Tool title bar says recruitmentautomationdbProd/appuser@RPA
--   2. Open this file (folder icon) or paste the whole thing in
--   3. Press F5 (or the play arrow) ONCE - it runs the entire buffer
--   4. Watch the Messages tab, not Data Output. Success looks like a long list of
--      CREATE TABLE / ALTER TABLE / NOTICE lines ending in COMMIT.
--
-- WRAPPED IN ONE TRANSACTION ON PURPOSE. If any statement fails, the whole thing
-- rolls back and production is left exactly as it was. There is no half-applied
-- state to clean up - fix the error and run the file again from the top.
--
-- NOTICE: "relation ... already exists, skipping" is EXPECTED and harmless.
-- Every file is idempotent, so re-running is safe.
--
-- Creates 21 tables. Verify afterwards with 04-verify.sql.
-- Plan: docs/phase3/STAGING-TO-PRODUCTION-DB-AND-ONEDRIVE-PLAN.md section A.2
-- ############################################################################

BEGIN;


-- ===========================================================================
-- [1/23]  2026-07-21-pipeline-stage-engine.sql
-- ===========================================================================

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

-- ===========================================================================
-- [2/23]  2026-07-23-interview-scheduling.sql
-- ===========================================================================

-- ============================================================================
-- Phase 3 — Module 2: Interview Scheduling (Technical Rounds 1 & 2)
-- Manual DDL — apply directly to PostgreSQL, then run:
--   cd backend && npx prisma db pull && npx prisma generate
-- Per the repo's documented workflow (docs/reference/VENDOR_PROCESS.md §13):
-- the Prisma schema is NEVER hand-edited; it is introspected from the live DB.
--
-- Idempotent, additive, non-destructive — safe to run multiple times.
--
-- Backs the "Schedule Interview" action on Technical Round 1 / 2 in the
-- Pipeline Tracker drawer. The Zeko rounds keep using
-- rpa_zeko_candidate_pipeline; this table never touches those.
--
-- WHO interviews comes from the MRF (rpa_mrf.first_technical_round /
-- second_technical_round, with *_round_interview_slot as the preferred
-- window) — those are free-text names shown to the recruiter as hints, so the
-- interviewer's actual mailbox is entered per booking and stored here.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rpa_interview_schedule (
  id                  BIGSERIAL PRIMARY KEY,
  pipeline_id         BIGINT NOT NULL REFERENCES rpa_candidate_pipeline (id) ON UPDATE CASCADE ON DELETE CASCADE,
  stage_key           VARCHAR(50) NOT NULL REFERENCES rpa_pipeline_stages (stage_key) ON UPDATE CASCADE,

  -- Interviewer(s) as booked. `interviewer_name` defaults to the MRF's
  -- free-text owner (e.g. "Naveen"); `interviewer_email` holds one or more
  -- mailboxes, comma-separated (a panel can be two or three people), and is
  -- who the invite and reminder are actually sent to. TEXT rather than
  -- VARCHAR(255) so a larger panel never overflows the column.
  interviewer_name    VARCHAR(150),
  interviewer_email   TEXT,

  scheduled_start_at  TIMESTAMPTZ NOT NULL,
  scheduled_end_at    TIMESTAMPTZ NOT NULL,
  status              VARCHAR(30) NOT NULL DEFAULT 'scheduled', -- scheduled | completed | cancelled
  notes               TEXT,

  -- Populated only when the Microsoft Graph calendar integration is enabled
  -- (config.microsoft.calendarEnabled). NULL means the booking was saved and
  -- emailed without an Outlook event / Teams meeting.
  graph_event_id      VARCHAR(512),
  teams_join_url      TEXT,

  invite_sent_at          TIMESTAMPTZ,
  candidate_reminded_at   TIMESTAMPTZ,
  interviewer_reminded_at TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  cancel_reason       TEXT,
  created_by          INTEGER REFERENCES rpa_users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interview_schedule_pipeline ON rpa_interview_schedule (pipeline_id);
CREATE INDEX IF NOT EXISTS idx_interview_schedule_stage    ON rpa_interview_schedule (pipeline_id, stage_key);
CREATE INDEX IF NOT EXISTS idx_interview_schedule_status   ON rpa_interview_schedule (status);
-- Drives the reminder sweep over upcoming interviews.
CREATE INDEX IF NOT EXISTS idx_interview_schedule_start    ON rpa_interview_schedule (scheduled_start_at)
  WHERE status = 'scheduled';

-- Only ONE live booking per candidate-round at a time. Reschedule is
-- cancel-then-recreate (the rule the Zeko flow already follows), so cancelled
-- rows remain as history without blocking a new booking.
CREATE UNIQUE INDEX IF NOT EXISTS uq_interview_schedule_live
  ON rpa_interview_schedule (pipeline_id, stage_key)
  WHERE status <> 'cancelled';

-- Widen interviewer_email for multi-interviewer panels. Only matters where an
-- earlier revision of this file already created the column as VARCHAR(255);
-- a no-op on a fresh table created above (TEXT to TEXT).
ALTER TABLE rpa_interview_schedule ALTER COLUMN interviewer_email TYPE TEXT;

-- ===========================================================================
-- [3/23]  2026-07-24-assessment-import.sql
-- ===========================================================================

-- ============================================================================
-- Phase 3 — Module 2: Evalground Bulk-CSV Import
-- Manual DDL — apply directly to PostgreSQL, then run:
--   cd backend && npx prisma db pull && npx prisma generate
-- Per docs/reference/VENDOR_PROCESS.md §13 / the 2026-07-21 DDL precedent:
-- schema.prisma is NEVER hand-edited; it is introspected from the live DB.
--
-- Scope: bulk-CSV import only (Phase 3 M2 decision, 2026-07-24). The
-- `mechanism` column below is kept for forward-compat with the deferred
-- single-result Outlook-mailbox path (see docs/phase3/07-EVALGROUND-IMPORT-PLAN.md
-- §3) but only 'bulk_csv' is ever written by this build.
--
-- Idempotent, additive, non-destructive — safe to run multiple times.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) rpa_assessment_imports — one row per import batch/event
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpa_assessment_imports (
  id                      BIGSERIAL PRIMARY KEY,
  mechanism               VARCHAR(20) NOT NULL DEFAULT 'bulk_csv', -- bulk_csv | single_outlook (latter unused this pass)
  source_message_id       VARCHAR(255), -- Graph message id; NULL for bulk_csv, reserved for the deferred mailbox path
  file_name               VARCHAR(500),
  raw_file_url            TEXT, -- OneDrive URL (falls back to local /uploads path, mirrors hrUpload.service.js's onedriveUrl fallback)
  uploaded_by             VARCHAR(255), -- username, mirrors rpa_upload_batch_summary.uploaded_by
  uploaded_by_id          INTEGER REFERENCES rpa_users (id) ON UPDATE NO ACTION ON DELETE SET NULL,
  uploaded_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_rows              INTEGER NOT NULL DEFAULT 0,
  matched_count           INTEGER NOT NULL DEFAULT 0,
  unmatched_count         INTEGER NOT NULL DEFAULT 0,
  duplicate_skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count             INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_assessment_imports_msg
  ON rpa_assessment_imports (source_message_id) WHERE source_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assessment_imports_uploaded_at ON rpa_assessment_imports (uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessment_imports_mechanism ON rpa_assessment_imports (mechanism);

-- ----------------------------------------------------------------------------
-- 2) rpa_assessment_test_mappings — remembered section→skill mapping, keyed by
--    exact test name (derived from the uploaded file name — the real sample
--    file has no per-row "Test Name" column, see docs/phase3/07-EVALGROUND-IMPORT-PLAN.md
--    §2 vs. the actual verified format). Without this table, "remembered by
--    exact test name" (doc 07 §2) has nowhere to live.
--
--    No company_id: no candidate-domain table in this schema (rpa_cv,
--    rpa_mrf, rpa_shortlisted_candidates, rpa_candidate_pipeline) carries
--    tenant scoping today — only rpa_users/rpa_sessions do.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpa_assessment_test_mappings (
  id                BIGSERIAL PRIMARY KEY,
  test_name         TEXT NOT NULL, -- derived from the uploaded file name, trimmed
  section_label_map JSONB NOT NULL, -- { "section_1": {"skill_label": "...", "legacy_field": "IQScore"|"TechScore"|null}, "section_2": {...}, "section_3": {...} }
  confirmed_by      VARCHAR(255),
  confirmed_by_id   INTEGER REFERENCES rpa_users (id) ON UPDATE NO ACTION ON DELETE SET NULL,
  confirmed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_import_id   BIGINT REFERENCES rpa_assessment_imports (id) ON UPDATE NO ACTION ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_assessment_test_mappings_name ON rpa_assessment_test_mappings (test_name);

-- ----------------------------------------------------------------------------
-- 3) rpa_assessment_results — one row per candidate-per-test-cycle result
--
--    pipeline_id is NULLABLE — required to durably record a genuinely
--    unmatched row, or a multi-open-journey row nobody manually picked,
--    instead of silently dropping it.
--
--    Deliberately NO unique constraint on (email_matched, test_name): a
--    candidate can legitimately have more than one historical result for the
--    same email+test across separate hiring cycles years apart (rejection +
--    6-month cooling-off + reapply). Retake/skip-unless-changed dedup is
--    scoped to (pipeline_id, test_name) at the service layer instead.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpa_assessment_results (
  id                 BIGSERIAL PRIMARY KEY,
  import_id          BIGINT NOT NULL REFERENCES rpa_assessment_imports (id) ON UPDATE NO ACTION ON DELETE CASCADE,
  pipeline_id        BIGINT REFERENCES rpa_candidate_pipeline (id) ON UPDATE NO ACTION ON DELETE SET NULL,
  cv_id              BIGINT,
  test_name          TEXT NOT NULL,
  section_label_map  JSONB NOT NULL, -- confirmed mapping ACTUALLY APPLIED to this row (frozen copy, not a live FK)
  section_1_score    NUMERIC(8,2), -- raw marks, not a percentage (verified against the real sample file)
  section_2_score    NUMERIC(8,2),
  section_3_score    NUMERIC(8,2),
  overall_percentage NUMERIC(6,2), -- Evalground's own overall Percentage column
  overall_result     VARCHAR(30), -- Evalground's own overall Result column (e.g. 'Passed') — drives the suggested outcome
  email_matched      VARCHAR(255) NOT NULL,
  match_note         TEXT, -- e.g. why a multi-journey candidate was auto-matched to this pipeline_id, or why unmatched
  source_row_number  INTEGER,
  status             VARCHAR(30) NOT NULL DEFAULT 'matched', -- matched | unmatched | duplicate_skipped | score_overwritten | error
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assessment_results_import    ON rpa_assessment_results (import_id);
CREATE INDEX IF NOT EXISTS idx_assessment_results_pipeline  ON rpa_assessment_results (pipeline_id);
CREATE INDEX IF NOT EXISTS idx_assessment_results_email     ON rpa_assessment_results (email_matched);
CREATE INDEX IF NOT EXISTS idx_assessment_results_pipe_test ON rpa_assessment_results (pipeline_id, test_name);
CREATE INDEX IF NOT EXISTS idx_assessment_results_status    ON rpa_assessment_results (status);

-- ===========================================================================
-- [4/23]  2026-07-25-assessment-invites.sql
-- ===========================================================================

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

-- ===========================================================================
-- [5/23]  2026-07-25-interviewer-scorecard.sql
-- ===========================================================================

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

-- ===========================================================================
-- [6/23]  2026-07-25-interview-occurrence.sql
-- ===========================================================================

-- ============================================================================
-- Phase 3 — Module 3 (part 1 of 2): Interview OCCURRENCE tracking
-- Manual DDL — apply directly to PostgreSQL, then run:
--   cd backend && npx prisma db pull && npx prisma generate
-- Per the repo's documented workflow (docs/reference/VENDOR_PROCESS.md §13):
-- the Prisma schema is NEVER hand-edited; it is introspected from the live DB.
--
-- Idempotent, additive, non-destructive — safe to run multiple times.
--
-- WHY: a scheduled interview may never actually happen (candidate no-show,
-- panel busy, network failure). The booking still reads status='scheduled' and
-- scheduled_end_at still passes on the clock, so we must NOT release the
-- interviewer scorecard link on the end time alone. These columns record
-- whether the interview OCCURRED, so the scorecard is only ever sent for a
-- confirmed 'held' interview. See docs/phase3/INTERVIEWER-SCORECARD-PLAN.md.
--
-- No new status enum: rpa_interview_schedule.status is a plain VARCHAR(30) with
-- no CHECK constraint, so it gains 'completed' (held) and 'no_show' alongside
-- the existing 'scheduled' / 'cancelled' with no migration — the app writes
-- them. occurrence_status is the parallel semantic flag the app branches on.
-- ============================================================================

ALTER TABLE rpa_interview_schedule
  -- Teams onlineMeeting id (distinct from graph_event_id): the path segment the
  -- Graph attendanceReports endpoint needs. Captured at booking when the
  -- calendar integration is on; NULL otherwise (falls back to a JoinWebUrl
  -- lookup or human confirmation).
  ADD COLUMN IF NOT EXISTS online_meeting_id        VARCHAR(512),

  -- The occurrence verdict. NULL = unresolved (still waiting to know if it
  -- happened); 'held' => set status='completed' and release the scorecard;
  -- 'no_show' => set status='no_show' and never release a scorecard.
  ADD COLUMN IF NOT EXISTS occurrence_status        VARCHAR(20),
  -- How the verdict was reached: 'graph' (Teams attendance report),
  -- 'recruiter' (ATS button), or 'interviewer' (no-login gate link).
  ADD COLUMN IF NOT EXISTS occurrence_source        VARCHAR(20),
  -- Who confirmed it: an ATS username (recruiter) or an interviewer email.
  ADD COLUMN IF NOT EXISTS occurrence_confirmed_by  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS occurrence_confirmed_at  TIMESTAMPTZ,

  -- No-show detail (only when occurrence_status='no_show').
  -- party: 'candidate' | 'panel' | 'both' | 'technical' (network/other).
  ADD COLUMN IF NOT EXISTS no_show_party            VARCHAR(20),
  ADD COLUMN IF NOT EXISTS no_show_reason           TEXT,

  -- Idempotency guards for the occurrence sweep job (jobs/interviewOccurrence.js):
  --   occurrence_nudge_at  — a "please confirm it happened" nudge was sent once.
  --   attendance_checked_at — last Graph attendance poll (so a still-pending
  --                           report is retried but a decided one is not re-read).
  ADD COLUMN IF NOT EXISTS occurrence_nudge_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attendance_checked_at    TIMESTAMPTZ,

  -- The single-fire guard for scorecard dispatch: once the tokenized links have
  -- been created + emailed for this interview, both the manual button and the
  -- sweep short-circuit. Guarantees "send exactly once".
  ADD COLUMN IF NOT EXISTS scorecard_dispatched_at  TIMESTAMPTZ;

-- Drives the occurrence sweep: unresolved bookings whose window has ended.
CREATE INDEX IF NOT EXISTS idx_interview_schedule_occurrence
  ON rpa_interview_schedule (scheduled_end_at)
  WHERE status = 'scheduled' AND occurrence_status IS NULL;

-- ===========================================================================
-- [7/23]  2026-07-25-teams-meeting-details.sql
-- ===========================================================================

-- ============================================================================
-- Phase 3 — Module 2 addendum: persist Teams dial-in Meeting ID + Passcode
-- Manual DDL — apply then: cd backend && npx prisma db pull && npx prisma generate
-- Idempotent, additive, non-destructive.
--
-- WHY: the Outlook event-create response returns only the Teams Join URL, so
-- the invite emails to the candidate + interviewer previously showed only a
-- Join link. To mirror the Outlook meeting block (Join link + Meeting ID +
-- Passcode) in the emails, we fetch those from the onlineMeeting resource and
-- store them on the booking so schedule AND reschedule emails can render them.
-- ============================================================================

ALTER TABLE rpa_interview_schedule
  ADD COLUMN IF NOT EXISTS teams_meeting_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS teams_passcode   VARCHAR(64);

-- ===========================================================================
-- [8/23]  2026-07-29-document-collection.sql
-- ===========================================================================

-- ============================================================================
-- Phase 3 — Module 4: Document Collection
-- Manual DDL — apply directly to PostgreSQL, then run:
--   cd backend && npx prisma db pull && npx prisma generate
-- Per the repo's documented workflow: the Prisma schema is NEVER hand-edited;
-- it is introspected from the live DB.
--
-- Idempotent, additive, non-destructive — safe to run multiple times.
-- Apply AFTER 2026-07-21-pipeline-stage-engine.sql.
--
-- Fires after the final interview rounds clear and before the offer goes out:
-- HR triggers the request -> the candidate uploads via a no-login tokenized
-- link -> HR verifies each document (or rejects it with a reason, which
-- re-opens that one item for re-upload).
--
-- RETENTION (RT-confirmed 2026-07-14): documents are NEVER deleted. Records get
-- pulled up to 3 years later for appraisals. There is deliberately no hard
-- delete or expiry job anywhere in this module.
-- ============================================================================

-- The checklist is DATA, not code, so the list can change without a redeploy.
-- Seeded (see prisma/seed-document-checklist.js) with the list from Chhaya's
-- 2026-07-14 request template, which is narrower than the older 4-item draft.
CREATE TABLE IF NOT EXISTS rpa_document_checklist_items (
  id          SERIAL PRIMARY KEY,
  item_key    VARCHAR(60) NOT NULL UNIQUE,
  label       VARCHAR(255) NOT NULL,
  description TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One request per journey. Re-requesting reuses the row (and its token) so a
-- candidate never ends up with two live upload links for the same journey.
CREATE TABLE IF NOT EXISTS rpa_document_requests (
  id               BIGSERIAL PRIMARY KEY,
  pipeline_id      BIGINT NOT NULL UNIQUE
                     REFERENCES rpa_candidate_pipeline (id) ON UPDATE CASCADE ON DELETE CASCADE,

  -- No-login upload link. gen_random_uuid() needs pgcrypto/pg13+ (already relied
  -- on by rpa_email_tracking.tracking_token).
  token            UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  token_status     VARCHAR(20) NOT NULL DEFAULT 'active',  -- 'active' | 'closed'

  requested_by     INT REFERENCES rpa_users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_reminded_at TIMESTAMPTZ,
  reminder_count   INT NOT NULL DEFAULT 0,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per checklist item per request — created up front in 'pending' so the
-- candidate's upload page and HR's verification table render the same list.
CREATE TABLE IF NOT EXISTS rpa_candidate_documents (
  id                BIGSERIAL PRIMARY KEY,
  request_id        BIGINT NOT NULL REFERENCES rpa_document_requests (id) ON UPDATE CASCADE ON DELETE CASCADE,
  checklist_item_id INT NOT NULL REFERENCES rpa_document_checklist_items (id) ON UPDATE CASCADE,

  -- OneDrive webUrl returned by uploadFileToOneDrive(); the file itself lives in
  -- "Document Collection/<candidate name (cv id)>/" under the same parent folder
  -- resumes already use. Null until the candidate uploads.
  file_url          TEXT,
  original_name     VARCHAR(255),
  uploaded_at       TIMESTAMPTZ,

  status            VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending' | 'uploaded' | 'verified' | 'rejected'
  remarks           TEXT,        -- the reason on a rejection, shown to the candidate
  verified_by       INT REFERENCES rpa_users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  verified_at       TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidate_documents_request ON rpa_candidate_documents (request_id);

-- One row per checklist item per request; a re-upload overwrites in place rather
-- than stacking rows, so the checklist stays one line per document.
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_document_item
  ON rpa_candidate_documents (request_id, checklist_item_id);

-- ===========================================================================
-- [9/23]  2026-07-29-hr-scorecard-fields.sql
-- ===========================================================================

-- ============================================================================
-- Phase 3 — HR Round scorecard: full field parity with the legacy workbook
-- Manual DDL — apply directly to PostgreSQL, then run:
--   cd backend && npx prisma db pull && npx prisma generate
-- Per the repo's documented workflow: the Prisma schema is NEVER hand-edited;
-- it is introspected from the live DB.
--
-- Idempotent, additive, non-destructive — safe to run multiple times.
-- Apply AFTER 2026-07-25-interviewer-scorecard.sql.
--
-- The HR Round sheet of docs/Interview Evaluation Format V2.xlsx (the MS Forms
-- + Power Automate process this replaces) collects ~16 fields; the original
-- table shipped with 5. These 10 columns close that gap so nothing HR used to
-- capture is lost in the move into the ATS.
--
-- Note on the two *_comments columns: the shared `communication`/`attitude`
-- NUMERIC ratings are reused as-is, but the workbook keeps their free-text
-- comments separate from "Final Comments" (the shared `comments` column), so
-- each needs its own column rather than being folded into `comments`.
--
-- "CTC and ETC" is one cell in the workbook but stays split across the existing
-- hr_current_ctc / hr_expected_ctc columns here — cleaner to report on.
-- ============================================================================

ALTER TABLE rpa_interview_scorecard
  ADD COLUMN IF NOT EXISTS hr_family_background     TEXT,
  ADD COLUMN IF NOT EXISTS hr_general_other         TEXT,
  ADD COLUMN IF NOT EXISTS hr_timings               VARCHAR(255),
  ADD COLUMN IF NOT EXISTS hr_communication_comments TEXT,
  ADD COLUMN IF NOT EXISTS hr_attitude_comments     TEXT,
  ADD COLUMN IF NOT EXISTS hr_weakness              TEXT,
  ADD COLUMN IF NOT EXISTS hr_only_negative         TEXT,
  ADD COLUMN IF NOT EXISTS hr_other_observation     TEXT,
  ADD COLUMN IF NOT EXISTS hr_final_feedback        TEXT,
  ADD COLUMN IF NOT EXISTS hr_next_step             TEXT;

-- ===========================================================================
-- [10/23]  2026-07-29-offer-management.sql
-- ===========================================================================

-- ============================================================================
-- Phase 3 — Module 5: Offer Management
-- Manual DDL — apply directly to PostgreSQL, then run:
--   cd backend && npx prisma db pull && npx prisma generate
-- Per the repo's documented workflow: the Prisma schema is NEVER hand-edited;
-- it is introspected from the live DB.
--
-- Idempotent, additive, non-destructive — safe to run multiple times.
-- Apply AFTER 2026-07-21-pipeline-stage-engine.sql.
--
-- RECORD-ONLY scope (Q3, reinforced by RT 2026-07-14): appointment/offer letters
-- are prepared and shared by HR entirely outside the ATS. This table therefore
-- stores no letter file and no letter URL — only the dates, the internal
-- approval, and the candidate's decision. Closure itself is NOT here: it stays
-- on rpa_candidate_pipeline.final_outcome via setFinalOutcome().
-- ============================================================================

CREATE TABLE IF NOT EXISTS rpa_offers (
  id                    BIGSERIAL PRIMARY KEY,
  -- One offer per journey; re-offers overwrite rather than accumulate (RT: no
  -- version tracking — revisions are handled manually outside the ATS).
  pipeline_id           BIGINT NOT NULL UNIQUE
                          REFERENCES rpa_candidate_pipeline (id) ON UPDATE CASCADE ON DELETE CASCADE,

  -- Internal approval before an offer goes out. A SOFT gate (Q26): recording
  -- "shared" without approval is allowed for exceptional cases, so this is a
  -- record of what happened, not an enforced state machine.
  approval_status       VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending' | 'approved'
  approval_requested_at TIMESTAMPTZ,
  approval_nudged_at    TIMESTAMPTZ,   -- last daily reminder (idempotency for the nudge job)
  approved_by           INT REFERENCES rpa_users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  approved_at           TIMESTAMPTZ,

  -- The offer itself, as recorded after HR shares it from their own mailbox.
  shared_at             TIMESTAMPTZ,
  shared_by             INT REFERENCES rpa_users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  joining_date          DATE,

  -- The candidate's answer.
  candidate_decision    VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'rejected'
  decision_at           TIMESTAMPTZ,

  remarks               TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drives the daily approval-nudge sweep: "approval requested but not approved".
CREATE INDEX IF NOT EXISTS idx_offers_awaiting_approval
  ON rpa_offers (approval_requested_at)
  WHERE approval_status = 'pending';

-- Drives the 90-day post-Joined auto-close sweep (Q12).
CREATE INDEX IF NOT EXISTS idx_offers_joining_date
  ON rpa_offers (joining_date)
  WHERE candidate_decision = 'accepted';

-- ===========================================================================
-- [11/23]  2026-07-31-notifications.sql
-- ===========================================================================

-- ============================================================================
-- Phase 3 — Notification Centre
-- Manual DDL — apply directly to PostgreSQL, then run:
--   cd backend && npx prisma db pull && npx prisma generate
-- Per the repo's documented workflow: the Prisma schema is NEVER hand-edited;
-- it is introspected from the live DB.
--
-- Idempotent, additive, non-destructive — safe to run multiple times.
-- Apply AFTER 2026-07-21-pipeline-stage-engine.sql.
--
-- Replaces the in-memory header bell. Until now a notification existed only in
-- one browser tab's React state: it vanished on refresh, and a recruiter who was
-- logged out when it fired never saw it at all. Rows here survive both.
--
-- FAN-OUT ON WRITE: one row per recipient per event, rather than one event row
-- plus a join table for per-user read state. The recruitment team is a handful
-- of people, so duplicating a short text row keeps every read a plain
-- "WHERE user_id = $1" with no join, and marking one read is a single UPDATE.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rpa_notifications (
  id           BIGSERIAL PRIMARY KEY,

  -- The recipient. Deleting a user takes their inbox with them.
  user_id      INT NOT NULL REFERENCES rpa_users (id) ON UPDATE CASCADE ON DELETE CASCADE,

  -- Event key, e.g. 'pipeline.outcome' / 'document.uploaded'. Deliberately free
  -- text (no enum/CHECK) so a new event type is a code change, not a migration —
  -- the same choice rpa_interview_schedule.status made.
  type         VARCHAR(60) NOT NULL,

  title        VARCHAR(255) NOT NULL,
  description  TEXT,

  -- Deep-link target. pipeline_id is the candidate journey the notification is
  -- about (nullable: not every event has one, e.g. mrf.closed); link_path is the
  -- precomputed route the bell navigates to, e.g. '/pipeline?candidate=123'.
  pipeline_id  BIGINT REFERENCES rpa_candidate_pipeline (id) ON UPDATE CASCADE ON DELETE SET NULL,
  link_path    VARCHAR(255),

  -- Anything the renderer wants that isn't worth a column (outcome key, stage
  -- label, counts…).
  meta         JSONB,

  -- NULL = unread. A timestamp rather than a boolean so "when did they see it"
  -- is answerable later without another column.
  read_at      TIMESTAMPTZ,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The inbox query: newest first for one user.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON rpa_notifications (user_id, created_at DESC);

-- The unread badge — partial, so it stays small as read rows accumulate.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON rpa_notifications (user_id)
  WHERE read_at IS NULL;

-- ===========================================================================
-- [12/23]  2026-08-11-mrf-filled-at.sql
-- ===========================================================================

-- ============================================================================
-- Requisitions — separate "filled" from "approved"
-- Manual DDL — apply directly to PostgreSQL, then run:
--   cd backend && npx prisma db pull && npx prisma generate
-- Per the repo's documented workflow: the Prisma schema is NEVER hand-edited;
-- it is introspected from the live DB.
--
-- Idempotent, additive, non-destructive — safe to run multiple times.
--
-- WHY
-- ---
-- "All openings are filled" was being expressed by OVERWRITING two status
-- columns that mean something else, saving neither prior value:
--
--   1. rpa_mrf.approval_status  -> 'closed', restored to a hardcoded
--      'approved' on re-open. But 'completed' is the most common status in
--      practice, and getApprovedRoles() treats the two differently:
--          approval_status = 'approved'
--       OR (approval_status = 'completed' AND approved_by_abhijit IN ('approved','true'))
--      So a 'completed' requisition that filled and later re-opened came back
--      as 'approved' — permanently escaping the approved_by_abhijit gate.
--
--   2. rpa_mrf_jd_send.mrfstatus -> 'closed'. That column is the protected
--      "raise status" workflow field (pendingfromleader / managersubmitted /
--      …) which the MRF page FILTERS and DISPLAYS on, and which
--      mrf.controller.js documents as "intentionally NOT accepted" from user
--      edits. The write was an updateMany on a loose, non-FK mrf_id, so a
--      single requisition could rewrite dozens of unrelated request rows.
--
-- Approved and Filled are independent facts. This column stores the second one
-- so neither status column is ever written by the closure path again.
-- ============================================================================

-- When every opening on this requisition was filled. NULL = still hiring.
-- Nullable rather than a boolean so the moment it filled is auditable, and so
-- re-opening is a plain "set back to NULL".
ALTER TABLE rpa_mrf
  ADD COLUMN IF NOT EXISTS filled_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN rpa_mrf.filled_at IS
  'When all openings were filled (NULL = still hiring). Set/cleared by mrfClosure.service.js. Independent of approval_status, which must never be overwritten to express fill state.';

-- Every hot read is "still hiring?" (JD dropdown, dashboard active tile), so
-- index the NULL side only — the filled rows are the minority and are not the
-- ones being scanned.
CREATE INDEX IF NOT EXISTS idx_rpa_mrf_open
  ON rpa_mrf (id)
  WHERE filled_at IS NULL;

-- ----------------------------------------------------------------------------
-- Backfill for environments that already ran the lossy closure path.
--
-- Any requisition sitting in approval_status='closed' was closed by the old
-- code. Record that it is filled, but DELIBERATELY LEAVE approval_status
-- ALONE: its true prior value ('approved' vs 'completed') was destroyed at
-- closure time and is unrecoverable. Guessing would repeat the original
-- mistake. See the README — these rows need a human to set the right status.
--
-- getApprovedRoles() whitelists only 'approved'/'completed', so they stay
-- correctly out of JD filtering in the meantime.
-- ----------------------------------------------------------------------------
-- NB: rpa_mrf has created_at but no modified_at, so the closure moment cannot
-- be recovered from the row itself — created_at is the closest honest floor.
UPDATE rpa_mrf
   SET filled_at = COALESCE(created_at, NOW())
 WHERE approval_status = 'closed'
   AND filled_at IS NULL;

-- ===========================================================================
-- [13/23]  2026-08-12-vendor-status-templates.sql
-- ===========================================================================

-- ----------------------------------------------------------------------------
-- Phase 3 Module 6 — Placement Vendor Completion & Hardening
-- 2026-08-12
--
-- Idempotent, additive, non-destructive. Creates no tables: everything M6 needs
-- already exists (rpa_candidate_pipeline.source / .vendor_email,
-- rpa_cv.VendorEmail / .lockForNinetyDays). The only blocker is a CHECK
-- constraint that would reject the new vendor-facing template category.
--
-- Run BEFORE `npm run seed:templates:<env>`, then `npx prisma db pull` +
-- `npx prisma generate` (no schema change here, but keep the habit).
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 1) Pre-flight: extend rpa_email_templates.category for 'vendor_status'
--    Same constraint the stage-engine DDL rewrote on 2026-07-21; this re-states
--    the full allowed set with 'vendor_status' appended, so running the two in
--    either order converges on the same list.
-- ----------------------------------------------------------------------------
ALTER TABLE rpa_email_templates DROP CONSTRAINT IF EXISTS rpa_email_templates_category_check;
ALTER TABLE rpa_email_templates ADD CONSTRAINT rpa_email_templates_category_check
  CHECK (category = ANY (ARRAY[
    'general'::text, 'shortlist'::text, 'interview'::text, 'offer'::text,
    'rejection'::text, 'follow_up'::text, 'onboarding'::text,
    'stage_outcome'::text, 'vendor_status'::text
  ]));

-- ----------------------------------------------------------------------------
-- 2) Vendor-ownership lookup index
--    createPipelineJourney() now reads (VendorEmail, lockForNinetyDays) for
--    every candidate it shortlists, and the Vendor Dashboard scopes its whole
--    join on VendorEmail. Both are point lookups on a table that grows without
--    bound.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rpa_cv_vendor_lock
  ON rpa_cv ("VendorEmail", "lockForNinetyDays")
  WHERE "VendorEmail" IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3) Journey-by-candidate index for the Vendor Dashboard's stage column
--    vendorPipelineByCvId() looks journeys up by cv_id, newest first.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_candidate_pipeline_cv_modified
  ON rpa_candidate_pipeline (cv_id, modified_at DESC);

-- ----------------------------------------------------------------------------
-- 4) rpa_upload_jobs.advisory — recruiter-facing context on a row that did NOT
--    fail. Currently the cooling-off notice: "this candidate was rejected in
--    March and is still inside the 6-month re-application window."
--
--    Separate from error_message on purpose. error_message means the upload
--    went wrong; advisory means it went fine and there is something the person
--    making the Merge/Cancel call should know first. Overloading error_message
--    would have made a healthy duplicate render as a failure everywhere the
--    two dashboards colour by it.
-- ----------------------------------------------------------------------------
ALTER TABLE rpa_upload_jobs ADD COLUMN IF NOT EXISTS advisory TEXT;

-- ----------------------------------------------------------------------------
-- 5) Seed the two vendor flow-key recipient rows so the admin Flow Keys screen
--    lists them from the start. Both are dynamic (resolved to the owning vendor
--    at send time), so the empty static `to` is correct, not a gap.
-- ----------------------------------------------------------------------------
INSERT INTO rpa_settings (key, value)
VALUES ('email_recipients.vendorStatus.to', ''),
       ('email_recipients.vendorStatus.cc', '')
ON CONFLICT (key) DO NOTHING;

-- ===========================================================================
-- [14/23]  2026-08-26-mrf-manual-closure.sql
-- ===========================================================================

-- ============================================================================
-- Requisitions — manual closure, with a reason
-- Manual DDL — apply directly to PostgreSQL, then run:
--   cd backend && npx prisma db pull && npx prisma generate
-- Per the repo's documented workflow: the Prisma schema is NEVER hand-edited;
-- it is introspected from the live DB.
--
-- Idempotent, additive, non-destructive — safe to run multiple times.
--
-- WHY
-- ---
-- A requisition cancelled by the BUSINESS — budget pulled, role withdrawn,
-- filled by an external agency — had no representation in the system at all:
--
--   * there is no manual close endpoint (mrf.routes.js has none);
--   * the MRF page renders its status Select as `disabled`;
--   * fill state is written only by the automatic offer-acceptance path; and
--   * `grep -E 'closure_reason|reason_for_closure'` returned ZERO hits
--     repo-wide, so even the AUTOMATIC closure recorded *when* but never *why*.
--
-- Such a requisition therefore sat open in the JD dropdown forever, and a
-- recruiter had no way to say what had happened to it.
-- Logged as audit §2.6, filed as Q34, answered "yes — action + reason".
--
-- WHY NOT REUSE filled_at
-- -----------------------
-- A cancelled requisition was NOT filled, and filled_at's own column comment
-- says exactly that. Two further reasons make separate columns the safer shape:
--
--   1. reopenMrfIfUnfilled() clears ONLY filled_at. With a separate closed_at,
--      a candidate backing out can never silently resurrect a requisition the
--      business deliberately cancelled. Merging the two would need a new guard
--      to get that invariant back.
--   2. "Openings Filled: YES/NO" (mrfDetail.export.js) stays truthful, because
--      isMrfFilled() keeps meaning what its name says. The wider "is this still
--      hiring?" question moves to isMrfClosed().
-- ============================================================================

-- When a human closed this requisition, and why. NULL = not manually closed.
-- Independent of filled_at: a requisition is out of JD filtering if EITHER is
-- set, which is what isMrfClosed() (config/pipelineStages.js) encapsulates.
ALTER TABLE rpa_mrf
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ NULL;

-- Controlled vocabulary, written by BOTH closure paths:
--   all_openings_filled   -- written automatically by closeMrfIfFilled()
--   budget_withdrawn
--   role_withdrawn
--   hired_externally
--   on_hold_indefinitely
--   other                 -- requires closure_note
--
-- Deliberately NOT a CHECK constraint or an enum: every other status column in
-- this schema is a plain VARCHAR, and a CHECK is what makes adding a value a
-- migration instead of a config edit. The vocabulary lives in
-- config/pipelineStages.js and is validated in the service.
ALTER TABLE rpa_mrf
  ADD COLUMN IF NOT EXISTS closure_reason VARCHAR(50) NULL;

-- Free text for the 'other' reason, and optional colour on any of the rest.
-- Without this, 'other' records that something happened but not what — which
-- is the same gap this change set exists to close, one level down.
ALTER TABLE rpa_mrf
  ADD COLUMN IF NOT EXISTS closure_note TEXT NULL;

COMMENT ON COLUMN rpa_mrf.closed_at IS
  'When a human manually closed this requisition (NULL = not manually closed). Set/cleared by mrf.service.js. Independent of filled_at, which means "all openings filled"; a requisition leaves JD filtering if EITHER is set — ask isMrfClosed().';

COMMENT ON COLUMN rpa_mrf.closure_reason IS
  'Why this requisition closed. Written by BOTH paths: closeMrfIfFilled() stamps all_openings_filled, a manual close stamps the recruiter''s choice. Vocabulary lives in config/pipelineStages.js (MRF_CLOSURE_REASONS) — no CHECK constraint, so adding a value is a config edit and not a migration.';

COMMENT ON COLUMN rpa_mrf.closure_note IS
  'Free-text detail for the closure, required when closure_reason = ''other''.';

-- The hot read is "still hiring?" — the JD dropdown (getApprovedRoles), the
-- dashboard active tile, the pipeline board card. Both closure signals must be
-- absent, so the partial index is widened to match the new predicate.
-- Dropped and recreated rather than left alone: a partial index whose WHERE no
-- longer matches the query's WHERE is simply not used.
DROP INDEX IF EXISTS idx_rpa_mrf_open;
CREATE INDEX IF NOT EXISTS idx_rpa_mrf_open
  ON rpa_mrf (id)
  WHERE filled_at IS NULL AND closed_at IS NULL;

-- ----------------------------------------------------------------------------
-- Backfill: the automatic path's reason, retrospectively.
--
-- Every row already carrying filled_at was closed by closeMrfIfFilled(), so its
-- reason is known with certainty. Stamping it means the column is complete from
-- day one rather than only for closures made after this deploy — otherwise
-- "why did this close?" stays unanswerable for every historical requisition.
--
-- closed_at is deliberately NOT backfilled: these were filled, not manually
-- closed, and conflating the two would make isMrfFilled() and isMrfClosed()
-- indistinguishable on exactly the rows that prove they differ.
-- ----------------------------------------------------------------------------
UPDATE rpa_mrf
   SET closure_reason = 'all_openings_filled'
 WHERE filled_at IS NOT NULL
   AND closure_reason IS NULL;

-- ===========================================================================
-- [15/23]  2026-08-26-shortlist-status-vocabulary.sql
-- ===========================================================================

-- ============================================================================
-- rpa_shortlisted_candidates.pipeline_status — widen the CHECK vocabulary
-- Manual DDL — apply directly to PostgreSQL, then run:
--   cd backend && npx prisma db pull && npx prisma generate
-- (No Prisma schema change results — a CHECK constraint is not introspected —
--  but the pull keeps the checked-in schema honest.)
--
-- Idempotent, additive, non-destructive — safe to run multiple times.
--
-- WHY
-- ---
-- 2026-07-21-pipeline-stage-engine.README.md states, in bold:
--
--   "Confirmed, no DDL needed: rpa_shortlisted_candidates.pipeline_status is a
--    plain VARCHAR(50) with no CHECK constraint in the current staging DB — the
--    planned future_prospect value can be written immediately."
--
-- That is FALSE. rpa_shortlisted_candidates_pipeline_status_check exists and
-- permits only 14 values, none of which is future_prospect. Two live bugs
-- followed, both SILENT because every writer of this column is a best-effort
-- legacy write-back wrapped in try/catch:
--
--   1. future_prospect (since 2026-07-21). shortlistStatusFor() returns it and
--      setStageOutcome writes it, so a recruiter picking "Future Prospect" has
--      always had that write rejected and logged, never applied. Staging proves
--      it: 79 shortlisted / 21 rejected / 2 on_hold, and ZERO future_prospect.
--   2. The closure statuses (2026-08-26, audit §2.4). setFinalOutcome writes
--      hired / withdrawn / backed_out / did_not_join / joined_and_left, five of
--      which the constraint rejects — so closure could not move a candidate off
--      'shortlisted', which is the exact defect §2.4 set out to fix.
--
-- The decision to use distinct closure values (audit §6a) was taken on the
-- README's false premise. Widening the constraint keeps that decision intact
-- and fixes the older future_prospect bug in the same pass.
--
-- NOTE ON 'hired' vs 'joined': both are kept. 'joined' is part of the original
-- legacy vocabulary and is already counted as a hire by dashboard.service.js;
-- 'hired' is what shortlistStatusFor() writes for HIRED_OUTCOMES (joined +
-- closure_approved) and is likewise counted there. Neither is removed, because
-- dropping a permitted value could invalidate rows written before this ran.
-- ============================================================================

ALTER TABLE rpa_shortlisted_candidates
  DROP CONSTRAINT IF EXISTS rpa_shortlisted_candidates_pipeline_status_check;

ALTER TABLE rpa_shortlisted_candidates
  ADD CONSTRAINT rpa_shortlisted_candidates_pipeline_status_check
  CHECK (pipeline_status IN (
    -- Original 14, unchanged.
    'shortlisted',
    'emailed',
    'interview_round1_scheduled',
    'interview_round1_done',
    'interview_round2_scheduled',
    'interview_round2_done',
    'managerial_round',
    'hr_round',
    'offer_sent',
    'offer_accepted',
    'offer_declined',
    'joined',
    'rejected',
    'on_hold',
    -- The fourth stage outcome, written since 2026-07-21 and rejected ever since.
    'future_prospect',
    -- The closure statuses (audit §2.4 / §6a, 2026-08-26). Distinct on purpose:
    -- only closure_rejected may map to 'rejected', because that value drives the
    -- Q11 6-month re-application cooling-off and a withdrawal has not earned it.
    'hired',
    'withdrawn',
    'backed_out',
    'did_not_join',
    'joined_and_left'
  ));

COMMENT ON CONSTRAINT rpa_shortlisted_candidates_pipeline_status_check
  ON rpa_shortlisted_candidates IS
  'Allowed pipeline_status values. Kept in lockstep with SHORTLIST_STATUSES in backend/src/config/pipelineStages.js — a value written there but missing here fails SILENTLY, because every writer is a best-effort legacy write-back inside a try/catch.';

-- ===========================================================================
-- [16/23]  2026-08-28-mrf-paused.sql
-- ===========================================================================

-- ============================================================================
-- Requisitions — pause hiring on a role (Gap G1)
-- Manual DDL — apply directly to PostgreSQL, then run:
--   cd backend && npx prisma db pull && npx prisma generate
-- Per the repo's documented workflow: the Prisma schema is NEVER hand-edited;
-- it is introspected from the live DB.
--
-- Idempotent, additive, non-destructive — safe to run multiple times.
--
-- WHY
-- ---
-- These columns are the DDL half of Gap G1
-- (docs/HR-CANDIDATE-PIPELINE-FAQ-AND-GAP-PLAN-2026-08-26.md §G1). The BACKEND
-- half of G1 was written and deployed to staging without this file ever being
-- created, so the running server queried columns that existed nowhere. Both
-- halves of the failure showed up in the same hour on 2026-08-28:
--
--   * GET /api/screening/roles  -> PG 42703 `column "paused_at" does not exist`
--     (surfaced as Prisma P2010). getApprovedRoles uses $queryRawUnsafe, which
--     bypasses the Prisma schema entirely and asks Postgres directly -- so this
--     one proves the COLUMN was missing.
--   * GET /api/mrf              -> PrismaClientValidationError, `Unknown field
--     'paused_at' for select statement on model 'rpa_mrf'`, thrown client-side
--     before any SQL was sent -- so this one proves the GENERATED CLIENT was
--     missing it too, i.e. nobody had re-introspected.
--
-- Applying this file fixes the first. The `db pull` + `generate` + restart in
-- the header comment is what fixes the second, and has to be run on every
-- checkout that serves traffic -- the client is generated per-checkout, not
-- shared through the database.
--
-- WHY NOT REUSE closed_at
-- -----------------------
-- Same argument that separated closed_at from filled_at in
-- 2026-08-26-mrf-manual-closure.sql, one step further out. A paused role is
-- coming BACK: `on_hold_indefinitely` in MRF_CLOSURE_REASONS is a closure and
-- reads as one everywhere (reason vocabulary, "Openings Filled" export, the
-- reopen guard). Pausing has to be reversible without a reopen being an
-- exceptional, audited act, so it gets a column that clears to NULL and touches
-- nothing else. isMrfFilled() / isMrfClosed() keep meaning what their names say.
-- ============================================================================

-- When hiring on this requisition was paused (NULL = not paused). Independent
-- of BOTH approval_status and filled_at/closed_at: a paused role is still
-- approved and still unfilled, it is just not being worked right now.
ALTER TABLE rpa_mrf
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ NULL;

-- Why it was paused, free text. Deliberately NOT a controlled vocabulary like
-- closure_reason: a closure feeds reporting and needs comparable buckets, while
-- a pause is a note to the next recruiter who opens the role ("Abhijit wants
-- this held until the Q3 budget lands").
ALTER TABLE rpa_mrf
  ADD COLUMN IF NOT EXISTS paused_reason TEXT NULL;

-- Who paused it. Nullable, no FK -- matching every other actor column in this
-- schema, which stores the id without a constraint so deleting a user never
-- blocks or rewrites requisition history.
ALTER TABLE rpa_mrf
  ADD COLUMN IF NOT EXISTS paused_by INTEGER NULL;

-- Advisory "pause until March" date. Drives a reminder; NEVER auto-resumes --
-- silently reopening a role nobody re-checked is worse than a nudge.
ALTER TABLE rpa_mrf
  ADD COLUMN IF NOT EXISTS resume_on DATE NULL;

COMMENT ON COLUMN rpa_mrf.paused_at IS
  'When hiring on this requisition was paused (NULL = active). Independent of approval_status, filled_at and closed_at: a paused role is approved and unfilled, just not being worked. Clears to NULL to resume.';

COMMENT ON COLUMN rpa_mrf.paused_reason IS
  'Free-text note on why hiring was paused. Deliberately not a controlled vocabulary like closure_reason -- a pause is a message to the next recruiter, not a reporting bucket.';

COMMENT ON COLUMN rpa_mrf.paused_by IS
  'rpa_users.id of whoever paused the requisition. No FK, matching the other actor columns in this schema.';

COMMENT ON COLUMN rpa_mrf.resume_on IS
  'Advisory date the requisition is expected to resume. Drives a reminder only -- nothing auto-clears paused_at.';

-- ----------------------------------------------------------------------------
-- NO INDEX CHANGE -- and that is deliberate, not an omission.
--
-- idx_rpa_mrf_open is partial: WHERE filled_at IS NULL AND closed_at IS NULL.
-- The pause-aware JD-dropdown query adds `AND paused_at IS NULL` on top, so its
-- predicate IMPLIES the index predicate and Postgres can still use the index,
-- rechecking the extra condition. Nothing to fix.
--
-- Widening the index to `... AND paused_at IS NULL` would actively HURT: the
-- implication runs the other way for every query that does NOT filter on
-- paused_at -- the dashboard active tile, the pipeline board card, and
-- getApprovedRoles on every branch that has not merged G1 yet -- and Postgres
-- would stop using the index for all of them. Multiple checkouts share this
-- database, so the index has to stay usable by the widest set of predicates.
-- ----------------------------------------------------------------------------

-- No backfill. NULL already means "not paused" for every existing row, which is
-- true: this state has never been recordable until now.

-- ===========================================================================
-- [17/23]  2026-09-01-interview-recording-options.sql
-- ===========================================================================

-- ============================================================================
-- Phase 3 — Interview Recordings, Phase 1: automatic Teams recording
-- Manual DDL — apply then: cd backend && npx prisma db pull && npx prisma generate
-- Idempotent, additive, non-destructive.
--
-- WHY: booking a round now PATCHes its Teams meeting with
-- recordAutomatically:true (plus allowedPresenters, which is what stops the
-- candidate ending the recording). That PATCH is best-effort — it must never
-- cost a recruiter their booking — so its outcome has to be recorded somewhere,
-- or "this interview was never actually recording" would only be discovered
-- weeks later by whoever went looking for the recording.
--
--   record_auto_applied_at  non-null  => Graph confirmed the meeting will record
--                           null      => it will NOT: feature off, round not in
--                                        MS_RECORDED_STAGES, or the PATCH failed
--   record_policy_error     the Graph message when the PATCH failed. A 403 here
--                           means OnlineMeetings.ReadWrite.All is missing, or
--                           the application access policy does not cover the
--                           calendar mailbox.
--
-- See docs/phase3/INTERVIEW-RECORDINGS-PLAN.md §5.2.
-- ============================================================================

ALTER TABLE rpa_interview_schedule
  ADD COLUMN IF NOT EXISTS record_auto_applied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS record_policy_error    TEXT;

-- ===========================================================================
-- [18/23]  2026-09-01-interview-recordings.sql
-- ===========================================================================

-- ============================================================================
-- Phase 3 — Interview Recordings, Phase 2: discover the recording after the call
-- Manual DDL — apply then: cd backend && npx prisma generate
-- Idempotent, additive, non-destructive.
--
-- WHY a table rather than a column on rpa_interview_schedule: one meeting can
-- produce SEVERAL recordings (an interviewer who stops and restarts mid-round
-- gets one artifact per segment), and a reschedule reuses the same
-- online_meeting_id across bookings. A single recording_url column would silently
-- keep whichever segment was written last.
--
-- graph_recording_id is UNIQUE because the sweep re-lists the same meeting every
-- tick, and Microsoft documents a duplicate-item issue on getAllRecordings when
-- a pagination token resets. Dedupe therefore lives in the database, not in the
-- job's logic, so it holds no matter how discovery is driven.
--
-- See docs/phase3/INTERVIEW-RECORDINGS-PLAN.md §5.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rpa_interview_recording (
  id                 BIGSERIAL    PRIMARY KEY,
  schedule_id        BIGINT       NOT NULL REFERENCES rpa_interview_schedule (id) ON DELETE CASCADE,
  pipeline_id        BIGINT       NOT NULL REFERENCES rpa_candidate_pipeline (id) ON DELETE CASCADE,
  stage_key          VARCHAR(50)  NOT NULL REFERENCES rpa_pipeline_stages (stage_key),
  -- 'recording' (MP4) | 'transcript' (VTT)
  kind               VARCHAR(20)  NOT NULL DEFAULT 'recording',
  graph_recording_id VARCHAR(1024) NOT NULL UNIQUE,
  online_meeting_id  VARCHAR(512) NOT NULL,
  recorded_start_at  TIMESTAMPTZ,
  recorded_end_at    TIMESTAMPTZ,
  -- Graph-authenticated URL. Never handed to a browser; playback is proxied.
  graph_content_url  TEXT,
  -- OneDrive/SharePoint web URL where resolvable (populated in Phase 5).
  teams_web_url      TEXT,
  archive_status     VARCHAR(20)  NOT NULL DEFAULT 'pending',
  archive_item_id    VARCHAR(512),
  archive_web_url    TEXT,
  archive_bytes      BIGINT,
  archive_error      TEXT,
  discovered_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  archived_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  modified_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interview_recording_pipeline ON rpa_interview_recording (pipeline_id);
CREATE INDEX IF NOT EXISTS idx_interview_recording_schedule ON rpa_interview_recording (schedule_id);
CREATE INDEX IF NOT EXISTS idx_interview_recording_stage    ON rpa_interview_recording (pipeline_id, stage_key);
CREATE INDEX IF NOT EXISTS idx_interview_recording_archive  ON rpa_interview_recording (archive_status);

-- Per-booking discovery state.
--   recording_status: NULL = not looked at yet
--                     'available' = at least one recording is linked
--                     'missing'   = looked for long enough; none exists (Phase 6)
--   recording_checked_at: last sweep poll, mirroring attendance_checked_at.
ALTER TABLE rpa_interview_schedule
  ADD COLUMN IF NOT EXISTS recording_status     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS recording_checked_at TIMESTAMPTZ;

-- Sweep configuration. Seeded here ON PURPOSE: when the occurrence sweep shipped,
-- its rpa_settings rows were absent, so the job read "disabled" and no cron was
-- ever registered — the real blocker for weeks, mistaken at the time for a
-- permissions problem. Seeding the rows with the job means "off" is a deliberate
-- value rather than an accident of a missing row.
INSERT INTO rpa_settings (key, value)
VALUES
  ('interview_recording_enabled',      'false'),
  ('interview_recording_interval_min', '15'),
  ('interview_recording_grace_min',    '10')
ON CONFLICT (key) DO NOTHING;

-- ===========================================================================
-- [19/23]  2026-09-02-onedrive-item-ids.sql
-- ===========================================================================

-- ============================================================================
-- Phase 3 — Candidate Complete Download, Phase 2: read files back out of OneDrive
-- Manual DDL — apply then: cd backend && npm run prisma:pull && npm run prisma:generate
-- Idempotent, additive, non-destructive. No existing column or row is touched.
--
-- WHY: the dossier a recruiter emails to an external interviewer has to carry the
-- resume INSIDE it. We store only a SharePoint webUrl today, which is a browser
-- URL behind a Microsoft login — handing it to an outsider produces a login wall,
-- not a resume. To put the bytes in the pack the ATS has to read the file back,
-- and reading back by drive-item id is the direct route:
--
--     GET /users/{owner}/drive/items/{itemId}/content
--
-- uploadFileToOneDrive() already receives the whole item object back from Graph
-- and currently keeps only item.webUrl, throwing the id away. These columns give
-- it somewhere to put the id.
--
-- WHY THIS IS AN IMPROVEMENT INDEPENDENT OF THE DOSSIER: an item id survives the
-- file being renamed or moved within the drive; a webUrl does not. Every stored
-- webUrl in these two tables is one rename away from being a dead link.
--
-- NULL IS EXPECTED AND SUPPORTED. Rows written before this change have no id, and
-- there is deliberately no backfill migration here — resolving thousands of URLs
-- through Graph inside a DDL script would be slow, rate-limited and untestable.
-- Instead downloadDriveItem() resolves a legacy row through the /shares/ route on
-- first use and writes the id back, so the backfill happens lazily, only for
-- files someone actually asks for, and costs one extra round trip per file once.
--
-- See docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md §6.3 and
--     docs/phase3/CANDIDATE-DOWNLOAD-IT-PERMISSION-REQUEST.md §3.
--
-- Permission note: the app-only read this enables was tested against staging on
-- 2026-09-02 and PASSED on the existing Sites.Selected grant — no new Graph
-- permission is required. Production uses a separate app registration whose
-- per-site grant is issued separately, so re-run that test before relying on
-- this there.
-- ============================================================================

-- The candidate's resume, uploaded by the parser / HR upload / manual add.
ALTER TABLE rpa_cv
  ADD COLUMN IF NOT EXISTS cv_file_item_id VARCHAR(512);

COMMENT ON COLUMN rpa_cv.cv_file_item_id IS
  'OneDrive drive-item id for cvFileUrl. NULL for rows written before 2026-09-02; '
  'resolved from the webUrl on first read and written back. Survives rename/move.';

-- Documents the candidate uploaded through the public document-collection link
-- (ID proof, payslips, certificates). These are opt-in for a dossier and their
-- inclusion is audited — see plan §8.4.
ALTER TABLE rpa_candidate_documents
  ADD COLUMN IF NOT EXISTS file_item_id VARCHAR(512);

COMMENT ON COLUMN rpa_candidate_documents.file_item_id IS
  'OneDrive drive-item id for file_url. NULL for rows written before 2026-09-02; '
  'resolved from the webUrl on first read and written back.';

-- ===========================================================================
-- [20/23]  2026-09-03-assessment-result-detail.sql
-- ===========================================================================

-- ============================================================================
-- Phase 3 — the Evalground import keeps the WHOLE row, not just three scores
-- Manual DDL — apply then: cd backend && npm run prisma:pull && npm run prisma:generate
-- Idempotent, additive, non-destructive. No existing column or row is touched.
--
-- WHY: Evalground has no API and produces no per-candidate report file. What HR
-- can export is one workbook per TEST with one ROW per candidate — 47 columns,
-- byte-identical across every sample export we hold (2025 and 2026, CSV and
-- XLSX). The import reads that file today and keeps SEVEN of those columns:
-- three section scores, the percentage, the marks, the vendor's verdict and the
-- matched email. Everything else — correct/wrong/unattempted per section, the
-- easy/medium/hard split, the totals, the time taken, the attempt date and the
-- test's own topic columns — is parsed and thrown away.
--
-- The candidate dossier is where that hurts: it could show an interviewer three
-- numbers and a percentage, and the pack had to say so ("the original report is
-- not yet stored in the ATS"). These columns are what section 7 of the pack
-- renders instead. See docs/phase3/ASSESSMENT-REPORT-UPLOAD-PLAN.md §3.
--
-- WHY BOTH raw_row AND TYPED COLUMNS: the typed columns are what the renderers
-- read, so nothing has to guess at a schema while building a file for someone
-- outside the company. raw_row is the archive — a column Evalground adds next
-- year is still recoverable without re-reading the source file out of OneDrive,
-- and it costs a few KB per candidate. The dossier must never render raw_row;
-- utils/dossierRedaction.js asserts that it cannot.
--
-- NULL IS EXPECTED. Every result imported before this ships has NULL here, and
-- that is a supported state, not a broken row: the pack tells the reader the
-- breakdown was captured only from this point on rather than pretending the
-- candidate answered nothing. A re-import of the same unchanged file backfills
-- these columns (assessmentImport.service.js) — the one deliberate exception to
-- "a row already on file is skipped unless the score changed", because a NULL
-- has nothing to protect.
-- ============================================================================

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS raw_row JSONB;

COMMENT ON COLUMN rpa_assessment_results.raw_row IS
  'The candidate''s own export row, verbatim, as header -> value. Archive only: '
  'the dossier renders the typed columns below and is asserted never to read this.';

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS started_on_text VARCHAR(60);

COMMENT ON COLUMN rpa_assessment_results.started_on_text IS
  'When the candidate started, exactly as Evalground printed it ("27 Jul 2026, '
  '15:59"). This is what the dossier renders — the vendor''s own words.';

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS started_on TIMESTAMPTZ;

COMMENT ON COLUMN rpa_assessment_results.started_on IS
  'started_on_text parsed, for sorting and querying. NULL when it could not be '
  'parsed rather than a guessed date. Evalground prints local wall-clock time '
  'with no offset, so this is read in the server''s timezone.';

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS duration_text VARCHAR(60);

COMMENT ON COLUMN rpa_assessment_results.duration_text IS
  'Time taken, as printed ("37 minutes 27 seconds"), whitespace collapsed.';

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS total_correct INT;

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS total_wrong INT;

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS total_unattempted INT;

COMMENT ON COLUMN rpa_assessment_results.total_unattempted IS
  'Questions left unanswered. Reported unaltered alongside correct/wrong — the '
  'vendor''s counts are never recomputed, so a reader holding an Evalground '
  'screenshot never finds two different numbers for one attempt.';

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS section_detail JSONB;

COMMENT ON COLUMN rpa_assessment_results.section_detail IS
  'Per section: marks, correct, wrong, unattempted, easy/medium/hard correct and '
  'the section result. An array, indexed 1..3 by the "index" field, carrying only '
  'the sections the test actually had. Labels are NOT stored here — they live in '
  'section_label_map, so a pack built a year later still reads "Python".';

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS topic_scores JSONB;

COMMENT ON COLUMN rpa_assessment_results.topic_scores IS
  'The test-specific tail columns ("Sql", "Coding", "Playwright" …) as an ordered '
  '[{label, value}] array. JSON rather than columns because these change with '
  'every test HR runs; anything that is not a known Evalground header is one.';

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS attempt_status VARCHAR(30);

COMMENT ON COLUMN rpa_assessment_results.attempt_status IS
  'The export''s "Report" column — "Completed" and the like. Internal: it says '
  'whether the attempt finished, not how the candidate did.';

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS marked_as VARCHAR(60);

COMMENT ON COLUMN rpa_assessment_results.marked_as IS
  'Evalground''s own recruiter tag on the attempt. INTERNAL — never travels in a '
  'candidate dossier; it is one of our people''s notes, not the candidate''s work.';

ALTER TABLE rpa_assessment_results
  ADD COLUMN IF NOT EXISTS public_report_url VARCHAR(512);

COMMENT ON COLUMN rpa_assessment_results.public_report_url IS
  'The export''s "Public Report" column, stored VERBATIM. Evalground truncates it '
  'at 62 characters, cutting the report id mid-UUID, so in every sample export '
  'held so far it cannot be opened. Kept so the question can be answered from '
  'data; never rendered as a link unless it survives isUsableReportUrl().';

-- ===========================================================================
-- [21/23]  2026-09-03-recording-share-links.sql
-- ===========================================================================

-- ============================================================================
-- Phase 4 — no-login, expiring share links for interview recordings
-- Manual DDL — apply then: cd backend && npm run prisma:pull && npm run prisma:generate
-- Idempotent, additive, non-destructive. No existing column or row is touched.
--
-- WHY: a candidate dossier is emailed to an interviewer with no ATS account, and
-- HR chose (decision #7) that recordings travel as an expiring no-login link
-- rather than as bytes — an MP4 round is hundreds of MB and three rounds would
-- make the pack unmailable.
--
-- THIS IS THE HIGHEST-RISK SURFACE IN THE FEATURE: an unauthenticated URL to a
-- video of a real person. Every column below is a control, not bookkeeping.
--
--   token           gen_random_uuid(), the same construction as
--                   rpa_interview_scorecard.token — 122 bits, not guessable.
--   recording_id    ONE LINK, ONE RECORDING. Never a link to "the candidate's
--                   recordings": a leak must expose one round, not the set.
--   expires_at      Checked server-side on every request, never trusted from the
--                   URL. Default now + DOSSIER_SHARE_LINK_DAYS (14).
--   revoked_at      The kill switch. Without it decision #7 has no undo, so the
--                   drawer exposes it as a button rather than an API call.
--   view_count      A cheap abuse signal: a link opened 40 times is not one
--                   interviewer.
--   created_by      Joins a leaked recording back to the pack it came from, via
--                   the dossier download audit row written at the same moment.
--
-- ON DELETE CASCADE from the recording: if the recording row goes, so does every
-- way to reach it. A share link outliving its subject would be a link nobody
-- could audit or revoke, because nothing in the UI would list it any more.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rpa_recording_share_link (
  id             BIGSERIAL PRIMARY KEY,
  token          UUID        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  recording_id   BIGINT      NOT NULL,
  pipeline_id    BIGINT      NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_by     VARCHAR(255),
  created_by_id  INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at     TIMESTAMPTZ,
  revoked_by     VARCHAR(255),
  revoked_by_id  INT,
  view_count     INT         NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  CONSTRAINT fk_recording_share_recording
    FOREIGN KEY (recording_id) REFERENCES rpa_interview_recording(id) ON DELETE CASCADE,
  CONSTRAINT fk_recording_share_pipeline
    FOREIGN KEY (pipeline_id) REFERENCES rpa_candidate_pipeline(id)
);

COMMENT ON TABLE rpa_recording_share_link IS
  'No-login, expiring, revocable links to ONE interview recording each, minted '
  'when a candidate dossier is downloaded with recording links included. Plan: '
  'docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md 6.5.';

COMMENT ON COLUMN rpa_recording_share_link.token IS
  'The only credential the link carries. Bearer-authenticated by design: anyone '
  'holding it can watch until it expires or is revoked.';

COMMENT ON COLUMN rpa_recording_share_link.expires_at IS
  'Enforced server-side on every request. Changing this column does NOT extend a '
  'link the viewer already holds any further than the new value.';

COMMENT ON COLUMN rpa_recording_share_link.revoked_at IS
  'Set from the drawer''s Shared links list. Refusal is immediate, not at next '
  'expiry — that is the whole point of having it.';

CREATE INDEX IF NOT EXISTS idx_recording_share_recording
  ON rpa_recording_share_link(recording_id);

CREATE INDEX IF NOT EXISTS idx_recording_share_pipeline
  ON rpa_recording_share_link(pipeline_id);

-- Live links only, for the drawer's list and for reuse when a second dossier is
-- downloaded for the same candidate: minting a fresh link per download would
-- leave a trail of live URLs nobody remembers to revoke.
CREATE INDEX IF NOT EXISTS idx_recording_share_live
  ON rpa_recording_share_link(recording_id, expires_at)
  WHERE revoked_at IS NULL;

-- ===========================================================================
-- [22/23]  2026-09-03-zeko-shared-report-link.sql
-- ===========================================================================

-- ============================================================================
-- Phase 3 — the pipeline drawer's "full screening report" link, without a login
-- Manual DDL — apply then: cd backend && npm run prisma:pull && npm run prisma:generate
-- Idempotent, additive, non-destructive. No existing column or row is touched.
--
-- WHY: rpa_zeko_interview_results.reportlink holds Zeko's RECRUITER report page —
--
--     https://app.zeko.ai/app/new-report?candidateId=…&jobId=…&tab=Overview
--
-- which is behind Zeko's own login. That is what the drawer's "View full report
-- on Zeko" opens today, so an ATS user who has no Zeko account (most of them)
-- gets a sign-in wall instead of the report. The dossier already solves this by
-- minting Zeko's own public share link (utils/zekoShareLink.js, plan §9 Phase 3);
-- these columns let the drawer reuse it.
--
-- WHY A COLUMN RATHER THAN MINTING ON EVERY CLICK: the mint is a call into Zeko,
-- and when the stored dashboard cookie has expired it goes through the OTP login
-- — measured at 38 SECONDS on staging (2026-09-03). Inside a recruiter's click
-- that is unacceptable more than once, so the answer is cached here: the first
-- person to open a round's report pays for it, everyone after reads a column.
--
-- NULL IS EXPECTED AND SUPPORTED, and there is deliberately no backfill. Minting
-- for every row would create a permanent, PUBLIC url for every candidate ever
-- screened, including the ones nobody will ever open — and unlike our own
-- recording links (plan §6.5) these are Zeko's to expire, not ours. So the link
-- is created lazily, only for a round someone actually asks to read, exactly as
-- 2026-09-02-onedrive-item-ids.sql backfills drive-item ids on first use.
--
-- See docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md §9 Phase 3.
-- ============================================================================

ALTER TABLE rpa_zeko_interview_results
  ADD COLUMN IF NOT EXISTS shared_report_link VARCHAR(512);

COMMENT ON COLUMN rpa_zeko_interview_results.shared_report_link IS
  'Zeko public share url (app/shared-report?linkId=…) for this round''s report, '
  'minted on first request and cached. Opens with NO login, so treat it as '
  'confidential. NULL until someone asks for it; never backfilled in bulk.';

ALTER TABLE rpa_zeko_interview_results
  ADD COLUMN IF NOT EXISTS shared_report_link_at TIMESTAMPTZ;

COMMENT ON COLUMN rpa_zeko_interview_results.shared_report_link_at IS
  'When shared_report_link was minted. Kept so a link that stops working can be '
  'aged rather than guessed at — Zeko owns its lifetime, we cannot revoke it.';

-- ===========================================================================
-- [23/23]  2026-09-04-referral-candidate.sql
-- ===========================================================================

-- ============================================================================
-- Phase 3 (P1) - Referral candidate flag + its audit log
-- Manual DDL - apply then: cd backend && npm run prisma:pull && npm run prisma:generate
-- Idempotent, additive, non-destructive. No existing column or row is touched.
--
-- WHY: Sanghamitra, 2026-08-28 (23:33-26:08): "the recruiter need to see that it
-- is a referral candidate" and, in the same breath, "I don't want the interviewer
-- to see... none of the interview process should know that it is a, because then
-- you can't be non-bias". A referral is therefore a fact the recruiter and the
-- final decision-maker act on and nobody else may learn.
--
-- WHY ON rpa_cv AND NOT ON THE SHORTLIST ROW: a referral is learned BEFORE a
-- shortlist row exists - an employee mails a resume in, and it may sit in the
-- database for months before anyone tags it to a JD. Storing it per-shortlist
-- would leave that fact nowhere to live between the two moments. It also matches
-- the stated reasoning, which is about the person: "that person is already aware
-- of Apna... and therefore they are keen to join Apna."
--
-- WHY NOT A VALUE OF JobSource OR rpa_candidate_pipeline.source: JobSource is
-- free text that recruiters can already type "Referral - Anuj" into today, and it
-- is rendered on the screening detail panel; `source` is displayed on the
-- pipeline board and in its CSV, is mutually exclusive with the real channel, and
-- is about to be redefined as College Placement / Placement / Vendor. Source is
-- the CHANNEL; referral is a boolean OVERLAY on top of it. A vendor-sourced
-- candidate can also be a referral.
--
-- DEFAULT FALSE, NOT NULL: every pre-existing row therefore reads "not a
-- referral". This feature must fail CLOSED on disclosure - an unknown that
-- defaulted to "maybe" would be shown, and showing it to an interviewer is the
-- one outcome the requirement exists to prevent.
--
-- See docs/REFERRAL-CANDIDATE-PLAN.md section 4 and section 6.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Current state, on the candidate
-- ----------------------------------------------------------------------------

ALTER TABLE rpa_cv
  ADD COLUMN IF NOT EXISTS is_referral BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN rpa_cv.is_referral IS
  'TRUE when an employee referred this candidate. Visible ONLY to logged-in '
  'superadmin/admin/recruiter; never on any public token surface, never in a '
  'candidate dossier, never in an interviewer email or Teams invite. '
  'utils/dossierRedaction.js asserts the dossier cannot carry it.';

ALTER TABLE rpa_cv
  ADD COLUMN IF NOT EXISTS referred_by VARCHAR(255);

COMMENT ON COLUMN rpa_cv.referred_by IS
  'Who referred them - "a referral from Anuj", the meeting''s own example. Free '
  'text by decision (2026-09-04), not an FK: a referrer is an employee who may '
  'have no ATS account. Normalised on write (trim + collapse whitespace) but NOT '
  'case-folded, because people''s names are not lower-case.';

ALTER TABLE rpa_cv
  ADD COLUMN IF NOT EXISTS referral_note TEXT;

COMMENT ON COLUMN rpa_cv.referral_note IS
  'Recruiter context ("ex-colleague of Anuj, spoke to him directly"). Recruiter-'
  'only; like every other recruiter-authored free-text field it must never travel '
  'to an interviewer surface.';

ALTER TABLE rpa_cv
  ADD COLUMN IF NOT EXISTS referral_set_by VARCHAR(255);

ALTER TABLE rpa_cv
  ADD COLUMN IF NOT EXISTS referral_set_at TIMESTAMPTZ;

COMMENT ON COLUMN rpa_cv.referral_set_by IS
  'Denormalised copy of the latest rpa_referral_audit row, so the drawer can show '
  '"marked by Chhaya" without a join. The AUDIT TABLE IS THE SOURCE OF TRUTH for '
  'history - these two columns are overwritten by the next change and so can '
  'never answer "who removed it?".';

-- Partial: referrals are a small minority of a 400+ and growing table, and the
-- only query that needs an index is "show me the referrals".
CREATE INDEX IF NOT EXISTS idx_cv_referral
  ON rpa_cv(is_referral) WHERE is_referral;


-- ----------------------------------------------------------------------------
-- 2. History: every mark, change and removal
-- ----------------------------------------------------------------------------
--
-- WHY A TABLE AND NOT JUST THE TWO STAMP COLUMNS ABOVE: a referral grants hiring
-- preference - "we always give preference to the referral person" - so it is not
-- an ordinary candidate field. It changes who gets hired, which makes its history
-- something that has to be investigable. referral_set_by/at cannot do that: a
-- REMOVAL overwrites the very columns that would have recorded it. Only an
-- append-only row survives the thing it needs to describe.
--
-- APPEND-ONLY BY CONVENTION: the application INSERTs and SELECTs here, and does
-- nothing else - no UPDATE, no DELETE, not even to fix a typo. See the README for
-- the optional trigger that turns that convention into a rule.

CREATE TABLE IF NOT EXISTS rpa_referral_audit (
  id              BIGSERIAL PRIMARY KEY,

  -- Who it was about. SET NULL rather than CASCADE: candidates do get deleted
  -- (docs/reference/MANUAL_CANDIDATE_CV_DELETION.md) and an incident record that
  -- vanishes with its subject is not an audit log. The name and email are
  -- snapshotted beside the FK so the row stays readable once it points nowhere.
  cv_id           BIGINT,
  candidate_name  VARCHAR(255),
  candidate_email VARCHAR(255),

  action          VARCHAR(20)  NOT NULL,

  -- Both sides of every change, so one row is legible without reading the
  -- one before it.
  old_is_referral BOOLEAN,
  new_is_referral BOOLEAN,
  old_referred_by VARCHAR(255),
  new_referred_by VARCHAR(255),
  note            TEXT,

  reason          TEXT,

  -- Who did it. Same snapshot rule, and for a reason this codebase has already
  -- been bitten by: a superadmin can delete a user account, and screening.service.js
  -- records the 2026-08-26 case where closure writes "made the shortlisting
  -- recruiter's name VANISH from the record". A log that resolves its actor only
  -- by join is worthless on exactly the day it is needed.
  acted_by        INT,
  acted_by_name   VARCHAR(255) NOT NULL,
  acted_by_email  VARCHAR(255),
  acted_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  acted_ip        VARCHAR(64),

  CONSTRAINT fk_referral_audit_cv
    FOREIGN KEY (cv_id) REFERENCES rpa_cv(id) ON DELETE SET NULL,
  CONSTRAINT fk_referral_audit_user
    FOREIGN KEY (acted_by) REFERENCES rpa_users(id) ON DELETE SET NULL,

  CONSTRAINT chk_referral_audit_action
    CHECK (action IN ('marked', 'updated', 'removed')),

  -- A removal with no stated reason is the case this table exists for, so it is
  -- refused twice: the service raises the friendly error the recruiter reads, and
  -- this backstop catches the code path that forgets to.
  CONSTRAINT chk_referral_audit_removal_reason
    CHECK (action <> 'removed' OR (reason IS NOT NULL AND btrim(reason) <> ''))
);

COMMENT ON TABLE rpa_referral_audit IS
  'Append-only history of the referral flag: who marked, changed or removed it, '
  'when, for which candidate, and - on a removal - why. Written in the same '
  'transaction as the rpa_cv update, never one without the other. Plan: '
  'docs/REFERRAL-CANDIDATE-PLAN.md section 6.';

COMMENT ON COLUMN rpa_referral_audit.action IS
  '''marked'' (flag set), ''updated'' (referrer name or note changed), ''removed'' '
  '(flag or name cleared). A removal is the investigable incident: only admin-tier '
  'may perform one, and it must carry a reason.';

COMMENT ON COLUMN rpa_referral_audit.reason IS
  'Why the referral was removed, typed by the person removing it. Mandatory on '
  '''removed'' and meaningless otherwise - it is what makes the row an incident '
  'record rather than a bare timestamp.';

COMMENT ON COLUMN rpa_referral_audit.candidate_name IS
  'Snapshot, not a join. Survives deletion of the candidate so the incident stays '
  'readable; also records the name AS IT WAS, which a later rename would hide.';

COMMENT ON COLUMN rpa_referral_audit.acted_by_name IS
  'Snapshot of the acting user''s display name. NOT NULL: an audit row that cannot '
  'name who acted is not worth writing.';

COMMENT ON COLUMN rpa_referral_audit.acted_ip IS
  'Best-effort client IP, as rpa_interview_scorecard.submitted_ip already records '
  'for a public submit. Corroboration, never identification on its own.';

CREATE INDEX IF NOT EXISTS idx_referral_audit_cv
  ON rpa_referral_audit(cv_id);

CREATE INDEX IF NOT EXISTS idx_referral_audit_actor
  ON rpa_referral_audit(acted_by);

-- The report's default ordering: newest first, across everything.
CREATE INDEX IF NOT EXISTS idx_referral_audit_acted
  ON rpa_referral_audit(acted_at DESC);

-- Removals only - the report's investigation view, and a small enough slice of
-- the table to be worth its own partial index rather than a filter scan.
CREATE INDEX IF NOT EXISTS idx_referral_audit_removed
  ON rpa_referral_audit(acted_at DESC) WHERE action = 'removed';

COMMIT;

-- Expect: COMMIT. Now run 03-settings.sql, then 04-verify.sql.
