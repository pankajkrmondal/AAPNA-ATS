# Plan: Legacy migration, Stage 2 (Excel and Naukri) and Stage 3 (resumes)

| | |
|---|---|
| Phase | 4.1 |
| Version | v2.0, 20 Nov 2026. **Stage 2 (Excel and Naukri) is complete on staging and production** (19 Nov 2026, certificates COMPLETE). Stage 3 (resumes) not started. **A new session starts at section 9, "START HERE".** v1.1 (18 Nov) added the proof of completion, the Naukri job source rule, the label names, "why one database" and the HR-gated timeline. |
| Builds on | `PLAN-MS-Access-Data-Migration-Mapping.md` (Stage 1, the mapping rules R1–R11 and V1–V12, the provenance table, the proof pack). Read its sections 1–3 first; this file only adds what is new. |
| Stakeholder version | The shareable Claude Doc "Legacy Candidate Data Migration: Update", one single document (one link, no tabs) with: **Migrated so far**; the plan (what is next, why one database, how, **Proof of completion** with the status board, the 8 checks and "check it yourself", timeline, what HR will notice); and **Report: what was migrated** (per source, plus where the candidate lists are). No technical detail and no personal data. It is the one place HR and management look; the dev team updates it after every wave. |
| Scope | Migration only, run from the backend by command-line scripts. A UI and backend for future Naukri and Excel uploads is a separate later project; nothing here is built for it. |
| Sources | `E:\Recruitment Process Automation\Phase 4\MS-Access\OneDrive_1_11-13-2026\` on the migration machine (the `E:` drive is not on every developer machine) |
| Target | `rpa_cv` on staging (`recruitmentautomationdb`), then production (`recruitmentautomationdbProd`) |
| Deadline | All legacy data in the ATS before 16–20 Feb 2027. Target in this plan: all live by about 11 Dec 2026. Each go-live waits for HR's approval of that batch's proof. |

---

## 1. Decisions taken for this plan (18 Nov 2026)

| # | Topic | Decision |
|---|---|---|
| S1 | Scope | All remaining archive data: AAPNA Excel trackers, Naukri Resdex downloads, Naukri job-application exports, the intern sheet, and about 5,240 resume files. |
| S2 | Where the code lives | One-time scripts only, in `backend/scripts/legacy-migration-excel/` and `backend/scripts/legacy-migration-resumes/`. Nothing under `backend/src` is edited or added. HR Upload is not changed. |
| S3 | Future upload UI | Out of scope. No reusable engine is built for it now. |
| S4 | Resume files | Stored and linked on the candidate (OneDrive), as HR Upload does. |
| S5 | Scanned resumes | Read with Gemini 2.5 Flash (already configured), then parsed by the same parser as every other resume. No local OCR tool. See 5.3. |
| S6 | Production order | Three data waves after one structure-alignment step (section 2). |
| S7 | Same scripts, same structure | One set of scripts for both databases; only `--env`, `--expect-db` and `--allow-production` change. All DDL is applied to both databases in Week 1, before any production load. |
| S8 | Labels | Stage 2 uses `legacy_source = 'excel'`, Stage 3 uses `'resume'`. Both are already allowed by the database, so no DDL is needed. The names shown change under S12. |
| S9 | Proof | The proof is a **completion certificate** per source per database (section 6): one verdict from 8 checks, plus a proof code. No row-count report is sent. The Stage 1 proof pack's detail survives only as the HR-only evidence file. |
| S10 | One place | The shared doc is the one place for HR and management: status, certificates and summaries, no personal data. Candidate-level lists exist only in the ATS (Data origin filter, then export) and in the HR-only evidence folder. |
| S11 | Naukri job source | `JobSource` = "Naukri" plus the year of the source folder: "Naukri 2023" (Resdex), "Naukri 2024-25" (applications). AAPNA tracker rows keep their own source value. |
| S12 | Label and filter names | Filter "Source" becomes **Data origin**. Options: All candidates · Archive – all · Archive – MS Access · Archive – Excel & Naukri · Archive – Old resumes · Current candidates only. Chips: "Archive · MS Access", "Archive · Excel & Naukri", "Archive · Old resumes"; for an existing candidate who was enriched, "Also in archive · …". CSV column "Data origin". Display text only (section 2.2, Step 0). |
| S13 | HR gate | Each batch goes live only after HR approves its staging proof (stakeholder doc, "How we will do it" and "Timeline"). If a review takes longer, that batch's go-live moves, not the staging work. |

Decided by Pankaj on 19 Nov 2026, at the start of the Stage 2 staging work:

| # | Topic | Decision |
|---|---|---|
| S14 | Rows loaded | Every row of every Excel file, on staging and on production. No sample cap on staging (a 20-row cap was considered and withdrawn the same day). |
| S15 | Naukri Resdex `createdAt` | The row's `Last Active Date` (closes O1). |
| S16 | Step 0 for Stage 2 | `certify.mjs` and `check-schema-parity.mjs` are built with the Stage 2 staging work. The label and filter rename (S12) is a separate task later; until then Excel candidates show the current label "Excel". |
| S17 | Folder `Good Profiles Count from Outlook, Naukri - 2023` | Included in Stage 2, spreadsheet files only (`.xlsx`, `.xls`, `.csv`). Every other file type in it (PDF, DOC, DOCX and so on) belongs to Stage 3. |

Decided by Pankaj on 20 Nov 2026, at the start of Stage 3:

| # | Topic | Decision |
|---|---|---|
| S18 | Staging scope for resumes | **Staging loads a 10-file sample only** (not the plan's 50-file sample, not the whole archive). Production loads every file. The sample is fixed by a hash (`1-inventory.mjs`, seed `stage3-staging-sample-v1`): 4 PDF, 3 DOCX, 1 Word 97-2003 `.doc`, 1 HTML-as-`.doc`, 1 image. Consequences: the parse runs on the 10 first (cost and time per resume measured there), then once on everything before production; the production dry run (read-only) is the first full view of matches, identity conflicts and rejections; HR's staging approval (S13) covers the sample. |
| S19 | `.doc` files | Converted to `.docx` working copies with LibreOffice headless (`1b-convert.mjs`), because HR Upload's `extractTextFromFile()` rejects `.doc`. Originals untouched. LibreOffice 26.8.3.1 installed on the migration machine for this (20 Nov). |
| S20 | RTF (3) and PPTX (1) | **Not converted, not imported.** Outcome `skipped_unsupported_type` (new DDL value), listed for HR. |
| S21 | Saved e-mails (5 files with no usable extension, each an e-mail with one PDF resume attached) | **Option A:** the attached PDF is taken out into the work folder (`1c-extract-email-pdfs.mjs`, originals untouched) and imported like any other PDF. Provenance stays on the e-mail file (its SHA-256). |
| S22 | Certificate check 8 for resumes | On production, check 8 ("live matches staging") compares only the 10 sample files; the other files have no staging counterpart by design (S18). |
| S23 | "Present" end dates on old resumes (23 Nov) | HR Upload counts "present" up to today, which adds up to 3 years to a 2023 resume. For the migration, "present" counts up to **December of the folder's year** (`12/2023`, `12/2025` for 2024-25). Only the experience sums change (`TotalExperienceYears`, `LastCompanyExperienceYears`, the numeric column, each job's `YearsWorked`); the stored history keeps the resume's own wording. The one deliberate difference from HR Upload: `lib/hr-steps.mjs` (`presentAs`), `lib/folders.mjs` (`presentAsOf`). Warning `experience_present_capped_at_folder_year`. The parity test (5.8) runs without the cap. |
| S24 | Where the full resume set goes (23 Nov) | **Production only.** The full parse runs once with the production keys (`--env production`); the full set is loaded to production only. Staging keeps just the 10-file sample (S18, loaded 23 Nov). HR's review before go-live is the staging sample, the transform's not-imported list and the production dry-run numbers, instead of a full staging certificate. Runbook: 5.9. |

---

## 2. Production approach

### 2.1 Principles

1. **One set of scripts and one database structure for both environments.** Every DDL file the migration needs is applied to staging and production together in Week 1 (Step 0). After that nothing structural changes, and every wave is data only. Before each production wave, `backend/scripts/check-schema-parity.mjs` (new, read-only) compares the two databases and stops on any difference: `rpa_cv` columns, `rpa_legacy_import_rows` columns, and the CHECK constraints `chk_legacy_import_source_kind`, `chk_legacy_import_outcome`, `chk_rpa_cv_legacy_source`, `chk_rpa_cv_legacy_relation`.
2. **Code first, then data, never on the same day.** The 16 Nov production release is done. If the legacy label build (`da71a03`) is not on production yet, it goes out in Week 1 right after its DDL, at least a day before Wave 1.
3. **Same load order on both databases.** The rule "fill empty fields only" means the first legacy source to fill a field keeps it. Staging and production are loaded in the same order, so each staging run is a true rehearsal.
4. **Most trusted source first.** Access, then the AAPNA trackers, then Naukri exports, then resumes. Oldest data first inside each source (R8).
5. **Production dry run before every apply.** Staging held about 220 real candidates before the Access load; production holds about 9,200. Only a dry run against production shows the real "already in the ATS" count. Stop and ask when it is far from what is expected.
6. **Small, reversible batches.** One table, file or resume folder per batch. Rollback in reverse order.
7. **Each wave ships when ready.** One combined run would be a 20–30 hour window with a larger blast radius, and would keep the Access scripts frozen longer.

### 2.2 Steps

| Step | Content | Exit check |
|---|---|---|
| 0 | Week 1, once. DDL to both databases with the guarded runner (dry run, then real): `2026-11-17-legacy-import-rows.sql` and `2026-11-17-legacy-source-label.sql` on production if missing; the new Stage 3 outcome file (5.7) on both. Schema parity check. Then the label build **with the new names (S12)** to staging, then production (backend after the DDL, then frontend). Stop `ats-staging-worker` during any restart (shared Redis queue). | `check-schema-parity.mjs`: MATCH. `6-check-labels.mjs --env production`: CHECK OK. Search Candidate shows "Data origin". |
| Wave 1 | MS Access. The staging certificate (section 6) goes to HR in Week 1. After HR approves, production runs exactly as `PLAN-MS-Access-Data-Migration-Mapping.md` §3.14 B4–B11 (B1–B3 are covered by Step 0), then the production certificate. | Both certificates COMPLETE; 8,843 records accounted for. |
| Wave 2 | Excel: layout A (trackers) → D (intern sheet) → B (Naukri Resdex) → C (Naukri applications). Staging, then the staging certificate to HR; after approval, the production dry run, production, then the production certificate. | Per file: reconcile and check; certificates COMPLETE. |
| Wave 3 | Resumes, folder by folder, oldest year first. Staging, then the certificate to HR; after approval, production over 2 days, then the production certificate. | Per folder: reconcile and check; certificates COMPLETE. |

**Label and filter rename (Step 0, S12).** Display text only; stored values and DDL unchanged. Ship to staging, then production, with the label build.

| File | Change |
|---|---|
| `backend/src/utils/legacySourceView.js:16-20`, `:43-47` | Names "Archive · MS Access", "Archive · Excel & Naukri", "Archive · Old resumes"; matched label "Also in archive · <name>" |
| `frontend/src/pages/Candidates.jsx:84-101` | Filter title "Data origin"; options All candidates · Archive – all · Archive – <name> (n) · Current candidates only; the filter phrase |
| `frontend/src/components/candidates/LegacySourceChip.jsx` | Tooltip "From: <table / file / folder>, added on <date>" |
| `backend/src/exports/candidates.export.js:50` | CSV column "Data origin" |

### 2.3 Effort and timeline

Hands-on developer hours, Claude-assisted. Machine time is unattended script time.

| Workstream | Tasks (hours) | Dev h | Machine time |
|---|---|---|---|
| Plan documents | Stakeholder doc 2, this plan 2 (done 18 Nov) | 4 | |
| Step 0 | Stage 3 outcome DDL 1, DDL to both databases with dry runs 1, `check-schema-parity.mjs` 1, label build to production if needed 2, new label and filter names (S12) 2 | 5–7 | |
| Proof and reporting | `certify.mjs` 6, manifest contract 1, doc updates after each wave 1 | 8 | |
| Wave 1 | Fingerprints and backup 0.5, pilot 0.5, watch 1, label check 1 | 3 | about 5 h |
| Stage 2 build | Header profiling 2, extractor and layout mappings with Naukri rules 10, loader/check/rollback/runner adapted from Stage 1 4, mapping fixes from the dry-run report 4 | 20 | |
| Stage 2 loads | Staging 2, production dry run 1, production 2, certificates 1 | 6 | 2–3 h per database |
| Stage 3 build | Inventory 3, conversion 2, scanned-file reader 3, runner 16, parity test 3, 50-file sample 2 | 29 | about 1 h inventory |
| Stage 3 loads | Parse run 2, staging load and insights 2, checks and certificates 2, production 2 | 8 | parse 5–6 h once; load 6–8 h per database |
| **Total** | | **about 84 (75–95)** | **about 30 h** |

The weeks follow the doc's HR-gated cadence: a batch is loaded to staging and its certificate sent to HR in one week, and it goes live the next week once HR approves.

| Week | Work | Dev h | Dates (optional) |
|---|---|---|---|
| Done | MS Access on staging; label and filter on staging; 16 Nov production release; plans and stakeholder doc | | 6–18 Nov |
| Week 1 (3 days) | Step 0 with the new names. Build `certify.mjs`; **MS Access staging certificate to HR**. Excel header profiling, resume inventory. Start the Stage 2 extractor. | about 16 | Wed 18 – Fri 20 Nov |
| Week 2 | **Wave 1, MS Access live** once HR approves; production certificate. Finish Stage 2; dry run, fixes, staging; **Excel and Naukri staging certificate to HR**. Start Stage 3: conversion, scanned-file reader. | about 30 | Mon 23 – Fri 27 Nov |
| Week 3 | **Wave 2, Excel and Naukri live** once HR approves; production certificate. Finish the Stage 3 runner, parity test, 50-file sample, one parse run, staging; **resume staging certificate to HR**. | about 30 | Mon 30 Nov – Fri 4 Dec |
| Week 4 (short) | **Wave 3, resumes live** once HR approves; production certificate. Status board: all six cells Complete. Spare days for any re-run. | about 4 | Mon 7 – Fri 11 Dec |

### 2.4 Working with Claude usage limits

- One build task per 5-hour session (Stage 2 extractor and mappings: about 2 sessions; Stage 3 runner: 3–4). Start each session from this file and the "Where we stand" log in section 9, not from a stretched conversation.
- Long runs (loads, parse, embeddings) are plain Node processes started from a terminal. They are watched through their logs and the check scripts, not inside a Claude session, so they use no Claude usage.
- Review and load days need little Claude; they sit between build days so the weekly limit lasts. If it runs out early, the Stage 3 build moves to the second developer or into the buffer.

### 2.5 Why one database

All archive data goes into the ATS PostgreSQL database (`rpa_cv`); there is no separate archive database or schema, and MS Access is frozen read-only after the last sign-off. The stakeholder doc gives the reasons in plain words. For developers:

- **One search path.** Search Candidate, JD screening (`screeningV2.service.js`), the duplicate matcher and the vectors all read `rpa_cv` and `rpa_cv_vectors` only. A separate store would be invisible to them, or would need every one of them to be changed.
- **One record per person.** The matcher merges archive rows into existing candidates. Two stores would drift: the same person edited in both.
- **Proof in the same place.** `rpa_legacy_import_rows` sits next to `rpa_cv`, so the certificate's checks are plain joins within one database.
- **Separable at any time.** `legacy_source` and `legacy_relation` plus the Data origin filter show or hide archive candidates without a second system.
- **One structure, two databases.** Staging and production have identical DDL (Step 0, `check-schema-parity.mjs`), so the same scripts run on both and a staging run is a true rehearsal.
- **Backups and recovery** follow the existing PostgreSQL routine. The questions still open on backups are in the stakeholder doc ("To confirm before go-live").

---

## 3. Rules carried over from Stage 1 (unchanged)

- Legacy data never overwrites the ATS. Empty fields are filled; history fields (`HRQuickcomments`, `TechRoundOne/Two/Three`, `ManagerialOrCEOFeedback`, `HRInterview`) are appended under "Legacy (<source>, <date>)". Extra emails and phones are added to the lists. `createdAt` of an existing candidate is not changed.
- Matching: `sanitizeMatchEmails()`, `sanitizeMatchContacts()`, `findExistingCandidateMatch()` from `hrUpload.service.js`, unchanged.
- No email is sent. Each batch check confirms no rows in `rpa_email_messages`, `rpa_email_log`, `rpa_email_notifications` for the batch's candidates.
- One provenance row per source row in `rpa_legacy_import_rows`; reconcile: rows read = inserted + merged in file + updated existing + skipped + rejected.
- Guards: `--env` and `--expect-db` on every command; `--allow-production` on every production write; dry run before every apply.
- Candidate data is never printed in logs, reports in the repo, or chat. Work folders and evidence files stay outside the repository.
- Search vectors with `saveCandidateVector()` for inserted candidates; `3b`-style retry for failures.
- The first legacy import to touch a candidate sets its label; later imports do not relabel (`3-load.mjs:167`).

### 3.1 New safeguards

| Safeguard | Rule | Where |
|---|---|---|
| Shared-contact guard | An email or phone seen with more than 3 different names is not used for grouping or matching, and is listed in the dry-run report. Stage 1 only excluded `9876543210`. | Both transforms |
| Identity guard | A resume that matches an existing candidate by email or phone, but whose name clearly differs (no shared name token after normalising), is not merged. Outcome `review_identity_conflict`, listed for HR. | Stage 3 load |
| Truncation repair | When an ATS history field is exactly the first 255 characters of the incoming Excel value, the full text replaces it (before-value kept in `changed_fields`) instead of being appended. Recovers Access notes cut at 255 characters (Access plan Q4). | Stage 2 load |
| Performance check | After each staging wave, time Search Candidate, JD screening (`screeningV2.service.js` reads every `rpa_cv` row) and the HR Upload duplicate check. If clearly slower, bring the index work of V31 `docs/security/ATS-DB-SCALE-READINESS-PLAN.md` forward before the next production wave. | Each wave |

---

## 4. Stage 2: Excel and Naukri

### 4.1 Sources

| Layout | Files | Rows | Folder |
|---|---|---|---|
| A. AAPNA tracker (Access headers) | `BDA.xlsx`, `Year 2023_Decisions Developer.xlsx`, `Year 2023_Dot Net Developer.xlsx`, `QA Testing  2023.xlsx` | about 1,780 | `Year 2023_Excel Data` |
| D. Intern sheet | `Rakhi Ma'am cv.xlsx`, sheet `Intern Profile` only (sheet `Exp & Fresher` is already in Access) | 13 | root |
| B. Naukri Resdex download | 6, plus 2 with a title row above the headers | about 3,880 | `Naukri Download Data 2023` |
| C. Naukri job-application export | 8 (role from `Job Title`, not the folder) | about 450 | `Naukri Good Profile Data Year 2024 - 2025\...` |
| Skipped | `Karya Keeper Entry Sheet_HRD Jan 2025_Master Sheet.xlsx` (staff timesheet) | | root |

Counts are from the 13 Nov inventory. **Measured on 19 Nov (as loaded):** 22 spreadsheets, 21 sheets loaded (A 4, D 1, B 8, C 8), 6,126 rows below the header rows, 5,801 with data, 325 blank. 17 sheets skipped: 7 Naukri `Candidate insights` statistics sheets, 9 sheets of the Karya Keeper timesheet, `Exp & Fresher` (already in Access). The folder `Good Profiles Count from Outlook, Naukri - 2023` holds no spreadsheet (S17).

### 4.2 Scripts (`backend/scripts/legacy-migration-excel/`), as built 19 Nov

All commands run in `backend/`. `<work>` = `E:\Recruitment Process Automation\Phase 4\MS-Access\_migration-work-excel`. `<n>` = the **load-order number** of a sheet (1–21; dry-run report "Per sheet, in load order", `transform/units.json` field `order`).

| Script | What | Flags |
|---|---|---|
| `1-extract-excel.mjs` | Reads every spreadsheet with SheetJS (spreadsheets only, S17). Detects the header row, classifies the layout, writes `raw/NN.jsonl` (`{"t":unit,"id":"r<excel row>","v":{header:[kind,value]}}`) and `manifest.json` (per unit: file, sheet, layout, header row, `sourceCount`, `sheetNonBlankRows`, `secondCount`, `countsMatch`, SHA-256; plus `skipped` with reasons). Calls `1b-recount-openxml.ps1` for the second count. **Refuses to run if `manifest.json` exists**: the extract runs once. | `--root <source folder> --out <work>` |
| `1b-recount-openxml.ps1` | Second, independent count: opens each `.xlsx` package read-only with .NET (zip + XML) and counts non-blank rows. Replaces the ACE OLEDB recount the plan first named (ACE is not registered on the migration machine). | called by the extract |
| `2-transform.mjs` | Maps, cleans, applies the shared-contact guard, groups by person across all files (union-find), sets the load order. No database. Writes `transform/units.json`, `transform/candidates.jsonl`, `transform/rows.jsonl`, `report/dry-run-report.md`, `report/no-contact-details.xlsx`, `report/review-merged-names.xlsx`, `report/review-shared-contacts.xlsx`. `--access-work` (optional, read-only) counts people also in the Stage 1 transform. Stops on an unknown layout, a count mismatch, a file without a default role, or a Naukri folder without a year. | `--work [--access-work <Stage 1 work folder>]` |
| `3-load.mjs` | Loads one sheet: insert or enrich (3.9 rule, truncation repair), provenance, label, search entry. Production needs `--allow-production` even for its dry run. | `--work --file <n> --env --expect-db [--apply] [--no-vectors] [--allow-production]` |
| `3b-retry-vectors.mjs` | Search entries for Excel-inserted candidates that have none. Dry run, then `--apply`. | `--work --env --expect-db [--apply] [--allow-production]` |
| `3c-check-batch.mjs` | Read-only check of one batch (columns against the transform, tag, label, search entries, no email). | `--work --batch <id> --env --expect-db` |
| `4-rollback-batch.mjs` | Undo one batch (deletes inserted, restores changed fields incl. truncation repairs and appended notes, removes "Also in Excel" labels it set). Dry run, then `--apply`. Roll back in reverse batch order. | `--batch <id> --env --expect-db [--apply] [--allow-production] [--work]` |
| `6-run-files.mjs` | Dry run → apply → check per sheet in load order; retries failed search entries after a sheet; stops on the first failure; a re-run skips done sheets and recorded rows. `--dry-run-only` reads only and prints every sheet's figures. Progress in `<work>/report/<env>-load-all.json`. | `--work --env --expect-db [--allow-production] [--only <n>] [--dry-run-only]` |
| `lib/env.mjs` | Loads `backend/.env.<env>` with override **before** any ATS module, and refuses an `--env` / `--expect-db` pair that does not belong together. So `--env production` really reaches production (fixes the Stage 1 issue; no `--env-file` needed for these scripts). | |
| `lib/layouts.mjs` | Layout detection, header classification per layout, skip rules, defaults per file, JobSource rule, load order of layouts, `CV_FIELDS` (Stage 1 fields + 4 degree columns). | |
| `lib/naukri-rules.mjs` | The Naukri value rules in 4.4, plus the NA placeholders, the layout C role and shift answer, name quotes. | |

Shared, outside the folder: `backend/scripts/legacy-proof/certify.mjs` (section 6.3; serves `--source excel` and `--source ms_access`) and `backend/scripts/check-schema-parity.mjs` (`--a staging --b production`; read-only catalog comparison, 96 items).

Reuse without editing: `../legacy-migration/lib/rules.mjs`, `../legacy-migration/lib/missing-fields.mjs` and `../legacy-migration/lib/mapping.mjs` (layout A header aliases) are imported. The Stage 1 folder stays frozen as the record of the Access run. The Stage 1 loader and rollback are copied and adapted, because `SOURCE_KIND` and `TAG` are hard-coded there (`lib/mapping.mjs:5-6`).

Constants: `SOURCE_KIND = 'excel'`, `TAG = 'legacy_excel_migration'`, history label `Legacy (Excel: <file>, <date>)`.

Work folder (outside the repo): `E:\Recruitment Process Automation\Phase 4\MS-Access\_migration-work-excel\` with the same layout as Stage 1 (`manifest.json`, `raw/`, `transform/`, `report/`, `logs/`).

**Why SheetJS and not ACE OLEDB.** OLEDB guesses each column's type from the first rows. A notes column whose first rows are short is read as 255-character text, and cells that do not fit the guessed type come back empty. That is the likely cause of the 255-character cut seen in the Access data. SheetJS reads each cell's own value. Phone numbers are taken from the cell's text so they are never turned into floats or scientific notation.

### 4.3 Mapping

Layout A uses the Stage 1 alias list as it stands. Layouts B and C start from the preliminary mapping in Access plan §4.2 and are confirmed against the Week 1 header profile. Additions and confirmations:

| Item | Rule |
|---|---|
| `JobSource` | Layouts B and C: "Naukri" plus the year in the source folder's name (S11): `Naukri Download Data 2023` gives "Naukri 2023", `Naukri Good Profile Data Year 2024 - 2025` gives "Naukri 2024-25". The year rule lives in `lib/layouts.mjs`; a Naukri folder with no year stops that file in the dry run. Layout A: the row's own source through `cleanSource()`. `JobSource` is free text and nothing groups by it (`screeningV2.service.js:86`, `utils/duplicateCompare.js:69` only list it), so the suffix breaks no report. |
| `PositionApplied` | B: `Designation` (a cell over 80 characters or a status word is rejected), else the role in the file name. C: `Job Title`, the text before the first " \| " ("HR Intern role", "Accountant"). A: `Role`, else the file default. D: `Intership/Position applied for`, else "Intern". |
| Defaults per file (R5, as loaded) | `BDA.xlsx`: Business Development Executive / Business Development (the file's own value on its filled rows). `Decisions Developer`: Decisions and RPA Developer / Decisions, RPA. `Dot Net Developer`: Dot Net Developer / .NET. `QA Testing 2023`: QA Engineer / Testing, QA. Resdex: Android Developer, Business Analyst, DevOps Engineer, Flutter Developer, iOS Developer, Node JS Developer (from the file name). Intern sheet: Intern. Kept in `fileDefaults()` of `lib/layouts.mjs`. |
| `Top5KeySkills` | B: `Resume Title` (no skills column). C: `Key Skills`. A: `Key Skills`, else the file default. |
| Degrees | B: `U.G. Course` → `graduationdegree`, `P. G. Course` → `postgraduationdegree`; `HighestQualification` = Post PG, else PG, else UG. C: UG / PG degree and specialization to the four degree columns; `HighestQualification` = doctorate, else PG, else UG. "NA", "Not Pursuing Pg" and the like are empty. |
| `createdAt` | A: `Date`. C: `Date of application`. B: `Last Active Date` (S15). D: no date, so the import time. |
| Screening questions (C) | Matched by keywords: current CTC → `CTC_LPA` (only when `Annual Salary` is empty), expected CTC → `ExpectedCTC_LPA`, notice period → `NoticePeriod` (only when the notice column is empty), English rating → `EnglishCommunicationRating` (as written, e.g. "4" or "3, 4"), shift → `PreferredShift` written as "11 am to 8 pm shift: Yes". Not mapped, kept in `raw_row` only: TDS years, relocate to Delhi/NCR, USA/Australian accounting, unpaid internship, work from home, employee engagement. |
| `Comment 1–5` | B: empty in every file. C: 8 rows with text, joined into `HRQuickcomments`. |
| Intern sheet (D) | In 5 rows the email and the position are in each other's columns: swapped back, warning `email_and_position_swapped`. |
| Shared-contact guard (3.1) | 1 contact seen with more than 3 names: not used for grouping or matching, and also left off those 4 candidates' contact fields (listed in `review-shared-contacts.xlsx`). |
| Matching notes | Compared without regard to whitespace, so the same note in Access and Excel is not appended twice. |
| Unmapped columns | Kept in `raw_row` only (address, date of birth, marital status, view/download activity, Resume ID, Naukri channel "Hot Vacancy"/"Broadcast", Department, Naukri Role, Industry, Resume Headline, Summary). The dry run found 0 columns with data that no rule covers. |
| Unknown header set | Stops that file until the mapping is agreed. |

### 4.4 Naukri value rules (`lib/naukri-rules.mjs`)

| Field | Seen in Naukri | Rule |
|---|---|---|
| Experience | B: `6Y 7 M`; C: `5 Year(s) 6 Month(s)`, `Fresher` | Display text "6 Years 7 Months" ("6 Years" when 0 months); numeric years + months/12 (6.58). Fresher = 0. Unlike the Access `3.6` question, Naukri states months explicitly. |
| CTC | B: `INR 6.0 L`; C: `Rs 4.20 Lakhs`, `NA`; C answers: `500000` | Strip currency and units; a value above 1,000 is divided by 100,000 (the ATS threshold). Result in LPA. 10 values with words or a range are kept as written (`ctc_kept_as_written`). |
| Notice period | `15 Days or less`, `1 Months`, `Serving Notice Period`, `More than 3 Months` | Kept as text; days through `parseNoticePeriodDays()`. |
| Dates | B: `18 Apr 2023`; C: `29-Jan-2025` | Month names read; then Stage 1 rule V1 (2015 onward, not in the future). |
| Phone | B: a mobile, then on a second line `91 <number>` or a landline | Stage 1 rule V2 on the cell **as written** (line breaks kept, so the second number splits correctly). 263 rows lose a fragment (e.g. a bare "91 22"); the untouched cell stays in `raw_row`. |
| Email | | Stage 1 rule V3. |
| Placeholders | `NA`, `Not Mentioned`, `Not Pursuing Pg`, `-`, `#N/A` | Empty. |

---

## 5. Stage 3: resumes

### 5.1 Sources

About 5,240 files: 3,446 PDF, 1,371 DOCX, 419 DOC, about 12 RTF/JPG/PPTX, in role and year folders. Re-measured by the inventory.

**Measured 20 Nov (by file content, not extension):** 5,273 archive files; 22 spreadsheets (Stage 2) leave 5,251 for Stage 3 in 26 folders. 3,446 PDF, 1,371 DOCX, **420** `.doc` (372 real Word 97-2003, 46 HTML pages saved as `.doc`, 2 DOCX with a `.doc` name; 416 distinct by SHA-256), 5 JPG, 3 RTF, 1 PPTX, and 5 saved e-mails with no usable extension, each carrying one PDF resume as an attachment (S21). Folder roles and years: `backend/scripts/legacy-migration-resumes/lib/folders.mjs`.

### 5.2 Scripts (`backend/scripts/legacy-migration-resumes/`)

| Script | What |
|---|---|
| `1-inventory.mjs --root --out <work>` | Walks the folders. SHA-256 per file; byte-identical copies collapse into one (`skipped_duplicate_file`). Records folder, role from folder name (R5), file date, type. Writes the manifest in the contract of section 6.3 (unit = folder, `sourceCount` from the walk, `secondCount` from a PowerShell `Get-ChildItem -Recurse -File` count). No AI. |
| `1b-convert.mjs --work` | Headless LibreOffice (`soffice --headless --convert-to`) in a working copy: `.doc` and `.rtf` to `.docx`, `.pptx` to `.pdf`. Originals untouched. Needs LibreOffice on the migration machine. |
| `2-parse.mjs --work [--concurrency 4] [--limit N]` | Text: `extractTextFromFile()`. Under about 200 characters: the scanned-file reader (5.3). Fields: `parseResumeWithOpenRouter()`. Then HR Upload's own checks (5.4). Result cached as `parse/<sha256>.json`. Resumable; backoff on 429. Run **once**; both databases load the same cache. |
| `3-transform.mjs --work [--sample]` | Groups by person (email or phone, shared-contact guard). The newest resume is the primary CV; older ones are kept in provenance (`merged_in_file`) and add only their emails and phones. "Newest" = folder year, then the latest date written in the employment history, then the longer text (file dates cannot be used: every archive file carries the 13 Nov 2026 download date). A resume in a group whose name shares no token with the primary's is not merged (`review_identity_conflict`). Role from the folder when the parser gives none. No valid email: `rejected_no_email`, listed for HR. Scanned JPGs are wrapped in a one-page PDF for upload (the ATS does not treat `.jpg` as a resume). `--sample` writes `transform-sample/`, the full run `transform/`. |
| `4-load.mjs --work (--sample \| --folder <n>) --env --expect-db [--apply] [--allow-production]` | Match, identity guard, insert or enrich (5.5), OneDrive upload, vector, provenance. Refuses `--apply` until the 5.7 DDL is applied. An upload whose database write fails is deleted again. 3 workers; one write at a time per matched ATS candidate. |
| `4b-insights.mjs` | `preGenerateCandidateInsights()` for inserted candidates, as a separate resumable pass. |
| `4c-check-batch.mjs`, `4d-retry-vectors.mjs`, `5-rollback-batch.mjs`, `7-run-folders.mjs` | As Stage 2; rollback also deletes the uploaded OneDrive files (`deleteDriveItem()`). The runner has `--sample`, `--only <n>`, `--dry-run-only` and `--max-people N` (the per-day cap). The proof comes from `legacy-proof/certify.mjs` (section 6). |

Constants: `SOURCE_KIND = 'resume'`, `TAG = 'legacy_resume_migration'`. Provenance: `source_file` = the archive root, `source_table` = the folder path (hashed if over 200 characters), `source_row_id` = the file's SHA-256.

### 5.3 Scanned resumes

A file whose extracted text is empty or under about 200 characters (image-only PDF, JPG, PNG) is sent to Gemini 2.5 Flash through the existing `@google/generative-ai` client and `GEMINI_API_KEY`, as inline file data, with a prompt that asks for the resume's plain text only. That text then goes through the same `parseResumeWithOpenRouter()` as every other resume and is stored as `resume_full_text`. The provenance warning `text_from_scanned_reader` marks these rows.

Chosen over a local OCR tool because it needs no new install (Tesseract would also need a PDF-to-image step), reads two-column layouts and tables better, and adds no new data exposure: resume text already goes to the same providers for parsing. Only corrupt or password-protected files are left (`rejected_unreadable`), listed for HR.

### 5.4 HR Upload steps the runner repeats

These live inside `runBatchParsing` in `hrUpload.service.js` and are not exported, so the runner repeats them. The parity test (5.8) guards the copy.

1. Experience from employment history (`:1276-1289`, `utils/experienceParser.js`).
2. `resume_text_quality` and `resume_technical_terms` (`:1291-1309`).
3. Keep only emails that appear in the resume text, with the fallback that reads emails from the text (`:1317-1335`).
4. Keep only phones whose digits appear in the text (`:1344-1348`).
5. No valid email: not imported, even with a phone (`:1350-1369`). This replaces the "no email and no phone" wording of Access plan §5.3.
6. The insert field set of `rpa_cv.create` (`:1645-1709`).

### 5.5 Load rules

- **New person:** insert with the HR Upload field set, `resume_full_text`, `cvFileUrl` and `cv_file_item_id`, the tag, `legacy_source='resume'`, `legacy_relation='imported'`, `missingData` and `statusActive` from `missing-fields.mjs`.
- **Existing person:** fill empty fields. Attach the CV and the resume text **only when the candidate has none**; a CV HR uploaded is never replaced. Recompute `missingData` (an Access candidate gaining a resume loses `uploadResume`). Label only if the candidate has none.
- **OneDrive:** `uploadFileToOneDriveDetailed(path, name, { folderPath: 'Legacy resumes/<year>' })`, per environment (each has its own `MS_ONEDRIVE_PARENT_ID`). Upload happens in the load, not the parse, so a rolled-back batch can delete exactly its files.
- **Pacing:** 3–4 workers, backoff on 429 from Gemini, OpenRouter and Microsoft Graph, a per-day cap on production.
- **Never called:** `runBatchParsing`, `dispatchBatchParsing`, any mail function, the resume queue.

### 5.6 Before the parse run

- Confirm the OpenRouter account's privacy setting: no training on inputs, no prompt logging. This is an account setting, not code.
- Run on a 50-file sample first to size time and cost.

### 5.7 DDL (written and applied in Step 0)

`backend/prisma/ddl/2026-11-20-legacy-import-outcomes.sql` and `.rollback.sql` (written 20 Nov, not applied yet): drop and re-add `chk_legacy_import_outcome` with the five Stage 1 values plus `rejected_no_email`, `rejected_unreadable`, `skipped_duplicate_file`, `skipped_unsupported_type` (added for S20), `review_identity_conflict`. Additive; applied with `run-ddl.mjs` (dry run, then real). **Staging applied 23 Nov 2026** (Pankaj: staging only for now). **Production not applied yet**: until it is, `check-schema-parity.mjs` will show this constraint as the one difference, and no production resume apply can run (`4-load.mjs` refuses).

### 5.8 Parity test

The same 10 synthetic resumes (no real people) go through HR Upload on a local backend and through the runner. The two sets of `rpa_cv` rows must match field by field, apart from the tag, the legacy columns and the email-related fields.

**As built (23 Nov 2026):** `backend/scripts/legacy-migration-resumes/test/parity.test.mjs`, run with `node --test --experimental-test-module-mocks scripts/legacy-migration-resumes/test/parity.test.mjs`. A local backend would have sent real welcome and missing-data emails to the synthetic candidates and uploaded to OneDrive, so the test runs HR Upload's **real** `runBatchParsing()` in-process with its outside connections replaced by recorders (database, OneDrive, vector store, email service, upload jobs, tag/sync/pipeline services, the LLM call returning a fixed parse) and `fetch` blocked. 11 synthetic DOCX resumes (`.test` email domain), built at run time. Compared: the `rpa_cv.create` data against `applyHrUploadSteps().fields` (41 fields; not the CV link, vendor, last action, timestamps, legacy label; `resume_term_updated_at` present or absent), and the search-entry input in key order (not `EmailID`/`unique_key`, which the migration sets to the validated list on purpose). Result: **12 of 12 pass** after one fix (below). The 21 emails HR Upload tried to send went to the recorder.

Fix found by the test: HR Upload's private `getMissingFields()` also copies the degree keys into lowercase keys on the parsed object (`graduationdegree`, …), which `saveCandidateVector()` embeds as JSON. The Stage 1 copy (`legacy-migration/lib/missing-fields.mjs`, frozen) leaves that out, so `lib/hr-steps.mjs` now does it (`normaliseDegreeKeys`). Stored `rpa_cv` fields were never affected; only the search entry's text. The 7 staging sample search entries (23 Nov) were built before the fix and are left as they are (same degree values, already present under the CamelCase keys).

### 5.9 Production-only run (S24), plan of 23 Nov 2026

Nothing in this section has been run on production yet. Each phase starts only on Pankaj's go-ahead for that phase.

**Why production only saves cost.** The parse is not tied to a database. `2-parse.mjs` runs on the migration machine, writes only `<work>/parse/<sha256>.json`, and both databases would load the same cache. So the parse is paid **once** whichever environment is named. What costs money **per database** is the load: one Gemini embedding (`gemini-embedding-001`) and one insights call (OpenRouter first, Gemini as fallback) per new candidate. Loading the full set to production only, and not to staging, saves those calls on staging (the sample's 7 were done on 23 Nov).

**Which account pays (checked 23 Nov, yes/no only, no key printed).**

| Call | Where it happens | Key | Staging and production keys |
|---|---|---|---|
| Resume parse (`parseResumeWithOpenRouter`, `openai/gpt-4.1-nano`) | 2-parse | `OPENROUTER_API_KEY` | **The same key**: one bill, whichever `--env` is used |
| Scanned-file reader, and the parser's Gemini fallback | 2-parse | `GEMINI_API_KEY` | Different; `--env production` bills production's Gemini account |
| Search entry (embedding) | 4-load, new candidates only | `GEMINI_API_KEY` | Production's, because the load runs with `--env production` |
| AI insights (`preGenerateCandidateInsights`, `hrUpload.service.js:1031`, call at `:1104`) | 4b-insights, new candidates only | **`OPENROUTER_API_KEY` first** (through `generateContentWithFallback`), Gemini only as fallback. Corrected 23 Nov: it is not Gemini-only. The function returns null without a Gemini key set (`:1032`), so `4b-insights` must run with the Gemini key present | OpenRouter: the shared key; fallback: production's Gemini |

**Every place that calls OpenRouter (checked 23 Nov 2026).** The only code that talks to OpenRouter is `generateContentWithFallback()` in `backend/src/utils/geminiHelper.js:35-79` (`POST {OPENROUTER_BASE_URL}/chat/completions`, model `OPENROUTER_MODEL`, default `openai/gpt-4.1-nano`, 120 s timeout; on any failure it falls back to Gemini models, `:81-121`). Configuration: `backend/src/config/index.js:311-316` (`OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL`). Callers:

| Feature in the ATS | Code | Called from |
|---|---|---|
| Resume parsing | `parseResumeWithOpenRouter()`, `hrUpload.service.js:254` (call `:328`) | `runBatchParsing()` `:1258` (HR Manual Upload, Vendor Upload, email intake); `candidate.controller.js:669` (resume uploaded on a candidate's missing-data step); migration `2-parse.mjs:155` |
| AI profile insights after an upload | `preGenerateCandidateInsights()`, `hrUpload.service.js:1031` (call `:1104`) | `runPostProcessing()` `:1946`; `hrUpload.service.js:813` (duplicate merge); `candidate.service.js:608` (candidate update); migration `4b-insights.mjs:42` |
| JD screening insights | `generateProfileInsights()`, `screening.service.js:488` (call `:590`) | `screening.service.js:917`, `:1619`; `screeningV2.service.js:506`, `:659` |
| JD parsing (MRF) | `parseJobDescription()`, `geminiParser.service.js:11` (call `:47`) | `mrf.controller.js:743` |
| Assessment import | `assessmentImport.service.js:172`, `:209` | `previewImport()` `:330` (`assessmentImport.controller.js:31`) |

Not OpenRouter (Gemini directly): search-entry embeddings (`vectorStore.service.js:46-60`, `gemini-embedding-001`) and the migration's scanned-file reader (`2-parse.mjs`). So with the OpenRouter credit used up, every feature in the table above falls back to Gemini; where Gemini is also capped (production since 23 Nov), they fail.

**Effect on production when OpenRouter fails (from the code, 23 Nov 2026; `SCREENING_V2=true` in `.env.production`).** If Gemini works, every feature keeps working through Gemini, slower and billed to the Gemini project (the chain reaches `gemini-2.5-pro`). If Gemini also fails, each AI call fails after about 30 s of retries (six models × 3 attempts on 429), with this effect:

| Feature | Effect when OpenRouter and Gemini both fail |
|---|---|
| HR Manual Upload / Vendor Upload (`hrUpload.service.js:1258`) | Resume fails, **no candidate created**; job "Failed"; HR must re-upload. The file was already put on OneDrive (`:1226`) and stays there without a candidate. Batch error alert to the resume-error recipients (`:1864`) |
| Email intake (website / direct emails) | Same path: **no candidate created** (whether intake retries was not checked) |
| Resume on a candidate's missing-data form (`candidate.controller.js:666-709`) | Form still saves and the CV is linked; parsed fields and resume text **not saved** |
| AI insights after an upload (`hrUpload.service.js:1115-1118`) | Candidate saved **without AI insights**; welcome e-mails still sent |
| JD / Keyword screening, v2 (`screeningV2.service.js:514-517`, `:667-670`) | Results shown **without AI insights** (`aiUnavailable`), after about a 30 s wait |
| New MRF, JD parsing (`mrf.controller.js:742-746`) | MRF created **without the AI-extracted JD details** |
| Assessment import preview (`assessmentImport.service.js:334-360`) | Rows show an AI error; a new test name's mapping suggestion is not caught, so the preview **fails** |

Not affected by OpenRouter: login, browsing and keyword filters on existing data, e-mails, OneDrive, search-entry embeddings (Gemini directly; those fail on their own while the production Gemini cap is exceeded).

**Size of the parse (from the sample).** 5,073 files still to parse (10 done). About 1,615 input and 305 output tokens per resume: about 8.2 million input and 1.5 million output tokens in total. About 3.3 s per parse with 4 workers in parallel: **1 to 1.5 hours**. Five scanned files take about 17 s each through the scanned-file reader. Resumable: a re-run parses only what is not cached.

**Production OneDrive space (checked 23 Nov, one read-only Graph request).**

| | |
|---|---|
| Drive | business OneDrive of the production drive user (different from staging's folder, drive user and app registration) |
| Total / used / free | 1,024 GB / 11.17 GB / **1,012.83 GB**, state `normal` |
| Stage 3 upload, upper bound | **896.5 MB** (all 5,083 readable files; the real number is lower: one CV per person, and no CV for an existing candidate who already has one) |
| Share of free space | **0.09 %** |
| Largest file | 4.1 MB. Uploaded with the same single PUT that HR Upload uses on production every day; Graph accepts up to 250 MB this way. |
| Folders | `Legacy resumes/2023`, `Legacy resumes/2024-25` under production's `MS_ONEDRIVE_PARENT_ID`; created on the first upload (`Legacy resumes` does not exist yet) |

**Result: the space is sufficient, and nothing needs to be done.** If it ever ran short: empty the drive's recycle bin (0 GB in it today), or ask the Microsoft 365 admin to raise the drive user's OneDrive storage limit in the admin center. The upload target is not changed by the migration.

**Phases.**

| Phase | Step | Command (in `backend/`, `<work>` = `E:\Recruitment Process Automation\Phase 4\MS-Access\_migration-work-resumes`) | Writes | Exit check / gate |
|---|---|---|---|---|
| A. Prepare | A1 | Pankaj commits `backend/scripts/legacy-migration-resumes/`, `backend/prisma/ddl/2026-11-20-legacy-import-outcomes*.sql`, this file | git only | Committed; folder frozen from here on |
| | A2 | Build `legacy-proof/certify.mjs --source resume`: production mode, check 8 on the 10 sample files only (S22), allowing `merged_in_file` against `inserted`/`updated_existing` for a sample file that the full transform groups differently | code | `node --check`; run on staging (sample) gives COMPLETE |
| | A3 | Build the 5.8 parity test (10 synthetic resumes) | code; HR Upload side on a local backend | Field by field equal, apart from the listed fields and the S23 cap (run without `presentAs`) |
| | A4 | Build a transform option for files that still fail to parse after three runs: recorded as `rejected_unreadable` with warning `parse_failed`, listed for HR (today the transform stops on any parse error) | code | Used only if A5 leaves failures |
| | A5 | **Full parse with the production keys:** `node scripts/legacy-migration-resumes/2-parse.mjs --work <work> --env production --expect-db recruitmentautomationdbProd --concurrency 4` | `<work>/parse/` only. No database, no OneDrive, no email | 5,083 cached, 0 `error`; re-run once for any error |
| | A6 | **Full transform:** `node scripts/legacy-migration-resumes/3-transform.mjs --work <work>` | `<work>/transform/` only | Report `report/transform-all.md` and review sheet read with Pankaj: no email, unreadable, name conflicts, shared contacts. Fingerprints of `manifest.json` and `transform/*` recorded here; **never re-run after B3** |
| B. Production structure and dry run | B1 | `node scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd --file prisma/ddl/2026-11-20-legacy-import-outcomes.sql --dry-run`, then without `--dry-run` | one constraint, additive | COMMITTED |
| | B2 | `node scripts/check-schema-parity.mjs --a staging --b production` | none | **MATCH** |
| | B3 | **Production dry run, every folder:** `node scripts/legacy-migration-resumes/7-run-folders.mjs --work <work> --env production --expect-db recruitmentautomationdbProd --allow-production --dry-run-only` | none (reads only) | Per folder: new, matched, name conflicts, CVs attached to existing, reconciles. Stop and ask when far from expectation |
| | B4 | **HR review (S24):** the 10 sample candidates in the staging ATS, the not-imported list (A6 review sheet, HR-only folder), the B3 numbers | none | HR OK; then **Pankaj's go-ahead for the production load** |
| C. Production load (2 days) | C0 | Production backup of the day (Pankaj confirms). No deploy that day. | | Backup confirmed |
| | C1 | Day 1: `node scripts/legacy-migration-resumes/7-run-folders.mjs --work <work> --env production --expect-db recruitmentautomationdbProd --allow-production --max-people 2500` | `rpa_cv`, provenance, vectors, OneDrive uploads | Per folder: dry run, apply, vector retry, `4c` check OK; stops at the first problem. Progress `report/production-resume-load-all.json` |
| | C2 | `node scripts/legacy-migration-resumes/4b-insights.mjs --work <work> --env production --expect-db recruitmentautomationdbProd --allow-production --apply` | `ai_profile_insights` only | written = candidates, 0 failed (re-run for failures) |
| | C3 | Performance check (3.1) on production after day 1: Search Candidate, JD screening, HR Upload duplicate check. First time at this size, because staging only has the sample. | none | Not clearly slower; else pause and bring the V31 index work forward |
| | C4 | Day 2: the C1 command again (skips finished folders), then C2 again | as C1 | `RUN DONE`, every folder OK |
| D. Proof | D1 | `4d-retry-vectors.mjs --env production … --allow-production --apply` if any search entry is missing; `6-check-labels.mjs --env production` | vectors only | 0 missing; CHECK OK |
| | D2 | `node scripts/legacy-proof/certify.mjs --source resume --work <work> --env production --expect-db recruitmentautomationdbProd --compare-env staging --compare-db recruitmentautomationdb` | `<work>/report/` | **COMPLETE**; evidence file to the HR-only folder; stakeholder doc updated (6.4) |
| | D3 | Spot check in the production ATS: a few new candidates (CV opens, label "Old resume", experience), a few matched ones (CV attached only where there was none) | none | Recorded in section 9 |

**Rollback.** One folder: `5-rollback-batch.mjs --work <work> --batch <id> --env production --expect-db recruitmentautomationdbProd --allow-production` (dry run first, then `--apply`). It deletes the inserted candidates, their search entries and their uploaded OneDrive files, and restores the fields it filled. Several folders: in reverse order. The day's backup is the last resort.

**Risks of loading production without a full staging rehearsal, and what covers them.**

| Risk | Cover |
|---|---|
| A transform or matching problem that only the full set shows | A6 review before anything touches production; B3 dry run of every folder against production's real candidates; per-folder check and stop at the first problem; per-folder rollback |
| Slower search with about 4,000–5,000 more rows carrying resume text | C3 after day 1, before day 2 |
| Network drops (seen on production in Stages 1 and 2) | The runner resumes; a partial folder is checked with `4c` before it runs again; an upload whose database write failed is deleted again |
| AI provider limits (429) during parse, embeddings or insights | Backoff and retries; parse, vector retry and insights are all resumable |
| Emails to candidates | No import script calls a mail function; every `4c` check and certificate check 7 confirm 0 rows in the three email tables |

**Time.** A: about half a day of building plus 1–1.5 hours of parsing and the transform review. B: about 1 hour plus HR's review. C: 2 days, about 4–8 hours of loading in total plus insights. D: about 1 hour.

---

## 6. Proof of completion and reporting

Stakeholders do not need a row-count report. They need proof that the whole archive was migrated, and a way to see what was migrated. HR checks it all in one place: the shared doc (S9, S10).

### 6.1 Three layers

| Layer | What | Personal data | Where it lives |
|---|---|---|---|
| Completion certificate | One verdict (COMPLETE / NOT COMPLETE) from 8 checks, plus a proof code. One per source per database: 3 sources × staging and production = 6. | None | Stakeholder doc, section "Proof of completion" (status board, checks, certificates issued). Exportable as PDF from the doc. |
| What was migrated (summary) | What came in (units, roles, years), what happened (new vs enriched), information carried over, what was not imported and why | None | Stakeholder doc, section "Report: what was migrated" (one subsection per source) |
| Evidence file | Every source record and its result, the not-imported list with source values, the side-by-side spot-check sheet | Yes | HR-only OneDrive folder, linked from the doc. Never in the repo or the doc. |

Candidate-level lists for HR come from the ATS itself: Search Candidate, then Data origin = an archive, then export (already built: `candidate.service.js:732-782`, `utils/legacySourceView.js`).

### 6.2 The 8 checks

| # | Check (as written in the doc) | How `certify.mjs` proves it |
|---|---|---|
| 1 | **Right data:** the exact source files, fingerprinted, the same for staging and live | SHA-256 of each source file and of `transform/` from the manifest; the same values on both databases' certificates |
| 2 | **Everything read:** counted by two separate tools that agree | Access: its own `COUNT(*)` against the rows extracted (`countsMatch`). Excel: SheetJS against a .NET OpenXML recount (`1b-recount-openxml.ps1`; the ACE OLEDB provider the plan first named is not registered on the migration machine, checked 19 Nov). Resumes: the file walk against PowerShell. |
| 3 | **Everything accounted for:** nothing missing, nothing counted twice | Provenance rows per unit equal `sourceCount`; the unique index `uq_legacy_import_source_row` rules out doubles |
| 4 | **Everything landed** | Every `cv_id` in provenance exists in `rpa_cv`. A candidate HR later merged or deleted is reported as "changed by HR later" (match on `last_action_context` and `modifiedAt` after the batch), not as missing. |
| 5 | **Values correct** | The `3c-check-batch.mjs` column comparison against `transform/` over all candidates (fields edited by HR later are excluded by `modifiedAt`), plus a fixed hash-based sample (5 per unit) on the evidence file's spot-check sheet |
| 6 | **Findable** | A row in `rpa_cv_vectors` for every inserted candidate with an email. For resumes, `cv_file_item_id` set on every attached CV, with a sample resolved through Graph. |
| 7 | **Nothing sent** | No rows in `rpa_email_messages`, `rpa_email_log` or `rpa_email_notifications` for these candidates since the batch started |
| 8 | **Live matches staging** (production only) | The provenance sets of the two databases compared on (`source_table`, `source_row_id`, `outcome`). The only allowed difference is `inserted` against `updated_existing`, because production holds more real candidates. |

**Proof code:** the first 12 hex characters of SHA-256 over the sorted provenance set (`source_table`, `source_row_id`, `outcome`, `cv_id`), shown as `XXXX-XXXX-XXXX`. Provenance rows are never updated after the load, so a later re-run gives the same code.

### 6.3 Script and manifest contract

`backend/scripts/legacy-proof/certify.mjs` is new and read-only, and one script serves all three sources:

```
node scripts/legacy-proof/certify.mjs --source ms_access|excel|resume --work <work folder>
     --env <staging|production> --expect-db <db>
     [--compare-env staging --compare-db recruitmentautomationdb]   # check 8, production only
     [--sample 5]
```

- SELECT statements only; `--env` and `--expect-db` guards as in Stage 1.
- Writes to `<work>/report/`:
  - `certificate-<source>-<env>-<stamp>.md` and `.json` (no personal data)
  - `what-was-migrated-<source>-<env>-<stamp>.md` (no personal data)
  - `evidence-<source>-<env>-<stamp>.xlsx` (personal data, copied to the HR folder only)
- Reuses, without editing the frozen Stage 1 folder:
  - the provenance queries and the deterministic sample of `legacy-migration/5-proof-pack.mjs`
  - the column comparison and email-table check of `3c-check-batch.mjs`
  - the Access field targets in `legacy-migration/lib/mapping.mjs`, imported read-only
- A certificate whose verdict is NOT COMPLETE is not put in the doc. Fix the cause, then run it again.

**Manifest contract (Stage 2 and 3).** Each unit carries `unit` (file and sheet, or folder), `sourceCount`, `secondCount` and `sha256`. For Stage 1, `certify.mjs` reads the existing `accessCount` and `countsMatch`.

### 6.4 Updating the doc after each wave

1. Run `certify.mjs` on staging, read the verdict, and copy the evidence file to the HR-only folder.
2. In the doc: set that cell of the "Proof of completion" status table to "Complete, <date>, code <proof code>"; add the certificate's 8 results under "Certificates issued"; fill that source's subsection of "Report: what was migrated"; update "Migrated so far".
3. After the HR approval and the production load, do the same with `--env production --compare-env staging`.

The doc carries no personal data, server addresses or credentials.

## 7. Runbook per wave

The same for Wave 2 and Wave 3. Commands run in `backend/`.

1. Work-folder fingerprints recorded (SHA-256 of `manifest.json` and the `transform/` files).
2. **Staging:** runner with `--env staging --expect-db recruitmentautomationdb`: dry run, apply and check per file or folder.
3. `certify.mjs --env staging`: COMPLETE. Evidence file to the HR folder; doc updated (6.4); performance check (3.1). **HR reviews and approves.**
4. Production backup taken that day.
5. `check-schema-parity.mjs`: MATCH.
6. **Production dry run** (read-only) of every file or folder; read "matched existing" and "identity conflicts"; stop and ask when far from expectation.
7. **Production:** the runner with `--env production --expect-db recruitmentautomationdbProd --allow-production`. Fingerprints unchanged since staging; do not re-run extract, transform or parse.
8. Vector retry; `6-check-labels.mjs --env production`: CHECK OK; `certify.mjs --env production --compare-env staging`: COMPLETE; doc updated (6.4).
9. Record the result in section 9.

Rollback: one batch with the stage's rollback script (dry run, then `--apply`); a whole wave by rolling back its batches in reverse order; the day's backup as the last resort. Freeze the stage's script folder during any production run.

---

## 8. Open questions (none blocks Week 1)

| # | Question |
|---|---|
| O1 | Closed 19 Nov: `Last Active Date` (S15). |
| O2 | Closed 18 Nov: Naukri candidates carry "Archive · Excel & Naukri" and `JobSource` "Naukri <year>" (S11, S12); no separate source value. |
| O5 | The HR-only OneDrive folder for evidence files: which folder, and who has access? |
| O3 | Retention: how long are legacy candidates who never respond kept? |
| O4 | Are "joined and left" candidates excluded from outreach, like Joined? (Access plan Q3) |

---

## 9. Where we stand (update after every step)

### START HERE: handover for a new session

This file is the single record of Stages 2 and 3. No session memory is kept anywhere else. Stage 1 (MS Access) has its own record: `PLAN-MS-Access-Data-Migration-Mapping.md` section 9.

**State on 23 Nov 2026, evening.**

| Stage | Staging (`recruitmentautomationdb`) | Production (`recruitmentautomationdbProd`) |
|---|---|---|
| 1. MS Access | Loaded 17 Nov, proof pack COMPLETE | Loaded 18–19 Nov, proof pack COMPLETE (Access plan §9) |
| 2. Excel and Naukri | Loaded 19 Nov. Certificate **COMPLETE**, proof code **2B4D-6964-BC2E** (re-run 23 Nov after the check 5 fix: same code). 4,083 new, 1,210 matched | Loaded 19 Nov. Certificate **COMPLETE** (checks 1–8), proof code **7619-B652-D329**. 4,077 new, 1,216 matched |
| 3. Resumes | Outcome DDL **applied 23 Nov**. **10-file sample loaded 23 Nov** (S18), batch `4b745282-0ef9-44cb-9df9-e84efd4c7c14`: 7 new, 3 matched, insights 7, check ok, no email. Sample certificate **COMPLETE**, proof code **E93A-51B9-8E49**. Staging gets nothing more (S24). | Not started (S24: the full set goes to production only, runbook 5.9). Phase A in progress: **parse paused at 2,080 of 5,083 files** (OpenRouter credit used up, see below). Outcome DDL **not applied**. OneDrive space checked: sufficient. |

### Stage 3: resume here (23 Nov 2026)

**Where Phase A (5.9) stands.**

| Step | State |
|---|---|
| A1 commit | **Open (Pankaj).** Uncommitted: `backend/scripts/legacy-migration-resumes/` (incl. `test/`), `backend/scripts/legacy-proof/certify.mjs`, `backend/prisma/ddl/2026-11-20-legacy-import-outcomes*.sql`, this file, `PLAN-MS-Access-Data-Migration-Mapping.md`. Commit before the production dry run (B3); freeze the folder from then on. |
| A2 resume certificate | **Done.** `certify.mjs --source resume --scope sample\|all`. Staging sample COMPLETE (E93A-51B9-8E49). |
| A3 parity test | **Done.** 12/12 pass (5.8). |
| A4 parse-failure option | **Done.** `3-transform.mjs --accept-parse-errors` (only on Pankaj's decision after three parse runs). |
| A5 full parse | **Paused at 2,255 / 5,083** (2,236 ok, 19 error, 2,828 not parsed; all cached). Stopped 20:39 on 23 Nov (OpenRouter account had no credit, 402). **Credit bought later that evening and OpenRouter tested OK** (one resume, 200). Ready to restart with the command below on Pankaj's go-ahead; 2 of the 19 errors are scanned files that need the production Gemini cap raised. |
| A6 full transform + review | Not started (needs A5 complete). |

**Blocker, and what Pankaj must do (incident of 23 Nov, log below).**

1. **OpenRouter: fixed 23 Nov evening.** Credits bought on the organization account: balance **$17.82**; key limit **$20, $8.01 left**; one-resume test 200 OK. The parse can restart (A5) when Pankaj says so. Watch the **key limit**: $8.01 covers the rest of the parse (about $1.50) and part of the Phase C insights, but the live ATS uses the same key; raise the key limit (OpenRouter, Keys) before Phase C so the key does not hit its ceiling mid-load, as it did at $12. A key limit adds no money; the account balance pays.
2. **Production Gemini project:** past its **monthly spending cap** since about 19:45 IST, 23 Nov (the parse's Gemini fallback ran there after OpenRouter ran out). Until the cap is raised in Google AI Studio (ai.studio/spend) or resets on 1 Dec, production's Gemini calls fail: HR Upload's fallback, search entries for new candidates, AI insights. The production load (Phase C) also needs headroom: one Gemini embedding per new candidate here, and one insights call per new candidate on OpenRouter (Gemini only if OpenRouter fails). Every place the ATS uses OpenRouter: section 5.9, "Every place that calls OpenRouter".
3. Check before restarting (read-only, no AI call), with the production key: `GET https://openrouter.ai/api/v1/credits` (account balance = `total_credits - total_usage`) **and** `GET https://openrouter.ai/api/v1/key` (`limit_remaining`). The lower of the two must cover about $0.0005 per file. `2-parse.mjs` does both checks itself and refuses otherwise.

**Next commands, in order (run in `backend/`; `<work>` = `E:\Recruitment Process Automation\Phase 4\MS-Access\_migration-work-resumes`).** Start long runs from your own terminal (PowerShell window), not inside a Claude session: on 23 Nov the background parse was ended when the session's background task ended.

```
# A5: finish the parse (resumes from the cache; no Gemini fallback; checks the OpenRouter credit first)
node scripts/legacy-migration-resumes/2-parse.mjs --work "<work>" --env production --expect-db recruitmentautomationdbProd --concurrency 4
#   run it again until "error 0" (an 'error' file is retried each run). Still failing after 3 runs: Pankaj decides on A4.

# A6: full transform (no AI, no database), then read report\transform-all.md and report\transform-all-review.xlsx with Pankaj
node scripts/legacy-migration-resumes/3-transform.mjs --work "<work>"
#   record the fingerprints it prints (and manifest.json 9B3D84E697162C2E) here; never re-run after B3

# Then Phase B, C, D exactly as section 5.9 (each phase on Pankaj's go-ahead): production DDL, schema parity MATCH,
# production dry run of every folder, HR review (S24), backup, 2-day load, insights, certificate.
```

**Stage 3 files.**

| What | Where |
|---|---|
| Resume source (read-only) | `E:\Recruitment Process Automation\Phase 4\MS-Access\OneDrive_1_11-13-2026\` (`manifest.sourceRoot`) |
| Stage 3 work folder (personal data, outside the repo) | `<work>` above: `manifest.json` (fingerprint `9B3D84E697162C2E`, 5,251 files, 26 folders), `converted/` (416 `.doc` → `.docx`), extracted e-mail PDFs, `parse/<sha256>.json` (parse cache), `transform-sample/` (what staging loaded: `candidates.jsonl` `F1D76C152453AF52`, `rows.jsonl` `631DA3EEDF1E5E07`, `units.json` `10C43554AD8E0A77`), `transform-sample.before-S23/` (old copy), `report/`, `logs/` (`parse-all-20261123-1831.*.log`) |
| Reports | `report/transform-sample.md`, `transform-sample-review.xlsx`, `load-staging-sample-*.json`, `staging-resume-load-all.json`, `certificate-resume-staging-20261123-1306.*`, `what-was-migrated-resume-staging-*`, `evidence-resume-staging-*.xlsx` (personal data: HR-only folder) |
| Scripts | `backend/scripts/legacy-migration-resumes/` (5.2): `1-inventory`, `1b-convert`, `1c-extract-email-pdfs`, `2-parse`, `3-transform`, `4-load`, `4b-insights`, `4c-check-batch`, `4d-retry-vectors`, `5-rollback-batch`, `7-run-folders`; `lib/` (`folders.mjs` roles/years/`presentAsOf`, `hr-steps.mjs` HR Upload copy, `identity.mjs`, `constants.mjs`, `jpg-to-pdf.mjs`); `test/parity.test.mjs` |
| Decisions | S18–S24 (section 1). Runbook 5.9. |

**Open points for Pankaj (Stage 3).**

1. The two account actions above (OpenRouter credit, production Gemini cap).
2. A1 commit.
3. Review the folder roles in `lib/folders.mjs` (asked 20 and 23 Nov, not answered yet). They are used only when the parser gives no role.
4. After A6: read the transform report with HR (not imported, name conflicts, shared contacts).

**Known issues met on 23 Nov (Stage 3), and what to do.**

| Issue | What to do |
|---|---|
| OpenRouter key credit limit ($12) reached mid-parse; the ATS helper (`src/utils/geminiHelper.js`) then falls back to up to six Gemini models × 3 attempts, including `gemini-2.5-pro`, on the environment's Gemini key | `2-parse.mjs` now runs without the Gemini fallback (`--allow-gemini-fallback` only on Pankaj's decision), checks the credit first and every 200 files, and stops after 10 errors in a row |
| OpenRouter failures are logged at warn level, hidden by the scripts' `LOG_LEVEL=error` | Read the credit with `GET /api/v1/key`; a slowdown with parse times around 15 s per resume means retries/fallback |
| A background run started from a Claude session ended with the session's background task | Start long runs (parse, loads, insights) from your own terminal; watch the log in `<work>/logs/` |
| `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` after a script refuses or exits early | Node on Windows closing open handles; nothing ran. Ignore |
| Re-running an Excel or MS Access certificate after the resume load | Fields a later legacy import filled are skipped in check 5 (fixed 23 Nov); the count is shown as "enriched by a later legacy import" |

The 16 Nov production release (`PRODUCTION-DEPLOYMENT-PLAN-2026-11-16.md`) is finished.

**Open after Stage 2 (not done in the session of 19 Nov):**

1. Copy the evidence files (personal data) to the HR-only folder: `evidence-excel-staging-20261119-1154.xlsx` and `evidence-excel-production-20261119-1648.xlsx` in `<work>\report\`. Which folder: O5.
2. Update the shared stakeholder doc (6.4) with both certificates (`certificate-excel-*.md`) and the two `what-was-migrated-excel-*.md` summaries. They hold no personal data.
3. Tell HR: about 4,077 candidates with created dates 2018–2025 now appear on production, labelled "Excel", `JobSource` "Naukri 2023" / "Naukri 2024-25" for the Naukri ones.
4. Pankaj commits: `backend/scripts/legacy-migration-excel/`, `backend/scripts/legacy-proof/`, `backend/scripts/check-schema-parity.mjs` and this file. The session does not commit.
5. Label and filter rename (S12): a separate task, not started. Until then Excel candidates show "Excel".
6. Not yet produced: the MS Access certificates with `certify.mjs --source ms_access --work <Stage 1 work folder>` (staging, then production with `--compare-env staging`). Optional; the Stage 1 proof packs exist.

**Stage 2 and shared reference.**

| What | Where |
|---|---|
| Excel source folder (read-only) | `E:\Recruitment Process Automation\Phase 4\MS-Access\OneDrive_1_11-13-2026\` (also holds the resume files for Stage 3) |
| Stage 2 work folder (personal data, outside the repo) | `E:\Recruitment Process Automation\Phase 4\MS-Access\_migration-work-excel\`: `manifest.json`, `raw/`, `transform/` (what was loaded), `report/` (dry-run report, HR lists, `staging-load-all.json`, `production-load-all.json`, `load-<env>-<n>-<batch>.json`, certificates, summaries, evidence files), `logs/` |
| Stage 2 fingerprints (SHA-256, first 16) | `manifest.json` `EFAE40599EFCD7E3`, `transform/units.json` `78121CF0BEED2B2C`, `transform/candidates.jsonl` `058F6C4735FBF222`, `transform/rows.jsonl` `8DC2E2289F935B47`. Never re-run the extract or the transform: both databases were loaded from exactly these files, and the certificates check them. |
| Stage 2 scripts | `backend/scripts/legacy-migration-excel/` (section 4.2). Stage 1 scripts `backend/scripts/legacy-migration/` stay frozen. |
| Proof and parity scripts | `backend/scripts/legacy-proof/certify.mjs`, `backend/scripts/check-schema-parity.mjs` |
| Databases | One server `20.244.34.176`. Staging `recruitmentautomationdb` (`backend/.env.staging`), production `recruitmentautomationdbProd` (`backend/.env.production`). |

**Commands (run in `backend/`; `<work>` = the Stage 2 work folder).**

```
# read-only checks, any time
node scripts/check-schema-parity.mjs --a staging --b production
node scripts/legacy-migration-excel/3c-check-batch.mjs --work <work> --batch <id> --env production --expect-db recruitmentautomationdbProd
node scripts/legacy-proof/certify.mjs --source excel --work <work> --env production --expect-db recruitmentautomationdbProd --compare-env staging --compare-db recruitmentautomationdb
node --env-file=.env.production scripts/legacy-migration/6-check-labels.mjs --env production --expect-db recruitmentautomationdbProd
#   (6-check-labels is a Stage 1 script: on production it needs --env-file; on staging it does not)

# undo one Stage 2 batch (dry run, then --apply; production also --allow-production; reverse batch order for several)
node scripts/legacy-migration-excel/4-rollback-batch.mjs --batch <id> --env production --expect-db recruitmentautomationdbProd --allow-production
```

Batch ids: `<work>\report\<env>-load-all.json`, plus the partial batches listed in the log below (a stopped apply leaves a batch without an entry there): staging `892e00ff-…`; production `a187f016-…`, `40ccc10b-…`.

**Known issues met on 19 Nov, and what to do.**

| Issue | What to do |
|---|---|
| ACE OLEDB is not registered on the migration machine (32- or 64-bit). | The second count uses `1b-recount-openxml.ps1`. Installing the Access Database Engine needs Pankaj's OK. |
| The database connection from the developer machine drops a few times an evening ("Can't reach database server", "Server has closed the connection", connection-pool timeout). New connections can take minutes to open while an open one keeps working. | The runner stops cleanly. Check the partial batch with `3c-check-batch.mjs` (read-only), then run the runner again: it skips recorded rows. A search entry lost in the drop is created by `3b-retry-vectors.mjs`. If drops are frequent, check the VPN: split tunnelling (database through the VPN, the rest direct) fixed it in Stage 1. |
| A full `6-run-files` pass takes about 3 hours per database (about 2–4 s per new candidate including the Gemini search entry; each sheet's duplicate lookup runs twice, in the dry run and the apply). | Start it as a background process; watch with the runner output or a read-only count of `rpa_legacy_import_rows`. |
| "Redis error … 127.0.0.1:6379" lines | Expected on the developer machine; ignore. |

**Rules for every session.**

- One step at a time. Nothing on production without Pankaj's explicit go-ahead for that step; "continue" alone is not one. A production backup of the day before the first production write.
- Dry run before every apply. Every command names the database twice (`--env` and `--expect-db`); production writes also need `--allow-production`. Never edit an env file to point elsewhere.
- Never print candidate data in chat, logs or reports in the repo: counts, shapes and column names only. Evidence files and work folders stay outside the repository.
- No import script sends email. Nothing under `backend/src` is edited by the migration; HR Upload is not changed.
- Do not change a stage's script folder while one of its production runs is in progress.
- Pankaj commits; the session does not.
- Record every step in the log below (date, what, counts, batch ids), so the next session can continue from this file alone.

### Log

| Date | Step | Result |
|---|---|---|
| 18 Nov 2026 | Plan written; stakeholder update shared | No code, no database change |
| 18 Nov 2026 | v1.1: proof of completion (section 6), Naukri job source, new label and filter names, why one database, HR-gated timeline. Stakeholder doc is one single document: Migrated so far, the plan with a Proof of completion section, and Report: what was migrated (MS Access filled in). | No code, no database change |
| 19 Nov 2026 | Stage 1 (MS Access) loaded on production (Access plan §9). Pankaj's go-ahead to start Stage 2 on staging, with decisions S14–S17. | Stage 2 work started |
| 19 Nov 2026 | Stage 2 scripts written in `backend/scripts/legacy-migration-excel/` (1-extract, 1b-recount-openxml, 2-transform, 3-load, 3b, 3c, 4-rollback, 6-run-files, lib/env, lib/layouts, lib/naukri-rules), plus `scripts/legacy-proof/certify.mjs` and `scripts/check-schema-parity.mjs` (tested staging against staging: MATCH, 96 items). Nothing under `backend/src` changed; the Stage 1 folder is imported read-only. | No database write |
| 19 Nov 2026 | Extract (work folder `E:\Recruitment Process Automation\Phase 4\MS-Access\_migration-work-excel\`): 22 spreadsheets, 21 sheets loaded (layouts A 4, D 1, B 8, C 8), 17 skipped (7 Naukri statistics sheets, 9 timesheet sheets, `Exp & Fresher` already in Access). Both counts equal on all 21 sheets. The folder `Good Profiles Count from Outlook, Naukri - 2023` holds no spreadsheet (S17: nothing for Stage 2). Transform: 6,126 rows, 325 blank, 0 without contact, 5,801 usable, 5,293 people, 1 shared contact. Read-only dry run of all 21 sheets on staging: 4,083 new, 1,210 matched existing (all of them people already loaded from MS Access), 508 merged, 325 blank; every sheet reconciles. 255 Access notes cut at 255 characters get their full text from the 2023 trackers (truncation repair; answers Access plan Q4 for these rows); 11 notes appended. | Waiting for Pankaj's review of the dry-run report before the staging apply |
| 19 Nov 2026 | Pankaj's go-ahead: apply on staging. Work-folder fingerprints before the load (SHA-256, first 16): `manifest.json` `EFAE40599EFCD7E3`, `transform/units.json` `78121CF0BEED2B2C`, `transform/candidates.jsonl` `058F6C4735FBF222`, `transform/rows.jsonl` `8DC2E2289F935B47`. Production must load these exact files: do not re-run the extract or the transform. Runner `6-run-files.mjs --env staging` started. | Staging load running |
| 19 Nov 2026 | Staging load (`recruitmentautomationdb`), 14:20–17:25 IST. Sheets 1–17 in one run, every sheet equal to its dry run and its check OK. 17:15 IST: sheet 18's apply stopped on a Prisma connection-pool timeout (database briefly unreachable, as Stage 1 §3.14 D). Partial batch `892e00ff-365c-4a17-a59c-6cf4ecb19aa3` (9 inserted; no entry in `staging-load-all.json`): read-only check correct on 37 columns, labelled, no email, 1 search entry missing. Runner restarted: sheet 18 finished in batch `6521b273-…` (15 new, 9 already done), sheets 19–21 OK, `ALL SHEETS DONE`. `3b-retry-vectors --apply`: created 1, failed 0; second dry run 0 missing. Totals: 6,126 rows recorded; 4,083 new candidates; 1,210 matched existing (all already labelled MS Access, so they keep that label); 508 merged; 325 blank; 0 not imported; 255 truncated Access notes restored, 11 appended. `6-check-labels`: CHECK OK (excel imported 4,083; 8,763 logged candidates, none unlabelled, none extra). | Staging loaded |
| 19 Nov 2026 | `certify.mjs --source excel --env staging`: **COMPLETE**, proof code **2B4D-6964-BC2E**; checks 1–7 PASS (8 n/a on staging). Files in the work folder's `report/`: `certificate-excel-staging-20261119-1154.md/.json`, `what-was-migrated-excel-staging-20261119-1154.md`, `evidence-excel-staging-20261119-1154.xlsx` (personal data: HR-only folder, never the repo). | Next: HR review of the staging certificate (S13); then production per runbook §7 with Pankaj's go-ahead per step |
| 19 Nov 2026 | Pankaj: "go ahead for production". Read-only steps first: work-folder fingerprints unchanged (same four values as before the staging load); `check-schema-parity.mjs --a staging --b production`: MATCH (96 items); production dry run of all 21 sheets (`6-run-files --dry-run-only`, nothing written) started. | Production: read-only steps |
| 19 Nov 2026 | Pankaj confirmed: production backup of the day taken; HR review of the staging certificate done (S13). Go-ahead for the production apply. Production dry run of sheets 1–8 equal to staging except one more match in Decisions Developer (209 new, 5 matched). Runner `6-run-files.mjs --env production --expect-db recruitmentautomationdbProd --allow-production` started. | Production load running |
| 19 Nov 2026 | Production dry run, all 21 sheets (read-only, finished while sheet 1 was applying): 4,077 new, 1,216 matched existing, 508 merged, 325 blank, 0 not imported, 255 truncation repairs, 11 appended. Against staging: 6 more matches (Decisions Developer 1, Accountant exports 2, HR-Intern exports 3), people HR already has in production. Within expectation; load continues. | Production load running |
| 19 Nov 2026 | 18:20 IST: sheet 1's apply on production stopped on "Can't reach database server" (network, as Stage 1). Partial batch `a187f016-de2f-4909-8a37-613eb5a84a8b` (346 of 602 rows, all `updated_existing`; no entry in `production-load-all.json`): read-only check ok (all labelled, no email, no problem). Server reachable again at 18:22; runner restarted. | Production load running |
| 19 Nov 2026 | Sheets 1–9 done on production, each check OK (1 search entry retried by the runner in sheet 8 ×3, sheet 9 ×1). Evening network slow (`select 1` median about 200 ms, new connections slow to open). About 21:15 IST sheet 10's apply (Flutter) stopped on "Server has closed the connection". Partial batch `40ccc10b-e2ed-41ec-9aca-07724c9845b1` (119 inserted, 1 merged; no entry in `production-load-all.json`): read-only check correct on 37 columns, labelled, no email, 1 search entry missing (for the final 3b retry). Runner restarted 21:45 IST. | Production load running |
| 19 Nov 2026 | Production: sheet 10 finished in batch `07f3c6ce-…` (68 new, 120 already done), sheets 11–21 OK, `ALL SHEETS DONE` about 22:20 IST. `3b-retry-vectors --apply`: created 1, failed 0; second dry run 0 missing. `6-check-labels` (run with `node --env-file=.env.production`, Stage 1 workaround): CHECK OK; excel imported 4,077, excel matched 6, ms_access 4,650 + 30; 8,763 logged candidates, none unlabelled, none extra. Totals: 6,126 rows recorded = rows read; 4,077 new; 1,216 matched existing (1,210 keep their MS Access label, 6 real production candidates now "Also in Excel"); 508 merged; 325 blank; 0 not imported; 255 truncated Access notes restored, 11 appended; 0 emails. Partial batches without an entry in `production-load-all.json`: `a187f016-…` (QA Testing), `40ccc10b-…` (Flutter). | Production loaded |
| 20 Nov 2026 | Stage 3 started on Pankaj's go-ahead, decisions S18–S22. LibreOffice 26.8.3.1 installed on the migration machine. Scripts written in `backend/scripts/legacy-migration-resumes/`: `1b-convert.mjs`, `1c-extract-email-pdfs.mjs`, `1-inventory.mjs`, `lib/folders.mjs`; DDL `2026-11-20-legacy-import-outcomes.sql` + rollback written (not applied). Work folder `E:\Recruitment Process Automation\Phase 4\MS-Access\_migration-work-resumes\`. Pankaj confirmed the OpenRouter privacy setting (no training on inputs, no prompt logging; plan 5.6). | No database change, no AI call |
| 20 Nov 2026 | Conversion (`1b-convert.mjs`): 420 `.doc` → 420 `.docx` OK (372 Word 97-2003, 46 HTML, 2 renamed DOCX), 0 failed, 0 under 200 characters, originals unchanged. Extraction (`1c-extract-email-pdfs.mjs`): 5 saved e-mails and 2 saved browser form-upload bodies (named `.pdf`, holding a raw PDF), 7 PDFs out, all complete. Inventory (`1-inventory.mjs`): 5,273 archive files, 22 spreadsheets (Stage 2), **5,251 Stage 3 files in 26 folders, both counts equal in every folder**; 162 byte-identical copies; to parse **5,083** (4,655 PDF/DOCX as they are, 416 converted, 7 extracted, 5 images); 6 not imported (3 RTF, 1 PPTX, 1 Word lock file, 1 empty file: `skipped_unsupported_type`). Fingerprints (SHA-256, first 16): `manifest.json` `9B3D84E697162C2E`, `sample.json` `930FBD1030DCBA41`, `report/convert-doc.json` `E520BDA103C6BDB5`, `report/extract-email-pdfs.json` `5C2D56A9A5E59A8B`. Do not re-run the inventory: both databases load from this manifest. | No database change |
| 20 Nov 2026 | Sample parse (`2-parse.mjs --sample`, 10 files, S18): 10 ok after one fix. Gemini 2.5 Flash is retired (404); the scanned-file reader now uses the ATS's configured model (`gemini-flash-latest`), and a failed scanner call on a short text is retried instead of parsed (the first run had parsed a 12-character stub). Scanned reader used on 2 (1 image, 1 image-only PDF). Parser: OpenRouter `openai/gpt-4.1-nano`. Per resume: about 3.8 s parse, about 17 s for a scanned file, about 2,400 input and 410 output tokens. HR Upload steps on the 10 (`lib/hr-steps.mjs`, read-only check): 10 would load, 0 without a valid email; 4 take their role from the folder. Cache in `<work>/parse/`. | No database change |
| 23 Nov 2026 | Pankaj: build the transform and loader. Written in `backend/scripts/legacy-migration-resumes/`: `3-transform.mjs`, `4-load.mjs`, `4b-insights.mjs`, `4c-check-batch.mjs`, `4d-retry-vectors.mjs`, `5-rollback-batch.mjs`, `7-run-folders.mjs`, `lib/constants.mjs`, `lib/identity.mjs`, `lib/jpg-to-pdf.mjs`; `lib/hr-steps.mjs` now also returns the search-entry data and flags `experience_counts_present_as_today`. Sample transform (`--sample`): 10 files → 10 candidates, 0 rejected, 0 merged; uploads 5 DOCX + 5 PDF (1 is the wrapped JPG, checked: 1 page, 1 image); fingerprints `transform-sample/candidates.jsonl` `0B1A72307CD06FCF`, `rows.jsonl` `EA1D863C5C85D467`. **7 of 10 resumes end a job with "present"**, which HR Upload's experience rule counts up to today (open point). Staging dry run of the sample (read-only, nothing uploaded): 7 new, 3 matched existing (all already labelled from MS Access or Excel; each would gain the CV and resume text), 0 name conflicts, reconciles 10/10. `--apply` refuses until the 5.7 DDL is applied. The full transform correctly refuses (5,073 files not parsed yet). Not built yet: `certify.mjs --source resume`, the parity test (5.8). | No database write, no upload, no AI call |
| 23 Nov 2026 | Pankaj: "Cap present at folder year end, apply DDL to staging". (1) S23 written (`lib/hr-steps.mjs`, `lib/folders.mjs`, `3-transform.mjs`). Sample transform re-run (previous output kept as `transform-sample.before-S23/`): the same 10 candidates; 7 have lower experience (2.92 years less for the three 2023 files, 0.91–0.92 less for the four 2024-25 files); all 27 history rows keep their wording; no other field changed. New fingerprints `candidates.jsonl` `F1D76C152453AF52`, `rows.jsonl` `631DA3EEDF1E5E07`. (2) Outcome DDL on **staging** `recruitmentautomationdb`: dry run OK, then COMMITTED (2 statements). Staging sample dry run again: 7 new, 3 matched, 0 name conflicts, reconciles 10/10, `outcomeConstraintReady` true. Production DDL not applied. The schema parity check was not run: it reads production, and the session's tool permissions blocked that. | Staging DDL applied; nothing loaded |
| 23 Nov 2026 | Pankaj: "yes, run the staging sample load". `7-run-folders.mjs --sample --env staging`: dry run 7 new / 3 matched, apply in 30 s, batch **`4b745282-0ef9-44cb-9df9-e84efd4c7c14`**: 7 inserted, 3 updated_existing (each gained the CV and resume text; all 3 already had an MS Access/Excel label, kept), 0 name conflicts, 10 uploads to staging OneDrive `Legacy resumes/<year>`, 7 search entries, reconciles. `4b-insights.mjs --batch … --apply`: 7 written, 0 failed. `4c-check-batch.mjs`: **ok**, no problems; 7/7 inserted with tag, label, CV, text, MetaData, insights, search entry; 0 column differences against the transform; 3/3 attached CVs still in place; 0 rows in `rpa_email_messages`, `rpa_email_log`, `rpa_email_notifications`. Progress file `report/staging-resume-load-all.json`. Rollback, if needed: `5-rollback-batch.mjs --batch 4b745282-…`. | Staging sample loaded |
| 23 Nov 2026 | Pankaj: check production readiness for Stage 3, do not start. Read-only checks only. **Ready:** work folder (manifest `9B3D84E697162C2E`, 5,251 files, 26/26 folders with both counts equal, every file to read on disk, 29.5 GB free); no change since 19 Nov to the ATS files the loader reuses; production `recruitmentautomationdbProd` holds 19,558 candidates, 0 resume rows, 0 with the resume tag; production OneDrive configured, different from staging (folder, drive user, app registration), Graph sign-in OK, parent folder found (`Legacy resumes` created on first upload). **Not ready:** (1) 5,073 of 5,083 files not parsed, so no full transform; (2) production outcome DDL not applied: `check-schema-parity.mjs` NO MATCH, only `chk_legacy_import_outcome`; (3) `certify.mjs --source resume` and the 5.8 parity test not built, so no staging certificate for HR; (4) production backup of the day, production dry run of all folders: not yet; (5) `backend/scripts/legacy-migration-resumes/` and the DDL files are uncommitted. | Not started on production |
| 23 Nov 2026 | Pankaj: the full resume set goes to production only, to save AI cost; plan first, do not run. Decision **S24**, runbook **5.9** written. Read-only facts: `OPENROUTER_API_KEY` is the same in both env files (the parse costs the same whichever `--env`); `GEMINI_API_KEY` differs (scanned reader, embeddings and insights billed to production's account with `--env production`). Production OneDrive (business): 1,024 GB total, 11.17 GB used, 1,012.83 GB free; the upload is at most 896.5 MB (0.09 %); largest file 4.1 MB; **space is sufficient, no action needed**. `6-check-labels.mjs` covers resume rows (name-conflict rows carry no `cv_id`). Nothing run on production. | Plan only |
| 23 Nov 2026 | Pankaj: HR review as in S24 is OK; start Phase A (5.9). Scripts not committed yet (A1 open, Pankaj). **A5** full parse started 18:31 IST with the production keys (`2-parse.mjs --env production --concurrency 4`, log `<work>/logs/parse-all-20261123-1831.*.log`): 640 of 5,073 after 10 min, 0 errors. **A4** `3-transform.mjs --accept-parse-errors` written (off by default; `parse_failed` → `rejected_unreadable`, listed for HR). **A2** `certify.mjs --source resume --scope sample|all` written: check 1 compares only `manifest.json` with staging, check 6 adds the CV files (item ids, Graph sample), check 8 on the sample with explained differences (S22). Staging sample certificate **COMPLETE**, proof code **E93A-51B9-8E49** (`report/certificate-resume-staging-20261123-1306.*`). Fix in check 5 for all sources: fields a LATER legacy import filled (its `changed_fields`) are not compared; found because the resume sample filled 2 Excel candidates' empty fields, which made the Excel staging certificate fail check 5 on re-run. Excel staging certificate re-run after the fix: **COMPLETE**, same proof code 2B4D-6964-BC2E. **A3** parity test built and passing, 12/12 (5.8), after the `normaliseDegreeKeys` fix in `lib/hr-steps.mjs`. | Phase A in progress |
| 23 Nov 2026 | **A5 parse stopped, incident.** About 19:00 IST the parse slowed (OpenRouter failing, ATS helper falling back to Gemini); about 19:45 the **production Gemini project hit its monthly spending cap** (429 "exceeded its monthly spending cap", models up to `gemini-2.5-pro` in the helper's fallback chain). The process ended at 2,080 of 5,073 (2,068 ok, 12 error; every result cached). Cause (read-only `GET /api/v1/key`, no AI call): the OpenRouter key has a **$12 credit limit**, usage $11.99, **$0.008 left**; this run used about $0.63 (about $0.0003 per resume). Once OpenRouter refused, `generateContentWithFallback()` tried up to six Gemini models × 3 attempts per resume on production's key. How much of the Gemini cap the fallback used, against the live ATS's own use, is not visible from here (AI Studio). **Live impact until fixed:** the OpenRouter key is shared by staging and production, so HR Upload parsing on both falls back to Gemini; on production that fallback, search entries for new candidates (`gemini-embedding-001`) and AI insights fail while the cap is exceeded. Staging has its own Gemini key. **Guard added to `2-parse.mjs`:** no Gemini fallback for the parse unless `--allow-gemini-fallback`; OpenRouter credit checked before starting (refuses below $0.0005 per file to parse) and every 200 files (stops below $0.05); stops after 10 errors in a row. Tested: refused with $0.01 left for 3,003 files, nothing parsed. Needs Pankaj: top up / raise the OpenRouter key limit; raise the production Gemini spend cap in AI Studio (or wait for the monthly reset). | Parse paused at 2,080 / 5,083 |
| 23 Nov 2026 | Pankaj topped up OpenRouter: key limit now **$50**, $50 left (read-only check). **A5 parse restarted 20:30 IST** as a separate hidden process (pid 23728, not tied to the Claude session), log `<work>/logs/parse-all-20261123-2030.*.log`: credit check passed (about $1.50 needed), Gemini fallback off, 3,003 files to parse (incl. the 12 errors), first 30 ok. Production Gemini spend cap: not yet confirmed raised (needed for the scanned-file reader, embeddings and the live ATS). | Parse running |
| 23 Nov 2026 | 20:38 IST: 14 of the first 170 files after the restart failed ("AI processing failed"), 2 more were scanned files (Gemini still capped). One failed file re-tried with the response recorded (one AI call): OpenRouter **402 "This request requires more credits, or fewer max_tokens … can only afford 63892"**. `GET /api/v1/credits`: **account total_credits $0, usage $0.07**: the top-up raised the **key's limit** to $50 but put **no money on the account**; OpenRouter reserves credit for the maximum reply (about $0.026 per call) and refuses when the account cannot cover it. Parse **stopped** 20:39 (pid 23728). Cache: **2,236 ok, 19 error, 2,828 not parsed**. `2-parse.mjs` guard now also reads the account balance (`/credits`) and uses the lower of the two; tested: refused ("account balance $-0.07, key limit left $49.93"), nothing parsed. | Parse paused at 2,255 / 5,083 |
| 23 Nov 2026 | Pankaj bought OpenRouter credits on the organization account (Aapna Infotheek Pvt Ltd: $17.82 available). Read-only check with the production key: **account balance $17.82** (total credits $90, usage $72.18), **key limit $20, $8.01 left** (key usage $11.99). One-resume test (a file that had failed with 402; production OpenRouter settings, Gemini fallback off; nothing written to the cache, database or OneDrive; no email): **200 OK**, `finish_reason` stop, provider Azure, valid JSON, 2,022 prompt + 753 completion tokens. **OpenRouter works for production.** The parse was NOT restarted (Pankaj: test only). Production Gemini spend cap: not confirmed raised yet. | OpenRouter OK; parse still paused |
| 24 Nov 2026 | Pankaj: draft the cost-approval e-mail to HR and IT (OpenRouter and Gemini). IT (screenshots): Gemini production project cap raised **₹500 → ₹700**, ₹534.40 used this month, about **₹500 of it on 23 Nov** (the parse's Gemini fallback); OpenRouter key limit raised $12 → $20. Read-only checks (no AI call): parse cache **2,255 = 2,236 ok + 19 error; 2,828 not parsed; 0 loaded on production**. OpenRouter key: `limit_reset` **null** (the $20 is a **lifetime** limit, not monthly), lifetime usage $12.00, month $1.03, week $0.64 (= the Stage 3 parse), today $0.007; $7.99 left. Cost so far for Stage 3: OpenRouter about **$0.64** (≈ $0.0003/resume), Gemini about **₹500** (fallback, now off). Estimate to finish: OpenRouter ≈ $1.00 parse (2,847 files) + ≈ $1.50 insights (≤ 5,000 new candidates, `openai/gpt-4.1-nano`) ≈ **$2.50**; Gemini ≈ ₹100–150 search entries (`gemini-embedding-001`, ≤ 5,000) + < ₹5 for 2 scanned files ≈ **₹150**; ×2 margin: $5 and ₹300. Asked in the e-mail: OpenRouter key limit $20 → $30 (no new money; balance $17.82 covers it); Gemini cap ₹1,000 for November if the load runs before 1 Dec (else the normal ₹500 is enough). E-mail text given in the session, not stored in the repo; final version shortened, plain text for Outlook, production only (no staging mention). | No run; parse still paused until approval |
| 19 Nov 2026 | `certify.mjs --source excel --env production --compare-env staging`: **COMPLETE**, proof code **7619-B652-D329**; checks 1–8 PASS (check 8: 6,126 live rows = 6,126 staging rows, 6 allowed new-vs-existing differences, 0 other). Files: `certificate-excel-production-20261119-1648.md/.json`, `what-was-migrated-excel-production-20261119-1648.md`, `evidence-excel-production-20261119-1648.xlsx` (personal data: HR-only folder). | **Stage 2 complete on staging and production.** Open: evidence files to the HR-only folder (O5), shared doc update (6.4), Pankaj commits the scripts and this file, HR told about ~4,077 older candidates now on production. |
