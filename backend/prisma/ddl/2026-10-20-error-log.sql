-- ============================================================================
-- Error log for Developer logging & error tracing (N42, Phase 3 section F).
-- Plan: docs/Phase 3 Enhancements or Feedback/PLAN-Phase3-Now.md §F (N42)
--
-- Apply with the guarded runner (never by hand in a SQL tool):
--   cd backend
--   node scripts/run-ddl.mjs --env .env.staging    --expect-db recruitmentautomationdb     --file prisma/ddl/2026-10-20-error-log.sql --dry-run
--   node scripts/run-ddl.mjs --env .env.staging    --expect-db recruitmentautomationdb     --file prisma/ddl/2026-10-20-error-log.sql
--   node scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd --file prisma/ddl/2026-10-20-error-log.sql
-- then `npm run prisma:generate` (schema.prisma already carries the model).
-- Staging FIRST. Idempotent and additive. Rollback: 2026-10-20-error-log.rollback.sql
--
-- WHY: errors only lived in log files on the server, so a developer could not
-- see them without logging in, and nothing tied what HR saw on screen to a log
-- line. One row per occurrence: backend 5xx errors, failed scheduled jobs,
-- crashes and browser errors, each with the request ref HR is shown.
--
-- Safe before the backend build: nothing reads or writes it until then. The
-- build is also safe before this file: writes to a missing table are caught
-- and only logged.
--
-- Retention: rows older than 30 days are deleted nightly (02:45 IST) by
-- backend/src/jobs/errorLogRetentionSweep.js.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rpa_error_log (
  id           BIGSERIAL     PRIMARY KEY,
  source       VARCHAR(20)   NOT NULL,
  env          VARCHAR(20)   NOT NULL,
  level        VARCHAR(10)   NOT NULL DEFAULT 'error',
  message      TEXT          NOT NULL,
  stack        TEXT,
  request_id   VARCHAR(80),
  route        VARCHAR(300),
  user_id      INT,
  meta         JSONB,
  fingerprint  VARCHAR(40)   NOT NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  -- No FK on user_id: an error must still be recordable for a deleted user,
  -- and the log must never block a user delete.
  CONSTRAINT chk_error_log_source CHECK (source IN ('backend', 'frontend', 'job')),
  CONSTRAINT chk_error_log_level  CHECK (level IN ('error', 'warn'))
);

COMMENT ON TABLE rpa_error_log IS
  'Errors from the backend, scheduled jobs and browsers, one row per occurrence (N42). Kept 30 days.';
COMMENT ON COLUMN rpa_error_log.request_id IS
  'The ref shown to the user ("ref: K7Q2MX") or job-<name>-<ref>; search key on Logs & errors.';
COMMENT ON COLUMN rpa_error_log.fingerprint IS
  'Groups repeats of the same error: hash of source, error name/code, route and top stack frame.';
COMMENT ON COLUMN rpa_error_log.meta IS
  'A few whitelisted keys only (status, job, url path, browser). Masked; never bodies or personal data.';

CREATE INDEX IF NOT EXISTS idx_error_log_request_id  ON rpa_error_log (request_id);
CREATE INDEX IF NOT EXISTS idx_error_log_fingerprint ON rpa_error_log (fingerprint, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_log_created_at  ON rpa_error_log (created_at DESC);
