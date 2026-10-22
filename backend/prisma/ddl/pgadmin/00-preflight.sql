-- ############################################################################
-- STEP 0 — PRE-FLIGHT.  READ-ONLY: this script changes NOTHING.
--
-- Run this FIRST, in pgAdmin, against recruitmentautomationdbProd.
-- It answers "is production still in the state the plan was written for, and
-- exactly how much am I about to delete?"
--
-- HOW TO RUN IN pgAdmin
--   Highlight ONE query block and press F5 to see its grid, or press F5 with
--   nothing selected to run them all (pgAdmin shows only the LAST result grid,
--   which is why the blocks below are numbered — run them one at a time).
--
-- Plan: docs/phase3/STAGING-TO-PRODUCTION-DB-AND-ONEDRIVE-PLAN.md section A.4
-- ############################################################################


-- ── 1. Am I on the right database? ──────────────────────────────────────────
-- MUST say recruitmentautomationdbProd. If it says recruitmentautomationdb you
-- are pointed at STAGING — stop and switch the Query Tool connection.
SELECT current_database()                       AS database,
       current_user                             AS connected_as,
       version()                                AS server;


-- ── 2. Has any of this already been applied? ────────────────────────────────
-- Expected on an untouched production: phase3_tables = 0, and the two
-- *_present columns = 'NO'. If phase3_tables is already 21, STEP 2 has been run.
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN (
     'rpa_pipeline_stages','rpa_stage_outcomes','rpa_outcome_reasons','rpa_stage_email_templates',
     'rpa_candidate_pipeline','rpa_pipeline_stage_events','rpa_interview_schedule',
     'rpa_interview_scorecard','rpa_interview_scorecard_skill','rpa_assessment_imports',
     'rpa_assessment_results','rpa_assessment_test_mappings','rpa_assessment_invites',
     'rpa_document_checklist_items','rpa_document_requests','rpa_candidate_documents',
     'rpa_offers','rpa_notifications','rpa_interview_recording','rpa_recording_share_link',
     'rpa_referral_audit'))                                                  AS phase3_tables_of_21,
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema = 'public')                                           AS total_public_tables,
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name = 'rpa_email_log' AND column_name = 'status')
       THEN 'YES' ELSE 'NO' END                                              AS email_log_status_present,
  CASE WHEN EXISTS (SELECT 1 FROM pg_constraint
        WHERE conname = 'rpa_email_messages_graph_message_id_key')
       THEN 'YES' ELSE 'NO' END                                              AS graph_id_unique_present;


-- ── 3. ⚠ HOW MANY ROWS WILL STEP 3 DELETE? ─────────────────────────────────
-- This is the number that needs sign-off. It GROWS every time the mailbox
-- poller runs, so the figure in the plan (8,866 on 2026-09-09) will be stale.
-- Re-run this immediately before STEP 3.
SELECT
  (SELECT count(*) FROM rpa_email_messages)                                  AS total_rows,
  (SELECT count(*) FROM (SELECT graph_message_id FROM rpa_email_messages
     WHERE graph_message_id IS NOT NULL
     GROUP BY 1 HAVING count(*) > 1) x)                                      AS duplicate_groups,
  (SELECT count(*) FROM (SELECT id, row_number() OVER
       (PARTITION BY graph_message_id ORDER BY id) rn
     FROM rpa_email_messages WHERE graph_message_id IS NOT NULL) t
    WHERE t.rn > 1)                                                          AS rows_to_be_deleted,
  (SELECT count(*) FROM rpa_email_messages WHERE graph_message_id IS NULL)   AS null_graph_id_kept,
  -- MUST be 0. Non-zero means duplicate rows differ from each other and are
  -- NOT safe re-inserts — stop and investigate before deleting anything.
  (SELECT count(*) FROM (SELECT graph_message_id FROM rpa_email_messages
     WHERE graph_message_id IS NOT NULL GROUP BY 1
     HAVING count(*) > 1 AND (count(DISTINCT direction) > 1
                          OR count(DISTINCT sent_at) > 1)) y)                AS unsafe_groups_MUST_BE_0;


-- ── 4. Orphan foreign-key pointers that STEP 3 will set to NULL ─────────────
-- Expected roughly 1 / 8 / 25. These become NULL, which is exactly what the
-- ON DELETE SET NULL constraint would have done. No message is lost.
SELECT
  (SELECT count(*) FROM rpa_email_messages m WHERE m.candidate_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM rpa_cv c WHERE c.id = m.candidate_id))     AS orphan_candidate_id,
  (SELECT count(*) FROM rpa_email_messages m WHERE m.mrf_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM rpa_mrf f WHERE f.id = m.mrf_id))          AS orphan_mrf_id,
  (SELECT count(*) FROM rpa_email_messages m WHERE m.shortlist_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM rpa_shortlisted_candidates s
                      WHERE s.id = m.shortlist_id))                           AS orphan_shortlist_id;


-- ── 5. Everything else must be clean before STEP 3 ─────────────────────────
-- EVERY COLUMN MUST BE 0. A non-zero value means a constraint in STEP 3 will
-- be rejected and the whole transaction will roll back.
SELECT
  (SELECT count(*) FROM rpa_email_messages WHERE id IS NULL)                 AS msg_id_null,
  (SELECT count(*) FROM (SELECT id FROM rpa_email_messages
     GROUP BY id HAVING count(*) > 1) a)                                     AS msg_id_dup,
  (SELECT count(*) FROM (SELECT id FROM rpa_email_tracking
     GROUP BY id HAVING count(*) > 1) b)                                     AS tracking_id_dup,
  (SELECT count(*) FROM (SELECT tracking_token FROM rpa_email_tracking
     WHERE tracking_token IS NOT NULL GROUP BY 1 HAVING count(*) > 1) c)     AS tracking_token_dup,
  (SELECT count(*) FROM rpa_email_tracking t WHERE NOT EXISTS
     (SELECT 1 FROM rpa_email_messages m WHERE m.id = t.message_id))         AS tracking_orphan,
  (SELECT count(*) FROM (SELECT id FROM rpa_cv_tmp
     GROUP BY id HAVING count(*) > 1) d)                                     AS cv_tmp_id_dup,
  (SELECT count(*) FROM (SELECT token FROM rpa_sessions
     WHERE token IS NOT NULL GROUP BY 1 HAVING count(*) > 1) e)              AS session_token_dup,
  (SELECT count(*) FROM rpa_cv WHERE resume_text_quality IS NOT NULL
     AND resume_text_quality NOT IN
         ('extracted','lossy','failed','unknown'))                           AS bad_resume_quality,
  (SELECT count(*) FROM rpa_mrf WHERE total_years_of_experience IS NOT NULL
     AND btrim(total_years_of_experience) !~ '^[0-9]+$')                     AS mrf_total_not_numeric,
  (SELECT count(*) FROM rpa_mrf WHERE relevant_years_of_experience IS NOT NULL
     AND btrim(relevant_years_of_experience) !~ '^[0-9]+$')                  AS mrf_relevant_not_numeric;


-- ── 6. Take the template and settings safety copies ────────────────────────
-- pgAdmin has no \copy. These two tables are the ones the seed scripts can
-- overwrite, so snapshot them INSIDE the database instead. Cheap and instant.
-- (This is the one part of this file that writes — it only creates copies.)
CREATE SCHEMA IF NOT EXISTS ats_backup;

CREATE TABLE IF NOT EXISTS ats_backup.email_templates_predeploy AS
  SELECT * FROM rpa_email_templates;

CREATE TABLE IF NOT EXISTS ats_backup.settings_predeploy AS
  SELECT * FROM rpa_settings;

SELECT (SELECT count(*) FROM ats_backup.email_templates_predeploy) AS templates_backed_up,
       (SELECT count(*) FROM ats_backup.settings_predeploy)        AS settings_backed_up;

-- ⚠ These are NOT a substitute for the pg_dump in Step 1 of the runbook. They
--   live in the same database, so they do not survive a lost server. Take the
--   real backup as well.
