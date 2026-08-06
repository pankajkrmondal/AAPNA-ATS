-- ============================================================================
-- Phase 3 — Module 5: Offer Management
-- Manual DDL — apply directly to PostgreSQL, then run:
--   cd backend && npx prisma db pull && npx prisma generate
-- Per the repo's documented workflow: the Prisma schema is NEVER hand-edited;
-- it is introspected from the live DB.
--
-- Idempotent, additive, non-destructive — safe to run multiple times.
-- Apply AFTER 2026-07-21-pipeline-stage-engine.sql.
--
-- RECORD-ONLY scope (Q3, reinforced by RT 2026-07-14): appointment/offer letters
-- are prepared and shared by HR entirely outside the ATS. This table therefore
-- stores no letter file and no letter URL — only the dates, the internal
-- approval, and the candidate's decision. Closure itself is NOT here: it stays
-- on rpa_candidate_pipeline.final_outcome via setFinalOutcome().
-- ============================================================================

CREATE TABLE IF NOT EXISTS rpa_offers (
  id                    BIGSERIAL PRIMARY KEY,
  -- One offer per journey; re-offers overwrite rather than accumulate (RT: no
  -- version tracking — revisions are handled manually outside the ATS).
  pipeline_id           BIGINT NOT NULL UNIQUE
                          REFERENCES rpa_candidate_pipeline (id) ON UPDATE CASCADE ON DELETE CASCADE,

  -- Internal approval before an offer goes out. A SOFT gate (Q26): recording
  -- "shared" without approval is allowed for exceptional cases, so this is a
  -- record of what happened, not an enforced state machine.
  approval_status       VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending' | 'approved'
  approval_requested_at TIMESTAMPTZ,
  approval_nudged_at    TIMESTAMPTZ,   -- last daily reminder (idempotency for the nudge job)
  approved_by           INT REFERENCES rpa_users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  approved_at           TIMESTAMPTZ,

  -- The offer itself, as recorded after HR shares it from their own mailbox.
  shared_at             TIMESTAMPTZ,
  shared_by             INT REFERENCES rpa_users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  joining_date          DATE,

  -- The candidate's answer.
  candidate_decision    VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'rejected'
  decision_at           TIMESTAMPTZ,

  remarks               TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drives the daily approval-nudge sweep: "approval requested but not approved".
CREATE INDEX IF NOT EXISTS idx_offers_awaiting_approval
  ON rpa_offers (approval_requested_at)
  WHERE approval_status = 'pending';

-- Drives the 90-day post-Joined auto-close sweep (Q12).
CREATE INDEX IF NOT EXISTS idx_offers_joining_date
  ON rpa_offers (joining_date)
  WHERE candidate_decision = 'accepted';
