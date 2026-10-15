-- ============================================================================
-- Missing-details dates on the candidate (N44, Phase 3 "Do Now")
-- Plan: docs/Phase 3 Enhancements or Feedback/PLAN-Phase3-Now.md section 4.C, N44
--
-- Apply with the guarded runner (never by hand in a SQL tool):
--   cd backend
--   node scripts/run-ddl.mjs --env .env.staging    --expect-db recruitmentautomationdb     --file prisma/ddl/2026-10-14-cv-details-dates.sql --dry-run
--   node scripts/run-ddl.mjs --env .env.staging    --expect-db recruitmentautomationdb     --file prisma/ddl/2026-10-14-cv-details-dates.sql
--   node scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd --file prisma/ddl/2026-10-14-cv-details-dates.sql
-- then stop the server and worker and run `npm run prisma:pull && npm run prisma:generate`.
-- Staging FIRST. Idempotent and additive: re-running changes nothing.
-- Rollback: 2026-10-14-cv-details-dates.rollback.sql
--
-- WHY: when a candidate completes the missing-details form nobody was told and
-- no date was kept (modifiedAt is overwritten by every later edit), so
-- recruiters could not pick out recent responders to chase.
-- ============================================================================

ALTER TABLE rpa_cv ADD COLUMN IF NOT EXISTS details_requested_at TIMESTAMPTZ;
ALTER TABLE rpa_cv ADD COLUMN IF NOT EXISTS details_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN rpa_cv.details_requested_at IS
  'When the missing-details form was FIRST emailed to the candidate. A re-send keeps the original date. '
  'Backfilled on release from the earliest rpa_email_log row (data_collection / missing_jd).';
COMMENT ON COLUMN rpa_cv.details_completed_at IS
  'When the candidate FIRST completed the missing-details form (nothing left missing). '
  'Set once; later submissions and staff edits never move it. NULL for completions before this column existed.';

-- Search Candidate filters "Completed in: today / 7 / 30 days" on this column.
CREATE INDEX IF NOT EXISTS idx_rpa_cv_details_completed_at
  ON rpa_cv (details_completed_at)
  WHERE details_completed_at IS NOT NULL;

COMMENT ON INDEX idx_rpa_cv_details_completed_at IS
  'Partial index for the Search Candidate "Completed in" filter (N44).';

-- Backfill the request date only. There is no reliable source for past
-- completion dates, so details_completed_at starts on release day.
UPDATE rpa_cv c
SET details_requested_at = l.first_sent
FROM (
  SELECT reference_id, MIN(sent_at) AS first_sent
  FROM rpa_email_log
  WHERE email_type IN ('data_collection', 'missing_jd')
    AND reference_id IS NOT NULL
    AND sent_at IS NOT NULL
  GROUP BY reference_id
) l
WHERE c.id = l.reference_id
  AND c.details_requested_at IS NULL;
