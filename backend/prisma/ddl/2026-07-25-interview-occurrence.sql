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
