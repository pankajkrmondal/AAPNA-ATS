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
