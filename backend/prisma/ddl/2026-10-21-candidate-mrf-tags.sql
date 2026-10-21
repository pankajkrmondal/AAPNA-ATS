-- ============================================================================
-- JD tagging (Phase 3 section B: N13 data model, used by N14 uploads, N15
-- screening filter, N21 Add to JD hardening and G3 Change JD).
-- Plan: docs/Phase 3 Enhancements or Feedback/PLAN-Phase3-Now.md (section B)
--
-- Apply with the guarded runner (never by hand in a SQL tool):
--   cd backend
--   node scripts/run-ddl.mjs --env .env.staging    --expect-db recruitmentautomationdb     --file prisma/ddl/2026-10-21-candidate-mrf-tags.sql --dry-run
--   node scripts/run-ddl.mjs --env .env.staging    --expect-db recruitmentautomationdb     --file prisma/ddl/2026-10-21-candidate-mrf-tags.sql
--   node scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd --file prisma/ddl/2026-10-21-candidate-mrf-tags.sql
-- then `npm run prisma:generate` (schema.prisma already carries the model and
-- the new columns). Staging FIRST. Idempotent and additive: re-running changes
-- nothing. Rollback: 2026-10-21-candidate-mrf-tags.rollback.sql
--
-- WHY: nothing recorded which JD a candidate was uploaded for. The only
-- candidate-to-MRF link was the shortlist row, written at shortlisting. RT
-- wants to upload "for" a JD and later see exactly those candidates (RT §4).
--
-- Release this BEFORE the backend build that writes the table.
-- ============================================================================

-- One row per candidate per JD. Unique, so tagging twice is a no-op.
CREATE TABLE IF NOT EXISTS rpa_candidate_mrf_tags (
  id                  BIGSERIAL     PRIMARY KEY,
  cv_id               BIGINT        NOT NULL,
  mrf_id              BIGINT        NOT NULL,
  source              VARCHAR(30)   NOT NULL,
  upload_execution_id VARCHAR(100),
  tagged_by           VARCHAR(255),
  tagged_by_id        INT,
  tagged_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT uq_candidate_mrf_tag UNIQUE (cv_id, mrf_id),
  CONSTRAINT fk_candidate_mrf_tag_cv
    FOREIGN KEY (cv_id) REFERENCES rpa_cv(id) ON DELETE CASCADE,
  CONSTRAINT fk_candidate_mrf_tag_mrf
    FOREIGN KEY (mrf_id) REFERENCES rpa_mrf(id) ON DELETE CASCADE,
  CONSTRAINT fk_candidate_mrf_tag_user
    FOREIGN KEY (tagged_by_id) REFERENCES rpa_users(id) ON DELETE SET NULL,
  CONSTRAINT chk_candidate_mrf_tag_source
    CHECK (source IN ('hr_manual_upload', 'vendor_portal', 'shortlist', 'search_candidate',
                      'change_jd', 'move', 'backfill'))
);

COMMENT ON TABLE rpa_candidate_mrf_tags IS
  'Which JD (MRF) a candidate was uploaded for or shortlisted to (JD tagging, N13). '
  'One row per candidate per MRF; source says how the tag was made.';

CREATE INDEX IF NOT EXISTS idx_candidate_mrf_tags_mrf ON rpa_candidate_mrf_tags(mrf_id);
CREATE INDEX IF NOT EXISTS idx_candidate_mrf_tags_cv  ON rpa_candidate_mrf_tags(cv_id);

-- A duplicate waiting for a recruiter's merge carries the JD of its upload, so
-- the merge can tag the candidate it resolves to (N14). Not in
-- CV_SHARED_FIELDS, so a merge never copies it into rpa_cv.
ALTER TABLE rpa_cv_tmp ADD COLUMN IF NOT EXISTS mrf_id BIGINT
  REFERENCES rpa_mrf(id) ON DELETE SET NULL;

-- The JD an upload job was made for: shown in the job list, and read back by
-- reprocess so a re-run tags the same JD (N14).
ALTER TABLE rpa_upload_jobs ADD COLUMN IF NOT EXISTS mrf_id BIGINT
  REFERENCES rpa_mrf(id) ON DELETE SET NULL;

-- ── Backfill (safe to re-run) ──────────────────────────────────────────────
-- Every existing shortlist link becomes a tag, so "Tagged to this JD only"
-- also shows people shortlisted before this release. A screening reject with
-- no journey is not a tag (rejectCandidates writes a 'rejected' shortlist row
-- for a candidate who was never put forward). Uploads made before this
-- release were never recorded and stay untagged.
INSERT INTO rpa_candidate_mrf_tags (cv_id, mrf_id, source, tagged_by, tagged_at)
SELECT DISTINCT ON (s.cv_id, s.mrf_id)
       s.cv_id, s.mrf_id, 'backfill', s.shortlisted_by,
       COALESCE(s.shortlisted_at, s.created_at, now())
  FROM rpa_shortlisted_candidates s
  JOIN rpa_cv  c ON c.id = s.cv_id
  JOIN rpa_mrf m ON m.id = s.mrf_id
 WHERE s.cv_id IS NOT NULL
   AND s.mrf_id IS NOT NULL
   AND (s.pipeline_status IS DISTINCT FROM 'rejected'
        OR EXISTS (SELECT 1 FROM rpa_candidate_pipeline p
                    WHERE p.cv_id = s.cv_id AND p.mrf_id = s.mrf_id))
 ORDER BY s.cv_id, s.mrf_id, s.shortlisted_at NULLS LAST
ON CONFLICT (cv_id, mrf_id) DO NOTHING;

-- ── One shortlist row per candidate per JD (N21 hardening, R3) ─────────────
-- shortlistCandidates checks then inserts, so two recruiters adding the same
-- candidate at once could write two rows. The app now serialises that with an
-- advisory lock; this index is the second guard. It can only be created when
-- no duplicates exist, so on a database that has some the index is skipped
-- with a WARNING naming them: clean those up by hand (keep the row the
-- journey points at), then re-run this file.
DO $$
DECLARE
  dupes TEXT;
BEGIN
  IF to_regclass('public.uq_shortlist_cv_mrf') IS NOT NULL THEN
    RETURN;
  END IF;
  SELECT string_agg(format('cv %s / MRF %s (rows %s)', cv_id, mrf_id, ids), '; ')
    INTO dupes
    FROM (SELECT cv_id, mrf_id, array_agg(id ORDER BY id)::text AS ids
            FROM rpa_shortlisted_candidates
           WHERE cv_id IS NOT NULL AND mrf_id IS NOT NULL
           GROUP BY cv_id, mrf_id
          HAVING count(*) > 1) d;
  IF dupes IS NULL THEN
    EXECUTE 'CREATE UNIQUE INDEX uq_shortlist_cv_mrf
               ON rpa_shortlisted_candidates (cv_id, mrf_id)
            WHERE cv_id IS NOT NULL AND mrf_id IS NOT NULL';
  ELSE
    RAISE WARNING 'uq_shortlist_cv_mrf NOT created: duplicate shortlist rows exist: %', dupes;
  END IF;
END $$;
