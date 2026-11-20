# Plan: Legacy migration, Stage 2 (Excel and Naukri) and Stage 3 (resumes)

| | |
|---|---|
| Phase | 4.1 |
| Version | v1.1, 18 Nov 2026. Adds the proof of completion (section 6), the Naukri job source rule, the new label and filter names, "why one database", and the HR-gated timeline. Plan only: no Stage 2 or Stage 3 code written yet, no database touched. |
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

Counts are from the 13 Nov inventory and are re-measured in Week 1.

### 4.2 Scripts (`backend/scripts/legacy-migration-excel/`)

| Script | What | Flags |
|---|---|---|
| `1-extract-excel.mjs` | Reads every spreadsheet with SheetJS (`xlsx`, already a backend dependency). Detects the header row, classifies the layout, writes `raw/NN.jsonl` in Stage 1's `{"t","id","v":{col:[kind,value]}}` format and `manifest.json` in the contract of section 6.3 (unit = file and sheet, `sourceCount` from SheetJS, `secondCount` from an ACE OLEDB recount, SHA-256, header row, layout). An unknown layout is recorded and stops the transform. | `--root <source folder> --out <work>` |
| `2-transform.mjs` | Maps, cleans and groups by person (union-find with the shared-contact guard). No database. Writes `transform/candidates.jsonl`, `transform/rows.jsonl`, `report/dry-run-report.md`, `report/no-contact-details.xlsx`, `report/review-merged-names.xlsx`. | `--work` |
| `3-load.mjs` | Loads one file: insert or enrich, provenance, label, vectors. | `--work --file <n> --env --expect-db [--apply] [--no-vectors] [--allow-production]` |
| `3b-retry-vectors.mjs`, `3c-check-batch.mjs` | As Stage 1. | as Stage 1 |
| `4-rollback-batch.mjs` | As Stage 1, with `SOURCE_KIND='excel'` and the Excel tag; also restores truncation repairs. | as Stage 1 |
| (no proof pack) | The proof comes from the shared `legacy-proof/certify.mjs` (section 6). | |
| `6-run-files.mjs` | Dry run → apply → check per file in run order; stops on the first failure; resumes. | `--work --env --expect-db [--allow-production] [--only <n>]` |
| `lib/layouts.mjs` | Layout definitions: header aliases per layout, header-row rule, run order. | |
| `lib/naukri-rules.mjs` | The Naukri value rules in 4.4. | |

Reuse without editing: `../legacy-migration/lib/rules.mjs` and `../legacy-migration/lib/missing-fields.mjs` are imported. The Stage 1 folder stays frozen as the record of the Access run. The Stage 1 loader and rollback are copied and adapted, because `SOURCE_KIND` and `TAG` are hard-coded there (`lib/mapping.mjs:5-6`).

Constants: `SOURCE_KIND = 'excel'`, `TAG = 'legacy_excel_migration'`, history label `Legacy (Excel: <file>, <date>)`.

Work folder (outside the repo): `E:\Recruitment Process Automation\Phase 4\MS-Access\_migration-work-excel\` with the same layout as Stage 1 (`manifest.json`, `raw/`, `transform/`, `report/`, `logs/`).

**Why SheetJS and not ACE OLEDB.** OLEDB guesses each column's type from the first rows. A notes column whose first rows are short is read as 255-character text, and cells that do not fit the guessed type come back empty. That is the likely cause of the 255-character cut seen in the Access data. SheetJS reads each cell's own value. Phone numbers are taken from the cell's text so they are never turned into floats or scientific notation.

### 4.3 Mapping

Layout A uses the Stage 1 alias list as it stands. Layouts B and C start from the preliminary mapping in Access plan §4.2 and are confirmed against the Week 1 header profile. Additions and confirmations:

| Item | Rule |
|---|---|
| `JobSource` | Layouts B and C: "Naukri" plus the year in the source folder's name (S11): `Naukri Download Data 2023` gives "Naukri 2023", `Naukri Good Profile Data Year 2024 - 2025` gives "Naukri 2024-25". The year rule lives in `lib/layouts.mjs`; a Naukri folder with no year stops that file in the dry run. Layout A: the row's own source through `cleanSource()`. `JobSource` is free text and nothing groups by it (`screeningV2.service.js:86`, `utils/duplicateCompare.js:69` only list it), so the suffix breaks no report. |
| `PositionApplied` | B: `Designation`, else the role in the file or folder name. C: `Job Title`. A: `Role`, else the Stage 1 table default for that role. |
| `Top5KeySkills` | B: `Resume Title` (no skills column). C: `Key Skills`. |
| `createdAt` | A: `Date`. C: `Date of application`. B: open question O1 (`Last Active Date` or the download date). |
| Screening questions (C) | Matched by keywords in the question text (current CTC, expected CTC, notice, English rating, shift). Each new file's questions are listed in the dry-run report before loading. |
| Unmapped columns | Kept in `raw_row` only (address, date of birth, marital status, view/download activity, Resume ID). |
| Unknown header set | Stops that file until the mapping is agreed. |

### 4.4 Naukri value rules (`lib/naukri-rules.mjs`)

| Field | Seen in Naukri | Rule |
|---|---|---|
| Experience | `5 Year(s) 6 Month(s)`, `Fresher` | Display text "5 Years 6 Months"; numeric 5.5. Fresher = 0. Unlike the Access `3.6` question, Naukri states months explicitly. |
| CTC | `Rs. 5.5 Lacs`, `INR 5,50,000`, `5.5 Lakh(s)` | Strip currency and units; a value above 1,000 is divided by 100,000 (the ATS threshold). Result in LPA. |
| Notice period | `15 Days or less`, `1 Month`, `Serving Notice Period` | Kept as text; days through `parseNoticePeriodDays()`. |
| Phone | `+91-98xxxxxxxx`, two numbers | Stage 1 rule V2. |
| Email | | Stage 1 rule V3. |

---

## 5. Stage 3: resumes

### 5.1 Sources

About 5,240 files: 3,446 PDF, 1,371 DOCX, 419 DOC, about 12 RTF/JPG/PPTX, in role and year folders. Re-measured by the inventory.

### 5.2 Scripts (`backend/scripts/legacy-migration-resumes/`)

| Script | What |
|---|---|
| `1-inventory.mjs --root --out <work>` | Walks the folders. SHA-256 per file; byte-identical copies collapse into one (`skipped_duplicate_file`). Records folder, role from folder name (R5), file date, type. Writes the manifest in the contract of section 6.3 (unit = folder, `sourceCount` from the walk, `secondCount` from a PowerShell `Get-ChildItem -Recurse -File` count). No AI. |
| `1b-convert.mjs --work` | Headless LibreOffice (`soffice --headless --convert-to`) in a working copy: `.doc` and `.rtf` to `.docx`, `.pptx` to `.pdf`. Originals untouched. Needs LibreOffice on the migration machine. |
| `2-parse.mjs --work [--concurrency 4] [--limit N]` | Text: `extractTextFromFile()`. Under about 200 characters: the scanned-file reader (5.3). Fields: `parseResumeWithOpenRouter()`. Then HR Upload's own checks (5.4). Result cached as `parse/<sha256>.json`. Resumable; backoff on 429. Run **once**; both databases load the same cache. |
| `3-transform.mjs --work` | Groups by person (email or phone, shared-contact guard). The newest resume is the primary CV; older ones are kept in provenance. Role from the folder when the parser gives none. No valid email: `rejected_no_email`, listed for HR. |
| `4-load.mjs --work --folder <n> --env --expect-db [--apply] [--allow-production]` | Match, identity guard, insert or enrich (5.5), OneDrive upload, vector, provenance. |
| `4b-insights.mjs` | `preGenerateCandidateInsights()` for inserted candidates, as a separate resumable pass. |
| `4c-check-batch.mjs`, `5-rollback-batch.mjs`, `7-run-folders.mjs` | As Stage 1; rollback also deletes the uploaded OneDrive files (`deleteDriveItem()`). The proof comes from `legacy-proof/certify.mjs` (section 6). |

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

`backend/prisma/ddl/2026-11-xx-legacy-import-outcomes.sql` and `.rollback.sql`: drop and re-add `chk_legacy_import_outcome` with the five Stage 1 values plus `rejected_no_email`, `rejected_unreadable`, `skipped_duplicate_file`, `review_identity_conflict`. Additive; applied with `run-ddl.mjs` (dry run, then real) to staging and production on the same day.

### 5.8 Parity test

The same 10 synthetic resumes (no real people) go through HR Upload on a local backend and through the runner. The two sets of `rpa_cv` rows must match field by field, apart from the tag, the legacy columns and the email-related fields.

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
| 19 Nov 2026 | `certify.mjs --source excel --env production --compare-env staging`: **COMPLETE**, proof code **7619-B652-D329**; checks 1–8 PASS (check 8: 6,126 live rows = 6,126 staging rows, 6 allowed new-vs-existing differences, 0 other). Files: `certificate-excel-production-20261119-1648.md/.json`, `what-was-migrated-excel-production-20261119-1648.md`, `evidence-excel-production-20261119-1648.xlsx` (personal data: HR-only folder). | **Stage 2 complete on staging and production.** Open: evidence files to the HR-only folder (O5), shared doc update (6.4), Pankaj commits the scripts and this file, HR told about ~4,077 older candidates now on production. |
