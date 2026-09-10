-- ============================================================================
-- Phase 3 (P1) - Referral candidate flag + its audit log
-- Manual DDL - apply then: cd backend && npm run prisma:pull && npm run prisma:generate
-- Idempotent, additive, non-destructive. No existing column or row is touched.
--
-- WHY: Sanghamitra, 2026-08-28 (23:33-26:08): "the recruiter need to see that it
-- is a referral candidate" and, in the same breath, "I don't want the interviewer
-- to see... none of the interview process should know that it is a, because then
-- you can't be non-bias". A referral is therefore a fact the recruiter and the
-- final decision-maker act on and nobody else may learn.
--
-- WHY ON rpa_cv AND NOT ON THE SHORTLIST ROW: a referral is learned BEFORE a
-- shortlist row exists - an employee mails a resume in, and it may sit in the
-- database for months before anyone tags it to a JD. Storing it per-shortlist
-- would leave that fact nowhere to live between the two moments. It also matches
-- the stated reasoning, which is about the person: "that person is already aware
-- of Apna... and therefore they are keen to join Apna."
--
-- WHY NOT A VALUE OF JobSource OR rpa_candidate_pipeline.source: JobSource is
-- free text that recruiters can already type "Referral - Anuj" into today, and it
-- is rendered on the screening detail panel; `source` is displayed on the
-- pipeline board and in its CSV, is mutually exclusive with the real channel, and
-- is about to be redefined as College Placement / Placement / Vendor. Source is
-- the CHANNEL; referral is a boolean OVERLAY on top of it. A vendor-sourced
-- candidate can also be a referral.
--
-- DEFAULT FALSE, NOT NULL: every pre-existing row therefore reads "not a
-- referral". This feature must fail CLOSED on disclosure - an unknown that
-- defaulted to "maybe" would be shown, and showing it to an interviewer is the
-- one outcome the requirement exists to prevent.
--
-- See docs/REFERRAL-CANDIDATE-PLAN.md section 4 and section 6.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Current state, on the candidate
-- ----------------------------------------------------------------------------

ALTER TABLE rpa_cv
  ADD COLUMN IF NOT EXISTS is_referral BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN rpa_cv.is_referral IS
  'TRUE when an employee referred this candidate. Visible ONLY to logged-in '
  'superadmin/admin/recruiter; never on any public token surface, never in a '
  'candidate dossier, never in an interviewer email or Teams invite. '
  'utils/dossierRedaction.js asserts the dossier cannot carry it.';

ALTER TABLE rpa_cv
  ADD COLUMN IF NOT EXISTS referred_by VARCHAR(255);

COMMENT ON COLUMN rpa_cv.referred_by IS
  'Who referred them - "a referral from Anuj", the meeting''s own example. Free '
  'text by decision (2026-09-04), not an FK: a referrer is an employee who may '
  'have no ATS account. Normalised on write (trim + collapse whitespace) but NOT '
  'case-folded, because people''s names are not lower-case.';

ALTER TABLE rpa_cv
  ADD COLUMN IF NOT EXISTS referral_note TEXT;

COMMENT ON COLUMN rpa_cv.referral_note IS
  'Recruiter context ("ex-colleague of Anuj, spoke to him directly"). Recruiter-'
  'only; like every other recruiter-authored free-text field it must never travel '
  'to an interviewer surface.';

ALTER TABLE rpa_cv
  ADD COLUMN IF NOT EXISTS referral_set_by VARCHAR(255);

ALTER TABLE rpa_cv
  ADD COLUMN IF NOT EXISTS referral_set_at TIMESTAMPTZ;

COMMENT ON COLUMN rpa_cv.referral_set_by IS
  'Denormalised copy of the latest rpa_referral_audit row, so the drawer can show '
  '"marked by Chhaya" without a join. The AUDIT TABLE IS THE SOURCE OF TRUTH for '
  'history - these two columns are overwritten by the next change and so can '
  'never answer "who removed it?".';

-- Partial: referrals are a small minority of a 400+ and growing table, and the
-- only query that needs an index is "show me the referrals".
CREATE INDEX IF NOT EXISTS idx_cv_referral
  ON rpa_cv(is_referral) WHERE is_referral;


-- ----------------------------------------------------------------------------
-- 2. History: every mark, change and removal
-- ----------------------------------------------------------------------------
--
-- WHY A TABLE AND NOT JUST THE TWO STAMP COLUMNS ABOVE: a referral grants hiring
-- preference - "we always give preference to the referral person" - so it is not
-- an ordinary candidate field. It changes who gets hired, which makes its history
-- something that has to be investigable. referral_set_by/at cannot do that: a
-- REMOVAL overwrites the very columns that would have recorded it. Only an
-- append-only row survives the thing it needs to describe.
--
-- APPEND-ONLY BY CONVENTION: the application INSERTs and SELECTs here, and does
-- nothing else - no UPDATE, no DELETE, not even to fix a typo. See the README for
-- the optional trigger that turns that convention into a rule.

CREATE TABLE IF NOT EXISTS rpa_referral_audit (
  id              BIGSERIAL PRIMARY KEY,

  -- Who it was about. SET NULL rather than CASCADE: candidates do get deleted
  -- (docs/reference/MANUAL_CANDIDATE_CV_DELETION.md) and an incident record that
  -- vanishes with its subject is not an audit log. The name and email are
  -- snapshotted beside the FK so the row stays readable once it points nowhere.
  cv_id           BIGINT,
  candidate_name  VARCHAR(255),
  candidate_email VARCHAR(255),

  action          VARCHAR(20)  NOT NULL,

  -- Both sides of every change, so one row is legible without reading the
  -- one before it.
  old_is_referral BOOLEAN,
  new_is_referral BOOLEAN,
  old_referred_by VARCHAR(255),
  new_referred_by VARCHAR(255),
  note            TEXT,

  reason          TEXT,

  -- Who did it. Same snapshot rule, and for a reason this codebase has already
  -- been bitten by: a superadmin can delete a user account, and screening.service.js
  -- records the 2026-08-26 case where closure writes "made the shortlisting
  -- recruiter's name VANISH from the record". A log that resolves its actor only
  -- by join is worthless on exactly the day it is needed.
  acted_by        INT,
  acted_by_name   VARCHAR(255) NOT NULL,
  acted_by_email  VARCHAR(255),
  acted_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  acted_ip        VARCHAR(64),

  CONSTRAINT fk_referral_audit_cv
    FOREIGN KEY (cv_id) REFERENCES rpa_cv(id) ON DELETE SET NULL,
  CONSTRAINT fk_referral_audit_user
    FOREIGN KEY (acted_by) REFERENCES rpa_users(id) ON DELETE SET NULL,

  CONSTRAINT chk_referral_audit_action
    CHECK (action IN ('marked', 'updated', 'removed')),

  -- A removal with no stated reason is the case this table exists for, so it is
  -- refused twice: the service raises the friendly error the recruiter reads, and
  -- this backstop catches the code path that forgets to.
  CONSTRAINT chk_referral_audit_removal_reason
    CHECK (action <> 'removed' OR (reason IS NOT NULL AND btrim(reason) <> ''))
);

COMMENT ON TABLE rpa_referral_audit IS
  'Append-only history of the referral flag: who marked, changed or removed it, '
  'when, for which candidate, and - on a removal - why. Written in the same '
  'transaction as the rpa_cv update, never one without the other. Plan: '
  'docs/REFERRAL-CANDIDATE-PLAN.md section 6.';

COMMENT ON COLUMN rpa_referral_audit.action IS
  '''marked'' (flag set), ''updated'' (referrer name or note changed), ''removed'' '
  '(flag or name cleared). A removal is the investigable incident: only admin-tier '
  'may perform one, and it must carry a reason.';

COMMENT ON COLUMN rpa_referral_audit.reason IS
  'Why the referral was removed, typed by the person removing it. Mandatory on '
  '''removed'' and meaningless otherwise - it is what makes the row an incident '
  'record rather than a bare timestamp.';

COMMENT ON COLUMN rpa_referral_audit.candidate_name IS
  'Snapshot, not a join. Survives deletion of the candidate so the incident stays '
  'readable; also records the name AS IT WAS, which a later rename would hide.';

COMMENT ON COLUMN rpa_referral_audit.acted_by_name IS
  'Snapshot of the acting user''s display name. NOT NULL: an audit row that cannot '
  'name who acted is not worth writing.';

COMMENT ON COLUMN rpa_referral_audit.acted_ip IS
  'Best-effort client IP, as rpa_interview_scorecard.submitted_ip already records '
  'for a public submit. Corroboration, never identification on its own.';

CREATE INDEX IF NOT EXISTS idx_referral_audit_cv
  ON rpa_referral_audit(cv_id);

CREATE INDEX IF NOT EXISTS idx_referral_audit_actor
  ON rpa_referral_audit(acted_by);

-- The report's default ordering: newest first, across everything.
CREATE INDEX IF NOT EXISTS idx_referral_audit_acted
  ON rpa_referral_audit(acted_at DESC);

-- Removals only - the report's investigation view, and a small enough slice of
-- the table to be worth its own partial index rather than a filter scan.
CREATE INDEX IF NOT EXISTS idx_referral_audit_removed
  ON rpa_referral_audit(acted_at DESC) WHERE action = 'removed';
