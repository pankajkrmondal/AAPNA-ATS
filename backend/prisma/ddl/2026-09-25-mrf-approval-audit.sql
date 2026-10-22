-- ============================================================================
-- MRF approval audit trail: per-approver links + tamper-evident decision proof
-- Plan: docs/phase3/New MRF Request - Approval Request/MRF-Approval-Unified-Fix-Plan.md §6.2
--
-- Apply with the guarded runner (never by hand in a SQL tool):
--   cd backend
--   node scripts/run-ddl.mjs --env .env.staging    --expect-db recruitmentautomationdb     --file prisma/ddl/2026-09-25-mrf-approval-audit.sql
--   node scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd --file prisma/ddl/2026-09-25-mrf-approval-audit.sql
-- then `npm run prisma:generate` (schema.prisma already carries the models).
-- Staging FIRST (D4). Idempotent and additive: re-running changes nothing.
-- Rollback: 2026-09-25-mrf-approval-audit.rollback.sql
--
-- WHY: every approver used to get the SAME link, and nothing recorded who
-- clicked it. On 23 Sep 2026 MRF #9 was approved through that link and nobody
-- could say by whom (production investigation, plan §1). These tables make a
-- decision provable: which approver's personal link was used, when, from which
-- IP and device, with what comment, and who else was told.
-- ============================================================================

-- One row per approver per MRF: the personal link. The JWT only carries
-- token_jti; the approver's identity always comes from THIS row, never from
-- anything the browser sends.
CREATE TABLE IF NOT EXISTS rpa_mrf_approval_tokens (
  id               BIGSERIAL    PRIMARY KEY,
  mrf_id           BIGINT       NOT NULL,
  approver_email   VARCHAR(255) NOT NULL,
  approver_name    VARCHAR(255),
  token_jti        UUID         NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  email_log_id     INT,
  issued_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ  NOT NULL,
  first_opened_at  TIMESTAMPTZ,
  last_opened_at   TIMESTAMPTZ,
  open_count       INT          NOT NULL DEFAULT 0,
  used_at          TIMESTAMPTZ,
  revoked_at       TIMESTAMPTZ,
  revoked_reason   VARCHAR(50),
  CONSTRAINT fk_mrf_approval_tokens_mrf
    FOREIGN KEY (mrf_id) REFERENCES rpa_mrf(id) ON DELETE CASCADE,
  CONSTRAINT chk_mrf_approval_tokens_revoked_reason
    CHECK (revoked_reason IS NULL OR revoked_reason IN ('decided_by_other', 'expired', 'reissued', 'mrf_closed'))
);

COMMENT ON TABLE rpa_mrf_approval_tokens IS
  'Personal MRF approval links, one per approver per MRF. Identity of whoever '
  'decides is taken from this row (by token_jti), never from the request.';

CREATE INDEX IF NOT EXISTS idx_mrf_approval_tokens_mrf ON rpa_mrf_approval_tokens(mrf_id);
CREATE INDEX IF NOT EXISTS idx_mrf_approval_tokens_email ON rpa_mrf_approval_tokens(approver_email);
CREATE INDEX IF NOT EXISTS idx_mrf_approval_tokens_log ON rpa_mrf_approval_tokens(email_log_id);

-- Append-only proof. The trigger below blocks UPDATE/DELETE/TRUNCATE except the
-- narrow retention masking the nightly sweep performs.
CREATE TABLE IF NOT EXISTS rpa_mrf_approval_events (
  id                     BIGSERIAL     PRIMARY KEY,
  mrf_id                 BIGINT        NOT NULL,
  token_id               BIGINT,
  event_type             VARCHAR(40)   NOT NULL,
  actor_email            VARCHAR(255),
  actor_name             VARCHAR(255),
  identity_source        VARCHAR(20)   NOT NULL DEFAULT 'system',
  ip_address             INET,
  user_agent             VARCHAR(512),
  client_data_masked_at  TIMESTAMPTZ,
  prior_status           VARCHAR(20),
  new_status             VARCHAR(20),
  comments               VARCHAR(2000),
  likely_scanner         BOOLEAN       NOT NULL DEFAULT false,
  meta                   JSONB,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT fk_mrf_approval_events_mrf
    FOREIGN KEY (mrf_id) REFERENCES rpa_mrf(id),
  CONSTRAINT fk_mrf_approval_events_token
    FOREIGN KEY (token_id) REFERENCES rpa_mrf_approval_tokens(id),
  CONSTRAINT chk_mrf_approval_events_type CHECK (event_type IN (
    'request_sent', 'link_opened', 'approved', 'rejected', 'attempt_after_decision',
    'token_invalid', 'token_expired', 'token_revoked_used', 'other_approvers_notified',
    'decision_confirmation_sent', 'links_reissued', 'backfilled')),
  CONSTRAINT chk_mrf_approval_events_identity CHECK (identity_source IN (
    'personal_link', 'legacy_shared_link', 'system'))
);

COMMENT ON TABLE rpa_mrf_approval_events IS
  'Append-only MRF approval trail (who/when/IP/device/comment). Protected by '
  'trg_mrf_approval_events_guard; only the retention sweep may mask old IP/UA.';

CREATE INDEX IF NOT EXISTS idx_mrf_approval_events_mrf ON rpa_mrf_approval_events(mrf_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mrf_approval_events_type ON rpa_mrf_approval_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_mrf_approval_events_actor ON rpa_mrf_approval_events(actor_email);

-- Tamper guard. The ONLY permitted change is the retention sweep, which runs
-- with SET LOCAL app.audit_retention = 'on' and may then (a) mask ip_address /
-- user_agent on rows older than the retention period, and (b) delete
-- link_opened rows older than it. Everything else is refused.
CREATE OR REPLACE FUNCTION rpa_mrf_approval_events_guard() RETURNS trigger AS $guard$
DECLARE
  retention_days INT := GREATEST(
    COALESCE(NULLIF(current_setting('app.audit_retention_days', true), '')::int, 365), 30);
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'rpa_mrf_approval_events is append-only (TRUNCATE refused)';
  END IF;
  IF current_setting('app.audit_retention', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'rpa_mrf_approval_events is append-only (% refused)', TG_OP;
  END IF;
  IF OLD.created_at > now() - make_interval(days => retention_days) THEN
    RAISE EXCEPTION 'retention sweep may only touch rows older than % days', retention_days;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.event_type <> 'link_opened' THEN
      RAISE EXCEPTION 'only link_opened events may be deleted by the retention sweep';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW.id, NEW.mrf_id, NEW.token_id, NEW.event_type, NEW.actor_email, NEW.actor_name,
      NEW.identity_source, NEW.prior_status, NEW.new_status, NEW.comments,
      NEW.likely_scanner, NEW.meta, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.mrf_id, OLD.token_id, OLD.event_type, OLD.actor_email, OLD.actor_name,
      OLD.identity_source, OLD.prior_status, OLD.new_status, OLD.comments,
      OLD.likely_scanner, OLD.meta, OLD.created_at) THEN
    RAISE EXCEPTION 'retention sweep may only change ip_address, user_agent and client_data_masked_at';
  END IF;
  RETURN NEW;
END
$guard$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mrf_approval_events_guard ON rpa_mrf_approval_events;
CREATE TRIGGER trg_mrf_approval_events_guard
  BEFORE UPDATE OR DELETE ON rpa_mrf_approval_events
  FOR EACH ROW EXECUTE FUNCTION rpa_mrf_approval_events_guard();

DROP TRIGGER IF EXISTS trg_mrf_approval_events_guard_truncate ON rpa_mrf_approval_events;
CREATE TRIGGER trg_mrf_approval_events_guard_truncate
  BEFORE TRUNCATE ON rpa_mrf_approval_events
  FOR EACH STATEMENT EXECUTE FUNCTION rpa_mrf_approval_events_guard();

-- Summary of the final decision on the MRF itself, for lists and exports. The
-- events table stays the source of truth. approval_status is NOT changed.
ALTER TABLE rpa_mrf ADD COLUMN IF NOT EXISTS decided_by_email  VARCHAR(255);
ALTER TABLE rpa_mrf ADD COLUMN IF NOT EXISTS decided_by_name   VARCHAR(255);
ALTER TABLE rpa_mrf ADD COLUMN IF NOT EXISTS decided_at        TIMESTAMPTZ;
ALTER TABLE rpa_mrf ADD COLUMN IF NOT EXISTS decided_ip        INET;
ALTER TABLE rpa_mrf ADD COLUMN IF NOT EXISTS decision_comments VARCHAR(2000);
ALTER TABLE rpa_mrf ADD COLUMN IF NOT EXISTS decision_event_id BIGINT;

-- ── Backfill (condition-based, never by id; safe to re-run) ─────────────────
-- Already-decided MRFs that have an outcome email get their decision time from
-- it (the outcome email is sent within seconds of the decision). Who decided is
-- unknowable for these; they are labelled so, never guessed.
-- rpa_email_log.sent_at is `timestamp without time zone` holding UTC.
UPDATE rpa_mrf m
   SET decided_at        = o.sent_at AT TIME ZONE 'UTC',
       decided_by_name   = 'Unknown (before audit trail)',
       decision_comments = NULLIF(trim(regexp_replace(
         substring(o.body_html from 'Comment from Management:</strong>(.*?)</p>'),
         '<[^>]+>', '', 'g')), '')
  FROM (
    SELECT DISTINCT ON (reference_id) reference_id, sent_at, body_html
      FROM rpa_email_log
     WHERE email_type IN ('mrf_approved', 'mrf_declined') AND status = 'sent'
     ORDER BY reference_id, sent_at
  ) o
 WHERE o.reference_id = m.id
   AND m.decided_at IS NULL
   AND lower(trim(m.approval_status)) NOT IN ('pending', 'waiting');

INSERT INTO rpa_mrf_approval_events
       (mrf_id, event_type, actor_name, identity_source, new_status, comments, meta, created_at)
SELECT m.id, 'backfilled', 'Unknown (before audit trail)', 'system', m.approval_status,
       m.decision_comments,
       jsonb_build_object('source', 'rpa_email_log outcome email',
                          'note', 'Decided before the approval audit trail existed; the approver is not recorded anywhere.'),
       m.decided_at
  FROM rpa_mrf m
 WHERE m.decided_at IS NOT NULL
   AND m.decided_by_name = 'Unknown (before audit trail)'
   AND NOT EXISTS (SELECT 1 FROM rpa_mrf_approval_events e
                    WHERE e.mrf_id = m.id AND e.event_type = 'backfilled');

UPDATE rpa_mrf m
   SET decision_event_id = e.id
  FROM rpa_mrf_approval_events e
 WHERE e.mrf_id = m.id AND e.event_type = 'backfilled'
   AND m.decision_event_id IS NULL;
