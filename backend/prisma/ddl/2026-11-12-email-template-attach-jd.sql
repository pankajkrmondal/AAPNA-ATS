-- ============================================================================
-- U02b · "Attach the JD" switch and {{jd_link}} on the Email Templates page (12 Nov 2026)
-- Run with the guarded runner:
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-11-12-email-template-attach-jd.sql
--
-- Idempotent and additive. Never changes a template's subject or body.
--
-- WHAT
-- ----
-- attach_jd: each candidate template's "Attach the JD" switch.
--   NULL  = the default rule in code (shouldAttachJd: on for every forward
--           round, off for Documents, Offer and closures)
--   true  = always carry the JD
--   false = never carry it
-- The backend reads and writes it with raw SQL and treats a missing column as
-- NULL, so the build that reads it can go out before or after this script.
--
-- jd_link: added to the placeholders of the templates that carry the JD, so
-- the page offers the {{jd_link}} chip (where the JD card goes). It is
-- optional: the card goes where it was before when the body has no token.
--
-- "Evalground Assessment Invite": the invite's text as a stored template,
-- created only if missing (copied from the old built-in copy in
-- AssessmentInviteModal.jsx). The modal and the send use it from now on.
-- ============================================================================

ALTER TABLE rpa_email_templates
  ADD COLUMN IF NOT EXISTS attach_jd boolean NULL;

COMMENT ON COLUMN rpa_email_templates.attach_jd IS
  'U02b: "Attach the JD" on the Email Templates page. NULL = default rule (shouldAttachJd), true = always, false = never.';

INSERT INTO rpa_email_templates (name, category, subject, body_html, placeholders, is_active)
SELECT
  'Evalground Assessment Invite',
  'interview',
  'Your AAPNA IQ / Tech Assessment — Evalground Test Invite',
  '<p>Hi {{candidate_name}},</p>'
    || '<p>As the next step for {{position}}, please complete the Evalground assessment using the link below:</p>'
    || '<p>[PASTE EVALGROUND TEST LINK HERE]</p>'
    || '<p>Please complete this within {{deadline_days}} day(s) of receiving this email.</p>'
    || '<p>Best regards,<br>AAPNA Talent Acquisition Team</p>',
  ARRAY['candidate_name', 'position', 'deadline_days', 'jd_link']::text[],
  true
WHERE NOT EXISTS (SELECT 1 FROM rpa_email_templates WHERE name = 'Evalground Assessment Invite');

UPDATE rpa_email_templates t
SET placeholders = array_append(COALESCE(t.placeholders, '{}'::text[]), 'jd_link')
WHERE (
    t.category = 'shortlist'
    OR t.name IN (
      'Shortlist Notification',
      'Zeko Interview Scheduled Invitation',
      'Interview Scheduled — Candidate',
      'Interview Rescheduled — Candidate',
      'Stage Outcome — Approved',
      'Evalground Assessment Invite'
    )
    OR t.id IN (SELECT s.template_id FROM rpa_stage_email_templates s WHERE s.outcome_key = 'approved')
  )
  AND NOT EXISTS (
    SELECT 1 FROM unnest(COALESCE(t.placeholders, '{}'::text[])) AS p(token)
    WHERE regexp_replace(p.token, '[{}]', '', 'g') = 'jd_link'
  );
