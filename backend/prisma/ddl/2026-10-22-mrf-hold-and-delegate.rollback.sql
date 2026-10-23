-- ============================================================================
-- ROLLBACK for 2026-10-22-mrf-hold-and-delegate.sql.
-- Run with the same guarded runner:
--   node scripts/run-ddl.mjs --env <env file> --expect-db <db> --file prisma/ddl/2026-10-22-mrf-hold-and-delegate.rollback.sql
--
-- First deploy the previous backend build (it never reads these columns), or at
-- least turn MRF_HOLD_ENABLED and MRF_DELEGATE_DECISION_ENABLED off.
--
-- Held MRFs are returned to 'pending' first, so none is stranded in a status the
-- old code does not know; their approvers can then be re-sent links with the
-- existing "Re-send approval links" button. The CHECK lists are narrowed back
-- only after the rows that use the new values are gone. The audit trail is
-- append-only (trigger), so events that use the new types or identity CANNOT be
-- deleted: if any exist, the narrowed constraints are added NOT VALID, which
-- keeps the history and blocks new rows of those kinds.
--
-- What is lost: the hold columns (note, hold-until date, hold count) and
-- decided_via. The approval trail keeps every hold / on-behalf event.
-- ============================================================================

UPDATE rpa_mrf SET approval_status = 'pending' WHERE approval_status = 'held';
UPDATE rpa_mrf_jd_send SET mrfstatus = 'pending' WHERE mrfstatus = 'held';

UPDATE rpa_mrf_approval_tokens SET revoked_reason = 'reissued'
 WHERE revoked_reason IN ('held', 'decided_by_delegate');

ALTER TABLE rpa_mrf_approval_tokens DROP CONSTRAINT IF EXISTS chk_mrf_approval_tokens_revoked_reason;
ALTER TABLE rpa_mrf_approval_tokens ADD CONSTRAINT chk_mrf_approval_tokens_revoked_reason
  CHECK (revoked_reason IS NULL OR revoked_reason IN ('decided_by_other', 'expired', 'reissued', 'mrf_closed'));

ALTER TABLE rpa_mrf_approval_events DROP CONSTRAINT IF EXISTS chk_mrf_approval_events_type;
ALTER TABLE rpa_mrf_approval_events ADD CONSTRAINT chk_mrf_approval_events_type CHECK (event_type IN (
  'request_sent', 'link_opened', 'approved', 'rejected', 'attempt_after_decision',
  'token_invalid', 'token_expired', 'token_revoked_used', 'other_approvers_notified',
  'decision_confirmation_sent', 'links_reissued', 'backfilled')) NOT VALID;

ALTER TABLE rpa_mrf_approval_events DROP CONSTRAINT IF EXISTS chk_mrf_approval_events_identity;
ALTER TABLE rpa_mrf_approval_events ADD CONSTRAINT chk_mrf_approval_events_identity CHECK (identity_source IN (
  'personal_link', 'legacy_shared_link', 'system')) NOT VALID;

DROP INDEX IF EXISTS idx_rpa_mrf_held_due;

ALTER TABLE rpa_mrf DROP COLUMN IF EXISTS decided_via;
ALTER TABLE rpa_mrf DROP COLUMN IF EXISTS hold_released_at;
ALTER TABLE rpa_mrf DROP COLUMN IF EXISTS hold_count;
ALTER TABLE rpa_mrf DROP COLUMN IF EXISTS hold_note;
ALTER TABLE rpa_mrf DROP COLUMN IF EXISTS held_by_name;
ALTER TABLE rpa_mrf DROP COLUMN IF EXISTS held_by_email;
ALTER TABLE rpa_mrf DROP COLUMN IF EXISTS held_until;
ALTER TABLE rpa_mrf DROP COLUMN IF EXISTS held_at;
