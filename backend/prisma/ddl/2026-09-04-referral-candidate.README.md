# 2026-09-04 — referral candidate flag + audit log (Phase 3, P1)

**What it does.** Adds five columns to `rpa_cv` recording that an employee referred this candidate and who
referred them, plus `rpa_referral_audit`: one append-only row per mark, change or removal of that flag.

**Apply:**

```bash
psql "$DATABASE_URL" -f prisma/ddl/2026-09-04-referral-candidate.sql
cd backend && npm run prisma:pull && npm run prisma:generate
```

`prisma:generate` takes a file lock on Windows — stop the dev server **and** the queue worker
(`npm run queue:worker`) first, or it fails with `EPERM`. Both were running when this was written.

**Safe to re-run.** `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.
Nothing is dropped, nothing is backfilled, no existing row is touched.

**Validated** against staging on 2026-09-04: all 21 statements executed inside a transaction that was rolled
back, the columns/indexes/constraints materialised as intended, and the removal-without-reason `CHECK` was
confirmed to fire (SQLSTATE 23514). The database was left unchanged.

**ASCII-only, no BOM.** Deliberate: `psql` on Windows can default to a WIN1252 client encoding, which would
garble non-ASCII text inside the `COMMENT ON` strings — the comments are the documentation, so they should not
depend on the shell that applied them.

**Staging first.** Applied by Pankaj against staging; production follows once the feature ships.

## Why the flag lives on `rpa_cv`

A referral is learned **before** a shortlist row exists — an employee mails a resume in, and it may sit in the
database for months before anyone tags it to a JD. Per-shortlist storage would leave that fact nowhere to live
between the two moments. It also matches the stated reasoning, which is about the person: *"that person is
already aware of Apna… and therefore they are keen to join Apna."*

`rpa_cv` is the right grain for the same reason `hrUpload.service.js` merges on re-upload rather than inserting
a second row: one person, one record.

### The blast radius, measured

| Reader of `rpa_cv` | Effect of a new column |
|---|---|
| Candidate dossier | **Safe by construction** — `CV_PROFILE_FIELDS` is a whitelist; a new column is invisible until consciously added |
| Candidate CSV export | **Safe** — `EXPORT_SELECT` in `candidate.service.js` is also an allowlist |
| `search()` | ⚠️ **Selects all ~80 columns, and vendors can call it.** `enforceVendorScope` limits them to their own candidates but still returns every column — so the referral columns must be excluded for vendor callers. This is the one place the new columns escape by default |

## Why each column is a control

| Column | Answers |
|---|---|
| `rpa_cv.is_referral` | The flag. `NOT NULL DEFAULT FALSE`, so every pre-existing row reads "not a referral" — the feature **fails closed on disclosure**, which is the direction that matters when the whole requirement is "the interviewer must not learn this" |
| `rpa_cv.referred_by` | "A referral from **Anuj**". Free text by decision (2026-09-04) — a referrer may have no ATS account |
| `rpa_cv.referral_note` | Recruiter context. Recruiter-only, like every other recruiter-authored free-text field |
| `rpa_cv.referral_set_by` / `_at` | Denormalised copy of the latest audit row, for display without a join. **Not** the history — they are overwritten by the next change |
| `rpa_referral_audit.action` | `marked` / `updated` / `removed`, CHECK-constrained |
| `rpa_referral_audit.reason` | Why it was removed. CHECK-enforced non-empty when `action = 'removed'` |
| `rpa_referral_audit.old_*` / `new_*` | Both sides of the change, so one row is legible without reading the one before it |
| `rpa_referral_audit.candidate_name` / `acted_by_name` | Snapshots — see below |
| `rpa_referral_audit.acted_ip` | Corroboration, as `rpa_interview_scorecard.submitted_ip` already records for a public submit |

## Why a table and not just the two stamp columns

A referral **grants hiring preference** — *"we always give preference to the referral person"*. That makes it
unlike other candidate fields: it changes who gets hired, so its history has to be investigable.

`referral_set_by` / `referral_set_at` cannot do that. A **removal overwrites the very columns that would have
recorded it**. Only an append-only row survives the event it needs to describe.

## Why the names are snapshotted rather than joined

This codebase has already been bitten by exactly this. From `screening.service.js`, on the shortlist-provenance
query:

> *"From 2026-08-26 closure writes made the shortlisting recruiter's name VANISH from the record…"*

A superadmin can delete a user account, and candidates do get deleted
(`docs/reference/MANUAL_CANDIDATE_CV_DELETION.md`). Both FKs are therefore `ON DELETE SET NULL` with the name
stored alongside: the row keeps its meaning on exactly the day someone needs to read it. The snapshot also
records the name **as it was**, which a later rename would otherwise hide.

## Append-only

The application only ever `INSERT`s and `SELECT`s here — no `UPDATE`, no `DELETE`, not even to fix a typo.
That is currently a convention. To make it a rule (recommended only if the log is ever used in a dispute):

```sql
CREATE OR REPLACE FUNCTION rpa_referral_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'rpa_referral_audit is append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_referral_audit_immutable
  BEFORE UPDATE OR DELETE ON rpa_referral_audit
  FOR EACH ROW EXECUTE FUNCTION rpa_referral_audit_immutable();
```

Deliberately **not** applied by this DDL: it changes behaviour, would block any future corrective migration, and
should be a conscious decision rather than a side effect of adding a column.

## Who may write what

| Action | Permission | Endpoint |
|---|---|---|
| Set / update a referral | `requireStaff` — any recruiter, admin, superadmin | `PATCH /api/candidates/:id/referral` |
| **Remove** a referral | **`requireAdmin` — admin-tier only**, with a mandatory reason | `DELETE /api/candidates/:id/referral` |

Two endpoints rather than one because the two actions carry **different permissions**; folding either into the
40-field mapper in `unmapCandidate()` would bury an admin-tier gate inside a field loop where nobody reviews it.

## Prerequisite already landed

`serializeCard()` in `interviewScorecard.service.js` was rewritten (2026-09-04) to build an explicit field list
instead of spreading the Prisma row. Without that, the public `GET /api/scorecard/:token` response carried the
whole `rpa_candidate_pipeline → rpa_shortlisted_candidates → mrf` graph — so a referral column added anywhere
on that path would have reached every interviewer with no code change and no failing test.

## Related

- `docs/REFERRAL-CANDIDATE-PLAN.md` §4 (storage), §5 (visibility), §6 (the audit log)
- `docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md` §8.2 — the dossier redaction table this feature must be
  added to
- `backend/src/utils/dossierRedaction.js` — the whitelist-plus-assertion guard that keeps it out of a pack
