-- ============================================================================
-- Phase 3 — Module 4: Document Collection
-- Manual DDL — apply directly to PostgreSQL, then run:
--   cd backend && npx prisma db pull && npx prisma generate
-- Per the repo's documented workflow: the Prisma schema is NEVER hand-edited;
-- it is introspected from the live DB.
--
-- Idempotent, additive, non-destructive — safe to run multiple times.
-- Apply AFTER 2026-07-21-pipeline-stage-engine.sql.
--
-- Fires after the final interview rounds clear and before the offer goes out:
-- HR triggers the request -> the candidate uploads via a no-login tokenized
-- link -> HR verifies each document (or rejects it with a reason, which
-- re-opens that one item for re-upload).
--
-- RETENTION (RT-confirmed 2026-07-14): documents are NEVER deleted. Records get
-- pulled up to 3 years later for appraisals. There is deliberately no hard
-- delete or expiry job anywhere in this module.
-- ============================================================================

-- The checklist is DATA, not code, so the list can change without a redeploy.
-- Seeded (see prisma/seed-document-checklist.js) with the list from Chhaya's
-- 2026-07-14 request template, which is narrower than the older 4-item draft.
CREATE TABLE IF NOT EXISTS rpa_document_checklist_items (
  id          SERIAL PRIMARY KEY,
  item_key    VARCHAR(60) NOT NULL UNIQUE,
  label       VARCHAR(255) NOT NULL,
  description TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One request per journey. Re-requesting reuses the row (and its token) so a
-- candidate never ends up with two live upload links for the same journey.
CREATE TABLE IF NOT EXISTS rpa_document_requests (
  id               BIGSERIAL PRIMARY KEY,
  pipeline_id      BIGINT NOT NULL UNIQUE
                     REFERENCES rpa_candidate_pipeline (id) ON UPDATE CASCADE ON DELETE CASCADE,

  -- No-login upload link. gen_random_uuid() needs pgcrypto/pg13+ (already relied
  -- on by rpa_email_tracking.tracking_token).
  token            UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  token_status     VARCHAR(20) NOT NULL DEFAULT 'active',  -- 'active' | 'closed'

  requested_by     INT REFERENCES rpa_users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_reminded_at TIMESTAMPTZ,
  reminder_count   INT NOT NULL DEFAULT 0,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per checklist item per request — created up front in 'pending' so the
-- candidate's upload page and HR's verification table render the same list.
CREATE TABLE IF NOT EXISTS rpa_candidate_documents (
  id                BIGSERIAL PRIMARY KEY,
  request_id        BIGINT NOT NULL REFERENCES rpa_document_requests (id) ON UPDATE CASCADE ON DELETE CASCADE,
  checklist_item_id INT NOT NULL REFERENCES rpa_document_checklist_items (id) ON UPDATE CASCADE,

  -- OneDrive webUrl returned by uploadFileToOneDrive(); the file itself lives in
  -- "Document Collection/<candidate name (cv id)>/" under the same parent folder
  -- resumes already use. Null until the candidate uploads.
  file_url          TEXT,
  original_name     VARCHAR(255),
  uploaded_at       TIMESTAMPTZ,

  status            VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending' | 'uploaded' | 'verified' | 'rejected'
  remarks           TEXT,        -- the reason on a rejection, shown to the candidate
  verified_by       INT REFERENCES rpa_users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  verified_at       TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidate_documents_request ON rpa_candidate_documents (request_id);

-- One row per checklist item per request; a re-upload overwrites in place rather
-- than stacking rows, so the checklist stays one line per document.
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_document_item
  ON rpa_candidate_documents (request_id, checklist_item_id);
