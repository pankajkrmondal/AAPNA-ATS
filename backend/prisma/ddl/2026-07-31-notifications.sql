-- ============================================================================
-- Phase 3 — Notification Centre
-- Manual DDL — apply directly to PostgreSQL, then run:
--   cd backend && npx prisma db pull && npx prisma generate
-- Per the repo's documented workflow: the Prisma schema is NEVER hand-edited;
-- it is introspected from the live DB.
--
-- Idempotent, additive, non-destructive — safe to run multiple times.
-- Apply AFTER 2026-07-21-pipeline-stage-engine.sql.
--
-- Replaces the in-memory header bell. Until now a notification existed only in
-- one browser tab's React state: it vanished on refresh, and a recruiter who was
-- logged out when it fired never saw it at all. Rows here survive both.
--
-- FAN-OUT ON WRITE: one row per recipient per event, rather than one event row
-- plus a join table for per-user read state. The recruitment team is a handful
-- of people, so duplicating a short text row keeps every read a plain
-- "WHERE user_id = $1" with no join, and marking one read is a single UPDATE.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rpa_notifications (
  id           BIGSERIAL PRIMARY KEY,

  -- The recipient. Deleting a user takes their inbox with them.
  user_id      INT NOT NULL REFERENCES rpa_users (id) ON UPDATE CASCADE ON DELETE CASCADE,

  -- Event key, e.g. 'pipeline.outcome' / 'document.uploaded'. Deliberately free
  -- text (no enum/CHECK) so a new event type is a code change, not a migration —
  -- the same choice rpa_interview_schedule.status made.
  type         VARCHAR(60) NOT NULL,

  title        VARCHAR(255) NOT NULL,
  description  TEXT,

  -- Deep-link target. pipeline_id is the candidate journey the notification is
  -- about (nullable: not every event has one, e.g. mrf.closed); link_path is the
  -- precomputed route the bell navigates to, e.g. '/pipeline?candidate=123'.
  pipeline_id  BIGINT REFERENCES rpa_candidate_pipeline (id) ON UPDATE CASCADE ON DELETE SET NULL,
  link_path    VARCHAR(255),

  -- Anything the renderer wants that isn't worth a column (outcome key, stage
  -- label, counts…).
  meta         JSONB,

  -- NULL = unread. A timestamp rather than a boolean so "when did they see it"
  -- is answerable later without another column.
  read_at      TIMESTAMPTZ,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The inbox query: newest first for one user.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON rpa_notifications (user_id, created_at DESC);

-- The unread badge — partial, so it stays small as read rows accumulate.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON rpa_notifications (user_id)
  WHERE read_at IS NULL;
