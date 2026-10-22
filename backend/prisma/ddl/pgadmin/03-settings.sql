-- ############################################################################
-- STEP 4 of the production deployment — rpa_settings rows
--
-- Run in pgAdmin against recruitmentautomationdbProd, AFTER 01-ddl-all.sql and
-- AFTER the parity backfill (2026-09-09-prod-parity-backfill.sql).
--
-- WHY THIS EXISTS: a MISSING settings row does not read as "use the default" —
-- it reads as DISABLED. The interview-recording job shipped broken for weeks
-- for exactly this reason. Without the rows below, the interview reminder and
-- occurrence-sweep crons never register at all in production, and nothing in
-- the log says so.
--
-- ON CONFLICT DO NOTHING IS LOAD-BEARING. Production already holds live
-- recipient addresses and mailbox sync cursors that differ from staging on
-- purpose. DO NOTHING is what stops this script from overwriting them.
-- Never change it to DO UPDATE.
--
-- Plan: docs/phase3/STAGING-TO-PRODUCTION-DB-AND-ONEDRIVE-PLAN.md section A.5.3
-- ############################################################################

BEGIN;

INSERT INTO rpa_settings (key, value) VALUES
  -- Pre-interview reminders to candidate + panel.
  ('interview_reminder_enabled',        'true'),
  ('interview_reminder_interval_min',   '2'),
  ('interview_reminder_lead_min',       '15'),

  -- "Did the interview actually happen?" sweep. Gates scorecard release, so a
  -- scorecard is never sent for a no-show.
  ('interview_occurrence_enabled',      'true'),
  ('interview_occurrence_interval_min', '2'),
  ('interview_occurrence_grace_min',    '5'),

  ('assessment_deadline_days',          '2'),

  -- DELIBERATELY OFF for go-live, unlike staging. This is the only setting here
  -- that sets a candidate's stage outcome WITHOUT a recruiter clicking anything.
  -- Turn it on later, once the pipeline has been watched running on real data.
  ('assessment_auto_advance_enabled',   'false')
ON CONFLICT (key) DO NOTHING;

COMMIT;


-- ── Verify: 8 rows, and production's own values untouched ──────────────────
SELECT key, value FROM rpa_settings
 WHERE key IN ('interview_reminder_enabled','interview_reminder_interval_min',
               'interview_reminder_lead_min','interview_occurrence_enabled',
               'interview_occurrence_interval_min','interview_occurrence_grace_min',
               'assessment_deadline_days','assessment_auto_advance_enabled')
 ORDER BY key;

-- These must still show PRODUCTION's addresses, not staging's. If any of them
-- now reads pkmondal@ / hmopuri@ / saukumar@, something overwrote them —
-- restore from ats_backup.settings_predeploy (created by 00-preflight.sql).
SELECT key, value FROM rpa_settings
 WHERE key LIKE 'email_recipients.%'
 ORDER BY key;


-- ############################################################################
-- NOT INCLUDED HERE, ON PURPOSE
--
--   ZEKO_CLIENT_ID      — only add if Zeko goes live in production.
--   mailbox_delta_link  — NEVER copy from staging. Production has its own live
--                         Graph cursor; overwriting it would make the poller
--                         re-read or skip mail.
--   email_recipients.vendorStatus.to / .cc
--                       — already inserted by the vendor-status DDL in
--                         01-ddl-all.sql. Set the real addresses through the
--                         admin Flow Keys screen, not here.
--
-- The interview_recording_* rows are also already inserted (as 'false') by
-- 01-ddl-all.sql. Flip them on deliberately, and only after the production
-- app registration has the Graph grants — see the plan, section B.4.
-- ############################################################################
