-- ============================================================================
-- ROLLBACK for 2026-10-20-error-log.sql.
-- Run with the same guarded runner:
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-10-20-error-log.rollback.sql
--
-- The backend build keeps working without the table: writes are caught and
-- logged, and Logs & errors shows an empty error list (log-file search and the
-- job/health panels still work). Job heartbeats live in rpa_settings
-- (keys job_heartbeat.<env>.<job>) and are not touched here.
--
-- What is lost: the recorded errors (at most 30 days of them).
-- ============================================================================

DROP TABLE IF EXISTS rpa_error_log;
