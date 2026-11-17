# Scope: show and filter candidates that came from the legacy import

- **Status:** approved and built on 17 Nov 2026 (branch `pankaj-work-staging-v28`, not committed). DDL `backend/prisma/ddl/2026-11-17-legacy-source-label.sql` **applied on staging** on 17 Nov 2026: 4,050 candidates labelled `MS Access`, 1 `Also in MS Access`, 217 unlabelled; every candidate in the import log is labelled and no other candidate is. The new backend and frontend code is **not deployed** to staging yet. Production: not done, needs Pankaj's approval.
- **Asked by:** Pankaj, for Chhaya (HR).
- **Separate from:** the one-time import in `PLAN-MS-Access-Data-Migration-Mapping.md`. That plan allows no UI work and no change under `backend/src`. This task changes the ATS itself, so it has its own approval, its own staging test and its own production step.

## 1. The need

Chhaya cannot tell on any ATS screen which candidates came from MS Access. The import writes a tag in the database (`rpa_cv.last_action_context = 'ms_access_migration'`), but no screen reads it, and the tag is overwritten the next time the candidate is uploaded again or merged as a duplicate.

She needs two things:

1. A label on the candidate that says it came from the legacy data.
2. A filter on Search Candidate to list only those candidates, or to leave them out.

The same label and filter must work later for Stage 2 (Excel) and Stage 3 (resume files) without new work.

### Decision of 17 Nov 2026: two needs, two answers

Pankaj considered a separate screen listing only the migrated data, with its own export button, and decided against it. Chhaya has two needs and each gets its own answer:

| Need | Answer | Where it is planned |
|---|---|---|
| Proof for higher management that the data was extracted and mapped properly | A proof pack: an Excel workbook generated once from the provenance table after the load, signed by Chhaya and kept by HR. It does not change when candidates are edited later. | `PLAN-MS-Access-Data-Migration-Mapping.md`, section 3.13 |
| Seeing in daily work which candidates came from legacy data | A permanent label and a filter on the existing Search Candidate. The existing CSV export follows the filter, so no new export button is needed. | This document |

Why no separate screen: it would show the import as it was on the import day, which is a fixed report and is better as a file; and it would be opened a few times a year.

What happens when a legacy candidate is updated later through HR Upload, Vendor Upload or an edit:

| Thing | After the update |
|---|---|
| Database tag `last_action_context` | Overwritten with the new action. Not used for the label. |
| Label on screen (`legacy_source`) | Stays after a manual edit. **Removed** when a fresh resume arrives: HR Upload or Vendor Upload duplicate merge, or email intake (decision 3, section 5). |
| Fields on the candidate | Show the current values. |
| Provenance row with the original source row | Unchanged. |

Duplicate merge (question 6): the existing code already merges the new upload into the old record, and the old record survives. No change to how merging works was needed. The merge now also removes the label, because the merge brings a fresh resume (question 3).

## 2. What is in scope

| # | Item | Where |
|---|---|---|
| 1 | A permanent "legacy source" value on the candidate | Database, one new column on `rpa_cv` |
| 2 | Fill that value for candidates already imported | One SQL statement, from `rpa_legacy_import_rows` |
| 3 | The import sets the value for future loads | `backend/scripts/legacy-migration/3-load.mjs` |
| 4 | A label next to the candidate's name in the Search Candidate table | `frontend/src/pages/Candidates.jsx` |
| 5 | The same label on the candidate view | `frontend/src/components/CandidateDetailCard.jsx` |
| 6 | A "Source" filter on Search Candidate | `Candidates.jsx`, `GET /api/candidates` |
| 7 | The CSV export follows the filter and gets a "Legacy source" column | `backend/src/exports/candidates.export.js` |

## 3. What is not in scope

- Candidate Screening, Candidate Pipeline and the dashboards. The label can be added there later with the same component.
- Showing the original Access row (`raw_row`) on screen.
- Any change to how duplicates are matched or merged.
- Editing or removing the label by hand.

## 4. How it would work

### 4.1 Where the value is kept

A new column `rpa_cv.legacy_source` (text, empty for normal candidates). Values: `ms_access`, later `excel` and `resume`, the same words the provenance table uses in `source_kind`.

Why a new column and not the existing tag or the provenance table:

- `last_action_context` is overwritten by later uploads and merges, so the label would disappear.
- `rpa_legacy_import_rows` has no model in `schema.prisma`, and the candidate search is built on Prisma `findMany`. Filtering through that table would mean rewriting the search query. A column on `rpa_cv` needs one extra line in the existing filter.

The provenance table stays the full record. The column is only a short, permanent copy of "which import".

This is a database change. It follows the repository convention: a dated SQL file and a rollback file under `backend/prisma/ddl/`, a matching field in `schema.prisma`, staging first, then production with sign-off.

### 4.2 Filling it

- **Already imported:** one `UPDATE` sets `legacy_source` from `rpa_legacy_import_rows` for every candidate the import inserted.
- **Future loads:** the loader writes the value when it inserts a candidate.

### 4.3 The label

A small chip beside the name, in the same place and style as the existing "Referral" chip (`ReferralChip.jsx`), with its own colour. Wording to be decided (question 1). One shared component, used in the table and on the candidate view.

On the candidate view the chip has a tooltip with the import date and the Access table name, read from the provenance table.

### 4.4 The filter

A "Source" dropdown in the Search Candidate form, next to "Details completed in":

| Option | Shows |
|---|---|
| All candidates (default) | Everyone, as today |
| Legacy data only | Candidates with a legacy source |
| Without legacy data | Candidates with no legacy source |

The server reads a new query parameter and adds one condition in `buildWhereClause()` (`backend/src/services/candidate.service.js`). The export uses the same function, so the CSV follows the filter.

### 4.5 Who sees it

Internal staff only. Vendors reach the same search endpoint for their own submissions; the new field is dropped for them, the same way the referral fields are (`redactReferral`).

## 5. Questions to decide before work starts

1. **Label wording.** "Legacy" for all three sources, or the source by name ("MS Access", "Excel", "Old resume")? Example: a candidate from the Access file shows either `Legacy` or `MS Access` beside the name.
2. **Candidates who were already in the ATS.** When an Access row matches a candidate HR had already uploaded, the import only fills empty fields on that candidate. Should that candidate carry the label too? Example: a candidate uploaded through HR Upload in October who is also in the Access file. Options: no label (the candidate did not come from Access), or a second wording such as "Also in MS Access".
3. **Does the label ever go away?** For example when HR completes the candidate's details or uploads a fresh resume. The scope assumes it stays for good.
4. **Filter granularity.** One "Legacy data" option, or one option per source once Excel and resumes are imported?
5. **Other screens.** Is the label needed on Candidate Screening and the Pipeline cards in this task, or later?
6. **Duplicate merge.** When a legacy candidate and a newer upload are merged in duplicate review, the surviving record keeps the label. Confirm. This touches the duplicate-merge code in HR Upload, which the migration plan says must not be modified, so it needs Pankaj's explicit approval.
7. **Original record on screen (optional, later).** A read-only "Original legacy record" panel on the candidate view, showing the source row as it was imported, so any single candidate can be shown original beside current. In this task, later, or not at all?

### Answers (Pankaj, 17 Nov 2026)

| # | Answer |
|---|---|
| 1 | The source by name: `MS Access`, later `Excel` and `Old resume`. |
| 2 | Yes, with a second wording: `Also in MS Access`. Stored as `rpa_cv.legacy_relation = 'matched'` (`'imported'` for candidates the import created). |
| 3 | Yes, the label goes away when a fresh resume arrives (HR Upload or Vendor Upload, including the duplicate merge). A manual edit keeps it. Email intake (Outlook) also brings a fresh resume and is treated the same way. |
| 4 | One option per source. The filter lists a source only once candidates from it exist. |
| 5 | Not now. The chip is one shared component (`LegacySourceChip.jsx`) for later use. |
| 6 | The new, up-to-date upload is merged into the old record. That is how the merge already works; no change to merging. |
| 7 | Yes, later. Not in this task. |

## 6. Work and testing

| Part | Work |
|---|---|
| Database | DDL and rollback, `schema.prisma` field, `prisma generate`, backfill statement |
| Backend | Filter parameter in search and export, field in the candidate mapping, vendor redaction, provenance detail for the tooltip |
| Frontend | Chip component, chip in table and candidate view, filter dropdown |
| Import script | Loader sets the value on insert |
| Tests | Backend tests for the filter and the vendor redaction; staging check by Chhaya |

Rough size: two to three working days including the staging test, assuming the answers in section 5 do not widen it.

Testing on staging:

- The count under "Legacy data only" equals the number of candidates the import inserted.
- "Without legacy data" plus "Legacy data only" equals "All candidates".
- A vendor login sees neither the chip nor the field in the API response.
- Re-uploading a legacy candidate through HR Upload and merging the duplicate removes the chip (decision 3). Editing the candidate by hand keeps it.
- The CSV export of a filtered list has the same count as the screen.

## 7. Order of work

1. Pankaj answers section 5 and approves the scope.
2. Build on a branch; DDL and backfill on staging.
3. Chhaya checks on staging.
4. Production: the DDL, backfill and code go together with the production run of the import, or after it. Each production step needs Pankaj's explicit approval.

This task does not block the staging import. It can be built while the import is being reviewed.

## 8. Build report (17 Nov 2026)

### 8.1 Where each step stands

| Step | State |
|---|---|
| 1. Answers and approval | Done (section 5, "Answers"). |
| 2. Build | Done. Not committed; in the working copy on `pankaj-work-staging-v28`. |
| 2. DDL and backfill on staging | Done 17 Nov 2026 (see 8.4). |
| Deploy the new backend and frontend to staging | **Not done.** Until it is, staging shows no chip and no filter. |
| 3. Chhaya checks on staging | Waiting for the deploy. Checklist in section 6. |
| 4. Production | Not done. Needs Pankaj's approval. Apply the DDL **before** deploying the backend: Prisma reads every `rpa_cv` column, so the new build fails on a database without the two columns. |

### 8.2 What was built

| Part | File | Change |
|---|---|---|
| Database | `backend/prisma/ddl/2026-11-17-legacy-source-label.sql` (+ `.rollback.sql`) | Columns `rpa_cv.legacy_source` (`ms_access` / `excel` / `resume`) and `rpa_cv.legacy_relation` (`imported` / `matched`), check constraints, partial index, backfill from `rpa_legacy_import_rows`. The backfill skips candidates that already have a label or that received a fresh resume after their import. Running it again cannot put back a label the ATS removed. |
| Database | `backend/prisma/schema.prisma` | The two fields. `prisma generate` run. |
| Rules | `backend/src/utils/legacySourceView.js` (new) | Wording, filter values, vendor omission and label removal, in one pure module. |
| Search, view, export | `backend/src/services/candidate.service.js` | `legacyLabel` on every candidate, the `legacySource` filter in `buildWhereClause()` (so the CSV export follows it), columns omitted for vendors, `legacySourceCounts()`, `legacyImportsFor()` (source table, outcome and date only; never `raw_row`). |
| Routes | `candidate.controller.js`, `candidate.routes.js` | `GET /api/candidates/legacy-sources` and `GET /api/candidates/:id/legacy-imports`, both staff only. |
| Export | `backend/src/exports/candidates.export.js` | "Legacy source" column; dropped from a vendor's file. |
| Vendors | `backend/src/utils/vendorScope.js` | A vendor's `legacySource` filter is discarded. |
| Label removal | `backend/src/services/hrUpload.service.js` | The duplicate merge and the email-intake update clear both columns. How the merge works is unchanged: the old record survives. |
| Import | `backend/scripts/legacy-migration/3-load.mjs` | Sets `imported` on insert; sets `matched` on an existing candidate that has no label yet. Refuses to run without the columns. |
| Import rollback | `backend/scripts/legacy-migration/4-rollback-batch.mjs` | Removes `matched` labels of the batch when no other batch touched the candidate. |
| Check | `backend/scripts/legacy-migration/6-check-labels.mjs` (new) | Read-only label counts and cross-check against the import log, for staging and production (section 9). |
| Screen | `frontend/src/components/candidates/LegacySourceChip.jsx` (new) | Shared chip, one colour per source. On the candidate view, a tooltip with the source table and import date. |
| Screen | `frontend/src/pages/Candidates.jsx`, `CandidateDetailCard.jsx`, `services/candidateService.js` | Chip beside the name in the table and on the candidate view. "Source" filter: shown to staff once a legacy source exists, with one option per source and its count, "Without legacy data", and "Any legacy data" once there are two or more sources. |
| Tests | `backend/src/tests/legacySource.test.js` (new) | Wording, filter values, vendor omission, label removal on merge and email intake, manual edit keeps it, staff-only routes. |

### 8.3 Checks run

| Check | Result |
|---|---|
| Backend unit tests (16 files in `src/tests/*.test.js`) | 273 passed, 0 failed |
| Frontend production build (`vite build`) | Succeeded |
| Staging DDL dry run, then apply (`scripts/run-ddl.mjs`, `--expect-db recruitmentautomationdb`) | Dry run OK; applied and committed |

`npm run test:unit` uses the glob `src/tests/**/*.test.js`, which also picks up `src/tests/integration/`. Those tests need a running server and hang without one, so the unit tests were run as the 16 top-level files. This is unrelated to this task.

Not yet checked: the screens in a browser and the section 6 staging checklist. Both need the deploy.

### 8.4 Staging result (`recruitmentautomationdb`, 17 Nov 2026)

The backfill updated 4,051 candidates. This matches the import log: many tables were loaded on staging after the pilot, giving 4,050 candidates created by the import and 1 that was already in the ATS.

| Label | Candidates |
|---|---|
| MS Access | 4,050 |
| Also in MS Access | 1 |
| No label | 217 |

Cross-check: 0 candidates in the import log without a label, 0 labelled candidates outside the log, 0 log entries pointing at a missing candidate.

### 8.5 Decisions after the build (Pankaj, 17 Nov 2026)

1. **Email intake: option A, as built.** A resume that arrives by email (Outlook) removes the label, the same as HR Upload and Vendor Upload. Example: Rahul is labelled `MS Access`; he emails a new resume; the label goes.
2. **Later imports: option A, as built.** A candidate keeps the label of the first import that touched it, and a later Excel or resume import does not relabel them. Example: Priya, created by the Access import, is also in the Excel sheet; she stays `MS Access` and is listed under "MS Access data only", not "Excel data only". The import log still records both sources. The Stage 2 and Stage 3 loaders must follow this rule (set a label only when the candidate has none).

### 8.6 Still open

- **Original record panel (question 7).** Planned for later; not started.
- **Commit.** Pankaj commits the change himself.

### 8.7 Staging re-check (17 Nov 2026, after further Access tables were loaded)

`6-check-labels.mjs` on staging: 4,629 `MS Access`, 1 `Also in MS Access`, 217 unlabelled. Cross-check OK. The 579 candidates added after the DDL were labelled by the updated `3-load.mjs` itself, which confirms the loader part on staging.

## 9. Production runbook

Run only after **both** of these:

- Pankaj has confirmed the staging deployment (section 9.1).
- Pankaj has given explicit approval for production on the day.

Production database: `recruitmentautomationdbProd`, env file `backend/.env.production`. All commands from `backend/`.

### 9.1 Gate: staging confirmed

| # | Check on staging | Who | Done |
|---|---|---|---|
| 1 | New backend and frontend deployed to staging | Pankaj | ☑ 2026-11-17 (Pankaj) |
| 2 | Search Candidate shows the chip beside legacy candidates; the candidate view shows it with a tooltip (Access table and import date) | Chhaya | ☐ |
| 3 | "Source" filter: count under "MS Access data only" equals the `ms_access` total from `6-check-labels.mjs` | Chhaya | ☐ |
| 4 | "MS Access data only" + "Without legacy data" = "All candidates" | Chhaya | ☐ |
| 5 | CSV export of a filtered list has the same row count as the screen and a "Legacy source" column | Chhaya | ☐ |
| 6 | Vendor login: no chip, no Source filter, no "Legacy source" column in its export | Chhaya | ☐ |
| 7 | HR Upload of a legacy candidate's resume, then Merge in duplicate review: the chip is gone. A manual Edit of another legacy candidate: the chip stays. (Use a synthetic test candidate, or one HR agrees to.) | Chhaya | ☐ |
| 8 | `node scripts/legacy-migration/6-check-labels.mjs --env staging --expect-db recruitmentautomationdb` ends with `CHECK OK` | Pankaj / Claude | ☑ 2026-11-17 after deploy: 4,679 "MS Access", 1 "Also in MS Access", 217 unlabelled; 4,680 logged candidates, all labelled, none extra; CHECK OK |

### 9.2 Before production

1. Back up the production database (the usual pre-deploy backup) and note its name.
2. Confirm the import log table exists on production, because the backfill reads it:
   `node scripts/legacy-migration/6-check-labels.mjs --env production --expect-db recruitmentautomationdbProd`
   - Prints `import log table ABSENT`: apply `prisma/ddl/2026-11-17-legacy-import-rows.sql` on production first (its own approval, per `PLAN-MS-Access-Data-Migration-Mapping.md`).
   - Prints `label columns ABSENT`: expected at this point; continue.
3. Decide the timing against the production import run (both orders work):
   - **Label first, import after** (recommended): the backfill labels 0 candidates and `3-load.mjs` labels each candidate as it loads.
   - **Import first, label after**: the backfill labels everything the import created.
   - `3-load.mjs` refuses to run on a database without the label columns, so the import cannot run between the backend deploy and the DDL by mistake.

### 9.3 Steps (this order matters)

| # | Step | Command / action | Expected |
|---|---|---|---|
| 1 | DDL dry run | `node scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd --file prisma/ddl/2026-11-17-legacy-source-label.sql --dry-run` | `DRY RUN OK`, 7 statements. Statement 7 shows how many candidates the backfill would label: 0 if the import has not run yet, otherwise about the number of candidates the import created. **Stop and check if it is anything else.** |
| 2 | DDL apply | The same command without `--dry-run` | `COMMITTED.`, same count as the dry run |
| 3 | Check | `node scripts/legacy-migration/6-check-labels.mjs --env production --expect-db recruitmentautomationdbProd` | `CHECK OK` |
| 4 | Deploy backend | The branch with this change. The build must run `npx prisma generate` (the schema has the two new fields). | Backend starts; Search Candidate loads |
| 5 | Deploy frontend | Same branch | Search Candidate shows the Source filter (once a legacy source exists) |
| 6 | Smoke test | Repeat 9.1 checks 2 to 6 on production, read-only (no uploads or merges on real candidates) | As on staging |
| 7 | If the import runs now | Run it as `PLAN-MS-Access-Data-Migration-Mapping.md` says, then repeat step 3 | `CHECK OK`; label count equals the import's inserted count |

**Never deploy the backend before step 2.** Prisma reads every `rpa_cv` column, so the new backend fails on Search Candidate, uploads and merges if the columns are missing.

### 9.4 Rollback

| Situation | Action |
|---|---|
| The screen or filter misbehaves, data is fine | Redeploy the previous backend and frontend. The columns can stay: the old build ignores them. |
| The labels must be removed completely | 1. Redeploy the previous backend first. 2. `node scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd --file prisma/ddl/2026-11-17-legacy-source-label.rollback.sql` (dry run first). The import log is not touched, so applying the forward file later restores the labels, except ones the ATS had removed. |
| One import batch must be undone | `4-rollback-batch.mjs` as the migration plan says. It now also removes that batch's `Also in MS Access` labels. |

### 9.5 After production

- Record in this section: date, dry-run count, applied count, the `6-check-labels.mjs` output (counts only) and who approved.
- Update section 8.1 (step 4: done).
