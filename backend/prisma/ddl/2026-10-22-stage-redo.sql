-- ============================================================================
-- L02-C · Re-do a passed stage (22 Oct 2026)
-- Run with the guarded runner:
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-10-22-stage-redo.sql
-- then: cd backend && npx prisma db pull && npx prisma generate
--
-- Idempotent and additive.
--
-- WHAT
-- ----
-- Under flexible stages a recruiter may move a candidate back into a stage they
-- already passed, to re-do it (lifting D2; Documents and Offer excluded). The
-- earlier attempt's booking must stay as history (its real status: completed /
-- no_show) but must no longer count as the stage's live booking:
--
-- 1. rpa_interview_schedule.superseded_at: set on every booking of the stage
--    when the stage is re-done.
-- 2. uq_interview_schedule_live (one live booking per journey and stage) now
--    ignores superseded rows, so the new attempt can be booked. Before this,
--    a completed booking blocked any second booking of the same stage forever.
--
-- Zeko needs no DDL: a re-done Zeko round uses a different Zeko job (decision
-- 22 Oct), which is a new row on the existing unique key. Evalground results
-- and invites are told apart by time (the stage's entered_at), not by a flag.
-- ============================================================================

ALTER TABLE rpa_interview_schedule
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN rpa_interview_schedule.superseded_at IS
  'L02-C: when this booking''s stage was re-done. The row keeps its real status as history of the earlier attempt and is no longer the stage''s live booking.';

DROP INDEX IF EXISTS uq_interview_schedule_live;

CREATE UNIQUE INDEX uq_interview_schedule_live
  ON rpa_interview_schedule (pipeline_id, stage_key)
  WHERE status <> 'cancelled' AND superseded_at IS NULL;

COMMENT ON TABLE rpa_pipeline_stage_state IS
  'One row per journey per stage the candidate has been in or moved past (flexible stages). completed = passed; a passed stage can be re-done (L02-C, 22 Oct 2026) except Documents and Offer: it becomes active again with a fresh entered_at and keeps its completed_at, so entered_at > completed_at marks a re-do visit.';
