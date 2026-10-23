-- ============================================================================
-- ROLLBACK for 2026-10-22-stage-redo.sql (L02-C re-do a passed stage).
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-10-22-stage-redo.rollback.sql
--
-- First deploy the previous backend build: this build reads and writes
-- superseded_at.
--
-- A stage re-done under this build can have two non-cancelled bookings (the
-- superseded one and the new one); the old index would refuse them, so the
-- superseded ones are cancelled first. Their real status (completed / no_show)
-- is lost; the drawer history and the scorecards keep the record.
-- ============================================================================

UPDATE rpa_interview_schedule
   SET status = 'cancelled', cancel_reason = COALESCE(cancel_reason, 'Earlier attempt of a re-done stage (rollback of L02-C)')
 WHERE superseded_at IS NOT NULL AND status <> 'cancelled';

DROP INDEX IF EXISTS uq_interview_schedule_live;

CREATE UNIQUE INDEX uq_interview_schedule_live
  ON rpa_interview_schedule (pipeline_id, stage_key)
  WHERE status <> 'cancelled';

ALTER TABLE rpa_interview_schedule DROP COLUMN IF EXISTS superseded_at;
