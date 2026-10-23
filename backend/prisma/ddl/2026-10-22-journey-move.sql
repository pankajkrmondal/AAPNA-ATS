-- ============================================================================
-- L02-A · Move to another JD (22 Oct 2026)
-- Run with the guarded runner:
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-10-22-journey-move.sql
-- then: cd backend && npx prisma db pull && npx prisma generate
--
-- Idempotent and additive.
--
-- WHAT
-- ----
-- A move closes the candidate's journey on one JD (final_outcome
-- 'moved_to_other_jd', no candidate or vendor email) and opens a new journey on
-- another JD, from the first stage or a chosen one. Nothing is copied: the old
-- journey keeps its Zeko, Evalground, scorecard and recording rows, and the new
-- journey shows them in "Earlier roles for this candidate".
--
-- 1. rpa_candidate_pipeline.moved_from_pipeline_id: the journey this one was
--    moved from. No FK on purpose: journeys are never deleted, and a dangling
--    link must never block a delete of test data. Indexed for the reverse
--    lookup ("Moved to …" on the old journey).
-- 2. rpa_shortlisted_candidates.pipeline_status gains 'moved', the shortlist
--    status of the old JD (shortlistStatusFor('moved_to_other_jd')). Without it
--    the best-effort write-back fails silently and the old row keeps reading
--    'shortlisted' (see the constraint's own COMMENT).
--
-- final_outcome has no CHECK, so 'moved_to_other_jd' needs no DDL.
-- ============================================================================

ALTER TABLE rpa_candidate_pipeline
  ADD COLUMN IF NOT EXISTS moved_from_pipeline_id BIGINT NULL;

COMMENT ON COLUMN rpa_candidate_pipeline.moved_from_pipeline_id IS
  'L02 Move to another JD: the journey (same candidate, other MRF) this one was moved from. That journey is closed as moved_to_other_jd. No FK: journeys are never deleted.';

CREATE INDEX IF NOT EXISTS idx_candidate_pipeline_moved_from
  ON rpa_candidate_pipeline (moved_from_pipeline_id)
  WHERE moved_from_pipeline_id IS NOT NULL;

ALTER TABLE rpa_shortlisted_candidates
  DROP CONSTRAINT IF EXISTS rpa_shortlisted_candidates_pipeline_status_check;

ALTER TABLE rpa_shortlisted_candidates
  ADD CONSTRAINT rpa_shortlisted_candidates_pipeline_status_check
  CHECK (pipeline_status IN (
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
    'future_prospect',
    'hired',
    'withdrawn',
    'backed_out',
    'did_not_join',
    'joined_and_left',
    -- L02 (22 Oct 2026): the old JD's row after Move to another JD.
    'moved'
  ));

COMMENT ON CONSTRAINT rpa_shortlisted_candidates_pipeline_status_check
  ON rpa_shortlisted_candidates IS
  'Allowed pipeline_status values. Kept in lockstep with SHORTLIST_STATUSES in backend/src/config/pipelineStages.js — a value written there but missing here fails SILENTLY, because every writer is a best-effort legacy write-back inside a try/catch.';
