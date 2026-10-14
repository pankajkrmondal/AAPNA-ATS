# Implementation plan: Phase 4 (C2C Vendor, MS Access, Other Phase 4 items (P01–P11))

**Date:** 7 Oct 2026 · **Scope:** the "Phase 4 - Updated" sheet of `ATS App - Phase wise Task Items.xlsx`
**Companion files:**
- [PLAN-Phase3-Now.md](PLAN-Phase3-Now.md): conventions (DDL, tests, settings, cron, changelogs, email safety)
- [PLAN-Phase3-in-Phase4.md](PLAN-Phase3-in-Phase4.md)
- [Phase-3-Feedback-Triage-Notes.md](Phase-3-Feedback-Triage-Notes.md)

All paths are relative to `AAPNA-ATS/`. Line numbers were checked on `harish-project-staging-v25` (head `3365d5b`).

---

## 1. Context and scope

This is the Phase 4 scope:
- **C2C vendor flow.** On hold. Sanghamitra asked to wait until the core has run stable for 1-2 months.
- **MS Access backup / export.**
- **Other Phase 4 items (P01–P11).** Eleven smaller items. Some come from the CEO and RT (Responded status & source marker through SMS / WhatsApp reminders (P01–P04)); the rest are ours.

The plan assumes the Do Now items are in place:
- **Filter utility (N01):** filter utility
- **JD tagging - data model (N13):** `rpa_candidate_mrf_tags`
- **JD attached to emails (N17):** email attachments
- **Candidate phone & interview reminders (N22):** phone capture
- **Analytics - Positions tab (N39):** positions analytics

| Group | Rows / items | Hours |
|---|---|---|
| C2C Vendor (on hold) | 40 tasks in 9 work packages | 83 |
| MS Access (R&D / export) | 4 tasks | 10 |
| Other Phase 4 items | Other Phase 4 items (P01–P11) | 222 |
| **Total** | | **315** |

## 2. Build order (easy items first)

1. **Captcha on public MRF form (P08)**, 4 h
2. **Zeko 90-day re-interview check (P09)**, 6 h
3. **MS Access backup**: scheduled export, scheduling and verification (M2–M4), 7 h. The **MS Access feasibility (M1)** write-up (3 h) follows when Chhaya's table format arrives.
4. **Admin Config UI polish (P10)**, 12 h
5. **Hiring-manager status email (P02)**, 16 h
6. **Reminder settings in one place (P06)**, 20 h
7. **Website candidates report (P07)**, 20 h. Introduces the `rpa_cv.intake_source` field; needs JD attached to emails (N17) from Do Now.
8. **Prompt configuration (P05)**, 20 h
9. **Excel scores to round scorecards (P11)**, 20 h
10. **SMS / WhatsApp reminders (P04)**, 24 h. Needs a provider decision first.
11. **Responded status & source marker (P01)**, 32 h. Reuses `intake_source` from the Website candidates report (P07).
12. **Hiring-manager read-only role (P03)**, 48 h. Comes after the Hiring-manager status email (P02).
13. **C2C (on hold)**: when Sanghamitra lifts the hold, all nine C2C work packages in order, from C2C database schema (C1) to C2C documentation (C9).

---

## 3. C2C Vendor (on hold)

### 3.1 Corrections to `docs/reference/c2c_vendor_plan.md`

The original plan's design still stands:
- a separate `rpa_cv_c2c` table and a `rpa_cv_c2c_tmp` review table
- one shared parsing engine, `runBatchParsing`, with a `SOURCE_PROFILE`
- personal details matched in memory and never stored
- an `already_in_main_pool` flag, never an automatic merge
- no 90-day lock
- vendor-only notifications
- screening on three axes

Some of its code facts are now out of date. **Use these corrections when building:**

| The old plan says | Current code | Use instead |
|---|---|---|
| `rpa_candidates_all` view selects `source_mrf_id` from `rpa_cv` | `rpa_cv` has **no** `source_mrf_id`, so the view DDL would fail | Keep `source_mrf_id` on `rpa_cv_c2c` only. The `rpa_cv` side of the UNION selects `NULL::int AS source_mrf_id`. JD links for main-pool candidates come from `rpa_candidate_mrf_tags` (JD tagging - data model (N13)) |
| MRFs live in `rpa_mrf_jd_send` | MRFs are `rpa_mrf` (`backend/prisma/schema.prisma:168`); `rpa_mrf_jd_send` is the older Send-JD form | Share JD is `POST /api/mrf/:id/share-jd` on `rpa_mrf.id` |
| `generateMrfEmailTable` is in `emailNotification.service.js` | It's a non-exported const in `backend/src/controllers/mrf.controller.js:470` | Move it to `backend/src/services/mrfEmail.helpers.js` and export it. `mrf.controller.js` imports it back |
| The lock is stamped with `addDaysIso(90)` | `vendorLockExpiry()` / `lockForNinetyDays` (`backend/src/services/hrUpload.service.js` ~648; `backend/src/utils/vendorLock.js`) | `applyLock:false` skips `vendorLockExpiry()` |
| `hrUpload.service.js` is 1724 lines; `screening.service.js` is 2266 lines | 1851 and 3220 lines | `runBatchParsing` :1042; duplicate routing ~1262-1287; identifier check ~1230; new-candidate create :1526 |

### 3.2 Work packages

Every work package below uses the same item template as the rest of this plan. Each package's task table lists the workbook rows it covers. Task text is shortened; the full row text is in the workbook.

#### C1 · Database schema (rows 3-8)
**High · 8 h**

| Row | Task | h | Notes |
|---|---|---|---|
| 3 | ALTER `rpa_users`: `vendor_type`, `contact_number`, `vendor_skills` | 1 | NULL `vendor_type` = placement, so existing vendors are unchanged |
| 4 | CREATE `rpa_cv_c2c` (no email/phone unique keys, no lock column) + indexes | 2 | Columns mirror the `rpa_cv` scoring fields, plus `vendor_email`, `source_mrf_id`, `upload_execution_id` |
| 5 | CREATE `rpa_cv_c2c_tmp` (LIKE `rpa_cv_c2c`) + `reviewStatus`, `source`, `already_in_main_pool` | 2 | |
| 6 | ALTER `rpa_upload_jobs`: `vendor_type` | 1 | |
| 7 | CREATE VIEW `rpa_candidates_all` (UNION of `rpa_cv` + `rpa_cv_c2c`) | 1 | Uses the corrected `source_mrf_id` handling above, plus a `candidate_type` column |
| 8 | `prisma db pull` + `generate` + review | 1 | Stop the server and worker first |

**Goal.** C2C candidates live apart from the main pool and never store personal details. Shared tracking reads one view.

**Current behaviour.** None of these objects exist. Code search finds no `vendor_type`, `rpa_cv_c2c` or `share-jd`.

**Design**
- One DDL file, `backend/prisma/ddl/2027-xx-xx-c2c-vendor.sql`, plus a rollback.
- Idempotent, ASCII only, `COMMENT ON` every object.
- `rpa_cv_c2c` has **no** `EmailID` / `ContactNumber` columns.

**Files:** DDL + rollback; `backend/prisma/schema.prisma` (via pull).

**Reuse:** the DDL conventions in [PLAN-Phase3-Now.md](PLAN-Phase3-Now.md) §3; `backend/scripts/run-ddl.mjs`.

**Tests:** row 32 (verify DDL), run via `--dry-run` first.

**Risks & rollout:** additive only.

**Depends on:** JD tagging - data model (N13; for the view's JD-link strategy). **Blocks:** C2C vendor registration through C2C documentation (C2–C9).

**Open decisions:** none.

#### C2 · Vendor registration (rows 9-10)
**Medium · 4 h**

| Row | Task | h |
|---|---|---|
| 9 | `backend/src/controllers/admin.controller.js` `createUser` / `updateUser` (:213-311) accept `vendor_type`, `contact_number`, `vendor_skills` when role is vendor | 2 |
| 10 | `frontend/src/pages/AdminDashboard.jsx`: Vendor Type select, Contact Number and Skills fields, shown only for the Vendor role | 2 |

**Goal.** Admins can register a C2C vendor.

**Current behaviour.** `createUser` takes the role and modules only. `DEFAULT_MODULES_BY_ROLE.vendor` = `vendor_dashboard` + `vendor_upload` (`admin.controller.js:38-56`).

**Design**
- Validate `vendor_type ∈ {placement, c2c_vendor}`.
- Login returns `vendor_type` in `user` (`backend/src/controllers/auth.controller.js:62-71`) so the frontend can route on it.

**Files:** `admin.controller.js`, `auth.controller.js`, `AdminDashboard.jsx`.

**Reuse:** the existing role field handling.

**Tests:** row 33 (verify registration, and that existing vendors still resolve as placement).

**Risks & rollout:** none.

**Depends on:** C2C database schema (C1). **Blocks:** C2C upload, dedup & persistence (C4), C2C portal (C7).

**Open decisions:** none.

#### C3 · Share JD (rows 11-13)
**Medium · 8 h**

| Row | Task | h |
|---|---|---|
| 11 | `POST /api/mrf/:id/share-jd` (`vendorEmails[]`, `c2c_rate`, `contract_duration`) | 3 |
| 12 | `sendVendorJDEmail`: reuse `generateMrfEmailTable` and append Duration / Rate blocks | 2 |
| 13 | MRF detail view: Share JD button + modal (multi-select vendors, optional Duration / Rate) | 3 |

**Goal**
- Recruiters share an open MRF's JD with selected vendors.
- Rate and duration are required for C2C vendors and optional for placement vendors.

**Current behaviour**
- No share path exists.
- `generateMrfEmailTable` is private (`mrf.controller.js:470`); see the corrections table.

**Design**
- Move `generateMrfEmailTable` to `backend/src/services/mrfEmail.helpers.js`.
- New table `rpa_mrf_vendor_shares` (`mrf_id`, `vendor_email`, `c2c_rate`, `contract_duration`, `shared_by`, `shared_at`) for history and vendor scoping. **Add it to the C2C database schema (C1) DDL.**
- The email attaches the JD using the JD attached to emails (N17) attachment support (`getMrfJdAttachment`).
- A portal notification is shown on the vendor dashboard.
- Vendors only see MRFs shared with them, which also feeds the JD tagging - uploads (N14) vendor JD picker.

**Files**
- `mrf.controller.js`
- the new helper module
- `backend/src/services/emailNotification.service.js`
- `backend/src/routes/mrf.routes.js`
- `frontend/src/pages/MRF.jsx` (or the MRF detail component)
- `frontend/src/services/mrfService.js`

**Reuse:** `generateMrfEmailTable`, JD attached to emails (N17) `jdAttachment.service.js`, `sendGraphEmail`.

**Tests:** row 34 (email + portal notification reach the vendors; the Rate / Duration blocks render).

**Risks & rollout:** none.

**Depends on:** C2C database schema (C1), C2C vendor registration (C2), JD attached to emails (N17). **Blocks:** C2C portal (C7).

**Open decisions:** none.

#### C4 · Upload, dedup and persistence (rows 14-19)
**Medium · 14 h**

| Row | Task | h | Notes |
|---|---|---|---|
| 14 | `hrUpload.service.js`: `SOURCE_PROFILE` object + `c2c_vendor` branch at the dedup/insert site | 4 | Shared engine, not a fork of `runBatchParsing` (:1042) |
| 15 | Dedup key: name + in-memory personal details vs `rpa_cv_c2c`; secondary cross-check vs `rpa_cv` | 3 | Sets `already_in_main_pool`; never merges or rejects automatically |
| 16 | Persistence: no EmailID / ContactNumber in the `rpa_cv_c2c` insert (`persistPII:false`) | 2 | |
| 17 | Lock-skip: no 90-day lock for C2C (`applyLock:false`) | 1 | Skips `vendorLockExpiry()` |
| 18 | Notify: vendor-only alert; no candidate welcome or missing-data emails | 2 | NDA |
| 19 | `backend/src/controllers/vendor.controller.js` `uploadResumes` (:204): route on `req.user.vendor_type` | 2 | |

**Goal.** C2C uploads run through the shared engine with C2C rules. No personal details are stored, no lock is applied, and no candidate is contacted.

**Current behaviour**
- `runBatchParsing(executionId, files, user, source, attribution)` (:1042).
- Duplicate routing to `rpa_cv_tmp` (~1262-1288).
- Create (:1526).
- Post-processing (`runPostProcessing` :1796) sends the candidate welcome / missing-data emails.

**Design**
- `SOURCE_PROFILE = { hr_manual_upload: {...}, vendor_portal: {...}, email_intake: {...}, c2c_vendor: { table:'rpa_cv_c2c', tmpTable:'rpa_cv_c2c_tmp', persistPII:false, applyLock:false, notifyCandidate:false, crossCheckMainPool:true } }`.
- The branch points read the profile (insert target, dedup query, lock, notify). The default profiles reproduce today's behaviour exactly.

**Files:** `hrUpload.service.js`, `vendor.controller.js`, `backend/src/workers/resumeWorker.js`.

**Reuse:** `sanitizeMatchEmails` / `sanitizeMatchContacts` (`hrUpload.service.js` ~67-72), `isVendorLockActive`, `jobsModelReady`.

**Tests**
- Rows 35, 36, 39 (C2C routing; dedup and main-pool flag; zero candidate emails).
- **Row 41 (full placement regression) is mandatory before merge:** `vendorIsolation`, `vendorNotification`, `vendorNotification.integration`, `csvExport`.

**Risks & rollout:** this touches the core upload engine. Profile defaults must be byte-for-byte equivalent for existing sources.

**Depends on:** C2C database schema (C1), C2C vendor registration (C2). **Blocks:** C2C review queue (C5), C2C screening (C6).

**Open decisions:** none.

#### C5 · Review queue (rows 20-24)
**Medium · 9 h**

| Row | Task | h |
|---|---|---|
| 20 | `c2cReview.controller.js`: `POST /c2c-review/merge` | 2 |
| 21 | `POST /c2c-review/reject` | 1 |
| 22 | `POST /c2c-review/accept-new`: a name collision is expected, not an error | 2 |
| 23 | Register the routes under a staff-only guard in `backend/src/routes/vendor.routes.js` | 1 |
| 24 | Review queue UI: tags (Name / Vendor / MRF) + `already_in_main_pool` warning chip; never change the raw Name | 3 |

**Goal.** Staff resolve C2C duplicates. Vendors never see the review queue.

**Current behaviour**
- The placement review exists: duplicate review search / merge / cancel (`vendor.routes.js:98-100`).
- `mergeDuplicates` (`hrUpload.service.js:545`).

**Design**
- New `backend/src/controllers/c2cReview.controller.js` with three handlers working on `rpa_cv_c2c_tmp` → `rpa_cv_c2c`.
- Guarded by `requireStaff` (`backend/src/middleware/auth.js:194`).
- UI: a new tab next to the existing duplicate review in `frontend/src/pages/VendorPortal.jsx` (staff view).

**Files:** new controller; `vendor.routes.js`; `VendorPortal.jsx`; `frontend/src/services/vendorService.js`.

**Reuse:** the `mergeDuplicates` patterns; `requireStaff`.

**Tests:** row 37 (accept-as-new: both exist independently, tags shown, Name unchanged); unit tests for the handlers.

**Risks & rollout:** none.

**Depends on:** C2C upload, dedup & persistence (C4). **Blocks:** C2C verification (C8).

**Open decisions:** none.

#### C6 · C2C screening (rows 25-27)
**Medium · 7 h**

| Row | Task | h |
|---|---|---|
| 25 | `screening.service.js`: `scoringProfile` parameter; C2C uses 3 axes (Skills / CTC / Notice), with education and stability set to zero | 3 |
| 26 | Gemini prompt scoped to the C2C axes only | 2 |
| 27 | `screening.controller.js`: `GET /api/screening/c2c/search` | 2 |

**Goal.** C2C candidates are searchable and scored on skills, rate/CTC and notice only.

**Current behaviour.** After Filter utility through JD - ranking (N01–N09), ranking uses `JD_RANK_WEIGHTS` (and Scoring weights & recency (L01) settings).

**Design**
- `scoringProfile: 'default' | 'c2c'`. The C2C weights are `{ coverage: 0.7, ctc: 0.15, notice: 0.15 }`.
- Search queries `rpa_cv_c2c`, using the Filter utility (N01) `buildFilterSql` with the C2C column set.
- Prompt variant in `generateProfileInsights` (`backend/src/services/screening.service.js:630`), which Prompt configuration (P05) later makes editable.

**Files:** `screening.service.js`, `backend/src/controllers/screening.controller.js`, `backend/src/routes/screening.routes.js`.

**Reuse:** Filter utility (N01), JD - skill gate through JD - ranking (N07–N09).

**Tests:** row 38 (C2C search scores only skills / CTC / notice).

**Risks & rollout:** none.

**Depends on:** C2C upload, dedup & persistence (C4), Filter utility through JD - ranking (N01–N09). **Blocks:** C2C verification (C8).

**Open decisions:** none.

#### C7 · C2C portal (rows 28-31)
**Medium · 10 h**

| Row | Task | h |
|---|---|---|
| 28 | `frontend/src/pages/C2CVendorPortal.jsx`: upload screen (no candidate email/phone fields) + NDA banner | 4 |
| 29 | `frontend/src/App.jsx`: render C2CVendorPortal on vendor login when `vendor_type=c2c_vendor` | 1 |
| 30 | `frontend/src/pages/VendorDashboard.jsx` C2C variant: hide email/phone columns; read the C2C endpoint | 3 |
| 31 | Shared tracking dashboard reads the `rpa_candidates_all` view with a `candidate_type` filter | 2 |

**Goal.** C2C vendors get their own portal and dashboard. Shared tracking shows both candidate types.

**Current behaviour**
- Placement portal: `VendorPortal.jsx` (887 lines).
- Dashboard: `VendorDashboard.jsx` (553 lines).
- Routes: `App.jsx:359-394` (`/vendor` behind `ModuleRoute`).

**Design**
- Reuse the upload components from `VendorPortal.jsx` and hide the personal-detail fields.
- Route on `user.vendor_type`.
- The tracking endpoint takes `candidate_type` and reads the view, so the controller needs no UNION.

**Files:** new page; `App.jsx`; `VendorDashboard.jsx`; the tracking controller (`vendor.controller.js` dashboard handler, :60-64 in routes).

**Reuse:** VendorPortal upload components; `enforceVendorScope` (`backend/src/utils/vendorScope.js`).

**Tests:** row 40 (a status update appears in the shared per-vendor dashboard); verify skill.

**Risks & rollout:** none.

**Depends on:** C2C vendor registration through C2C upload, dedup & persistence (C2–C4). **Blocks:** C2C verification (C8).

**Open decisions:** none.

#### C8 · Verification (rows 32-41)
**Medium · 22 h**

| Row | Check | h |
|---|---|---|
| 32 | DDL: no personal-detail or lock columns on C2C tables; the view returns both types | 2 |
| 33 | Registration persists; existing vendors resolve as placement | 1 |
| 34 | Share JD email + portal notification; Rate / Duration render | 2 |
| 35 | C2C routing: portal renders; upload goes through the shared engine; lands in `rpa_cv_c2c` with no personal details or lock | 3 |
| 36 | Dedup: a name collision goes to review; a main-pool match is flagged; personal details are never persisted | 3 |
| 37 | Accept-as-new: both exist; tags shown; Name unchanged | 2 |
| 38 | Screening scores only skills / CTC / notice | 2 |
| 39 | Zero emails to any parsed candidate address on C2C upload | 2 |
| 40 | Shared steps 7-9: status update appears in the shared dashboard | 2 |
| 41 | Full placement regression (dedup + 90-day lock + merge + emails unchanged) | 3 |

**Design**
- New integration file `backend/src/tests/integration/c2cVendor.test.js`, with fixtures tagged through `src/tests/helpers/fixture.js`. It covers rows 32 and 35-40.
- Rows 33-34 are manual plus a unit test.
- Row 41 re-runs the existing vendor suites.
- Personal-detail check: `SELECT` across `rpa_cv_c2c`, `rpa_cv_c2c_tmp`, `rpa_upload_jobs` and `rpa_email_log` for any parsed email or phone from the fixture. Expect zero rows.

**Depends on:** C2C database schema through C2C portal (C1–C7).

#### C9 · Documentation (row 42)
**Medium · 1 h**

| Row | Task | h |
|---|---|---|
| 42 | VENDOR_PROCESS.md Update Log entry + supersede c2c_vendor_plan.md with an as-built section | 1 |

- Add an Update Log entry to `docs/reference/VENDOR_PROCESS.md`.
- Supersede `docs/reference/c2c_vendor_plan.md` with an "as built" section that includes the §3.1 corrections.

### 3.3 C2C open decisions
- **Lifting the hold.** Owner: Sanghamitra.
- **Whether a C2C candidate who is already in the main pool can be linked across.** Recommended: flag only (already decided).

---

## 4. MS Access (R&D / export)

#### M1 · MS Access feasibility (R&D)
**Medium · 3 h · row 44**

**Goal.** Write up the options for handling schema mismatches, plus an alternative plan.

**Current behaviour**
- This is legacy backup data, not a live database.
- It goes both ways: a one-time import of historic Access/Excel data, and an ongoing export out of the ATS (`docs/phase3/MEETING-NOTES-2026-07-14.md:68-73`; `04-QUESTIONS.md` Q21).
- Still owed:
  - the feasibility write-up (Harish)
  - the Access table format (Chhaya)
  - a storage-capacity answer

**Design.** Write `docs/phase4/MS-ACCESS-FEASIBILITY.md` covering:
1. Field mapping of the Access tables (from Chhaya's sample) to `rpa_cv`.
2. Mismatch handling: unmapped fields go to a JSON `legacy_extra`; type coercion rules; duplicate detection reusing the upload dedup.
3. Import route: convert to Excel/CSV, then use the existing bulk upload with `source='legacy_import'`. This avoids AI parsing for structured rows; it is the same idea as the Upload speed (N41) brainstorm.
4. Volume and storage estimate.
5. Recommendation.

**Files:** the new doc.

**Reuse:** HR bulk upload; `candidates.export.js` column list.

**Tests:** run the mapping on a 100-row sample.

**Risks & rollout:** blocked on Chhaya's table format.

**Depends on:** Chhaya. **Blocks:** the legacy import (future).

**Open decisions:** import now or later. Recommended: export first (MS Access scheduled export through MS Access export verification (M2–M4)), import after the feasibility review.

#### M2 · Scheduled export job
**Medium · 3 h · row 45**

**Goal.** A scheduled CSV/Excel export of the core candidate tables. It ships regardless of how full schema reconciliation turns out.

**Current behaviour**
- `backend/src/exports/runExport.js` is tied to `req`/`res` and capped by `EXPORT_MAX_ROWS` = 25,000 (`backend/src/config/index.js:489`). Production has about 99k candidates.
- `candidates.export.js` defines 28 columns plus `fetch` (vendor-scoped, needs a `user`).
- `buildCsv` (`backend/src/utils/csvExport.js:191`).
- `xlsx@0.18.5` is installed.

**Design**
- New `backend/src/jobs/legacyBackupExport.js`:
  - pages `rpa_cv` by `id` in 5,000-row batches using the `candidates.export.js` columns, with an admin system user (no vendor scoping)
  - also exports `rpa_shortlisted_candidates`, `rpa_candidate_pipeline` and `rpa_mrf`
  - streams CSV to a temp file per table, then zips them
- Upload with `ensureDriveFolderPathFromRoot(['ATS Backups', 'YYYY-MM'])` (`backend/src/services/onedrive.service.js:155`) and `uploadStreamToOneDrive` (:196), a resumable upload session. Model: `backend/src/jobs/interviewRecordings.js:348-356`.
- Keep the last 12 monthly and 8 weekly backups. Delete older ones.
- Log every run to `rpa_processing_log`.

**Files:** new job; `onedrive.service.js` (helper for listing / deleting old backups).

**Reuse:** `buildCsv`, `csvFilename`, `uploadStreamToOneDrive`, the `candidates.export.js` column definitions.

**Tests:** MS Access export verification (M4).

**Risks & rollout:**
- The backup contains personal data, so the OneDrive folder must be restricted to admins.
- No email attachment; the link goes to admins only.

**Depends on:** none. **Blocks:** MS Access export scheduling (M3).

**Open decisions:** CSV vs Excel. Recommended: CSV in ZIP, which is Access-importable and has no row limit.

#### M3 · Export scheduling (cron)
**Medium · 2 h · row 46**

**Goal.** Wire the export to a schedule.

**Design**
- Register in `backend/src/server.js`: weekly on Sunday at 02:00 IST, plus monthly on the 1st.
- Use `timezone: 'Asia/Kolkata'` and a `running` guard (pattern: `backend/src/jobs/mrfAuditRetentionSweep.js:123`).
- Settings: `legacy_backup_enabled` (default false), `legacy_backup_cron`.
- Admin "Run now" button in Settings.
- Wrap the job with `runJob` from Developer logging & error tracing (N42), which is delivered in Do Now. This gives a failure alert and a heartbeat.

**Files:** `server.js`, `backend/src/controllers/settings.controller.js`, `frontend/src/pages/Settings.jsx`.

**Reuse:** cron registration pattern.

**Tests:** MS Access export verification (M4).

**Risks & rollout:** run at night; check database load on staging.

**Depends on:** MS Access scheduled export (M2).

**Open decisions:** none.

#### M4 · Verification: export completeness
**Medium · 2 h · row 47**

**Design**
- After a run, compare row counts per table against `COUNT(*)` and check 20 random ids field by field.
- Open the CSV in Access, using an Access import test on one table.
- Record the result in `docs/changelog`.

**Depends on:** MS Access scheduled export (M2), MS Access export scheduling (M3).

---

## 5. Other Phase 4 items (Other Phase 4 items (P01–P11))

#### P01 · Responded status & source marker
**Low · 32 h · CEO (Phase 3 Enh. row 2; Phase 4 sheet row 83)**

**Goal**
- **Today:** nothing records whether a candidate responded to outreach or is an old database record, so search can't prefer active applicants.
- **Change:**
  - Store a responded status and the source (new applicant vs old database).
  - Rank late responders lower.
  - Add a "Responders only" search option.
  - the Raw vs qualified (interim) (N37) counts switch to the stored status.
- **Done when:** search can be limited to responders, and each card shows "Responded" or "From old database".

**Current behaviour.** The signals exist but are not stored as a status:
- `cvMissingTokenStatus='RECEIVED'` (`backend/src/controllers/candidate.controller.js:519-520`)
- inbound replies in `rpa_email_messages` (`backend/src/jobs/inboundEmailSync.js:120-170`)
- `rpa_email_log.responded_at`

`last_action_by` / `last_action_context` give the intake route, but are overwritten later (e.g. `duplicate_merge`, `backend/src/services/hrUpload.service.js:613`).

**Design**
- **DDL:** add to `rpa_cv`:
  - (`intake_source` already exists, added by Website candidates report (P07); this item reuses it and backfills legacy rows)
  - `response_status` (`none|responded`)
  - `last_response_at`
  - `first_outreach_at`
- **Writers**
  - Upload sets `intake_source` once, never overwritten (`runBatchParsing` / email intake).
  - The outreach email sets `first_outreach_at`.
  - Form completion and inbound reply set `responded` + `last_response_at`.
- **Backfill (conditional, idempotent)**
  - `intake_source` from `last_action_context`, where it is not `duplicate_merge`; otherwise `legacy`.
  - responded from the current signals.
- **Old database rule:** `intake_source='legacy'` **or** `createdAt` older than 180 days with no response in that window.
- **Screening:** `respondersOnly` filter (Filter utility (N01) `buildFilterSql`). Ranking gets a lateness penalty: `last_response_at − first_outreach_at` beyond 7 days lowers the recency component (Scoring weights & recency (L01)).
- Cards show a chip: "Responded <date>" or "From old database".
- Raw vs qualified (interim) (N37) switches to these columns.

**Files:**
- DDL + backfill
- `hrUpload.service.js`, `backend/src/jobs/emailResumeIntake.js`, `inboundEmailSync.js`, `candidate.controller.js`
- `backend/src/services/screening.service.js`, `backend/src/utils/screeningFilters.js`
- `frontend/src/pages/CandidateScreening.jsx`, `backend/src/services/dashboard.service.js`

**Reuse:** Filter utility (N01), Raw vs qualified (interim) (N37), Scoring weights & recency (L01).

**Tests:**
- Unit: the old-database rule.
- Integration: an inbound reply marks the fixture as responded.
- Backfill dry-run counts.

**Risks & rollout:** the backfill touches ~99k rows. Run it in batches, staging first.

**Depends on:** Website candidates report (P07), which adds `intake_source`; Filter utility (N01); Raw vs qualified (interim) (N37); Scoring weights & recency (L01) for the ranking part. **Blocks:** none.

**Open decisions:** the "old database" age threshold. Recommended: 180 days.

#### P02 · Hiring-manager status email
**Medium · 16 h · Anuj (demo); our #71**

**Goal**
- **Today:** RT sends daily/weekly position updates to hiring managers by hand.
- **Change:** an automatic daily or weekly email to each hiring manager about their open positions (candidates per stage, upcoming interviews, offers). The schedule is set in Settings.
- **Done when:** hiring managers receive it without RT's involvement.

**Current behaviour**
- The MRF stores the requester and submitter: `submitter_email` and the manager's name/designation (`backend/prisma/schema.prisma:170-172`).
- There is no digest job.

**Design**
- **Job:** `backend/src/jobs/hmStatusDigest.js` (cron from settings: `hm_digest_frequency` `daily|weekly|off`, `hm_digest_time` default 09:00 IST).
  - For each `submitter_email` with open MRFs, build:
    - a per-MRF block using the Analytics - Positions tab (N39) positions data (stage counts, offers, joined)
    - upcoming interviews in the next 7 days (`rpa_interview_schedule`)
    - new shortlists since the last digest
  - Optional CSV attachment (JD attached to emails (N17) support).
- **Template** "Hiring Manager Status" in the email templates, wrapped with `wrapBrandedEmail`.
- **Recipients:** the digest goes to `submitter_email`. CC goes to `resolveRecipients('hmDigestCc')`, a new flow key editable in the Email Routing tab.
- Track sends in `rpa_email_log` (type `hm_digest`), so the next digest knows the window.

**Files:** new job; `server.js`; a template seed; `backend/src/config/emailRecipients.js`; `settings.controller.js`; `Settings.jsx`.

**Reuse:** Analytics - Positions tab (N39) positions service, `wrapBrandedEmail`, `resolveRecipients`, JD attached to emails (N17) attachments.

**Tests:**
- Unit: digest building from fixture data.
- Integration: a send to the staging inbox.

**Risks & rollout:** wrong recipients. Outside production, mail is redirected. Review the first production run with RT (dry-run setting `hm_digest_dry_run` sends to RT only).

**Depends on:** Analytics - Positions tab (N39). **Blocks:** Hiring-manager read-only role (P03; lower priority once the digest exists).

**Open decisions:** daily vs weekly default. Recommended: weekly, Monday 09:00.

#### P03 · Hiring-manager read-only role
**Low · 48 h · CEO (Phase 4 sheet row 86)**

**Goal**
- **Today:** hiring managers have no ATS login.
- **Change:** a read-only role that sees only the hiring manager's own positions (pipeline and analytics).
- **Done when:** a hiring manager logs in, sees only their positions, and has no edit actions.

**Current behaviour**
- Roles: superadmin / admin / recruiter / vendor (`backend/src/config/roles.js:12-30`).
- Module checks guard only some routes (`backend/src/middleware/auth.js:123`).
- The sidebar is not filtered by permissions (`frontend/src/layouts/MainLayout.jsx:258-267`).
- The vendor scoping pattern is `enforceVendorScope` (`backend/src/utils/vendorScope.js`).

**Design**
- **Role:** `hiring_manager`, rank below recruiter, with modules `hm_positions` only.
- **Scope:** `enforceHmScope(req)` limits MRF ids to `rpa_mrf.submitter_email = user.email`. It is applied to the new read-only endpoints:
  - `GET /api/hm/positions` (Analytics - Positions tab (N39) data, filtered)
  - `GET /api/hm/positions/:mrfId/pipeline` (`listPipeline` with `mrfId`, `backend/src/services/pipeline.service.js:171`, with personal details trimmed to name + stage + dates; no email, phone, CTC or referral)
  - `GET /api/hm/positions/:mrfId/analytics`
- **No write routes.**
- **Frontend:** an `HmPortal.jsx` page (positions list, then per-position board, read-only), routed by role like the vendor portal. Sidebar filtering by `user.permissions` is added as part of this item; it also enables Housekeeping (N40) option B.
- **Accounts:** an admin creates HM users. Optionally invite them from the MRF ("Give this manager access").

**Files:** `roles.js`, `auth.js`, new `backend/src/utils/hmScope.js`, new routes/controller, `App.jsx`, `MainLayout.jsx`, new page, `admin.controller.js` (role option).

**Reuse:** the `enforceVendorScope` pattern, Analytics - Positions tab (N39), `listPipeline`, `getPipelineAnalytics({mrfId})`.

**Tests:** an HM isolation integration test modelled on `backend/src/tests/vendorIsolation.test.js`: an HM can't see another HM's MRF; every write route returns 403.

**Risks & rollout:** data exposure. The response whitelist is tested. The referral flag is never exposed (same rule as for interviewers).

**Depends on:** Analytics - Positions tab (N39), Hiring-manager status email (P02). **Blocks:** none.

**Open decisions:** whether HMs see candidate CVs. Recommended: no, name + stage only.

#### P04 · SMS / WhatsApp reminders
**Low · 24 h · RT §9**

**Goal**
- **Today:** the ATS can only send email.
- **Change:** interview reminders by SMS / WhatsApp through a provider, using the phone captured in Candidate phone & interview reminders (N22).
- **Done when:** a scheduled interview triggers an SMS / WhatsApp reminder.

**Current behaviour**
- No SMS/WhatsApp provider exists.
- The interview reminder job emails candidates for Teams rounds (`backend/src/jobs/interviewReminder.js`).
- Zeko sends its own SMS once Candidate phone & interview reminders (N22) passes the phone.

**Design**
- **Provider adapter:** `backend/src/services/messaging/` with `send({ to, template, params })`. One implementation, chosen by `MESSAGING_PROVIDER`, plus a `console` stub for staging.
- **Templates:** pre-approved WhatsApp templates (required by WhatsApp Business); plain SMS for the fallback.
- **Trigger:** `interviewReminder.js` sends email plus SMS when `sms_reminder_enabled`.
- Claim per row with a new `candidate_sms_reminded_at` column (DDL) to avoid duplicates.
- **Consent:** only numbers the candidate provided (form / recruiter-entered, Candidate phone & interview reminders (N22)). Opt-out keyword handling, if the provider supports it.
- Log every send to `rpa_email_log`-style `rpa_message_log` (DDL).

**Files:** new service folder; `interviewReminder.js`; DDL; `settings.controller.js`; `Settings.jsx`; config.

**Reuse:** `normalisePhone` (Filter utility (N01)), reminder claim pattern.

**Tests:**
- Unit: the adapter with the stub.
- Integration: the staging stub logs the message.

**Risks & rollout:** cost, consent and template approval lead time (WhatsApp).

**Depends on:** Candidate phone & interview reminders (N22); provider decision. **Blocks:** none.

**Open decisions:** the provider (e.g. MSG91, Gupshup or Twilio) and SMS vs WhatsApp. Owner: Harish + RT.

#### P05 · Prompt configuration
**Medium · 20 h · our list**

**Goal**
- **Today:** all six AI prompts are hard-coded: JD parse, resume parse, two insight prompts, two Evalground prompts.
- **Change:** an admin screen to view and edit prompts, with versioning, reset to default and a test run.
- **Done when:** a prompt can be changed and rolled back without a deployment.

**Current behaviour.** Prompts live in the code:
- `backend/src/services/geminiParser.service.js:12` (JD)
- `backend/src/services/hrUpload.service.js:240` (resume) and :963 (general insights)
- `backend/src/services/screening.service.js:630` (role-fit insights)
- `backend/src/services/assessmentImport.service.js:140`, :187 (Evalground)

All calls go through `generateContentWithFallback` (`backend/src/utils/geminiHelper.js:34`).

**Design**
- **DDL:** a table `rpa_ai_prompts` with columns `key`, `version`, `body`, `is_active`, `created_by`, `created_at`, `note`, and UNIQUE `(key, version)`.
- **Service:** `getPrompt(key)` returns the active body, falls back to the in-code default, and caches for 60 s.
- Each call site replaces its literal with `getPrompt('resume_parse')`. The in-code text stays as the default.
- **Safety:**
  - Prompts embed the JSON schema the code parses. The editor shows a **locked schema section** that can't be edited.
  - "Test run" executes the prompt on a sample input and validates the JSON shape before allowing activation.
- **Admin UI:** Settings → "AI prompts": list, version history, diff, activate, reset to default. `requireAdmin`.

**Files:** DDL; new `backend/src/services/aiPrompt.service.js`; the five call-site files; new routes/controller; `Settings.jsx` (or a new admin page).

**Reuse:** `generateContentWithFallback`.

**Tests:**
- Unit: fallback to default, cache, schema validation.
- Manual: edit, test, activate, then roll back.

**Risks & rollout:** a bad prompt can break parsing for every upload. Activation requires a passing test run, and rollback is one click.

**Depends on:** none. **Blocks:** C2C screening (C6; C2C prompt variant becomes configurable).

**Open decisions:** who may edit. Recommended: superadmin only.

#### P06 · Reminder settings in one place
**Medium · 20 h · our list**

**Goal**
- **Today:** Settings → Reminder Settings covers only three reminder types. Interview, occurrence, document and assessment reminders are set elsewhere or in server config.
- **Change:** every reminder's on/off switch, timing and limits under one Settings section.
- **Done when:** all reminders can be tuned from Settings.

**Current behaviour**
- Reminder Settings (`frontend/src/pages/Settings.jsx` ~959-1080) drives only `missing_jd`, `mrf_hm` and the MRF approval reminder (`backend/src/jobs/reminderEligibility.js:43-47`).
- Interview reminder: `Settings.jsx` ~540-660.
- Occurrence nudge: ~663-800, with the repeat interval and cap hard-coded (`backend/src/jobs/interviewOccurrence.js:75-76`).
- Document reminders: env only (`backend/src/config/index.js:414-422`).
- Assessment deadline: days in Settings, schedule via env (config :403).
- The offer approval nudge is switched off in code (`backend/src/jobs/offerSweep.js:13-16`).

**Design**
- Move the env-only values into `rpa_settings` keys, with the env values as defaults:
  - `document_reminder_*`
  - `assessment_deadline_cron`
  - `occurrence_nudge_interval_h`, `occurrence_nudge_max`
- One "Reminders" page section with a card per reminder: what it does, who receives it, an on/off switch, timing and a max count.
- Saving restarts the affected job (pattern: `settings.controller.js:157-214`).
- Fix the banner text, which today claims "all recruitment workflows".
- Admin-only for these keys.

**Files:** `documentReminder.js`, `assessmentDeadlineChecker.js`, `interviewOccurrence.js`, `settings.controller.js`, `settings.routes.js`, `Settings.jsx`, `backend/src/config/index.js`.

**Reuse:** the `interviewReminder.js` `SETTING_KEYS` / `DEFAULTS` pattern, `restartInterviewReminderJob`-style restart.

**Tests:**
- Unit: setting fallbacks to env.
- Integration: `sweepJobs.test.js` still passes.
- Manual: change and restart.

**Risks & rollout:** none. Behaviour is unchanged until someone edits a value.

**Depends on:** none. **Blocks:** Drop-out rules (L05; drop-out rules sit on the same page).

**Open decisions:** none.

#### P07 · Website candidates report
**Medium · 20 h · our list (Website Data Update; Website Integration)**

**Goal**
- **Today:** website applications reach the ATS through the recruitment mailbox, but aren't marked as website-sourced. RT has no daily report of them.
- **Change:**
  - Store a permanent intake source on each candidate.
  - Send RT a daily 8 AM email with the current month's website candidates as Excel.
  - On the 1st, send a second email with the previous month's summary.
- **Done when:** RT receives both emails on schedule.

**Current behaviour**
- The mailbox poller → `processIntakeMessages` (`backend/src/jobs/emailResumeIntake.js:68-170`) → `runBatchParsing(source='email_intake')`.
- The only marker is `last_action_by='Self Applied'`, and it gets overwritten.
- Website applications and direct emails are not told apart. The sender is stored only in `rpa_upload_batch_summary.details` (:122-139), with no candidate link.

**Design**
- **Source:** this item **adds** `rpa_cv.intake_source` (DDL; permanent, never overwritten once set; later reused by Responded status & source marker (P01)). Upload and email intake stamp it. Email intake sets `website` when the sender/subject matches the setting `website_sender_patterns` (e.g. the careers-site sender address), otherwise `email`.
- **Job:** `backend/src/jobs/websiteReport.js` at 08:00 IST daily.
  - Builds an xlsx (`xlsx` library; model: `backend/src/exports/candidateDossier.export.js:851-998`) of `intake_source='website'` candidates created this month, with the `candidates.export.js` columns.
  - Emails RT with the attachment (JD attached to emails (N17) support).
  - On the 1st: a second email with the previous month's file and a summary (count by role, by week).
- **Recipients:** a new flow key `websiteReport` in `backend/src/config/emailRecipients.js`.

**Files:** `emailResumeIntake.js`, `hrUpload.service.js` (stamp), new job, `server.js`, `emailRecipients.js`, `settings.controller.js`, `Settings.jsx`.

**Reuse:** JD attached to emails (N17) attachments, the `candidates.export.js` columns, the cron pattern.

**Tests:**
- Unit: sender matching and the month windows (1st-of-month edge cases).
- Integration: a send to the staging inbox.

**Risks & rollout:** attachment size. Above 3 MB, upload to OneDrive and send a link instead (JD attached to emails (N17) fallback).

**Depends on:** JD attached to emails (N17). **Blocks:** Responded status & source marker (P01), which reuses `intake_source`.

**Open decisions:** the website sender pattern(s). Owner: RT/IT.

#### P08 · Captcha on public MRF form
**Medium · 4 h · our list (Captcha)**

**Goal**
- **Today:** captcha protects the login pages, but the public MRF submission form has no captcha or rate limit.
- **Change:** add captcha and a rate limit to the public MRF form.
- **Done when:** automated submissions are blocked.

**Current behaviour**
- Cloudflare Turnstile protects login, admin login and forgot password:
  - widget: `frontend/src/components/TurnstileWidget.jsx`
  - verification: `backend/src/services/turnstile.service.js`, enforced in `backend/src/controllers/auth.controller.js:20-30`
- `POST /api/mrf/submit` (`backend/src/routes/mrf.routes.js` ~68-71) has neither captcha nor rate limit.

**Design**
- Add `TurnstileWidget` to `frontend/src/pages/MrfSubmit.jsx`. The token is required on submit.
- The submit handler verifies with `turnstile.service`. The same "skip if the key isn't set" behaviour applies.
- Add an `express-rate-limit` limiter (10 per hour per IP), like `backend/src/middleware/mrfApprovalRateLimit.js`.

**Files:** `MrfSubmit.jsx`, `mrf.routes.js`, `mrf.controller.js`.

**Reuse:** `TurnstileWidget`, `turnstile.service`, the approval rate limiter.

**Tests:** manual: submit without a token is rejected; rate limit trips on the 11th request.

**Risks & rollout:** none.

**Depends on:** none. **Blocks:** none.

**Open decisions:** none.

#### P09 · Zeko 90-day re-interview check
**Medium · 6 h (+ R&D) · our list**

**Goal**
- **Today:** nothing stops a Zeko interview being sent again to a candidate interviewed in the last 90 days.
- **Change:**
  - Warn or block re-sending within 90 days and reuse the previous result.
  - Investigate whether Zeko's API allows archiving or deleting old interview data.
- **Done when:** re-sending within 90 days shows a warning with the previous result.

**Current behaviour**
- `assignCandidateToZekoJob` (`backend/src/services/screening.service.js:2498`) upserts on shortlist + job + round.
- A new MRF means new rows, and there is no history check.
- Data is available in `rpa_zeko_candidate_pipeline` (`link_sent_at`, `completed_at`) and `rpa_zeko_interview_results`.
- Pattern to copy: `backend/src/utils/rejectionCooldown.js` (`REJECTION_COOLDOWN_DAYS=90`).

**Design**
- `findRecentZekoInterview(cvId, round, days=90)` joins through the shortlist's `cv_id`.
- In `assignCandidateToZekoJob` and `scheduleInterview`, if one is found:
  - return `409` with the previous result (date, score, report link)
  - unless `override=true` with a reason
- The drawer shows "Interviewed by Zeko on <date> (score X)" with "Reuse result" / "Send anyway".
- **Reuse result:** copy the previous result as this round's result, flagged `reused_from`.
- **R&D (separate, not in the hours):** ask Zeko whether their API supports archive/delete, and document the answer.

**Files:** `screening.service.js`, `backend/src/services/pipeline.service.js` (detail flag), `frontend/src/components/pipeline/PipelineDrawer.jsx`, new util.

**Reuse:** the `rejectionCooldown.js` pattern, `findZekoRoundResult`.

**Tests:** unit tests for the window; an integration check that the warning is returned.

**Risks & rollout:** reusing a result must keep round scoping intact (see Scores in the pipeline drawer (N28)).

**Depends on:** Scores in the pipeline drawer (N28). **Blocks:** none.

**Open decisions:** warn vs block. Recommended: warn, with an override reason.

#### P10 · Admin Config UI polish
**Medium · 12 h · our list**

**Goal**
- **Today:** admins can edit stages, outcomes and reasons, but:
  - there is no hard delete
  - there is no in-use check when deactivating outcomes or reasons
  - config changes are not audited
  - new custom interview stages get no scheduling or scorecards
- **Change:** add those four.
- **Done when:** config changes are logged and can't break candidates mid-stage.

**Current behaviour**
- `frontend/src/components/pipeline/PipelineConfigPanel.jsx` (four tabs, mounted at `frontend/src/pages/Settings.jsx:1170`).
- Endpoints in `backend/src/controllers/pipeline.controller.js:1059-1289`.
- Deactivating a **stage** is refused while it is in use (:1089-1099). Outcomes and reasons have no such check.
- The engine branches on hard-coded `STAGE_KEYS` (`backend/src/config/pipelineStages.js:16-29`).
- A stale save silently overwrites (`docs/test-plans/phase3-test-results.md:213`).

**Design**
- **In-use checks:** before an outcome or reason is deactivated, count its references in `rpa_pipeline_stage_events`, among open journeys. If any exist, warn and require confirmation.
- **Hard delete:** only when there are no references at all; otherwise only deactivation is allowed.
- **Audit:** a new `rpa_config_audit` table (DDL), with `who`, `entity`, `key`, `before` (JSON), `after` (JSON) and `at`. Written by every config handler, with an audit tab in the panel.
- **Stale-save guard:** an `updated_at` check, returning 409 if the row changed since it was loaded.
- **Custom interview stages:** `stage_type='scheduled_interview'` drives scheduling and scorecards instead of `STAGE_KEYS` membership (`isSchedulableStageKey`, `backend/src/services/interviewSchedule.service.js`). New stages get default outcomes (approve / reject / hold).

**Files:** `pipeline.controller.js`, `pipelineStages.js`, `interviewSchedule.service.js`, `PipelineConfigPanel.jsx`, DDL.

**Reuse:** the existing stage in-use check.

**Tests:**
- Unit: in-use counting, stale-save 409.
- Integration: a custom interview stage can be scheduled (`schedulingAndScorecard` style).

**Risks & rollout:** the custom-stage change touches scheduling, so run all pipeline integration files.

**Depends on:** none. **Blocks:** none.

**Open decisions:** none.

#### P11 · Excel scores to round scorecards
**Medium · 20 h · our list**

**Goal**
- **Today:** interview scores in Excel uploads are stored on the candidate record, not in the round scorecards the pipeline uses. Scores in the pipeline drawer (N28) only displays them.
- **Change:** import them into the matching round's scorecard.
- **Done when:** uploaded scores appear as real round scores.

**Current behaviour**
- HR Excel upload writes `IQScore`, `TechScore`, `TechRoundOne/Two/Three`, `ManagerialOrCEOFeedback`, `HRInterview` and the Zeko columns to `rpa_cv` (`backend/src/services/hrUpload.service.js` ~75-95, write ~1440-1466).
- The pipeline reads scorecards (`rpa_interview_scorecard`), Zeko results and Evalground results only.

**Design**
- **Mapping:**
  - `TechRoundOne` → stage `tech1`; `TechRoundTwo` → `tech2`; `TechRoundThree` → `tech3`
  - `HRInterview` → `hr_round`; `ManagerialOrCEOFeedback` → `ceo`
  - `IQScore` → the assessment result (Evalground table) with `source='excel_import'`
- **Import:**
  - For candidates with an open journey on an MRF, a recruiter clicks "Import uploaded scores" in the drawer, which shows a preview.
  - This creates scorecard rows flagged `source='excel_import'`, with `submitted_by` = the recruiter, and one per round only if none exists.
  - Non-numeric feedback text goes into the scorecard comments.
- **Bulk:** an admin action that imports for all open journeys, with a dry-run report.
- After import, the Scores in the pipeline drawer (N28) "Uploaded scores" panel hides the imported fields.

**Files:** `backend/src/services/interviewScorecard.service.js`, `backend/src/services/pipeline.service.js`, `PipelineDrawer.jsx`, `pipeline.controller.js`, DDL (`source` column on the scorecard table, if missing).

**Reuse:** the scorecard creation helpers; the Evalground result commit (`backend/src/services/assessmentImport.service.js` `commitImport`).

**Tests:**
- Unit: mapping and parsing of score text.
- Integration: an import creates a scorecard visible in the drawer, and doesn't duplicate on re-run.

**Risks & rollout:** Excel score formats vary ("7/10", "Good", "72%"). Unparseable values stay as comments only.

**Depends on:** Scores in the pipeline drawer (N28), Candidate data sync (N29). **Blocks:** none.

**Open decisions:** whether imported scores count toward stage approvals. Recommended: yes, with a visible "Imported" label.

---

## 6. Cross-cutting tables

### DDL

| # | Change | Item |
|---|---|---|
| 1 | C2C: `rpa_users` vendor fields; `rpa_cv_c2c`; `rpa_cv_c2c_tmp`; `rpa_upload_jobs.vendor_type`; `rpa_mrf_vendor_shares`; view `rpa_candidates_all` | C2C database schema (C1), C2C Share JD (C3) |
| 2 | `rpa_cv.intake_source` | Website candidates report (P07) |
| 2b | `rpa_cv.response_status`, `last_response_at`, `first_outreach_at` + backfill (including `intake_source` for legacy rows) | Responded status & source marker (P01) |
| 3 | `rpa_interview_schedule.candidate_sms_reminded_at`; `rpa_message_log` | SMS / WhatsApp reminders (P04) |
| 4 | `rpa_ai_prompts` | Prompt configuration (P05) |
| 5 | `rpa_config_audit` | Admin Config UI polish (P10) |
| 6 | Scorecard `source` column (if missing); `reused_from` on Zeko results | Excel scores to round scorecards (P11), Zeko 90-day re-interview check (P09) |

### Settings keys

| Key | Item |
|---|---|
| `legacy_backup_enabled`, `legacy_backup_cron` | MS Access export scheduling (M3) |
| `hm_digest_frequency`, `hm_digest_time`, `hm_digest_dry_run` | Hiring-manager status email (P02) |
| `sms_reminder_enabled` (+ provider env) | SMS / WhatsApp reminders (P04) |
| `document_reminder_*`, `assessment_deadline_cron`, `occurrence_nudge_interval_h`, `occurrence_nudge_max` | Reminder settings in one place (P06) |
| `website_sender_patterns` | Website candidates report (P07) |

### New cron jobs

| Job | Item |
|---|---|
| `legacyBackupExport` (weekly Sunday 02:00 IST + 1st of month) | MS Access scheduled export (M2), MS Access export scheduling (M3) |
| `hmStatusDigest` (per setting) | Hiring-manager status email (P02) |
| `websiteReport` (daily 08:00 IST) | Website candidates report (P07) |

### New roles / endpoints

| What | Item |
|---|---|
| `POST /api/mrf/:id/share-jd`; `/api/c2c-review/*`; `GET /api/screening/c2c/search` | C2C Share JD (C3), C2C review queue (C5), C2C screening (C6) |
| Role `hiring_manager`; `/api/hm/*` | Hiring-manager read-only role (P03) |
| `/api/admin/ai-prompts/*` | Prompt configuration (P05) |

### Emails

| Email | Item |
|---|---|
| Vendor JD share | C2C Share JD (C3) |
| C2C vendor-only upload alert | C2C upload, dedup & persistence (C4) |
| Hiring-manager digest | Hiring-manager status email (P02) |
| Website report (daily, monthly) | Website candidates report (P07) |
| SMS / WhatsApp reminders | SMS / WhatsApp reminders (P04) |

## 7. Release plan

| Release | Contents |
|---|---|
| A | Captcha on public MRF form (P08), Zeko 90-day re-interview check (P09) |
| B | MS Access backup (M2–M4); MS Access feasibility (M1) after Chhaya's format arrives |
| C | Admin Config UI polish (P10), Hiring-manager status email (P02; dry-run to RT first) |
| D | Reminder settings in one place (P06), Website candidates report (P07; adds `intake_source`) |
| E | Prompt configuration (P05), Excel scores to round scorecards (P11) |
| F | SMS / WhatsApp reminders (P04; after provider onboarding), Responded status & source marker (P01; backfill in batches) |
| G | Hiring-manager read-only role (P03) |
| H (on hold) | C2C work packages (C1–C9), with the full placement regression (row 41) as the release gate |

Each release follows [PLAN-Phase3-Now.md](PLAN-Phase3-Now.md) §6.

## 8. Open decisions register

| # | Decision | Item | Owner | Recommended default |
|---|---|---|---|---|
| 1 | Lift the C2C hold | C2C work packages (C1–C9) | Sanghamitra | After 1-2 stable months |
| 2 | Access table format; import now or later | MS Access feasibility (M1) | Chhaya / Harish | Export first, import after review |
| 3 | CSV vs Excel backup | MS Access scheduled export (M2) | Harish | CSV in ZIP |
| 4 | "Old database" age | Responded status & source marker (P01) | CEO / RT | 180 days |
| 5 | Digest frequency | Hiring-manager status email (P02) | RT | Weekly, Monday 09:00 |
| 6 | HM can view CVs | Hiring-manager read-only role (P03) | CEO | No |
| 7 | SMS / WhatsApp provider | SMS / WhatsApp reminders (P04) | Harish + RT | Shortlist MSG91 / Gupshup / Twilio |
| 8 | Who edits prompts | Prompt configuration (P05) | Harish | Superadmin only |
| 9 | Website sender pattern | Website candidates report (P07) | RT / IT | — |
| 10 | Zeko 90-day: warn or block | Zeko 90-day re-interview check (P09) | RT | Warn + override reason |
| 11 | Imported scores count for approval | Excel scores to round scorecards (P11) | RT | Yes, labelled |

## 9. ID index (ID → task name)

| ID | Task |
|---|---|
| C1 | C2C database schema |
| C2 | C2C vendor registration |
| C3 | C2C Share JD |
| C4 | C2C upload, dedup & persistence |
| C5 | C2C review queue |
| C6 | C2C screening |
| C7 | C2C portal |
| C8 | C2C verification |
| C9 | C2C documentation |
| M1 | MS Access feasibility |
| M2 | MS Access scheduled export |
| M3 | MS Access export scheduling |
| M4 | MS Access export verification |
| P01 | Responded status & source marker |
| P02 | Hiring-manager status email |
| P03 | Hiring-manager read-only role |
| P04 | SMS / WhatsApp reminders |
| P05 | Prompt configuration |
| P06 | Reminder settings in one place |
| P07 | Website candidates report |
| P08 | Captcha on public MRF form |
| P09 | Zeko 90-day re-interview check |
| P10 | Admin Config UI polish |
| P11 | Excel scores to round scorecards |
