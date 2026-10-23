-- ============================================================================
-- MRF Hold + decisions on behalf of absent approvers (HR Admin Recruiter)
-- Plan: docs/phase3/MRF/MRF-Hold-and-Delegate-Approval-Plan.md §5
--
-- Apply with the guarded runner (never by hand in a SQL tool):
--   cd backend
--   node scripts/run-ddl.mjs --env .env.staging    --expect-db recruitmentautomationdb     --file prisma/ddl/2026-10-22-mrf-hold-and-delegate.sql
--   node scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd --file prisma/ddl/2026-10-22-mrf-hold-and-delegate.sql
-- then `npm run prisma:generate` (stop the dev server AND the queue worker first).
-- Staging FIRST. Idempotent and additive: re-running changes nothing, and code
-- that predates it keeps working (new columns are nullable / defaulted; the
-- CHECK lists only grow).
-- Rollback: 2026-10-22-mrf-hold-and-delegate.rollback.sql
--
-- WHY: approvers could only approve or reject. A requisition the business
-- wanted to park ("budget freeze until Q3") had to be rejected and re-raised,
-- or left pending and forgotten. Hold parks it with a note and a hold-until
-- date; on that date it returns to pending and both approvers are emailed again.
-- Separately, when both approvers are away nobody could decide at all; an HR
-- Admin Recruiter / Admin / Super Admin may now decide from the ATS during an
-- absence window, and that decision is recorded as such.
--
-- `approval_status` stays a free-text column; the new value is 'held'. The
-- Prisma enum `approval_status` is not used by any column, so it is left alone.
-- ============================================================================

-- Hold state AT THE APPROVAL GATE. Deliberately NOT the paused_* / resume_on
-- columns: those pause an APPROVED requisition (they already drive "Paused" in
-- analytics and the pause-aware JD dropdown). Two lifecycles, two sets of columns.
ALTER TABLE rpa_mrf ADD COLUMN IF NOT EXISTS held_at          TIMESTAMPTZ;
ALTER TABLE rpa_mrf ADD COLUMN IF NOT EXISTS held_until       DATE;
ALTER TABLE rpa_mrf ADD COLUMN IF NOT EXISTS held_by_email    VARCHAR(255);
ALTER TABLE rpa_mrf ADD COLUMN IF NOT EXISTS held_by_name     VARCHAR(255);
ALTER TABLE rpa_mrf ADD COLUMN IF NOT EXISTS hold_note        VARCHAR(2000);
ALTER TABLE rpa_mrf ADD COLUMN IF NOT EXISTS hold_count       INT NOT NULL DEFAULT 0;
ALTER TABLE rpa_mrf ADD COLUMN IF NOT EXISTS hold_released_at TIMESTAMPTZ;
-- 'email_link' (an approver's personal link) | 'ats_delegate' (decided in the
-- ATS on behalf of absent approvers). NULL for decisions before this existed.
ALTER TABLE rpa_mrf ADD COLUMN IF NOT EXISTS decided_via      VARCHAR(20);

COMMENT ON COLUMN rpa_mrf.held_until IS
  'Hold-until date (IST) of an MRF held at the APPROVAL GATE (approval_status = ''held''). On this date mrfHoldSweep returns it to pending and re-sends approval links to every approver. Not the same as resume_on, which belongs to a PAUSED approved requisition.';
COMMENT ON COLUMN rpa_mrf.hold_count IS
  'How many times this MRF has been put on hold. There is no limit; each hold is capped by the mrf_hold_max_days setting.';
COMMENT ON COLUMN rpa_mrf.decided_via IS
  'How the final approve/reject was given: email_link (approver''s personal link) or ats_delegate (in the ATS, on behalf of absent approvers).';

-- The sweep's only query: held rows due today or earlier.
CREATE INDEX IF NOT EXISTS idx_rpa_mrf_held_due
  ON rpa_mrf (held_until) WHERE approval_status = 'held';

-- Audit event types: every existing value plus the hold / on-behalf ones.
ALTER TABLE rpa_mrf_approval_events DROP CONSTRAINT IF EXISTS chk_mrf_approval_events_type;
ALTER TABLE rpa_mrf_approval_events ADD CONSTRAINT chk_mrf_approval_events_type CHECK (event_type IN (
  'request_sent', 'link_opened', 'approved', 'rejected', 'attempt_after_decision',
  'token_invalid', 'token_expired', 'token_revoked_used', 'other_approvers_notified',
  'decision_confirmation_sent', 'links_reissued', 'backfilled',
  'held', 'hold_date_changed', 'hold_released', 'hold_notice_sent', 'delegate_notice_sent'));

-- Identity: a logged-in ATS user (deciding on behalf of the approvers, or
-- changing / releasing a hold) as well as a personal link or the system.
ALTER TABLE rpa_mrf_approval_events DROP CONSTRAINT IF EXISTS chk_mrf_approval_events_identity;
ALTER TABLE rpa_mrf_approval_events ADD CONSTRAINT chk_mrf_approval_events_identity CHECK (identity_source IN (
  'personal_link', 'legacy_shared_link', 'system', 'ats_user'));

-- Why a link stopped working: also when the MRF was held, or decided in the ATS.
ALTER TABLE rpa_mrf_approval_tokens DROP CONSTRAINT IF EXISTS chk_mrf_approval_tokens_revoked_reason;
ALTER TABLE rpa_mrf_approval_tokens ADD CONSTRAINT chk_mrf_approval_tokens_revoked_reason
  CHECK (revoked_reason IS NULL OR revoked_reason IN
    ('decided_by_other', 'expired', 'reissued', 'mrf_closed', 'held', 'decided_by_delegate'));
