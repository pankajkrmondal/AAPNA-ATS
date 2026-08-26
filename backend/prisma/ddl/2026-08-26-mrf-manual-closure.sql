-- ============================================================================
-- Requisitions — manual closure, with a reason
-- Manual DDL — apply directly to PostgreSQL, then run:
--   cd backend && npx prisma db pull && npx prisma generate
-- Per the repo's documented workflow: the Prisma schema is NEVER hand-edited;
-- it is introspected from the live DB.
--
-- Idempotent, additive, non-destructive — safe to run multiple times.
--
-- WHY
-- ---
-- A requisition cancelled by the BUSINESS — budget pulled, role withdrawn,
-- filled by an external agency — had no representation in the system at all:
--
--   * there is no manual close endpoint (mrf.routes.js has none);
--   * the MRF page renders its status Select as `disabled`;
--   * fill state is written only by the automatic offer-acceptance path; and
--   * `grep -E 'closure_reason|reason_for_closure'` returned ZERO hits
--     repo-wide, so even the AUTOMATIC closure recorded *when* but never *why*.
--
-- Such a requisition therefore sat open in the JD dropdown forever, and a
-- recruiter had no way to say what had happened to it.
-- Logged as audit §2.6, filed as Q34, answered "yes — action + reason".
--
-- WHY NOT REUSE filled_at
-- -----------------------
-- A cancelled requisition was NOT filled, and filled_at's own column comment
-- says exactly that. Two further reasons make separate columns the safer shape:
--
--   1. reopenMrfIfUnfilled() clears ONLY filled_at. With a separate closed_at,
--      a candidate backing out can never silently resurrect a requisition the
--      business deliberately cancelled. Merging the two would need a new guard
--      to get that invariant back.
--   2. "Openings Filled: YES/NO" (mrfDetail.export.js) stays truthful, because
--      isMrfFilled() keeps meaning what its name says. The wider "is this still
--      hiring?" question moves to isMrfClosed().
-- ============================================================================

-- When a human closed this requisition, and why. NULL = not manually closed.
-- Independent of filled_at: a requisition is out of JD filtering if EITHER is
-- set, which is what isMrfClosed() (config/pipelineStages.js) encapsulates.
ALTER TABLE rpa_mrf
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ NULL;

-- Controlled vocabulary, written by BOTH closure paths:
--   all_openings_filled   -- written automatically by closeMrfIfFilled()
--   budget_withdrawn
--   role_withdrawn
--   hired_externally
--   on_hold_indefinitely
--   other                 -- requires closure_note
--
-- Deliberately NOT a CHECK constraint or an enum: every other status column in
-- this schema is a plain VARCHAR, and a CHECK is what makes adding a value a
-- migration instead of a config edit. The vocabulary lives in
-- config/pipelineStages.js and is validated in the service.
ALTER TABLE rpa_mrf
  ADD COLUMN IF NOT EXISTS closure_reason VARCHAR(50) NULL;

-- Free text for the 'other' reason, and optional colour on any of the rest.
-- Without this, 'other' records that something happened but not what — which
-- is the same gap this change set exists to close, one level down.
ALTER TABLE rpa_mrf
  ADD COLUMN IF NOT EXISTS closure_note TEXT NULL;

COMMENT ON COLUMN rpa_mrf.closed_at IS
  'When a human manually closed this requisition (NULL = not manually closed). Set/cleared by mrf.service.js. Independent of filled_at, which means "all openings filled"; a requisition leaves JD filtering if EITHER is set — ask isMrfClosed().';

COMMENT ON COLUMN rpa_mrf.closure_reason IS
  'Why this requisition closed. Written by BOTH paths: closeMrfIfFilled() stamps all_openings_filled, a manual close stamps the recruiter''s choice. Vocabulary lives in config/pipelineStages.js (MRF_CLOSURE_REASONS) — no CHECK constraint, so adding a value is a config edit and not a migration.';

COMMENT ON COLUMN rpa_mrf.closure_note IS
  'Free-text detail for the closure, required when closure_reason = ''other''.';

-- The hot read is "still hiring?" — the JD dropdown (getApprovedRoles), the
-- dashboard active tile, the pipeline board card. Both closure signals must be
-- absent, so the partial index is widened to match the new predicate.
-- Dropped and recreated rather than left alone: a partial index whose WHERE no
-- longer matches the query's WHERE is simply not used.
DROP INDEX IF EXISTS idx_rpa_mrf_open;
CREATE INDEX IF NOT EXISTS idx_rpa_mrf_open
  ON rpa_mrf (id)
  WHERE filled_at IS NULL AND closed_at IS NULL;

-- ----------------------------------------------------------------------------
-- Backfill: the automatic path's reason, retrospectively.
--
-- Every row already carrying filled_at was closed by closeMrfIfFilled(), so its
-- reason is known with certainty. Stamping it means the column is complete from
-- day one rather than only for closures made after this deploy — otherwise
-- "why did this close?" stays unanswerable for every historical requisition.
--
-- closed_at is deliberately NOT backfilled: these were filled, not manually
-- closed, and conflating the two would make isMrfFilled() and isMrfClosed()
-- indistinguishable on exactly the rows that prove they differ.
-- ----------------------------------------------------------------------------
UPDATE rpa_mrf
   SET closure_reason = 'all_openings_filled'
 WHERE filled_at IS NOT NULL
   AND closure_reason IS NULL;
