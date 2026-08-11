-- ============================================================================
-- Requisitions — separate "filled" from "approved"
-- Manual DDL — apply directly to PostgreSQL, then run:
--   cd backend && npx prisma db pull && npx prisma generate
-- Per the repo's documented workflow: the Prisma schema is NEVER hand-edited;
-- it is introspected from the live DB.
--
-- Idempotent, additive, non-destructive — safe to run multiple times.
--
-- WHY
-- ---
-- "All openings are filled" was being expressed by OVERWRITING two status
-- columns that mean something else, saving neither prior value:
--
--   1. rpa_mrf.approval_status  -> 'closed', restored to a hardcoded
--      'approved' on re-open. But 'completed' is the most common status in
--      practice, and getApprovedRoles() treats the two differently:
--          approval_status = 'approved'
--       OR (approval_status = 'completed' AND approved_by_abhijit IN ('approved','true'))
--      So a 'completed' requisition that filled and later re-opened came back
--      as 'approved' — permanently escaping the approved_by_abhijit gate.
--
--   2. rpa_mrf_jd_send.mrfstatus -> 'closed'. That column is the protected
--      "raise status" workflow field (pendingfromleader / managersubmitted /
--      …) which the MRF page FILTERS and DISPLAYS on, and which
--      mrf.controller.js documents as "intentionally NOT accepted" from user
--      edits. The write was an updateMany on a loose, non-FK mrf_id, so a
--      single requisition could rewrite dozens of unrelated request rows.
--
-- Approved and Filled are independent facts. This column stores the second one
-- so neither status column is ever written by the closure path again.
-- ============================================================================

-- When every opening on this requisition was filled. NULL = still hiring.
-- Nullable rather than a boolean so the moment it filled is auditable, and so
-- re-opening is a plain "set back to NULL".
ALTER TABLE rpa_mrf
  ADD COLUMN IF NOT EXISTS filled_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN rpa_mrf.filled_at IS
  'When all openings were filled (NULL = still hiring). Set/cleared by mrfClosure.service.js. Independent of approval_status, which must never be overwritten to express fill state.';

-- Every hot read is "still hiring?" (JD dropdown, dashboard active tile), so
-- index the NULL side only — the filled rows are the minority and are not the
-- ones being scanned.
CREATE INDEX IF NOT EXISTS idx_rpa_mrf_open
  ON rpa_mrf (id)
  WHERE filled_at IS NULL;

-- ----------------------------------------------------------------------------
-- Backfill for environments that already ran the lossy closure path.
--
-- Any requisition sitting in approval_status='closed' was closed by the old
-- code. Record that it is filled, but DELIBERATELY LEAVE approval_status
-- ALONE: its true prior value ('approved' vs 'completed') was destroyed at
-- closure time and is unrecoverable. Guessing would repeat the original
-- mistake. See the README — these rows need a human to set the right status.
--
-- getApprovedRoles() whitelists only 'approved'/'completed', so they stay
-- correctly out of JD filtering in the meantime.
-- ----------------------------------------------------------------------------
-- NB: rpa_mrf has created_at but no modified_at, so the closure moment cannot
-- be recovered from the row itself — created_at is the closest honest floor.
UPDATE rpa_mrf
   SET filled_at = COALESCE(created_at, NOW())
 WHERE approval_status = 'closed'
   AND filled_at IS NULL;
