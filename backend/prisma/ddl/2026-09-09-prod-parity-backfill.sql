-- ============================================================================
-- Production parity backfill — the drift no other DDL file covers
-- 2026-09-09
-- Manual DDL — apply then: cd backend && npm run prisma:pull && npm run prisma:generate
--
-- WHY THIS FILE EXISTS: every other file in this folder describes a feature. This
-- one describes a GAP. A read-only comparison of recruitmentautomationdb (staging)
-- against recruitmentautomationdbProd on 2026-09-09 found ten objects that exist
-- on staging tables which ALSO EXIST IN PRODUCTION, and which no file in this
-- folder creates. They were applied to staging by hand or by an ad-hoc script and
-- never captured. A deploy that runs `ls *.sql | sort` therefore misses all ten.
--
-- NOT PURELY ADDITIVE — unlike every other file here. It DELETES rows (section 2)
-- and CHANGES a column type (section 9). Read section 2 before running it and see
-- docs/phase3/STAGING-TO-PRODUCTION-DB-AND-ONEDRIVE-PLAN.md section A.4.
--
-- ORDER MATTERS AND IS NOT ALPHABETICAL. Duplicates must go before the UNIQUE
-- that rejects them; the primary key must exist before anything references it;
-- orphans must be nulled before the foreign keys that would refuse them. The
-- section numbering below IS the required order.
--
-- IDEMPOTENT: every statement is guarded, because a production run that fails
-- halfway must be safe to re-run. Postgres has no ADD CONSTRAINT IF NOT EXISTS,
-- so constraints are guarded by an explicit pg_constraint lookup rather than by
-- DROP-then-ADD — dropping a live primary key to re-add it would be a worse
-- failure mode than the one being prevented.
--
-- RUN INSIDE THE MAINTENANCE WINDOW, WITH THE APP STOPPED:
--   pm2 stop ats-prod-backend ats-prod-worker
-- The mailbox poller writes to rpa_email_messages every 5 minutes and would race
-- section 2. It is also what created the duplicates in the first place.
-- ============================================================================

BEGIN;


-- ----------------------------------------------------------------------------
-- 1. rpa_email_log.status / .error_message
--
-- Production has NEITHER column, but emailTemplate.controller.js groups by
-- `status` and filters on status='failed' — so the Email Analytics endpoint 500s
-- against production the moment the current build ships. This is the cheapest
-- fix in the file and the one with a user-visible symptom today.
--
-- DEFAULT 'sent' backfills every pre-existing row (14,014 at time of writing),
-- which is the correct historical value: a row was only ever written on a
-- successful send, so there is no lost 'failed' state to reconstruct.
-- ----------------------------------------------------------------------------

ALTER TABLE rpa_email_log ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'sent';
ALTER TABLE rpa_email_log ADD COLUMN IF NOT EXISTS error_message TEXT;

COMMENT ON COLUMN rpa_email_log.status IS
  'Send outcome: ''sent'' | ''failed''. Backfilled to ''sent'' on 2026-09-09 for all '
  'rows predating the column — they were only ever written on success.';


-- ----------------------------------------------------------------------------
-- 2. rpa_email_messages — remove the duplicate re-inserts
--
-- ⚠ THIS DELETES PRODUCTION ROWS. It requires the sign-off recorded as decision
--   D-1 in the migration plan. Do not run this file without it.
--
-- WHY THERE ARE DUPLICATES: inboundEmailSync.js inserts each polled message and
-- relies on the database raising a unique violation (Prisma P2002) to skip one it
-- has already stored — "Idempotent via the unique graph_message_id" says the
-- comment above the function. Staging has that constraint. Production never did.
-- So every poller restart and every Graph delta re-emit re-inserted the same
-- message, unopposed, since the module shipped.
--
-- MEASURED ON PRODUCTION 2026-09-09, twice, hours apart:
--   duplicate graph_message_id groups       2,836  →  2,840
--   rows inside a duplicate group          11,689  → 11,706
--   rows to delete (keep lowest id)         8,853  →  8,866
--   largest single group                       18  →     18
--   groups differing in direction/sent_at        0  →      0
-- The counts RISE between runs because the poller is still running. Whatever
-- number you verified against, re-count immediately before executing.
--
-- WHY DELETING IS SAFE: that last row is the one that matters. Inside every
-- duplicate group the rows agree on direction and sent_at — they are re-inserts
-- of one Graph message, not distinct events. The lowest id is kept.
--
-- THE SNAPSHOT LIVES IN ITS OWN SCHEMA, deliberately. A backup table in `public`
-- would be picked up by `prisma db pull` and appear in schema.prisma as a bogus
-- model, breaking the empty-diff check that is the deployment's proof of parity.
-- ats_backup is outside the connection string's `?schema=public`, so Prisma
-- cannot see it.
-- ----------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS ats_backup;

COMMENT ON SCHEMA ats_backup IS
  'Pre-migration row snapshots. Deliberately NOT public: Prisma introspects only '
  'public, so nothing in here can pollute schema.prisma.';

CREATE TABLE IF NOT EXISTS ats_backup.email_messages_dupes_20260909
  (LIKE public.rpa_email_messages);

-- Re-runnable: only captures rows not already captured, so a second run after a
-- failure adds any duplicates that arrived in between rather than silently
-- keeping a stale snapshot.
INSERT INTO ats_backup.email_messages_dupes_20260909
SELECT m.* FROM public.rpa_email_messages m
 WHERE m.id IN (
       SELECT id FROM (
         SELECT id, row_number() OVER (PARTITION BY graph_message_id ORDER BY id) AS rn
           FROM public.rpa_email_messages
          WHERE graph_message_id IS NOT NULL) t
        WHERE t.rn > 1)
   AND NOT EXISTS (SELECT 1 FROM ats_backup.email_messages_dupes_20260909 b WHERE b.id = m.id);

-- Re-point tracking rows at the surviving message BEFORE the delete. Measured
-- zero on 2026-09-09 — every tracking row already points at a keeper — but this
-- runs before a delete that the ON DELETE CASCADE in section 5 would otherwise
-- turn into silent tracking loss, and new duplicates accrue until the app stops.
-- A no-op today is not a no-op on deploy day.
UPDATE rpa_email_tracking t
   SET message_id = keep.keep_id
  FROM (SELECT id AS dup_id,
               first_value(id) OVER (PARTITION BY graph_message_id ORDER BY id) AS keep_id
          FROM rpa_email_messages
         WHERE graph_message_id IS NOT NULL) keep
 WHERE t.message_id = keep.dup_id
   AND keep.dup_id <> keep.keep_id;

DELETE FROM rpa_email_messages
 WHERE id IN (SELECT id FROM ats_backup.email_messages_dupes_20260909);


-- ----------------------------------------------------------------------------
-- 3. rpa_email_messages — null the orphaned foreign-key pointers
--
-- 34 rows point at parents that no longer exist (1 candidate, 8 mrf, 25
-- shortlist; all in the id band 3271–3401). Every corresponding staging FK is
-- ON DELETE SET NULL, so nulling them is not a workaround — it is exactly the
-- state the constraint would have produced had it been present when the parent
-- was deleted. No message is lost.
--
-- All 25 shortlist pointers are necessarily dangling: rpa_shortlisted_candidates
-- is EMPTY in production (0 rows).
-- ----------------------------------------------------------------------------

UPDATE rpa_email_messages m SET candidate_id = NULL
 WHERE m.candidate_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM rpa_cv c WHERE c.id = m.candidate_id);

UPDATE rpa_email_messages m SET mrf_id = NULL
 WHERE m.mrf_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM rpa_mrf f WHERE f.id = m.mrf_id);

UPDATE rpa_email_messages m SET shortlist_id = NULL
 WHERE m.shortlist_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM rpa_shortlisted_candidates s WHERE s.id = m.shortlist_id);


-- ----------------------------------------------------------------------------
-- 4. rpa_email_messages — primary key, uniqueness, foreign keys, indexes
--
-- The primary key comes FIRST: section 5's foreign key from rpa_email_tracking
-- references rpa_email_messages(id) and cannot be created without it.
--
-- The UNIQUE is the fix that closes section 2 permanently — with it in place the
-- poller's P2002 path finally works and duplicates cannot recur. It is added
-- AFTER the delete for the obvious reason.
-- ----------------------------------------------------------------------------

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rpa_email_messages_pkey') THEN
    ALTER TABLE rpa_email_messages ADD CONSTRAINT rpa_email_messages_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rpa_email_messages_graph_message_id_key') THEN
    ALTER TABLE rpa_email_messages ADD CONSTRAINT rpa_email_messages_graph_message_id_key
      UNIQUE (graph_message_id);
  END IF;

  -- NULL is permitted and common (4,941 rows): sends without a Graph id. UNIQUE
  -- does not constrain NULLs, which is why those rows need no attention.

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rpa_email_messages_account_id_fkey') THEN
    ALTER TABLE rpa_email_messages ADD CONSTRAINT rpa_email_messages_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES rpa_outlook_accounts(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rpa_email_messages_candidate_id_fkey') THEN
    ALTER TABLE rpa_email_messages ADD CONSTRAINT rpa_email_messages_candidate_id_fkey
      FOREIGN KEY (candidate_id) REFERENCES rpa_cv(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rpa_email_messages_mrf_id_fkey') THEN
    ALTER TABLE rpa_email_messages ADD CONSTRAINT rpa_email_messages_mrf_id_fkey
      FOREIGN KEY (mrf_id) REFERENCES rpa_mrf(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rpa_email_messages_shortlist_id_fkey') THEN
    ALTER TABLE rpa_email_messages ADD CONSTRAINT rpa_email_messages_shortlist_id_fkey
      FOREIGN KEY (shortlist_id) REFERENCES rpa_shortlisted_candidates(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rpa_email_messages_sent_by_user_id_fkey') THEN
    ALTER TABLE rpa_email_messages ADD CONSTRAINT rpa_email_messages_sent_by_user_id_fkey
      FOREIGN KEY (sent_by_user_id) REFERENCES rpa_users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rpa_email_messages_template_id_fkey') THEN
    ALTER TABLE rpa_email_messages ADD CONSTRAINT rpa_email_messages_template_id_fkey
      FOREIGN KEY (template_id) REFERENCES rpa_email_templates(id) ON DELETE SET NULL;
  END IF;
END
$do$;

-- Production has 17k+ rows here against 56 indexes for the whole database; the
-- Outlook Email module joins and filters on every one of these columns.
CREATE INDEX IF NOT EXISTS idx_email_messages_account      ON rpa_email_messages (account_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_candidate    ON rpa_email_messages (candidate_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_conversation ON rpa_email_messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_direction    ON rpa_email_messages (direction);
CREATE INDEX IF NOT EXISTS idx_email_messages_from         ON rpa_email_messages (from_email);
CREATE INDEX IF NOT EXISTS idx_email_messages_mrf          ON rpa_email_messages (mrf_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_sent_at      ON rpa_email_messages (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_shortlist    ON rpa_email_messages (shortlist_id);


-- ----------------------------------------------------------------------------
-- 5. rpa_email_tracking — primary key, token uniqueness, parent FK
--
-- Production has no key of any kind on this table. tracking_token is the
-- credential in the open/click pixel URL, so a duplicate there is not a tidiness
-- problem — it would attribute one candidate's open to another's message. It is
-- populated by gen_random_uuid() and measured clean (0 nulls, 0 duplicates), so
-- the constraint just makes that guarantee structural.
--
-- ON DELETE CASCADE mirrors staging: a tracking row for a message that no longer
-- exists is unreadable by definition. Section 2 re-pointed the surviving rows
-- before any delete precisely so this cascade never fires on the dedup.
-- ----------------------------------------------------------------------------

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rpa_email_tracking_pkey') THEN
    ALTER TABLE rpa_email_tracking ADD CONSTRAINT rpa_email_tracking_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rpa_email_tracking_tracking_token_key') THEN
    ALTER TABLE rpa_email_tracking ADD CONSTRAINT rpa_email_tracking_tracking_token_key
      UNIQUE (tracking_token);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rpa_email_tracking_message_id_fkey') THEN
    ALTER TABLE rpa_email_tracking ADD CONSTRAINT rpa_email_tracking_message_id_fkey
      FOREIGN KEY (message_id) REFERENCES rpa_email_messages(id) ON DELETE CASCADE;
  END IF;
END
$do$;

CREATE INDEX IF NOT EXISTS idx_email_tracking_message ON rpa_email_tracking (message_id);
CREATE INDEX IF NOT EXISTS idx_email_tracking_token   ON rpa_email_tracking (tracking_token);


-- ----------------------------------------------------------------------------
-- 6. rpa_cv_tmp — primary key
--
-- The staging holding table for in-flight resume parsing has a key; production's
-- does not. id is already BIGINT NOT NULL with no nulls and no duplicates, so
-- ADD PRIMARY KEY is a metadata change plus one index build over 356 rows.
-- ----------------------------------------------------------------------------

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rpa_cv_tmp_pkey') THEN
    ALTER TABLE rpa_cv_tmp ADD CONSTRAINT rpa_cv_tmp_pkey PRIMARY KEY (id);
  END IF;
END
$do$;


-- ----------------------------------------------------------------------------
-- 7. rpa_sessions — token uniqueness, owner FK, created_at default
--
-- token is the session credential itself. Production has it NOT NULL but not
-- UNIQUE, so nothing at the database level prevents two sessions sharing one
-- token. Measured clean; make it structural.
-- ----------------------------------------------------------------------------

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rpa_sessions_token_key') THEN
    ALTER TABLE rpa_sessions ADD CONSTRAINT rpa_sessions_token_key UNIQUE (token);
  END IF;

  -- No ON DELETE clause: this matches staging exactly. Deleting a user with a
  -- live session is therefore refused rather than silently orphaning it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rpa_sessions_user_id_fkey') THEN
    ALTER TABLE rpa_sessions ADD CONSTRAINT rpa_sessions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES rpa_users(id);
  END IF;
END
$do$;

ALTER TABLE rpa_sessions ALTER COLUMN created_at SET DEFAULT now();


-- ----------------------------------------------------------------------------
-- 8. rpa_cv.resume_text_quality — restrict to the four known values
--
-- 9,139 rows measured, 0 outside the domain. The CHECK is written as IN (...)
-- so Postgres normalises it to the identical `= ANY (ARRAY[...]::text[])` form
-- staging already stores — which is what keeps the section-below `prisma db pull`
-- diff empty.
-- ----------------------------------------------------------------------------

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_resume_text_quality') THEN
    ALTER TABLE rpa_cv ADD CONSTRAINT chk_resume_text_quality
      CHECK (resume_text_quality IN ('extracted', 'lossy', 'failed', 'unknown'));
  END IF;
END
$do$;


-- ----------------------------------------------------------------------------
-- 9. rpa_mrf experience columns — text → int4
--
-- ⚠ The only TYPE change in this file. Staging models both as int4 and so does
--   schema.prisma; production still holds text. Left alone, the MRF model is a
--   type mismatch on every read.
--
-- Measured on all 5 production rows: 0 values that are not digit strings
-- (NULL/10, 3/1, 0/4, 3/3, 2/2). NULLIF(btrim(...),'') maps an empty string to
-- NULL rather than failing the cast — the case a bare ::int4 would break on.
--
-- Guarded on the CURRENT type, not on a constraint name: re-running after a
-- successful run would otherwise try btrim() on an integer and fail.
-- ----------------------------------------------------------------------------

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'rpa_mrf'
                AND column_name = 'total_years_of_experience' AND data_type = 'text') THEN
    ALTER TABLE rpa_mrf
      ALTER COLUMN total_years_of_experience TYPE int4
      USING NULLIF(btrim(total_years_of_experience), '')::int4;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'rpa_mrf'
                AND column_name = 'relevant_years_of_experience' AND data_type = 'text') THEN
    ALTER TABLE rpa_mrf
      ALTER COLUMN relevant_years_of_experience TYPE int4
      USING NULLIF(btrim(relevant_years_of_experience), '')::int4;
  END IF;
END
$do$;


-- ----------------------------------------------------------------------------
-- 10. seed_module_permissions() — the two module keys production never seeds
--
-- Production's trigger function seeds 7 module keys; staging's seeds 8. The
-- missing 'outlook_email' means every user created in production after go-live
-- silently gets no permission row for the Outlook Email module — no error, the
-- module simply never appears for them.
--
-- 'recruitment_pipeline' is absent from BOTH function bodies yet present in
-- staging's data, so it is currently granted by application code or by hand.
-- Adding it here is a deliberate improvement over strict parity, recorded as
-- decision D-4 in the migration plan. If parity is preferred, remove that one
-- string here AND from section 11.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.seed_module_permissions()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  INSERT INTO rpa_module_permissions (user_id, module_key, is_enabled)
  SELECT
    NEW.id,
    m,
    CASE WHEN NEW.role = 'admin' THEN TRUE ELSE FALSE END
  FROM unnest(ARRAY[
    'vendor_upload',
    'new_mrf',
    'search_candidates',
    'hr_manual_upload',
    'system_config',
    'candidate_screening',
    'screening_analytics',
    'outlook_email',
    'recruitment_pipeline'
  ]) AS m
  ON CONFLICT (user_id, module_key) DO NOTHING;
  RETURN NEW;
END;
$fn$;


-- ----------------------------------------------------------------------------
-- 11. Backfill the two new module keys for users who ALREADY exist
--
-- Section 10 only fires on INSERT, so production's 8 existing users would still
-- have no row for either module. Disabled by default, enabled for admins —
-- the same rule the trigger applies, so a backfilled user is indistinguishable
-- from a newly created one.
--
-- Recruiters who need the pipeline are granted it afterwards, deliberately and
-- by name, with prisma/grant-recruiter-pipeline-access.js.
-- ----------------------------------------------------------------------------

INSERT INTO rpa_module_permissions (user_id, module_key, is_enabled)
SELECT u.id, m, (u.role = 'admin')
  FROM rpa_users u
  CROSS JOIN unnest(ARRAY['outlook_email', 'recruitment_pipeline']) AS m
ON CONFLICT (user_id, module_key) DO NOTHING;


COMMIT;


-- ============================================================================
-- VERIFICATION — run after COMMIT, outside the transaction
-- ============================================================================
--
-- -- The blocker is closed and cannot reopen:
-- SELECT count(*) FROM (SELECT graph_message_id FROM rpa_email_messages
--   WHERE graph_message_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x;   -- 0
--
-- -- Rows preserved, not lost — these two must sum to the pre-run total:
-- SELECT (SELECT count(*) FROM rpa_email_messages) AS kept,
--        (SELECT count(*) FROM ats_backup.email_messages_dupes_20260909) AS backed_up;
--
-- -- Analytics fix landed:
-- SELECT status, count(*) FROM rpa_email_log GROUP BY 1;   -- one 'sent' row
--
-- -- No orphans remain and every FK is enforced (expect 14 rows: 8 on
-- -- rpa_email_messages, 3 on rpa_email_tracking, 3 on rpa_sessions/rpa_cv_tmp):
-- SELECT conrelid::regclass AS tbl, conname, contype FROM pg_constraint
--  WHERE conname IN ('rpa_email_messages_pkey','rpa_email_messages_graph_message_id_key',
--    'rpa_email_messages_account_id_fkey','rpa_email_messages_candidate_id_fkey',
--    'rpa_email_messages_mrf_id_fkey','rpa_email_messages_shortlist_id_fkey',
--    'rpa_email_messages_sent_by_user_id_fkey','rpa_email_messages_template_id_fkey',
--    'rpa_email_tracking_pkey','rpa_email_tracking_tracking_token_key',
--    'rpa_email_tracking_message_id_fkey','rpa_cv_tmp_pkey',
--    'rpa_sessions_token_key','rpa_sessions_user_id_fkey','chk_resume_text_quality')
--  ORDER BY 1, 2;
--
-- -- Then the real proof of parity, from backend/:
-- --   NODE_ENV=production npx prisma db pull && git diff prisma/schema.prisma
-- -- An EMPTY diff means production and staging now agree. ats_backup is outside
-- -- the introspected schema, so the snapshot table cannot show up here.
--
-- ============================================================================
-- ROLLBACK (this file is not self-reversing — see the plan, section A.7)
-- ============================================================================
--   ALTER TABLE rpa_email_messages DROP CONSTRAINT rpa_email_messages_graph_message_id_key;
--   INSERT INTO rpa_email_messages SELECT * FROM ats_backup.email_messages_dupes_20260909;
--   ALTER TABLE rpa_mrf ALTER COLUMN total_years_of_experience    TYPE text USING total_years_of_experience::text;
--   ALTER TABLE rpa_mrf ALTER COLUMN relevant_years_of_experience TYPE text USING relevant_years_of_experience::text;
--   -- then DROP the remaining constraints/indexes by name, and re-apply the
--   -- 7-key seed_module_permissions() body from the pre-deploy dump.
--
-- The 34 nulled orphan pointers (section 3) are the one change with no in-file
-- reversal: recover those ids from prod-predeploy-<date>.dump if ever needed.
--
-- Retain ats_backup.email_messages_dupes_20260909 for at least one full
-- retention cycle before dropping it.
-- ============================================================================
