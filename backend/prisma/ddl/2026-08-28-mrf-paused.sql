-- ============================================================================
-- Requisitions — pause hiring on a role (Gap G1)
-- Manual DDL — apply directly to PostgreSQL, then run:
--   cd backend && npx prisma db pull && npx prisma generate
-- Per the repo's documented workflow: the Prisma schema is NEVER hand-edited;
-- it is introspected from the live DB.
--
-- Idempotent, additive, non-destructive — safe to run multiple times.
--
-- WHY
-- ---
-- These columns are the DDL half of Gap G1
-- (docs/HR-CANDIDATE-PIPELINE-FAQ-AND-GAP-PLAN-2026-08-26.md §G1). The BACKEND
-- half of G1 was written and deployed to staging without this file ever being
-- created, so the running server queried columns that existed nowhere. Both
-- halves of the failure showed up in the same hour on 2026-08-28:
--
--   * GET /api/screening/roles  -> PG 42703 `column "paused_at" does not exist`
--     (surfaced as Prisma P2010). getApprovedRoles uses $queryRawUnsafe, which
--     bypasses the Prisma schema entirely and asks Postgres directly -- so this
--     one proves the COLUMN was missing.
--   * GET /api/mrf              -> PrismaClientValidationError, `Unknown field
--     'paused_at' for select statement on model 'rpa_mrf'`, thrown client-side
--     before any SQL was sent -- so this one proves the GENERATED CLIENT was
--     missing it too, i.e. nobody had re-introspected.
--
-- Applying this file fixes the first. The `db pull` + `generate` + restart in
-- the header comment is what fixes the second, and has to be run on every
-- checkout that serves traffic -- the client is generated per-checkout, not
-- shared through the database.
--
-- WHY NOT REUSE closed_at
-- -----------------------
-- Same argument that separated closed_at from filled_at in
-- 2026-08-26-mrf-manual-closure.sql, one step further out. A paused role is
-- coming BACK: `on_hold_indefinitely` in MRF_CLOSURE_REASONS is a closure and
-- reads as one everywhere (reason vocabulary, "Openings Filled" export, the
-- reopen guard). Pausing has to be reversible without a reopen being an
-- exceptional, audited act, so it gets a column that clears to NULL and touches
-- nothing else. isMrfFilled() / isMrfClosed() keep meaning what their names say.
-- ============================================================================

-- When hiring on this requisition was paused (NULL = not paused). Independent
-- of BOTH approval_status and filled_at/closed_at: a paused role is still
-- approved and still unfilled, it is just not being worked right now.
ALTER TABLE rpa_mrf
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ NULL;

-- Why it was paused, free text. Deliberately NOT a controlled vocabulary like
-- closure_reason: a closure feeds reporting and needs comparable buckets, while
-- a pause is a note to the next recruiter who opens the role ("Abhijit wants
-- this held until the Q3 budget lands").
ALTER TABLE rpa_mrf
  ADD COLUMN IF NOT EXISTS paused_reason TEXT NULL;

-- Who paused it. Nullable, no FK -- matching every other actor column in this
-- schema, which stores the id without a constraint so deleting a user never
-- blocks or rewrites requisition history.
ALTER TABLE rpa_mrf
  ADD COLUMN IF NOT EXISTS paused_by INTEGER NULL;

-- Advisory "pause until March" date. Drives a reminder; NEVER auto-resumes --
-- silently reopening a role nobody re-checked is worse than a nudge.
ALTER TABLE rpa_mrf
  ADD COLUMN IF NOT EXISTS resume_on DATE NULL;

COMMENT ON COLUMN rpa_mrf.paused_at IS
  'When hiring on this requisition was paused (NULL = active). Independent of approval_status, filled_at and closed_at: a paused role is approved and unfilled, just not being worked. Clears to NULL to resume.';

COMMENT ON COLUMN rpa_mrf.paused_reason IS
  'Free-text note on why hiring was paused. Deliberately not a controlled vocabulary like closure_reason -- a pause is a message to the next recruiter, not a reporting bucket.';

COMMENT ON COLUMN rpa_mrf.paused_by IS
  'rpa_users.id of whoever paused the requisition. No FK, matching the other actor columns in this schema.';

COMMENT ON COLUMN rpa_mrf.resume_on IS
  'Advisory date the requisition is expected to resume. Drives a reminder only -- nothing auto-clears paused_at.';

-- ----------------------------------------------------------------------------
-- NO INDEX CHANGE -- and that is deliberate, not an omission.
--
-- idx_rpa_mrf_open is partial: WHERE filled_at IS NULL AND closed_at IS NULL.
-- The pause-aware JD-dropdown query adds `AND paused_at IS NULL` on top, so its
-- predicate IMPLIES the index predicate and Postgres can still use the index,
-- rechecking the extra condition. Nothing to fix.
--
-- Widening the index to `... AND paused_at IS NULL` would actively HURT: the
-- implication runs the other way for every query that does NOT filter on
-- paused_at -- the dashboard active tile, the pipeline board card, and
-- getApprovedRoles on every branch that has not merged G1 yet -- and Postgres
-- would stop using the index for all of them. Multiple checkouts share this
-- database, so the index has to stay usable by the widest set of predicates.
-- ----------------------------------------------------------------------------

-- No backfill. NULL already means "not paused" for every existing row, which is
-- true: this state has never been recordable until now.
