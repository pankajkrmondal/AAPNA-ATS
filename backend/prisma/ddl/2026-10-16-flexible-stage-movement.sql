-- ============================================================================
-- Flexible stage movement (drag and drop), phase 1 of §6.
-- Plan: docs/phase3/pipeline/FLEXIBLE-STAGE-MOVEMENT-DRAG-DROP-PLAN.md (C1, C11, C12)
--
-- Apply with the guarded runner (never by hand in a SQL tool):
--   cd backend
--   node scripts/run-ddl.mjs --env .env.staging    --expect-db recruitmentautomationdb     --file prisma/ddl/2026-10-16-flexible-stage-movement.sql --dry-run
--   node scripts/run-ddl.mjs --env .env.staging    --expect-db recruitmentautomationdb     --file prisma/ddl/2026-10-16-flexible-stage-movement.sql
--   node scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd --file prisma/ddl/2026-10-16-flexible-stage-movement.sql
-- then `npm run prisma:generate` (schema.prisma already carries the model and
-- the new columns). Staging FIRST. Idempotent and additive: re-running changes
-- nothing. Rollback: 2026-10-16-flexible-stage-movement.rollback.sql
--
-- WHY: the stage engine only knew where a candidate IS (current_stage_key),
-- never which stages they PASSED, SKIPPED or never visited. Once a candidate
-- can move in any order (FLEXIBLE_STAGES_ENABLED), "everything to the left is
-- done" stops being true, and the no-re-do rule (D2) needs a real answer.
--
-- Release this BEFORE the backend build that writes the table. The build keeps
-- the table current for every journey whether or not the flag is on, so the
-- flag can be switched on later with no second backfill.
-- ============================================================================

-- One row per journey per stage the candidate has been in or been moved past.
-- NO ROW means "not visited" (the plan's not_visited state): a stage an admin
-- adds later is then automatically not visited for everybody, with nothing to
-- insert. 'not_visited' is still allowed so a row can be reset explicitly.
CREATE TABLE IF NOT EXISTS rpa_pipeline_stage_state (
  id            BIGSERIAL    PRIMARY KEY,
  pipeline_id   BIGINT       NOT NULL,
  stage_key     VARCHAR(50)  NOT NULL,
  status        VARCHAR(20)  NOT NULL,
  entered_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  skipped_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by    INT,
  CONSTRAINT uq_pipeline_stage_state UNIQUE (pipeline_id, stage_key),
  CONSTRAINT fk_pipeline_stage_state_pipeline
    FOREIGN KEY (pipeline_id) REFERENCES rpa_candidate_pipeline(id) ON DELETE CASCADE,
  CONSTRAINT fk_pipeline_stage_state_stage
    FOREIGN KEY (stage_key) REFERENCES rpa_pipeline_stages(stage_key),
  CONSTRAINT fk_pipeline_stage_state_user
    FOREIGN KEY (updated_by) REFERENCES rpa_users(id),
  CONSTRAINT chk_pipeline_stage_state_status
    CHECK (status IN ('not_visited', 'active', 'completed', 'skipped', 'rejected', 'hold'))
);

COMMENT ON TABLE rpa_pipeline_stage_state IS
  'Per-journey state of each pipeline stage (flexible stage movement, C1). '
  'No row = not visited. completed = passed (Approved) and can never be re-entered (D2).';

CREATE INDEX IF NOT EXISTS idx_pipeline_stage_state_pipeline ON rpa_pipeline_stage_state(pipeline_id);

-- C12: the stage a 'moved' event came FROM, so the Move history report does
-- not have to parse it out of the notes text. NULL for every other event type.
ALTER TABLE rpa_pipeline_stage_events ADD COLUMN IF NOT EXISTS from_stage_key VARCHAR(50);

-- C11: Withdraw Evalground invite. The row stays (history), it is only marked.
ALTER TABLE rpa_assessment_invites ADD COLUMN IF NOT EXISTS withdrawn_at    TIMESTAMPTZ;
ALTER TABLE rpa_assessment_invites ADD COLUMN IF NOT EXISTS withdrawn_by    INT;
ALTER TABLE rpa_assessment_invites ADD COLUMN IF NOT EXISTS withdraw_reason TEXT;

-- ── Backfill (condition-based, never by id; safe to re-run) ────────────────
-- Mirrors deriveStageStates() in backend/src/utils/stageState.js, which is the
-- same rule in code (and what the app falls back to for a journey with no rows):
--   1. the CURRENT stage: rejected / hold from current_stage_status; 'approved'
--      (the final stage approved, nothing after it) = completed; else active;
--   2. any other stage with an 'approved' outcome event = completed;
--   3. any other stage BEFORE the current one = skipped (forward-only history
--      means the candidate went past it without approving it there);
--   4. everything else: no row (not visited).
-- The inactive 'shortlist' stage is never a board column and gets no row.
-- ON CONFLICT DO NOTHING keeps any row the app has written since.
INSERT INTO rpa_pipeline_stage_state
       (pipeline_id, stage_key, status, entered_at, completed_at, skipped_at, updated_at)
SELECT x.pipeline_id, x.stage_key, x.status,
       x.entered_at,
       CASE WHEN x.status = 'completed' THEN COALESCE(x.approved_at, x.entered_at, now()) END,
       CASE WHEN x.status = 'skipped' THEN COALESCE(x.entered_at, x.pipeline_created_at) END,
       now()
  FROM (
    SELECT p.id AS pipeline_id,
           s.stage_key,
           p.created_at AS pipeline_created_at,
           (SELECT max(e.created_at) FROM rpa_pipeline_stage_events e
             WHERE e.pipeline_id = p.id AND e.stage_key = s.stage_key
               AND e.event_type IN ('entered', 'skip', 'moved')) AS entered_at,
           (SELECT max(e.created_at) FROM rpa_pipeline_stage_events e
             WHERE e.pipeline_id = p.id AND e.stage_key = s.stage_key
               AND e.event_type = 'outcome' AND e.outcome = 'approved') AS approved_at,
           CASE
             WHEN s.stage_key = p.current_stage_key THEN
               CASE p.current_stage_status
                 WHEN 'rejected' THEN 'rejected'
                 WHEN 'hold'     THEN 'hold'
                 WHEN 'approved' THEN 'completed'
                 ELSE 'active'
               END
             WHEN EXISTS (SELECT 1 FROM rpa_pipeline_stage_events e
                           WHERE e.pipeline_id = p.id AND e.stage_key = s.stage_key
                             AND e.event_type = 'outcome' AND e.outcome = 'approved') THEN 'completed'
             WHEN s.sort_order < cur.sort_order THEN 'skipped'
             ELSE NULL
           END AS status
      FROM rpa_candidate_pipeline p
      JOIN rpa_pipeline_stages cur ON cur.stage_key = p.current_stage_key
      CROSS JOIN rpa_pipeline_stages s
     WHERE s.stage_key <> 'shortlist'
       AND (s.is_active OR s.stage_key = p.current_stage_key)
  ) x
 WHERE x.status IS NOT NULL
ON CONFLICT (pipeline_id, stage_key) DO NOTHING;
