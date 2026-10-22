-- ============================================================================
-- ROLLBACK for 2026-10-22-journey-move.sql (L02-A Move to another JD).
-- Run with the guarded runner:
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-10-22-journey-move.rollback.sql
--
-- First deploy the previous backend build: this build writes
-- moved_from_pipeline_id and the 'moved' shortlist status.
--
-- Rows already written as 'moved' would break the narrower CHECK, so they are
-- turned into 'withdrawn' first (the nearest older closure value; the journey
-- itself still says moved_to_other_jd). The link between moved journeys is
-- lost; the closure and entry notes still name both JDs.
-- ============================================================================

UPDATE rpa_shortlisted_candidates SET pipeline_status = 'withdrawn' WHERE pipeline_status = 'moved';

ALTER TABLE rpa_shortlisted_candidates
  DROP CONSTRAINT IF EXISTS rpa_shortlisted_candidates_pipeline_status_check;

ALTER TABLE rpa_shortlisted_candidates
  ADD CONSTRAINT rpa_shortlisted_candidates_pipeline_status_check
  CHECK (pipeline_status IN (
    'shortlisted', 'emailed', 'interview_round1_scheduled', 'interview_round1_done',
    'interview_round2_scheduled', 'interview_round2_done', 'managerial_round', 'hr_round',
    'offer_sent', 'offer_accepted', 'offer_declined', 'joined', 'rejected', 'on_hold',
    'future_prospect', 'hired', 'withdrawn', 'backed_out', 'did_not_join', 'joined_and_left'
  ));

DROP INDEX IF EXISTS idx_candidate_pipeline_moved_from;

ALTER TABLE rpa_candidate_pipeline DROP COLUMN IF EXISTS moved_from_pipeline_id;
