-- ============================================================================
-- PROD-1  CHECK (read-only).  Run in pgAdmin on recruitmentautomationdbProd.
-- Safe to run any time, before and after PROD-2. Changes nothing.
-- Shows whether the MRF approval audit DB changes are already applied.
-- ============================================================================

-- 1) Which database am I on?  Must say: recruitmentautomationdbProd
SELECT current_database() AS database;

-- 2) One-row status: before PROD-2 expect  tables=0  columns=0  triggers=0  approvers=NOT SET
--                    after  PROD-2 expect  tables=2  columns=6  triggers=2  approvers=SET
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('rpa_mrf_approval_tokens', 'rpa_mrf_approval_events'))           AS tables,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'rpa_mrf'
      AND column_name IN ('decided_by_email', 'decided_by_name', 'decided_at',
                          'decided_ip', 'decision_comments', 'decision_event_id'))      AS columns,
  (SELECT count(*) FROM pg_trigger
    WHERE tgname LIKE 'trg_mrf_approval_events_guard%')                                 AS triggers,
  CASE WHEN EXISTS (SELECT 1 FROM rpa_settings WHERE key = 'mrf_approvers')
       THEN 'SET' ELSE 'NOT SET' END                                                    AS approvers;

-- 3) Approver list (after PROD-2: Abhijit Roy + Sanghamitra Roy)
SELECT key, value FROM rpa_settings
 WHERE key IN ('mrf_approvers', 'email_recipients.mrfOutcome.cc', 'reminder_max_count');

-- 4) After PROD-2 only (errors before PROD-2 because the columns do not exist yet):
--    already-decided MRFs backfilled as "Unknown (before audit trail)".
--    Expect at least MRFs 6, 7, 8, 9; MRF 9 decided_at = 2026-09-23 17:13:25+00 (22:43 IST).
-- SELECT id, approval_status, decided_by_name, decided_at FROM rpa_mrf
--  WHERE decided_at IS NOT NULL ORDER BY id;
