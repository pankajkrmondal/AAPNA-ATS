-- ============================================================================
-- U08 · Zeko: optional phone page and expiry reminder (10 Nov 2026)
-- Run with the guarded runner:
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-11-10-zeko-link-token.sql
-- then: cd backend && npx prisma generate
--
-- Idempotent and additive.
--
-- WHAT
-- ----
-- Our Zeko invite linked straight to the JOB's Zeko page, the same URL for
-- every candidate, so a click could not be tied to anyone. Each Zeko row now
-- carries its own link token: the email links to /api/z/<token>, which sends a
-- candidate with no phone on file to an optional "add your phone" page first,
-- and everyone else straight on to Zeko.
--
-- reminded_at makes the expiry reminder fire once per booking (the
-- zekoExpiryReminder job). A reschedule clears it, because a new window is
-- owed its own reminder.
--
-- phone_captured_at records when the candidate gave a number on that page.
--
-- gen_random_uuid() is volatile, so ADD COLUMN fills a DIFFERENT token into
-- every existing row (Postgres evaluates a volatile default per row).
-- ============================================================================

ALTER TABLE rpa_zeko_candidate_pipeline
  ADD COLUMN IF NOT EXISTS link_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS rpa_zeko_candidate_pipeline_link_token_key
  ON rpa_zeko_candidate_pipeline (link_token);

ALTER TABLE rpa_zeko_candidate_pipeline
  ADD COLUMN IF NOT EXISTS reminded_at timestamptz NULL;

ALTER TABLE rpa_zeko_candidate_pipeline
  ADD COLUMN IF NOT EXISTS phone_captured_at timestamptz NULL;

COMMENT ON COLUMN rpa_zeko_candidate_pipeline.link_token IS
  'U08: per-booking token for the tracked Zeko link /api/z/<token> in our invite and reminder emails. The only credential for the public phone page.';
COMMENT ON COLUMN rpa_zeko_candidate_pipeline.reminded_at IS
  'U08: when the "Zeko Interview Reminder" email went out for this window. NULL = not yet. Cleared when the interview is rescheduled.';
COMMENT ON COLUMN rpa_zeko_candidate_pipeline.phone_captured_at IS
  'U08: when the candidate added a phone number on the /zeko-start page. NULL = never (or skipped).';
