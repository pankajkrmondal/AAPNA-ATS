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
