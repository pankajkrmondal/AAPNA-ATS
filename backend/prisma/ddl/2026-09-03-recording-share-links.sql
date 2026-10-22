-- ============================================================================
-- Phase 4 — no-login, expiring share links for interview recordings
-- Manual DDL — apply then: cd backend && npm run prisma:pull && npm run prisma:generate
-- Idempotent, additive, non-destructive. No existing column or row is touched.
--
-- WHY: a candidate dossier is emailed to an interviewer with no ATS account, and
-- HR chose (decision #7) that recordings travel as an expiring no-login link
-- rather than as bytes — an MP4 round is hundreds of MB and three rounds would
-- make the pack unmailable.
--
-- THIS IS THE HIGHEST-RISK SURFACE IN THE FEATURE: an unauthenticated URL to a
-- video of a real person. Every column below is a control, not bookkeeping.
--
--   token           gen_random_uuid(), the same construction as
--                   rpa_interview_scorecard.token — 122 bits, not guessable.
--   recording_id    ONE LINK, ONE RECORDING. Never a link to "the candidate's
--                   recordings": a leak must expose one round, not the set.
--   expires_at      Checked server-side on every request, never trusted from the
--                   URL. Default now + DOSSIER_SHARE_LINK_DAYS (14).
--   revoked_at      The kill switch. Without it decision #7 has no undo, so the
--                   drawer exposes it as a button rather than an API call.
--   view_count      A cheap abuse signal: a link opened 40 times is not one
--                   interviewer.
--   created_by      Joins a leaked recording back to the pack it came from, via
--                   the dossier download audit row written at the same moment.
--
-- ON DELETE CASCADE from the recording: if the recording row goes, so does every
-- way to reach it. A share link outliving its subject would be a link nobody
-- could audit or revoke, because nothing in the UI would list it any more.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rpa_recording_share_link (
  id             BIGSERIAL PRIMARY KEY,
  token          UUID        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  recording_id   BIGINT      NOT NULL,
  pipeline_id    BIGINT      NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_by     VARCHAR(255),
  created_by_id  INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at     TIMESTAMPTZ,
  revoked_by     VARCHAR(255),
  revoked_by_id  INT,
  view_count     INT         NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  CONSTRAINT fk_recording_share_recording
    FOREIGN KEY (recording_id) REFERENCES rpa_interview_recording(id) ON DELETE CASCADE,
  CONSTRAINT fk_recording_share_pipeline
    FOREIGN KEY (pipeline_id) REFERENCES rpa_candidate_pipeline(id)
);

COMMENT ON TABLE rpa_recording_share_link IS
  'No-login, expiring, revocable links to ONE interview recording each, minted '
  'when a candidate dossier is downloaded with recording links included. Plan: '
  'docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md 6.5.';

COMMENT ON COLUMN rpa_recording_share_link.token IS
  'The only credential the link carries. Bearer-authenticated by design: anyone '
  'holding it can watch until it expires or is revoked.';

COMMENT ON COLUMN rpa_recording_share_link.expires_at IS
  'Enforced server-side on every request. Changing this column does NOT extend a '
  'link the viewer already holds any further than the new value.';

COMMENT ON COLUMN rpa_recording_share_link.revoked_at IS
  'Set from the drawer''s Shared links list. Refusal is immediate, not at next '
  'expiry — that is the whole point of having it.';

CREATE INDEX IF NOT EXISTS idx_recording_share_recording
  ON rpa_recording_share_link(recording_id);

CREATE INDEX IF NOT EXISTS idx_recording_share_pipeline
  ON rpa_recording_share_link(pipeline_id);

-- Live links only, for the drawer's list and for reuse when a second dossier is
-- downloaded for the same candidate: minting a fresh link per download would
-- leave a trail of live URLs nobody remembers to revoke.
CREATE INDEX IF NOT EXISTS idx_recording_share_live
  ON rpa_recording_share_link(recording_id, expires_at)
  WHERE revoked_at IS NULL;
