# Plan: Legacy candidate data migration into the ATS database

| | |
|---|---|
| Phase | 4 |
| Version | v3.2, 2026-11-16. Planning only: no code written, nothing imported, no database touched. All doubts on the Access stage are decided (section 7). |
| Scope rule | One-time import and mapping into the database. The scripts are run once and not reused. No UI work and no export feature are part of this plan. |
| Order of work | Stage 1 MS Access (current focus) → Stage 2 Excel files → Stage 3 resume files (PDF/DOCX) |
| Access source | `E:\Recruitment Process Automation\Phase 4\MS-Access\All Data_ - With Daily Updated Data  16th Jan 2025.accdb` |
| Other sources | `E:\Recruitment Process Automation\Phase 4\MS-Access\OneDrive_1_11-13-2026\` |
| Target | PostgreSQL, table `rpa_cv` (`backend/prisma/schema.prisma`) |
| Requirements from | Calls with Chhaya Verma on 6 Nov 2026 (minutes 0–15) and 13 Nov 2026 (full call) |
| Hard constraint | The existing HR Upload module is not to be modified |
| Deadline | All legacy data in the ATS before 16–20 Feb 2027 |

How the Access file was read: read-only through the Access OLEDB driver, twice. Structure, fill counts, value shapes, date ranges, email overlap between tables, status values and the content of unnamed columns were profiled. The decisions taken are recorded in section 7.

---

## 1. Requirements carried through all three stages

| # | Requirement | Source |
|---|---|---|
| R1 | Candidates must be searchable in the ATS and usable for mass mailing. | 6 Nov 3:41 |
| R2 | Map each source column to the matching ATS column. No new ATS fields. Unmatched values may be skipped. | 6 Nov 1:12, 11:09 |
| R3 | Minimum fields: name, phone, email, role. Everything else is good to have. | 13 Nov 11:50, 47:23 |
| R4 | For Access, capture as many fields as possible, including interview notes (Tech 1, Tech 2, Tech 3, Managerial, HR). | 13 Nov 48:28 |
| R5 | When Role or Key Skills is blank, take it from the table, sheet or folder name. | 6 Nov 2:28–5:27 |
| R6 | Tag: it must be provable which records came from Access (total, and spot-checks). The visible tag may change later; a history must remain. | 13 Nov 23:35–29:54 |
| R7 | Duplicates: Chhaya's rule is "first record kept, second discarded". Pankaj's decision of 16 Nov for a candidate who already exists in the ATS database: update the existing record, otherwise insert. See 3.9 for how the two are combined. | 6 Nov 14:17, 13 Nov 12:11, Pankaj 16 Nov |
| R8 | Load oldest data first. | 13 Nov 47:45 |
| R9 | No email flood. Never mail anyone whose status is Joined. Outreach later, in batches. | 6 Nov 5:27–6:43 |
| R10 | One table or file at a time, starting small. | 6 Nov 6:43, 12:02 |
| R11 | The Access import is one-time. Data never flows from Access into the ATS again. | 13 Nov 22:00 |

Out of scope by Pankaj's decision of 16 Nov: any export feature and any UI change. The only goal is to import the legacy data and map it onto the database columns, once.

---

## 2. Which database table

**`rpa_cv` is the only business table the migration writes to.** It is the ATS candidate master. Every screen that lists or searches candidates reads it, and it already has a column for every Access field, including the interview-round notes.

| Table | Used? | Why |
|---|---|---|
| `rpa_cv` | Yes, one row per unique candidate | Candidate master. Has `Heat`, `HRQuickcomments`, `IQScore`, `TechScore`, `FinalStatus`, `TechRoundOne/Two/Three`, `ManagerialOrCEOFeedback`, `HRInterview` and the rest. |
| `rpa_cv_vectors` | Yes, indirectly | Candidate search uses a vector per candidate. Written by calling the existing `saveCandidateVector()` function, unchanged (decision D5). |
| `rpa_legacy_import_rows` | Yes, new table (decision D1) | Permanent record of every source row: where it came from, what happened to it, which candidate it became. This is the "came from Access" history (R6). |
| `rpa_cv_tmp` | No | HR's duplicate-review queue. Thousands of legacy duplicates would bury live work. |
| `rpa_shortlisted_candidates`, `rpa_candidate_pipeline`, stage tables, scorecards | No | These need an MRF and the live stage engine. Legacy round notes are history text, not live pipelines. |
| `rpa_candidate_mrf_tags` | No | Needs a real MRF id. The role is kept as text in `PositionApplied`. |
| `rpa_upload_jobs`, `rpa_upload_log`, `rpa_upload_batch_summary` | No | They feed the HR Upload status dashboard. Migration rows do not belong there. |

All `rpa_cv` data columns used here are free text (`String?`), so mixed formats cannot fail on type. Three numeric helper columns are derived with the ATS's own parsers: `TotalExperienceYearsNumeric`, `ExpectedCTCNumeric`, `NoticePeriodDays`.

---

## 3. Stage 1: MS Access

### 3.1 What the file contains

- 31 tables. 28 are imported. Ignored: `~TMPCLP483111`, `~TMPCLP621551` (Access leftovers), `Table1` (empty). Nine saved queries exist; they are views, not data.
- 5,931 candidate rows, plus 2,912 blank rows that are skipped.
- 4,675 distinct email addresses across the file, so roughly 4,700 unique candidates after de-duplication.
- Dates run from 2017 to mid-2025. The file is not limited to the 2020–2022 RMS period, and it was edited after the date in its name.

| # | Table | Candidate rows | Blank rows | Years | With email + phone | Specifics |
|---|---|---|---|---|---|---|
| 1 | Accountant Role | 251 | 23 | 2022–2025 | 247 | Standard |
| 2 | Android Developer | 75 | 1,023 | 2024–2025 | 75 | Comment column is `HR owner feedback` |
| 3 | Angular | 49 | 0 | 2022–2023 | 49 | Rounds named 1st/2nd/3rd |
| 4 | BA | 138 | 0 | 2017–2023 | 101 | 36 rows email only |
| 5 | BD Manager - Middle East | 215 | 0 | 2025 | 215 | 34 cells hold two emails |
| 6 | BDE Junior | 165 | 1,010 | 2023–2025 | 161 | |
| 7 | Build & Release | 84 | 0 | 2019–2022 | 84 | Pilot table. Role and Key Skills filled on every row. |
| 8 | Customer Success Clean data | 66 | 30 | 2025 | 58 | `Job Profile` column on 13 rows |
| 9 | Dot Net | 566 | 0 | 2017–2023 | 560 | Has Role, Key Skills, Current Company, Gender. 113 cells hold two emails. |
| 10 | Dot Net  March 2024 | 251 | 0 | 2018–2024 | 216 | Snapshot (3.3). Interview feedback in unnamed columns `Field23`–`Field26`. 23 rows have no email and no phone. |
| 11 | Dot Net Developer 2024 | 79 | 0 | 2021–2024 | 78 | Snapshot (3.3) |
| 12 | DotNet 22 April | 479 | 513 | 2020–2024 | 463 | Snapshot (3.3) |
| 13 | Hyper Automation Clean Sheet | 773 | 291 | 2023–2024 | 670 | No column names. Header text sits in row ID 1. |
| 14 | IT Support | 115 | 0 | 2019–2023 | 113 | |
| 15 | Kony Hcl voltmx | 20 | 0 | 2024 | 15 | |
| 16 | Mobile | 92 | 0 | 2017–2023 | 91 | Feedback in unnamed column `Field21` (5 rows) |
| 17 | Node JS | 75 | 0 | 2020–2022 | 70 | |
| 18 | Others | 13 | 1 | 2018–2020 | 13 | Every column typed as text |
| 19 | PHP | 63 | 0 | 2017–2022 | 44 | 18 rows email only |
| 20 | Power BI | 52 | 0 | 2018–2019 | 44 | 5 rows have no email and no phone |
| 21 | QA | 601 | 0 | 2018–2022 | 600 | Snapshot (3.3) |
| 22 | QA 20 Sept | 900 | 1 | 2018–2024 | 857 | Snapshot (3.3) |
| 23 | Rakhi Ma'am cv | 136 | 0 | no date | 120 | Own layout (3.6) |
| 24 | React | 20 | 0 | 2022 | 16 | |
| 25 | ROR | 85 | 14 | 2021–2025 | 84 | Two comment columns |
| 26 | Sales Leader | 284 | 5 | 2023–2024 | 0 | No phone numbers at all; 283 rows email only |
| 27 | UI UX Designer | 254 | 0 | 2019–2025 | 251 | 32 rows carry form answers in unnamed columns `Field24`–`Field37`. 8 rows have a birth year in the date column. |
| 28 | UKG | 30 | 0 | 2024 | 29 | |

### 3.2 Findings that shape the mapping

1. **The same field has many spellings.** For example the HR comment appears as `HR Quick comments`, `HR Quick Comments`, `Quickie Comments`, `Quicky Comments - HR Updates`, `HR owner feedback`. Mapping therefore goes through one alias list (3.4), not per-table code.
2. **Most tables declare 130–255 columns; only the first 20–27 hold data.** The rest are empty `FieldN` padding, or cells holding a single space. Whitespace-only cells are treated as empty.
3. **Some unnamed columns hold real data** and must not be dropped (3.6): interview feedback in Dot Net March 2024 and Mobile, form answers in UI UX Designer.
4. **Several tables are snapshots of the same sheet** (3.3).
5. **Column types vary by table.** Phone is a number in some tables and text in others; dates are real dates in some and text in five formats in others. Value rules are in 3.7.
6. **Long notes exist.** Managerial notes reach 3,383 characters, HR comments 2,792. They are copied in full.
7. **Nine notes columns never exceed exactly 255 characters** (`Technical 1st/2nd/3rd Round`, `CEO Interview`, `CEO Feedback`, `HR Screening Comments`, the two `Technical Skype/Telephonic/F2F` round columns). That pattern means the text was already cut when the sheets were loaded into Access. The migration cannot restore it from this file.
8. **Status columns are untidy.** 130 distinct values, including spelling variants and about 30 rows where a score sits in the status column.

### 3.3 Snapshot tables

Email overlap between tables:

| Pair | Overlap |
|---|---|
| `QA` (600 emails) inside `QA 20 Sept` (890) | 600 of 600 |
| `Dot Net Developer 2024` (78) inside `DotNet 22 April` (457) | 78 of 78 |
| `Dot Net  March 2024` (216) inside `DotNet 22 April` (457) | 215 of 216 |
| `Dot Net` (532) and `DotNet 22 April` (457) | 136 |
| `Dot Net` (532) and `Dot Net  March 2024` (216) | 72 |

`QA` is an older copy of `QA 20 Sept`. The Dot Net 2024 tables are copies of one another at different dates. Under a plain "first kept, second discarded" rule the older, less complete copy of a row would win, and the feedback that exists only in `Dot Net  March 2024` (`Field23`–`Field26`) could be lost.

Handling, approved by Pankaj on 16 Nov:

- Inside the Access file, rows for the same person are consolidated into one candidate. The earliest-dated row is the base. Blank fields on the base are filled from the other rows. A filled field is never overwritten.
- Against a candidate already in the ATS database, the update rule in 3.9 applies.

### 3.4 Master column mapping

| `rpa_cv` column | Access header variants | Transform |
|---|---|---|
| (provenance only) | `ID` | Access serial number. Stored only in the provenance row. |
| `createdAt` | `Date` | Rule V1. See decision D2. |
| `Name` | `Name` | Trim, collapse spaces |
| `Heat` | `Heat` | As text. Rule V7. |
| `NoticePeriod`, `NoticePeriodDays` | `Notice Period`, `Notice period` | Number becomes "30 days"; days through `parseNoticePeriodDays()` |
| `HRQuickcomments` | `HR Quick comments`, `HR Quick Comments`, `Quickie Comments`, `Quicky Comments - HR Updates`, `HR owner feedback`, `HR Screening Comments` | Trim. When a table has two of these (ROR), join them with the header as a label. |
| `ContactNumber` | `Phone`, `Contact Number` | Rule V2 |
| `EmailID` | `Email ID`, `E-mail ID`, `Email`, `Email Address` | Rule V3 |
| `HighestQualification` | `Qualification`, `Quaification` | Trim. `#N/A` becomes empty. |
| `TotalExperienceYears`, `TotalExperienceYearsNumeric` | `Experience`, `Experience ( & months)`, `Experience (Year & months)`, `Experience(& months)` | Rule V4 |
| `LastCompanyExperienceYears` | `in Last Company`, `year in Last Company`, `Year in Last Company`, `Years in Last Company`, `Experience in Last Company`, `Last Company` | Rule V4 |
| `CurrentLocation` | `Location` | Trim |
| `CTC_LPA` | `CTC`, `CTC (LPA)` | Rule V5 |
| `ExpectedCTC_LPA`, `ExpectedCTCNumeric` | `ECTC` | Rule V5 |
| `JobSource` | `Source` | Rule V6. The Access tag does not go here; this stays the real source (Naukri, LinkedIn and so on). |
| `RecruiterInfoAAPNA` | `HR Owner` | Trim. "None" becomes empty. |
| `IQScore` | `IQ Score`, `IQ Score/24` | Rule V8 |
| `TechScore` | `Tech Score`, `Tech Score/15`, `/20`, `/25`, `/35`, `/40`, `/50` | Rule V8, keeping the denominator from the header ("18/25") |
| `FinalStatus` | `Final Status`, `Status` | As written, trimmed. Rule V9. |
| `TechRoundOne` | `Technical Skype/Telephonic`, `Technical 1st Round`, `Technical Skype/Telephonic/F2F - 1st Round` | Full text |
| `TechRoundTwo` | `Technical F2F`, `Technical 2nd Round`, `Technical 2`, `Technical Skype/Telephonic/F2F - 2nd Round` | Full text |
| `TechRoundThree` | `Technical 3rd Round` | Full text |
| `ManagerialOrCEOFeedback` | `Magerial Interview`, `Managerial Interview`, `CEO Interview`, `CEO Feedback` | Full text. When a table has both a managerial and a CEO column, join with labels. |
| `HRInterview` | `HR Interview` | Full text |
| `PositionApplied` | `Role`, `Job Profile` | If blank, the table default (3.5). A cell holding a status word or a feedback paragraph is rejected (seen twice). |
| `Top5KeySkills` | `Key Skills` | If blank, the table default (3.5) |
| `CurrentCompany` | `Current Company Name` | Optional |
| `Gender` | `Gender` | Male / Female. "NA" becomes empty. |
| not mapped | `Action Taken / Comments - HR` | Holds single characters only. Kept in the provenance raw row. |
| not mapped | `Mail Sent Date`, the column named ` 3` | One row each. Kept in the provenance raw row. |

Columns the import sets itself:

| `rpa_cv` column | Value |
|---|---|
| `last_action_context`, `last_action_by` | `ms_access_migration` (the visible tag, R6) |
| `modifiedAt` | Import time |
| `missingData`, `statusActive` | Computed with the ATS's existing missing-field rule, so these rows behave like any other candidate |
| `MetaData` | Set by the vector step, the same way HR Upload sets it |
| `cvFileUrl`, `cv_file_item_id`, `resume_full_text` | Empty. Access has no resumes. |
| `cvMissingToken`, `details_requested_at` | Empty at import. Set only when outreach runs. |
| `vendorName`, `VendorEmail`, `lockForNinetyDays` | Empty. Legacy rows carry no vendor claim. |
| `is_referral` | False |

### 3.5 Default role and key skills per table (R5)

Used only when the row's own cell is blank. The skills column is a first proposal for Chhaya to correct.

| Table | Default `PositionApplied` | Default `Top5KeySkills` |
|---|---|---|
| Accountant Role | Accountant | Accounts, Finance |
| Android Developer | Android Developer | Android |
| Angular | Angular Developer | Angular |
| BA | Business Analyst | Business Analysis |
| BD Manager - Middle East | BD Manager - Middle East | Business Development, Sales |
| BDE Junior | Business Development Executive (Junior) | Business Development, Sales |
| Build & Release | Build and Release Engineer | Build and Release |
| Customer Success Clean data | Customer Success | Customer Success |
| Dot Net, Dot Net  March 2024, Dot Net Developer 2024, DotNet 22 April | Dot Net Developer | .NET |
| Hyper Automation Clean Sheet | Hyper Automation Developer | Hyper Automation, RPA |
| IT Support | IT Support | IT Support |
| Kony Hcl voltmx | Kony / HCL Volt MX Developer | Kony, HCL Volt MX |
| Mobile | Mobile Developer (the row's own Role says iOS, Android or Flutter on all 92 rows) | Mobile Development |
| Node JS | Node JS Developer | Node.js |
| Others | blank | blank |
| PHP | PHP Developer | PHP |
| Power BI | Power BI Developer | Power BI |
| QA, QA 20 Sept | QA Engineer | Testing, QA |
| Rakhi Ma'am cv | from `Profile Name` | blank |
| React | React Developer | React |
| ROR | Ruby on Rails Developer | Ruby on Rails |
| Sales Leader | Sales Leader | Sales |
| UI UX Designer | UI/UX Designer | UI, UX |
| UKG | UKG Consultant | UKG |

### 3.6 Tables with their own handling

**Hyper Automation Clean Sheet** has no column names. Map by position and skip row ID 1, which holds the header text:

`Field1` Date · `Field2` Name · `Field3` Heat · `Field4` Notice Period · `Field5` HR Quick comments · `Field6` Phone · `Field7` Email ID · `Field8` Qualification · `Field9` Experience · `Field10` in Last Company · `Field11` Location · `Field12` CTC · `Field13` ECTC · `Field14` Source · `Field15` HR Owner · `Field16` IQ Score · `Field17` Tech Score/25 · `Field18` Status · `Field19` Technical Skype/Telephonic · `Field20` Technical F2F · `Field21` Managerial Interview · `Field22` HR Interview

`Field23`–`Field26` (Role, Key Skills, Current Company, Gender) contain only their header text, so role and skills come from the table default. The header cells for fields 3, 4, 6, 9, 10 and 16 are empty because Access typed those columns as numbers; their meaning follows the standard column order and their number types agree with it.

**Dot Net  March 2024** carries interview feedback past the last named column, written as "interviewer, date, feedback":

| Column | Rows | Content seen | Target (approved 16 Nov) |
|---|---|---|---|
| `Field23` | 26 | Feedback, mostly from the management round | Appended to `ManagerialOrCEOFeedback` |
| `Field24` | 21 | Feedback, mostly from the HR round, plus offer notes | Appended to `HRInterview` |
| `Field25` | 9 | Further HR or panel feedback | Appended to `HRInterview` |
| `Field26` | 4 | Further feedback | Appended to `HRInterview` |

This looks like a column shift: the table's named `Managerial Interview` and `HR Interview` columns sit just before them. The split above is by dominant author and was approved by Pankaj on 16 Nov.

**Mobile** `Field21` (5 rows) sits between `Magerial Interview` and `HR Interview` and holds management feedback. Appended to `ManagerialOrCEOFeedback`.

**UI UX Designer** has 32 rows from 2025 with form answers in unnamed columns. The clear ones map to existing `rpa_cv` columns:

| Column | Content seen | Target (approved 16 Nov) |
|---|---|---|
| `Field24` | List of skills | `Top5KeySkills` |
| `Field25` | "Current Company … Website Address …" | `CurrentCompany` (company name part) |
| `Field26` | Male / Female | `Gender` |
| `Field27` | A number 1–5 | `EnglishCommunicationRating` |
| `Field28` | Shift timings | `PreferredShift` |
| `Field32` | "10th Marks … 12th Marks … Graduation Marks …" | `a10th`, `a12th`, `graduation`, `EducationalScoresPercentage` |
| `Field30`, `Field31`, `Field34`, `Field37` | Yes / No | Unknown questions. Not imported into `rpa_cv`. The values stay in the log table's `raw_row`, so they can be mapped later if Chhaya supplies the questions (Q5). |

**Rakhi Ma'am cv:** `Name` → `Name`, `Profile Name` → `PositionApplied`, `Experience` → `TotalExperienceYears`, `Contact Number` → `ContactNumber`, `Email Address` → `EmailID`. No date, so `createdAt` is the import time.

**Customer Success Clean data:** `Job Profile` (13 rows) → `PositionApplied`.

### 3.7 Value rules

| Rule | Field | What the data looks like | Rule |
|---|---|---|---|
| V1 | Date | Real dates (most), text as `dd-mm-yyyy`, `dd/m/yyyy`, two-digit years, Excel serial numbers; 8 UI UX rows with years 1992–2004; 6 unreadable | Parse day-first. Convert serial numbers. A date before 2015 or in the future is treated as missing and reported. |
| V2 | Phone | Numbers stored as decimals, text with trailing commas, two numbers in one cell, `+91` prefixes, one negative value | Digits only, no scientific notation. Split on comma, slash, space, newline. Strip `+91` or a leading 0. Keep valid 10-digit numbers, comma-separated (the format the ATS duplicate matcher expects). |
| V3 | Email | Mostly clean. About 200 cells hold two addresses. Some trailing spaces. | Lowercase, trim, split, validate, comma-separated. |
| V4 | Experience | `5`, `5.5`, `3.11`, a few with words | Keep the cleaned original as the display text. Numeric through the ATS's `parseExperienceNumeric()`, which reads `3.6` as 3.6 years. Question for Chhaya in section 8. |
| V5 | CTC, ECTC | Mostly LPA (`5.63`). About 200 values are full rupee amounts (`600000`). A few carry words. | Strip units. A value above 1,000 is divided by 100,000, the same threshold the ATS parser uses. Words only becomes empty and is reported. |
| V6 | Source | 93 spellings; Naukri is about 3,500 rows | Normalise case and obvious variants. Anything else as written. |
| V7 | Heat | 85% are `8`. 56 rows hold `15`, which looks like a notice period one column to the left. | As written. Values above 10 are listed in the dry-run report. |
| V8 | IQ and Tech scores | Numbers, `18/24`, per-section text, words such as "NA" | A plain number gets the header's denominator. Anything else as written. |
| V9 | Final Status | 130 distinct values. About 30 rows hold a score instead of a status. | As written. A purely numeric status is reported. A separate normalised lookup, used only for the "Joined" check, treats `joined`, `joined and left`, `joined & left` as joined. |
| V10 | Blank rows | 2,912 rows hold nothing but `ID` | Skipped and counted. |
| V11 | Minimum fields (R3) | 43 rows have a name but neither email nor phone (23 of them in Dot Net  March 2024) | Not imported (approved 16 Nov). Written to a separate Excel list, one row per candidate with table name, Access ID, name and every filled field, for Pankaj to send to HR. |
| V12 | Whitespace-only cells | Thousands in the padding columns | Treated as empty. |

### 3.8 Tag and provenance (R6)

1. **Visible tag:** `rpa_cv.last_action_context = 'ms_access_migration'`. An existing column. It changes the next time the candidate is uploaded or updated in the ATS, which Chhaya accepted.
2. **Permanent history:** the new table `rpa_legacy_import_rows` (approved by Pankaj on 16 Nov), one row per source row read, never updated after the import.

| Column | Purpose |
|---|---|
| `id` | Key |
| `batch_id` | One per import run |
| `source_kind` | `ms_access`, `excel`, `resume` (the same table serves all three stages) |
| `source_file`, `source_table`, `source_row_id` | Exact origin |
| `raw_row` (JSON) | The untouched source row, including unmapped columns |
| `outcome` | `inserted`, `merged_in_file`, `updated_existing`, `skipped_blank`, `rejected_min_fields` |
| `changed_fields` (JSON) | For `updated_existing`: each field changed, with its value before the update, so the update can be undone |
| `cv_id` | The `rpa_cv` row it became or matched |
| `warnings` (JSON) | Value rules that fired |
| `created_at` | Import time |

This is a log table in the database only. It has no screen. The Access total and list that Chhaya wants to show management come from a plain SQL query on it, run by the dev team. It also stops a row being imported twice if a run is interrupted and restarted, and it makes a rollback exact.

It is a database change. It follows the repository convention: a dated SQL file and a rollback file under `backend/prisma/ddl/`, applied to local, then staging, then production, each with sign-off.

### 3.9 Duplicates (R7)

- Match rule: the ATS's own rule (any email in common, or any phone in common), using the existing `findExistingCandidateMatch()`, `sanitizeMatchEmails()` and `sanitizeMatchContacts()` functions unchanged.
- Inside the Access file: consolidated as described in 3.3.
- Against the ATS database, decided at load time, so no separate read of staging is needed beforehand:
  - **Candidate not found:** insert a new `rpa_cv` row.
  - **Candidate found:** update the existing `rpa_cv` row.
- **What "update" changes (approved by Pankaj on 16 Nov).** The candidate already in the ATS is the newer record, and the Access row is 1 to 8 years old. The update therefore works as follows:
  - A field that is empty on the ATS record is filled from Access.
  - A field that already has a value on the ATS record is left as it is. This protects current phone, CTC, notice period, location and status from being replaced by old values.
  - The legacy history fields are the exception, because the ATS has no other copy of them: Access HR comments and round notes (`HRQuickcomments`, `TechRoundOne/Two/Three`, `ManagerialOrCEOFeedback`, `HRInterview`) are appended under a "Legacy (MS Access, date)" label when the ATS field already has text.
  - An extra email or phone from Access is added to the existing comma-separated list.
  - `createdAt` of the existing record is not changed.
- Nothing is sent to the HR duplicate-review queue, and no email is sent.

### 3.10 Search (R1)

ATS candidate search uses one vector per candidate in `rpa_cv_vectors`. Without it a migrated candidate would be stored but hard to find. The import calls the existing `saveCandidateVector(candidateId, data)` for every inserted candidate, passing the mapped fields (approved by Pankaj on 16 Nov). A candidate that already existed keeps the search entry it already has. Two facts to know:

- That function skips a candidate with no email. About 30 phone-only candidates would have no vector.
- It makes one embedding call per candidate, about 4,700 calls for Access.

Whether keyword search also depends on resume text is checked during the pilot.

### 3.11 Emails (R9)

The Access import sends no email. It does not call any mail function. Outreach is a later, separate step, in batches, excluding status Joined and candidates with no valid email. On staging, mail goes only to the approved mail sink.

### 3.12 How Stage 1 runs

Code location: a new folder, `backend/scripts/legacy-migration/`. Nothing under `backend/src` is edited. Existing functions are imported and called as they are.

| Step | What | Exit check |
|---|---|---|
| 1 | Sign-off on this plan (the decisions in section 7 are already recorded) | Written |
| 2 | Extract: each Access table to one raw file (JSON lines), values untouched. Access opened read-only. | Row count per table equals the Access count |
| 3 | Transform and dry-run report for all 28 tables. No database connection is needed for this step. It also produces the "no contact details" list for HR. | Zero unmapped columns that hold data. Warnings reviewed. |
| 4 | Provenance table created on local, then staging | SQL and rollback both run cleanly |
| 5 | Pilot on staging: Build & Release, 84 rows | Counts reconcile. 10 rows compared field by field with Access. Candidates found by search. No email sent. |
| 6 | Remaining tables on staging, oldest data first (R8), one table per run | Same checks per table |
| 6a | Proof pack for staging (3.13), generated after all tables are loaded | Totals in the pack equal the Access totals |
| 7 | Review with Chhaya on staging, using the spot-check sheet of the proof pack | Sign-off on the pack |
| 8 | Production, same order | Sign-off per group |
| 8a | Proof pack for production (3.13) | Totals equal the Access totals. Chhaya signs; HR keeps the file. |

Suggested table order after the pilot, by earliest data: Power BI, Others, Mobile, PHP, BA, IT Support, Node JS, Dot Net, the QA pair, Angular, React, the Dot Net 2024 group, ROR, BDE Junior, Hyper Automation, Sales Leader, Kony, UKG, Android Developer, Accountant Role, UI UX Designer, BD Manager - Middle East, Customer Success, Rakhi Ma'am cv.

Reconciliation per table: rows read = inserted + merged in file + updated existing + skipped blank + rejected.

Rollback per batch: delete the `rpa_cv` rows (and their vectors) that the batch recorded as `inserted`; restore the before-values recorded for rows it `updated_existing`; then delete the batch's provenance rows. Nothing else is touched.

### 3.13 Proof pack for management (R6)

Added on 17 Nov 2026 by Pankaj's decision. Built the same day: `backend/scripts/legacy-migration/5-proof-pack.mjs`.

```
cd backend
node scripts/legacy-migration/5-proof-pack.mjs --work <work folder> --env staging --expect-db recruitmentautomationdb [--sample 5]
```

It runs SELECT statements only and writes `<work>/report/proof-pack-ms-access-<env>-<date>-<time>.xlsx`. While tables are still being loaded, the Summary sheet says INCOMPLETE and the file name ends in `-INCOMPLETE`; such a copy is not proof. The spot-check sample (5 new candidates per table by default) is chosen by a hash of table and row id, so the same rows come out on every run.

**Why.** Chhaya needs proof for higher management that the legacy data was extracted and mapped properly. The proof must not change when HR later edits, re-uploads or merges a candidate. A screen cannot give that, because a screen shows the candidate as they are today. A file generated once from the provenance table can.

**What it is.** One Excel workbook per source file and per database (one for staging, one for production), generated from `rpa_legacy_import_rows` after the last table is loaded, and not changed afterwards.

| Sheet | Content |
|---|---|
| Summary | Source file, database, load dates, batch count. Rows read, candidates created, rows merged into another row of the same person, rows matched to a candidate already in the ATS, blank rows, rows not imported. The numbers add up to the Access total. |
| Per table | The same counts for each of the 28 tables, with the Access row count beside them. |
| Row list | Every source row: table, row id, what happened to it, the ATS candidate id it became, and the value rules that fired. |
| Not imported | Each row that was not imported, with the reason. |
| Spot-check | A random sample per table: the Access values beside the ATS values, column by column, with a column for Chhaya to tick. |
| Decisions | The mapping decisions that changed data (name repair in `DotNet 22 April`, shifted rows in `Dot Net  March 2024`, the "filled field is never overwritten" rule), with row counts. |

**Rules.**

- A read-only script in `backend/scripts/legacy-migration/`, next to the import scripts. It reads the database and writes the file. It changes nothing.
- The pack holds candidate personal data. It is written outside the repository and handed to HR. HR keeps it; the ATS does not.
- It is not an ATS export feature and adds no screen, so the scope rule of this plan (no UI, no export feature in the ATS) still holds.
- It can be produced again at any time, because the provenance table keeps the untouched source row. A pack produced later shows the same import facts; only the "ATS values" on the spot-check sheet would show today's values, so the signed pack is the one made right after the load.
- Stage 2 (Excel) gets one pack per Excel file by the same script; the provenance table already separates sources by `source_kind` and `source_file`.

**Seeing legacy candidates on screen** is a separate task with its own approval: `SCOPE-Legacy-Source-Label-and-Filter.md` (a permanent label and a filter on Search Candidate). The proof pack does not depend on it.

### 3.14 Production run (runbook)

Written 17 Nov 2026, after the staging load. Nothing in this section has been run on production. Every production step needs Pankaj's explicit go-ahead for that step.

**Databases.** Staging and production are on the same server (`20.244.34.176`). Staging is `recruitmentautomationdb` (`backend/.env.staging`); production is `recruitmentautomationdbProd` (`backend/.env.production`). Every command below names the database twice, through `--env` and `--expect-db`, and refuses to run if they do not match. Scripts that write also need `--allow-production`.

#### A. Before production day

| # | Check | Who |
|---|---|---|
| A1 | Chhaya has reviewed staging and signed the staging proof pack (`proof-pack-ms-access-staging-20261117-1001.xlsx`). | Chhaya |
| A2 | The staging deployment is confirmed, including the legacy label and filter (`SCOPE-Legacy-Source-Label-and-Filter.md`) if it goes to production at the same time. | Pankaj |
| A3 | The half-done production deployment of 16 Nov (`PRODUCTION-DEPLOYMENT-PLAN-2026-11-16.md`) is finished, or its remaining steps are ordered together with this run. | Pankaj |
| A4 | The migration scripts are committed. Today they are untracked files in `backend/scripts/legacy-migration/` and `backend/prisma/ddl/`. | Dev |
| A5 | Done 17 Nov: the two helper scripts of the staging run are in the repository. `6-run-tables.mjs` runs the tables (dry run → apply → check, stops on the first failure, resumes where it stopped; `--only "<table>"` for the pilot). `3c-check-batch.mjs` is the read-only check of one batch. Both take `--env` and `--expect-db`; the runner also refuses production without `--allow-production` and refuses an env/database pair that does not belong together. Tested on staging read-only: the check passes on the pilot batch, and the runner recognises all 28 tables as done. | Dev |
| A6 | The work folder `E:\Recruitment Process Automation\Phase 4\MS-Access\_migration-work\` is unchanged since staging. Do **not** re-run the extract or the transform: production must load exactly what staging loaded. Fingerprints (SHA-256, first 16 characters) on 17 Nov: `manifest.json` `4A0A4FC3068597B6`, `transform/candidates.jsonl` `E57E4AFBEBE5B781`, `transform/rows.jsonl` `0735F581ED241570`. | Dev |
| A7 | A production database backup taken on the day, before step B1. | Pankaj / DBA |
| A8 | The developer machine can reach `20.244.34.176:5432`, will not sleep, and stays on for about five hours. | Dev |

#### B. Production day, in this order

| # | Step | Command (run in `backend/`) | Exit check |
|---|---|---|---|
| B1 | Provenance table: dry run, then real | `node scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd --file prisma/ddl/2026-11-17-legacy-import-rows.sql --dry-run`, then without `--dry-run` | 5 statements, COMMITTED |
| B2 | Legacy label columns: dry run, then real | the same with `prisma/ddl/2026-11-17-legacy-source-label.sql` | COMMITTED. It must come **before** the backend build that knows the columns (the DDL file says why). |
| B3 | `npx prisma generate`, then deploy the backend and frontend build with the label, if it is part of this release | per the deployment plan | ATS up; Search Candidate works |
| B4 | Pilot dry run only, to read the figures | `node scripts/legacy-migration/3-load.mjs --work <work folder> --table "Build & Release" --env production --expect-db recruitmentautomationdbProd --allow-production` | Counts reconcile. Read the "matched existing" figure (see C1). |
| B5 | Pilot: dry run, apply and check | `node scripts/legacy-migration/6-run-tables.mjs --work <work folder> --env production --expect-db recruitmentautomationdbProd --allow-production --only "Build & Release"` | "Build & Release" OK: 84 rows, check passes |
| B6 | Pilot in the ATS | search two pilot candidates in the production ATS; open one profile | Fields as in Access; label shows |
| B7 | **Stop.** Pankaj confirms the pilot on production. | | Go-ahead for B8 |
| B8 | Remaining 27 tables, in `RUN_ORDER` | the same command without `--only` (it skips the pilot, already done) | Each table: dry run reconciles, apply equals the dry run, check passes. The runner stops on the first failure; run it again after fixing the cause. Progress and batch ids: `<work folder>/report/production-load-all.json`. |
| B9 | Missing search entries | `node scripts/legacy-migration/3b-retry-vectors.mjs --work <work folder> --env production --expect-db recruitmentautomationdbProd --allow-production` (dry run, then `--apply` if it finds any) | 0 missing |
| B10 | Production proof pack | `node scripts/legacy-migration/5-proof-pack.mjs --work <work folder> --env production --expect-db recruitmentautomationdbProd` (read-only) | Status COMPLETE; 8,843 rows recorded; 0 unaccounted |
| B11 | Chhaya signs the production pack; HR keeps it | | Signed |

#### C. What will differ from staging

1. **More matches with existing candidates.** Staging had 1. Production holds the real candidates HR has uploaded, so more Access people will already be there. They are updated by rule 3.9 (fill empty fields only, history appended) and get the label "Also in MS Access". The number of new candidates will be lower than 4,679 by the same amount; the total of people stays 4,680. Read the dry-run figure for each table before its apply; if it is far above what Pankaj expects, stop and ask.
2. **Created dates.** Imported candidates keep their Access date, so dashboards and lists sorted by created date on production will show about 4,700 older candidates the day after the run. HR should know this in advance.
3. **Live users.** The ATS stays up during the load. HR can keep working; the loader inserts one candidate at a time.
4. **Search entries cost.** Each new candidate with an email calls the Gemini embedding service once (about 4,650 calls on staging, roughly two to three seconds each).

#### D. Known issues from the staging run, and what to do

| Issue on staging | What to do on production |
|---|---|
| 4 search entries failed on a 5-second database timeout inside the ATS's vector function | The runner retries once with `3b-retry-vectors.mjs`; B9 catches anything left |
| One dry run ended with a Windows crash code before writing anything; it passed when run again | Run the runner again. It skips finished tables and repeats the dry run of the stopped one. If the apply step itself stops, check that table's batch with `3c-check-batch.mjs` first; the loader skips rows already recorded, so a second run finishes the table without doubling anything. |
| "Redis error … 127.0.0.1:6379" lines | Expected on the developer machine; ignore |
| The loader was changed by another session while it was running | Freeze `backend/scripts/legacy-migration/` for the whole production run |

#### E. If something goes wrong

- A table fails its check: the runner stops; later tables are not touched. Find the cause, then run the runner again.
- Undo one table: `node scripts/legacy-migration/4-rollback-batch.mjs --batch <batch id> --env production --expect-db recruitmentautomationdbProd --allow-production` (dry run, then `--apply`). Batch ids are in the runner's output and in `report/production-load-all.json`. Check one batch at any time, read-only: `node scripts/legacy-migration/3c-check-batch.mjs --work <work folder> --batch <batch id> --env production --expect-db recruitmentautomationdbProd`. It deletes the candidates the batch created (unless changed or used in the ATS since), restores fields it filled on existing candidates, and removes the label it set on matched ones.
- Undo everything: roll back each batch in reverse order, then the two DDL rollback files. The database backup from A7 is the last resort.

---

## 4. Stage 2: Excel files

Starts after Stage 1 is signed off. One file layout at a time, each with its own alias list, the same value rules, tag, duplicate rule and provenance table. Tag value: `legacy_excel_migration`.

### 4.1 What is there

22 spreadsheets, read for sheet names, headers and row counts only.

| Layout | Files | Rows | Where |
|---|---|---|---|
| A. AAPNA tracker (same headers as Access) | 4 | about 1,780 | `Year 2023_Excel Data` |
| B. Naukri Resdex download | 6, plus 2 small ones with a title row above the headers | about 3,880 | `Naukri Download Data 2023` |
| C. Naukri job-application export | 8 | about 450 | Inside `Naukri Good Profile Data Year 2024 - 2025\QA Manual & Automation Testing_4+ years` |
| D. Rakhi Ma'am cv.xlsx | 1 (2 sheets) | 136 | Root folder |
| Not candidate data | 1 | | `Karya Keeper Entry Sheet_HRD Jan 2025_Master Sheet.xlsx` is a staff timesheet. Skipped. |

Notes:

- Layout A files are `BDA.xlsx` (60 rows), `Year 2023_Decisions Developer.xlsx` (547), `Year 2023_Dot Net Developer.xlsx` (573), `QA Testing  2023.xlsx` (602). The Stage 1 alias list covers their headers as they stand. `QA Testing  2023.xlsx` has the same row count as the Access `QA` table and is probably the same data; the duplicate rule will absorb it.
- Layout C files are named Accountant and HR-Intern but sit in a QA folder. The role comes from the file's `Job Title` column, not from the folder.
- Layout D: the sheet `Exp & Fresher` is already in Access as the `Rakhi Ma'am cv` table. The sheet `Intern Profile` (13 rows) is not, and is imported here.

### 4.2 Preliminary mapping, to be confirmed file by file

**Layout B, Naukri Resdex** (sheet `Candidate Details`; the `Candidate insights` sheet is ignored):

| Source header | `rpa_cv` column |
|---|---|
| Candidate Name | `Name` |
| Contact No. | `ContactNumber` |
| Email | `EmailID` |
| Work Exp | `TotalExperienceYears` |
| Annual Salary | `CTC_LPA` |
| Current Location | `CurrentLocation` |
| Current Employer | `CurrentCompany` |
| Designation | `PositionApplied`; if blank, the role in the file name |
| Resume Title | `Top5KeySkills` (Naukri has no skills column in this layout) |
| U.G. / P.G. / Post P.G. Course | `HighestQualification` (highest present), `graduationdegree`, `postgraduationdegree` |
| Comment 1–5 | `HRQuickcomments`, joined |
| Last Active Date | `createdAt` (to confirm) |
| fixed value | `JobSource` = "Naukri" |
| Preferred Location, Age/Date of Birth, Postal Address, Resume ID | Not mapped. Kept in the provenance raw row. |

**Layout C, Naukri job-application export** (sheet `MySheet`, 70+ columns):

| Source header | `rpa_cv` column |
|---|---|
| Name, Email ID, Phone Number | `Name`, `EmailID`, `ContactNumber` |
| Job Title (or Role) | `PositionApplied` |
| Date of application | `createdAt` |
| Current Location | `CurrentLocation` |
| Total Experience | `TotalExperienceYears` |
| Curr. Company name | `CurrentCompany` |
| Key Skills | `Top5KeySkills` |
| Annual Salary, or the answer to the current-CTC question | `CTC_LPA` |
| Answer to the expected-CTC question | `ExpectedCTC_LPA` |
| Notice period / Availability to join, or the notice-period answer | `NoticePeriod` |
| Answer to the English-rating question | `EnglishCommunicationRating` |
| Answer to the shift question | `PreferredShift` |
| Under Graduation degree, UG Specialization | `graduationdegree`, `graduationspecialization` |
| Post graduation degree, PG specialization | `postgraduationdegree`, `postgraduationspecialization` |
| Gender | `Gender` |
| Latest Pipeline Stage | `FinalStatus` |
| Comment 1–5 | `HRQuickcomments`, joined |
| Source | `JobSource`, default "Naukri" |
| Marital status, address, pin code, date of birth, view/download/email activity columns | Not mapped. Kept in the provenance raw row. |

The screening-question columns differ per job posting, so they are matched by keyword in the question text, and each new file's questions are listed in its dry-run report before loading.

### 4.3 Method for every Excel file

1. Read headers and row counts. Classify the layout. A header set never seen before stops the run for that file until a mapping is agreed.
2. Dry-run report: mapped columns, unmapped columns that hold data, warnings, duplicates against the ATS.
3. Review, then load. Insert when the candidate is new; otherwise update the existing record by the rule in 3.9.
4. Reconcile and record in the provenance table.
5. Proof pack for the file, as in 3.13.

---

## 5. Stage 3: resume files (PDF, DOCX)

About 5,240 resumes: 3,446 PDF, 1,371 DOCX, 419 DOC, plus a few RTF, JPG and PPTX.

### 5.1 What the existing HR Upload does with a file

Read from `backend/src/services/hrUpload.service.js` and its routes. For every uploaded file it:

1. Accepts `.pdf`, `.docx`, `.zip`, `.xlsx` only. `.doc` is not accepted.
2. Extracts the text and sends it to the LLM parser, which returns the candidate fields.
3. Uploads the file to OneDrive and stores the link.
4. Checks for a duplicate by email or phone. A duplicate goes to the HR review queue (`rpa_cv_tmp`) and a duplicate-alert email is sent.
5. Inserts a new candidate into `rpa_cv`, including the full resume text.
6. Creates the search vector and AI profile insights.
7. **Sends the candidate a welcome email, and a missing-data email if anything is missing.**
8. Writes rows for the Upload Status dashboard.

Steps 4 and 7 are the problem. Pushing 5,240 legacy resumes through the HR Upload screen or its API would email every one of those candidates at once and fill the review queue, against R9 and R7. No setting that turns those emails off was found in the code searched.

### 5.2 Options

| Option | How | HR Upload file edited? | Emails | Duplicates | Verdict |
|---|---|---|---|---|---|
| A. Separate migration runner that reuses HR Upload's building blocks | A new script calls the existing exported functions as they are: `extractTextFromFile()`, `parseResumeWithOpenRouter()`, the duplicate matcher, `saveCandidateVector()`, the OneDrive upload. It writes the same `rpa_cv` columns HR Upload writes for a new candidate. | No | None | Insert if new, otherwise update by the rule in 3.9; recorded in provenance | Chosen by Pankaj, 16 Nov |
| B. Send the files through the real HR Upload endpoint | Batches of up to 100 files posted to `/upload` | No | Welcome and missing-data mail to every candidate; duplicate alerts to staff | Go to the HR review queue | Not acceptable as it stands |

With option A the resume is read, parsed and stored exactly as HR Upload does it, because the same functions do the work. The one thing that is copied, not shared, is the list of `rpa_cv` fields written at insert. A parity check guards that: the same 10 synthetic resumes are run through HR Upload on local and through the runner, and the two sets of `rpa_cv` rows must match field for field, apart from the tag and the email-related fields.

### 5.3 Details for Stage 3

- **Role from the folder name** (R5): for example `Year 2023_Dot Net Profiles` gives Dot Net Developer; `Flutter 5+ yrs` gives Flutter Developer. Used when the parser returns no role.
- **`.doc` files (419):** HR Upload cannot read them, so neither can its extractor. They are converted to `.docx` in a working copy first; the originals are not changed. RTF, JPG and PPTX files (about 12) are listed for manual handling.
- **Tag:** `last_action_context = 'legacy_resume_migration'`, plus the provenance row with the file path.
- **Minimum fields:** a resume with no email and no phone is not imported, the same as HR Upload.
- **Cost:** one LLM parse, one embedding, one insights call and one OneDrive upload per resume. To be sized on a 50-file sample before the full run.
- **Batches:** by folder, oldest year first, with a per-day cap.

---

## 6. Not part of this plan

Removed on Pankaj's instruction of 16 Nov, because this is a one-time import: the Access-format export for HR, and any UI change. The meeting with Rakhi ma'am about keeping Access in parallel, and the later outreach emails to migrated candidates, are separate topics and do not block the import.

---

## 7. Decisions

Decided by Pankaj on 16 Nov:

| # | Topic | Decision |
|---|---|---|
| 1 | Snapshot tables (3.3) | Consolidate rows for the same person inside the Access file. |
| 4 | `createdAt` | The original Access date. |
| 5 | Stage 3 resume route | Separate script that reuses HR Upload's functions. HR Upload is not edited. |
| 6 | Rows with no email and no phone | Not imported. Listed in a file for HR. |
| 8 | Reading staging before the load | Not needed. The load itself inserts or updates. |
| 2 | Columns with no heading but with data (3.6) | Mapped as listed in 3.6. The four UI UX Yes/No columns are not imported. |
| 3 | Log table `rpa_legacy_import_rows` (3.8) | Approved. One new table, no screen. |
| 7 | Search vectors (3.10) | The import creates the search entry for each inserted candidate. |
| 9 | What "update" means for a candidate already in the ATS (3.9) | Fill empty fields; leave filled fields alone; append Access HR comments and round notes under a "Legacy (MS Access)" label; add extra emails and phones to the list. |
| | Scope | One-time import only. No export, no UI. |

Decided by Pankaj on 17 Nov:

| # | Topic | Decision |
|---|---|---|
| 10 | `DotNet 22 April`, names one row out of place | Repair (section 9, finding 1). |
| 11 | `Dot Net  March 2024`, 32 shifted rows | Not imported; they stay on the HR list. |
| 12 | Different values for the same person in two tables | The rule stays: the base row keeps its value. |
| 13 | Proof for management (R6) | A proof pack per source file, generated from the provenance table after the load (3.13). No separate screen for migrated data. |
| 14 | Seeing legacy candidates on screen | A label and filter on the existing Search Candidate, as a separate task outside this plan (`SCOPE-Legacy-Source-Label-and-Filter.md`). Not yet approved for build. |

No doubt is open on the Access stage. The questions in section 8 are for Chhaya; none of them blocks the pilot table.

## 8. Questions for Chhaya

| # | Question |
|---|---|
| Q1 | In the Experience columns, does `3.6` mean 3 years 6 months or 3.6 years? The ATS currently reads it as 3.6. |
| Q2 | Is the default role and skills list in 3.5 correct? What should "Others" get? |
| Q3 | Are "joined and left" candidates to be excluded from outreach, like Joined? |
| Q4 | Several round-note columns are cut at 255 characters inside the Access file (3.2, point 7). Do the original sheets with the full text still exist? |
| Q5 | What were the questions on the UI UX Designer form (the Yes/No columns)? |

## 9. Handover notes for a new session

This file is the single record of the migration work. Nothing is kept anywhere else. A new session should read this file first and continue from "Next step" below.

**Status on 2026-11-17** (this replaces the 16 Nov status below where they differ)

Pankaj gave the go-ahead on 17 Nov: run Stage 1 (MS Access) only, everything on the staging database (`recruitmentautomationdb`), production only after staging is signed off. There is no separate local database: `backend/.env`, `.env.development` and `.env.staging` all point at staging.

| Step (3.12) | State |
|---|---|
| 2. Extract | Done. 28 tables, 8,843 rows, every count equal to Access. |
| 3. Transform and dry-run report | Done. No database used. 4,680 unique candidates from 5,879 usable rows. |
| 4. Provenance table on staging | Done 17 Nov. `rpa_legacy_import_rows` created on `recruitmentautomationdb` (dry run first, then committed, 5 statements). |
| 5. Pilot on staging | Done 17 Nov. `Build & Release`, batch `e18befba-76f2-439c-ba4c-14f85978c494`: 84 rows, 79 candidates inserted, 5 rows merged in file, 0 matched an existing candidate. |
| 6. Remaining tables on staging | Done 17 Nov, on Pankaj's go-ahead. All 28 tables loaded, one table per run, each with dry run, apply and read-only check. Totals: 8,843 rows recorded = Access total; 4,679 candidates created; 1 existing ATS candidate matched (so 4,680 people, as the dry run said); 4,657 search entries (the other 22 candidates have no email); 77 rows not imported; 0 rows unaccounted for. |
| 6a. Proof pack, staging | Done 17 Nov: `proof-pack-ms-access-staging-20261117-1001.xlsx` in the work folder's `report/`, status COMPLETE. Spot-check: 140 candidates, 2,280 values; every difference is explained by a value rule or the name repair. |
| 7–8 | Not started: review with Chhaya on staging, then production with Pankaj's explicit approval. |

Events during the staging load: (1) `Dot Net` and `QA`: 4 search entries failed on a database timeout inside the ATS's vector function and were created by the new `3b-retry-vectors.mjs`. (2) One dry run (`Sales Leader`) ended with a Windows crash code before writing anything; it passed when run again. (3) During the run, another session built the legacy label (`SCOPE-Legacy-Source-Label-and-Filter.md`) and changed `3-load.mjs` and `4-rollback-batch.mjs`; Pankaj applied its DDL on staging, and the last four tables were loaded with the changed loader. All 4,680 imported or matched candidates carry `legacy_source = 'ms_access'`.

The database server `20.244.34.176:5432` was unreachable from the developer machine on the morning of 17 Nov and reachable later the same day.

Pilot checks (read-only, after the load):

- 84 provenance rows (79 `inserted`, 5 `merged_in_file`), all pointing at 79 distinct candidates.
- All 79 candidates compared with the transform output on the 33 mapped columns and on the created date: no difference.
- All 79 carry `last_action_context = 'ms_access_migration'`, have `MetaData`, and have one search vector with an embedding.
- No row for these candidates or their addresses in `rpa_email_messages`, `rpa_email_log` or `rpa_email_notifications`.
- A second dry run reports 84 rows already done and nothing to insert.
- Staging totals after the pilot: 297 rows in `rpa_cv`, 79 of them tagged.
- Not checked yet: searching for a pilot candidate in the staging ATS screens. This is for Pankaj.

Note: the loader prints "Redis error … 127.0.0.1:6379" lines on the developer machine. `hrUpload.service.js` loads a Redis client when it is imported and no Redis runs locally. The functions the loader uses do not use Redis; the lines can be ignored.

Decisions by Pankaj on 17 Nov on findings 1–3 below:

1. `DotNet 22 April`: **repair** the names. Done in `lib/mapping.mjs` (`NAME_ROW_REPAIR`) and `2-transform.mjs`; details under finding 1.
2. `Dot Net  March 2024`: the 32 shifted rows **stay on the HR list** and are not imported. No change to the code.
3. Different values for the same person: **the rule stays as approved** (the base row keeps its value). No change to the code.

Code written (new files only, nothing under `backend/src` edited):

- `backend/scripts/legacy-migration/1-extract-access.ps1`, `2-transform.mjs`, `3-load.mjs`, `4-rollback-batch.mjs`, `lib/mapping.mjs`, `lib/rules.mjs`, `lib/missing-fields.mjs` (a copy of `getMissingFields()`, which `hrUpload.service.js` does not export).
- `backend/prisma/ddl/2026-11-17-legacy-import-rows.sql` and `.rollback.sql`. The table has no model in `schema.prisma`; the scripts use raw SQL.
- Work folder with the extracted data and reports, outside the repository: `E:\Recruitment Process Automation\Phase 4\MS-Access\_migration-work\` (`raw/`, `transform/`, `report/dry-run-report.md`, `report/no-contact-details.xlsx`, `report/review-merged-names.xlsx`).

Findings from the dry run that the plan did not know. The first three need Pankaj's decision before the affected tables are loaded; none affects the pilot table.

1. **`DotNet 22 April`: the Name column is one row out of place** over a continuous block of about 230 rows (roughly physical rows 220–474). In that block the name on a row belongs to the person on the next row; every other column is on the right row. Evidence: a row's name agrees with its own email in 48% of rows in this table, against 83–100% in every other table; for 241 people who are also in another Dot Net table, the name one row up matches in 199 cases and the name on the same row in 32. Loading it as it stands would put wrong names on real contact details. It is also why 207 consolidated candidates show completely different names.
   **Repair as built (17 Nov).** A closer look showed four separate runs of rows, not one block. Row numbers are positions in the table (`r1` is the first row):
   - Name taken from the Name cell of the row above: `r141`–`r144`, `r226`–`r316`, `r330`–`r338`, `r361`–`r475` (219 rows with data; warning `name_from_row_above`). Rows between the runs are correct and are not touched.
   - Name left empty: `r140`, `r329`, `r360`. Each is the row just before a run; its Name cell holds the next person's name, so its own name is not known (warning `name_unknown_row_before_repair`).
   - Kept as in Access and listed for HR: `r145`, `r225`, `r328`, at the edge of a run with no evidence either way (warning `name_review_edge_of_repair`).
   - These six edge rows are on the sheet "Name repair, edge rows" in `review-merged-names.xlsx`. The original cell stays in `raw_row`.
   - Effect: consolidated candidates whose rows carry different names fell from 239 to 48. Only 22 candidates get a different name from the repair, because most of these people take their name from an earlier Dot Net table. Candidate count (4,680) and the pilot output are unchanged.
   - The transform stops if the table does not have exactly 992 rows, so the rule cannot run on another copy of the table.
2. **`Dot Net  March 2024`: 32 rows have their cells one or more columns to the right** (the phone number sits in the email column, the tech score in the status column). All 30 rows with data in `Field23`–`Field26` are among these 32, so the 16 Nov reading of those columns as extra feedback was wrong: it is overflow from the shift. As coded, these 32 rows are not imported and go to the "no contact details" list; 24 of them have an email somewhere in the row and 8 of those people exist in another table.
3. **Different values for the same person in two tables.** The base row keeps its value (3.3), so the other value is dropped: `HRQuickcomments` on 274 candidates, `TechRoundTwo` on 185, `FinalStatus` on 64. Snapshot copies of one sheet carry the same date, so "earliest date" does not pick between them; the code then takes the most complete row.
4. 13 tables have no `ID` column. Their rows are numbered by position (`r1`, `r2`, …) in the provenance record.
5. Three unnamed columns with data are not in the plan: `UI UX Designer.Field38` (32 rows, Yes/No, a fifth form question), `DotNet 22 April.Field24` (1 row, one word), `Hyper Automation Clean Sheet.Field136` (1 row, one stray character). They are kept in `raw_row` only.
6. Counts against 3.1: 77 rows are not imported for lack of contact details, not 43 (16 with a name and no contact cell, 36 with a contact cell that is not a valid email or phone, 25 with one or two stray cells and no name). Blank rows are 2,887; the plan's 2,912 included those 25.
7. Phone rule: only valid 10-digit numbers are kept (V2). 16 rows in `BD Manager - Middle East` lose part of a phone cell, most likely foreign numbers.
8. For a candidate already in the ATS, the loader leaves `last_action_context` and `last_action_by` as they are; the tag is set on inserted candidates only. The provenance row records the match either way.

**Next step (from 17 Nov)**

1. Done on 17 Nov: all 28 tables on staging, staging proof pack generated.
2. Chhaya reviews staging with the pack's spot-check sheet and signs it.
3. Production: follow the runbook in 3.14, starting with its preparation list (A1–A8). Nothing runs on production without Pankaj's explicit go-ahead.

Batch ids of the staging run are in `<work folder>/report/staging-load-all.json` and `report/load-*.json`. The rollback script has not been run on staging.

**Status on 2026-11-16**

- Plan v3.2 is complete for Stage 1 (MS Access). All doubts are decided (section 7).
- No code has been written. No table has been created. No data has been imported. No database has been touched.
- Stage 2 (Excel) has an inventory and a preliminary mapping only (section 4). Stage 3 (resumes) has a chosen route only (section 5).

**Working rules set by Pankaj**

- This is a one-time import and column mapping into `rpa_cv`. The scripts run once and are not reused. No UI work, no export feature, no reusable admin tooling.
- The existing HR Upload module must not be modified. Nothing under `backend/src` is edited. New code goes in `backend/scripts/legacy-migration/` and only imports existing functions.
- Order of work: MS Access first, then Excel one layout at a time, then resumes.
- When a mapping is in doubt, ask Pankaj before deciding. Explain in plain words with an example from the data.
- Do not code until Pankaj says to start.
- No email is sent by any import script. Applicant personal data is not printed in logs, reports or chat.

**Next step**

1. Pankaj gives the go-ahead to start coding.
2. Write the DDL and rollback for `rpa_legacy_import_rows` under `backend/prisma/ddl/` (3.8) and apply it to the local database only.
3. Write the Stage 1 script for the pilot table, Build & Release, following the steps in 3.12: extract, transform, dry-run report, then load on local.
4. Pankaj reviews the dry-run report before any load on staging. Staging and production loads each need his explicit approval.
5. Send the section 8 questions to Chhaya. Q1 (the meaning of `3.6` in Experience) affects every table.

**Practical notes for reading the sources**

- The Access file opens read-only from Windows PowerShell 5.1 with the `Microsoft.ACE.OLEDB.16.0` provider. The same provider reads the `.xlsx` files (`Excel 12.0 Xml;HDR=YES;IMEX=1`).
- Two Access tables report 255 columns. Query them in chunks of 40 columns, otherwise the query fails.
- `Hyper Automation Clean Sheet` has no column headings: its headings are in the row with ID 1 (3.6).
- The E: drive is slow. File searches over the whole repository or the OneDrive folder time out; use PowerShell with a long timeout, or search one file or folder at a time.
- The read-only profiling scripts used for this plan are kept in `docs/Phase 4/profiling-scripts/`. Their outputs are not kept, because they contain candidate data; write any new output outside the repository. Run them with Windows PowerShell 5.1, in this order:

| Script | Parameters | What it gives |
|---|---|---|
| `access-schema.ps1` | `-Db <path to .accdb> -Out <schema.csv>` | Tables, columns, types, row counts and fill counts. No cell values. |
| `access-profile.ps1` | `-Db <path to .accdb> -Schema <schema.csv>` | Value shapes per column (top values for category columns, shapes only for personal data). |
| `access-deep.ps1` | `-Db <path to .accdb> -Schema <schema.csv>` | Date ranges, email overlap between tables, status values, content of unnamed columns. Prints to the console; redirect to a file. |
| `excel-inventory.ps1` | `-Root <path to OneDrive_1_11-13-2026>` | Every spreadsheet, its sheets, headers and row counts. |

**Existing code this plan relies on (read only, not to be edited)**

| File | What is used |
|---|---|
| `backend/prisma/schema.prisma` | `rpa_cv`, `rpa_cv_vectors`, `rpa_cv_tmp` models |
| `backend/src/services/hrUpload.service.js` | `sanitizeMatchEmails`, `sanitizeMatchContacts`, `findExistingCandidateMatch`, `extractTextFromFile`, `parseResumeWithOpenRouter` |
| `backend/src/utils/candidateParser.js` | `parseExperienceNumeric`, `parseExpectedCTCNumeric`, `parseNoticePeriodDays` |
| `backend/src/services/vectorStore.service.js` | `saveCandidateVector(candidateId, parsedData)` |
