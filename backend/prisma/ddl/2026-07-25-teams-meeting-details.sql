-- ============================================================================
-- Phase 3 — Module 2 addendum: persist Teams dial-in Meeting ID + Passcode
-- Manual DDL — apply then: cd backend && npx prisma db pull && npx prisma generate
-- Idempotent, additive, non-destructive.
--
-- WHY: the Outlook event-create response returns only the Teams Join URL, so
-- the invite emails to the candidate + interviewer previously showed only a
-- Join link. To mirror the Outlook meeting block (Join link + Meeting ID +
-- Passcode) in the emails, we fetch those from the onlineMeeting resource and
-- store them on the booking so schedule AND reschedule emails can render them.
-- ============================================================================

ALTER TABLE rpa_interview_schedule
  ADD COLUMN IF NOT EXISTS teams_meeting_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS teams_passcode   VARCHAR(64);
