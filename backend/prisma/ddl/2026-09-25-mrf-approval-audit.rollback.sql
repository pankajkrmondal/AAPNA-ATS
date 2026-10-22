-- ============================================================================
-- ROLLBACK for 2026-09-25-mrf-approval-audit.sql. DESTROYS the approval audit
-- trail, so use only to back out a failed release, never casually.
-- Run with the same guarded runner:
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-09-25-mrf-approval-audit.rollback.sql
-- approval_status is untouched by both scripts, so no MRF changes state.
-- Before rolling back production, first set MRF_APPROVAL_AUDIT_ENABLED=false
-- (the app then uses the shared-link flow and no longer reads these tables).
-- ============================================================================

DROP TRIGGER IF EXISTS trg_mrf_approval_events_guard_truncate ON rpa_mrf_approval_events;
DROP TRIGGER IF EXISTS trg_mrf_approval_events_guard ON rpa_mrf_approval_events;
DROP FUNCTION IF EXISTS rpa_mrf_approval_events_guard();
DROP TABLE IF EXISTS rpa_mrf_approval_events;
DROP TABLE IF EXISTS rpa_mrf_approval_tokens;

ALTER TABLE rpa_mrf DROP COLUMN IF EXISTS decision_event_id;
ALTER TABLE rpa_mrf DROP COLUMN IF EXISTS decision_comments;
ALTER TABLE rpa_mrf DROP COLUMN IF EXISTS decided_ip;
ALTER TABLE rpa_mrf DROP COLUMN IF EXISTS decided_at;
ALTER TABLE rpa_mrf DROP COLUMN IF EXISTS decided_by_name;
ALTER TABLE rpa_mrf DROP COLUMN IF EXISTS decided_by_email;
