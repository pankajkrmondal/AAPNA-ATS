-- ############################################################################
-- VERIFICATION — READ-ONLY. Run in pgAdmin after every other script.
--
-- Run each numbered block on its own (highlight it, press F5): pgAdmin shows
-- only the last result grid when you run a whole buffer.
--
-- Target numbers are staging's, measured 2026-09-09. Row counts will differ —
-- production carries the real data — but every OBJECT count must match.
-- ############################################################################


-- ── 1. Object parity with staging ──────────────────────────────────────────
-- tables 49 (48 + rpa_cv_vectors), columns 789, indexes 160, triggers 6.
SELECT
  (SELECT count(*) FROM information_schema.tables  WHERE table_schema = 'public') AS tables_expect_49,
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public') AS columns_expect_789,
  (SELECT count(*) FROM pg_indexes                 WHERE schemaname  = 'public') AS indexes_expect_160,
  (SELECT count(*) FROM pg_trigger t
     JOIN pg_class c     ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal)                           AS triggers_expect_6;


-- ── 2. All 21 Phase-3 tables exist ─────────────────────────────────────────
SELECT count(*) AS phase3_tables_expect_21
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name IN (
  'rpa_pipeline_stages','rpa_stage_outcomes','rpa_outcome_reasons','rpa_stage_email_templates',
  'rpa_candidate_pipeline','rpa_pipeline_stage_events','rpa_interview_schedule',
  'rpa_interview_scorecard','rpa_interview_scorecard_skill','rpa_assessment_imports',
  'rpa_assessment_results','rpa_assessment_test_mappings','rpa_assessment_invites',
  'rpa_document_checklist_items','rpa_document_requests','rpa_candidate_documents',
  'rpa_offers','rpa_notifications','rpa_interview_recording','rpa_recording_share_link',
  'rpa_referral_audit');


-- ── 3. The email-template CHECK was widened ────────────────────────────────
-- MUST contain BOTH 'stage_outcome' AND 'vendor_status', or the template seed
-- will be rejected.
SELECT pg_get_constraintdef(oid) AS category_check
  FROM pg_constraint WHERE conname = 'rpa_email_templates_category_check';


-- ── 4. ⚠ THE BLOCKER IS CLOSED ─────────────────────────────────────────────
-- duplicates_left MUST be 0, and rows_kept + rows_backed_up must equal the
-- total_rows you recorded in 00-preflight.sql block 3. Nothing is lost —
-- the deleted rows are in ats_backup, not gone.
SELECT
  (SELECT count(*) FROM (SELECT graph_message_id FROM rpa_email_messages
     WHERE graph_message_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x)   AS duplicates_left_expect_0,
  (SELECT count(*) FROM rpa_email_messages)                                  AS rows_kept,
  (SELECT count(*) FROM ats_backup.email_messages_dupes_20260909)            AS rows_backed_up,
  (SELECT count(*) FROM rpa_email_messages)
    + (SELECT count(*) FROM ats_backup.email_messages_dupes_20260909)        AS should_equal_preflight_total;


-- ── 5. Every constraint the plan promised — expect 15 rows ─────────────────
SELECT conrelid::regclass AS table_name, conname, contype
  FROM pg_constraint
 WHERE conname IN (
  'rpa_email_messages_pkey','rpa_email_messages_graph_message_id_key',
  'rpa_email_messages_account_id_fkey','rpa_email_messages_candidate_id_fkey',
  'rpa_email_messages_mrf_id_fkey','rpa_email_messages_shortlist_id_fkey',
  'rpa_email_messages_sent_by_user_id_fkey','rpa_email_messages_template_id_fkey',
  'rpa_email_tracking_pkey','rpa_email_tracking_tracking_token_key',
  'rpa_email_tracking_message_id_fkey','rpa_cv_tmp_pkey',
  'rpa_sessions_token_key','rpa_sessions_user_id_fkey','chk_resume_text_quality')
 ORDER BY 1, 2;


-- ── 6. Email Analytics is fixed, and no orphans remain ─────────────────────
-- The three orphan columns MUST be 0. status_rows should account for every
-- rpa_email_log row.
SELECT
  (SELECT count(*) FROM rpa_email_log WHERE status = 'sent')                 AS log_rows_marked_sent,
  (SELECT count(*) FROM rpa_email_log)                                       AS log_rows_total,
  (SELECT count(*) FROM rpa_email_messages m WHERE m.candidate_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM rpa_cv c WHERE c.id = m.candidate_id))    AS orphan_candidate_expect_0,
  (SELECT count(*) FROM rpa_email_messages m WHERE m.mrf_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM rpa_mrf f WHERE f.id = m.mrf_id))         AS orphan_mrf_expect_0,
  (SELECT count(*) FROM rpa_email_messages m WHERE m.shortlist_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM rpa_shortlisted_candidates s
                      WHERE s.id = m.shortlist_id))                          AS orphan_shortlist_expect_0;


-- ── 7. rpa_mrf experience columns are now integers ─────────────────────────
-- Both must read 'integer'. If either still says 'text', section 9 of the
-- parity script did not run.
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'rpa_mrf'
   AND column_name IN ('total_years_of_experience','relevant_years_of_experience')
 ORDER BY 1;


-- ── 8. The module-permission trigger seeds all 9 keys ──────────────────────
-- The returned function body MUST list 'outlook_email' and
-- 'recruitment_pipeline'. Without them, every NEW production user silently
-- never sees those two modules.
SELECT pg_get_functiondef(oid) AS seed_module_permissions_body
  FROM pg_proc WHERE proname = 'seed_module_permissions';

-- ...and existing users were backfilled. Expect 2 rows per user.
SELECT module_key, count(*) AS users, count(*) FILTER (WHERE is_enabled) AS enabled
  FROM rpa_module_permissions
 WHERE module_key IN ('outlook_email','recruitment_pipeline')
 GROUP BY module_key ORDER BY 1;


-- ── 9. Seed data (run AFTER the npm seed scripts) ──────────────────────────
SELECT
  (SELECT count(*) FROM rpa_pipeline_stages)          AS stages_expect_12,
  (SELECT count(*) FROM rpa_stage_outcomes)           AS outcomes_expect_45,
  (SELECT count(*) FROM rpa_outcome_reasons)          AS reasons_expect_9,
  (SELECT count(*) FROM rpa_document_checklist_items) AS checklist_expect_3,
  (SELECT count(*) FROM rpa_email_templates)          AS templates_was_15;


-- ── 10. Prove the fix actually holds ───────────────────────────────────────
-- Tries to re-insert a graph_message_id that already exists. It MUST fail and
-- roll back — that failure IS the proof the poller can no longer duplicate
-- mail. Nothing is written either way.
DO $$
DECLARE existing_id TEXT;
BEGIN
  SELECT graph_message_id INTO existing_id
    FROM rpa_email_messages WHERE graph_message_id IS NOT NULL LIMIT 1;
  IF existing_id IS NULL THEN
    RAISE NOTICE 'SKIPPED: no rows with a graph_message_id to test against';
    RETURN;
  END IF;
  BEGIN
    INSERT INTO rpa_email_messages
      (graph_message_id, conversation_id, direction, from_email, to_emails)
      VALUES (existing_id, '__probe__', 'inbound', 'probe@example.invalid',
              ARRAY['probe@example.invalid']);
    -- Reached only if the UNIQUE constraint is missing. Raising here aborts the
    -- block, which also rolls the probe row back — so a FAIL writes nothing either.
    RAISE EXCEPTION 'FAIL: the duplicate was ACCEPTED — the UNIQUE constraint is missing';
  EXCEPTION WHEN unique_violation THEN
    -- The rejected INSERT is rolled back to this block's implicit savepoint,
    -- so the probe leaves no trace.
    RAISE NOTICE 'PASS: duplicate re-insert rejected. The poller is now idempotent.';
  END;
END $$;
-- Look in the Messages tab for: "PASS: duplicate re-insert rejected."
