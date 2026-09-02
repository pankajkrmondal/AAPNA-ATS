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
