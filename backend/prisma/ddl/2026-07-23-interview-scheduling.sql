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
