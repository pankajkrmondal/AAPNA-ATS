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
