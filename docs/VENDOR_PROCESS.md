# Vendor Process

> **Single source of truth for the vendor workflow** — both the history of what we built and the
> current scenario-by-scenario behavior. Whenever the vendor workflow changes, add a dated entry to
> the [Update Log](#update-log) (newest first) **and** revise the affected section under
> [Current Vendor Workflow](#current-vendor-workflow). Keep the language plain; assume the reader
> hasn't seen the code.

Source of truth in code:
- [`controllers/vendor.controller.js`](../backend/src/controllers/vendor.controller.js) — upload, attribution, jobs feed, reprocess, review actions
- [`routes/vendor.routes.js`](../backend/src/routes/vendor.routes.js) — vendor + staff routes & guards
- [`services/hrUpload.service.js`](../backend/src/services/hrUpload.service.js) — parsing, dedup→review queue, merge/cancel, 90-day lock (shared engine; vendor uploads run through it)
- [`services/uploadJob.service.js`](../backend/src/services/uploadJob.service.js) — job lifecycle + socket emits
- [`services/emailNotification.service.js`](../backend/src/services/emailNotification.service.js) — duplicate/vendor alert emails
- [`config/roles.js`](../backend/src/config/roles.js) — roles & the `vendor_upload` module key

---

## Update Log

### 2026-06-26 — Premium pass refinement: quieter success + "Real-time" indicator
- Made the premium pass more professional: **dropped the confetti** (now a single refined success check)
  and replaced the loud uppercase **"LIVE"** badge with a muted **"● Real-time"** indicator (soft halo +
  tooltip). The rest of the polish is unchanged. (`theme/index.css`, `UploadCelebration.jsx`,
  `VendorPortal.jsx`, `HRUpload.jsx`.)

### 2026-06-26 — Premium UI pass (Vendor + HR upload)
- Professional "awe" polish on both upload screens (CSS-only): **count-up KPI cards** (Total / Processing /
  Saved / Pending Review) via the shared `KpiCard`; a pulsing **"● LIVE"** badge; rows that **flash green
  as their status changes** live over Socket.io; a **drag-active dropzone** + **upload progress bar**; a
  brief **success burst** on upload; shimmer on in-flight rows; glow on action-required tags; button sheen.
  Respects `prefers-reduced-motion`. Backend: vendor (+ HR) `getUploadJobs` now returns
  `stats.processing/completed/total` via a status `groupBy`. New shared `KpiCard`/`useCountUp`/
  `UploadCelebration`; premium block in `theme/index.css`. (`VendorPortal.jsx`, `vendor.controller.js`.)

### 2026-06-26 — Vendor screen scoped to vendor-portal + per-uploader visibility
- The Vendor screen's job feed was showing HR manual uploads (and every staff member's uploads). Fixed
  `getUploadJobs`: now hard-filtered to **`source='vendor_portal'`**, with role-based visibility —
  **admin/superadmin** see all; **recruiter/hr** see only the records **they themselves uploaded**
  (`uploaded_by_id`) + anything needing review (`action_required`, shared); **vendors** see only their
  **own** self-uploads. The Vendor Dashboard's `pendingReview` count is likewise scoped to
  `source='vendor_portal'`. (`vendor.controller.js`.)

### 2026-06-26 — Fix: parser fabricating identifiers
- Parsed emails/phones are now **verified against the resume text** before being used as the candidate's
  identity/dedupe keys — the AI sometimes invents a plausible email from the name (e.g.
  `firstname.lastname@example.com`); if it isn't actually in the resume it's dropped. The parser prompt was
  also hardened to forbid fabricating/guessing emails & phones. (`hrUpload.service.js`.)

### 2026-06-26 — Fix: candidate inheriting the uploader's email
- The shared parser call passed `attrEmail || email`, so for non-vendor uploads the **uploader's own
  email** was handed to the AI as the "Vendor Email" and leaked into the candidate's `EmailID`. Now the
  parser receives only the real vendor attribution, and the uploader's/vendor's own email is excluded from
  the candidate's identity keys (`sanitizeMatchEmails` exclude list). (`hrUpload.service.js`.)

### 2026-06-25 — Fix: false-positive duplicate match + "Rejected by System"
- **Bug:** a resume with no usable email/phone was wrongly flagged as a duplicate of an unrelated
  candidate and the merge fused the two records. Cause: the dedupe key fell back to `parsed.unique_key`
  (the parser's email echo) without validation, so a stray/non-email value leaked through and matched.
- **Fix (`hrUpload.service.js`):** match keys are now built by `sanitizeMatchEmails` (valid-email-format
  only) and `sanitizeMatchContacts` (drops blanks + the `"9876543210"` placeholder), used at **both** the
  parse-time match and the merge re-find — so junk/placeholder values can no longer match. The existing
  find-duplicate → merge/insert logic is unchanged; it just gets clean keys.
- **New rule:** a resume with **no valid email AND no phone** is now rejected as **"Rejected by System"**
  (new `rpa_upload_jobs` status `Rejected_By_System`, not "Processing Failed"); anything with at least one
  identifier is saved (new or merged) and the existing missing-candidate-details email follows up.
- Frontend: `Rejected by System` status label/colour added to `VendorPortal.jsx` + `HRUpload.jsx`.
- Note: an already-fused record from before this fix needs a one-off manual DB correction.

### 2026-06-25 — UI fixes: dropzone box, green accent (aligned to Search Candidate page)
- **Empty grey box** above the dropzone: AntD v5 applies a `Dragger`'s inline `style` to the outer
  `.ant-upload-wrapper`, so the grey background landed on the wrapper and the `table-cell` content layout
  left it uncentred. Fixed by styling the real `.ant-upload.ant-upload-drag` via scoped `.upload-page` CSS
  (dashed border, flex-centred content, `min-height: 96px`) and removing the inline styles from `<Dragger>`.
- **Green accent**: the 3px gradient bar overflowed the cards' rounded corners. Reworked it to match
  `Candidates.jsx` (the Search Candidate page) — a `borderTop: '4px solid #7a922e'` directly on the card
  (follows the rounded corners), replacing the inner gradient bar + `overflow: 'hidden'` workaround;
  secondary cards use `boxShadow` only.
- Files: `theme/index.css`, `VendorPortal.jsx`, `HRUpload.jsx`.

### 2026-06-25 — Elegant UI pass (Vendor + HR upload pages)
- Reused the theme's animation kit for a professional, animated feel — purely presentational:
  card **fade-in-up with stagger** on mount, **stat tiles** that fade in and **lift on hover**
  (new `.stat-tile`), a **dropzone** that lifts/tints on hover with a springy inbox icon (new
  `.upload-page` scoped CSS + `.upload-inbox-icon`), and **hover tooltips** on every status tag
  (explaining the status) and on the stat tiles. Files: `theme/index.css`, `VendorPortal.jsx`
  (and the HR `HRUpload.jsx`).

### 2026-06-25 — Last-activity stamped on merge resolution
- `mergeDuplicates` now records **`last_action_by`** (the recruiter who resolved) +
  **`last_action_context = 'duplicate_merge'`** on both the update-existing and create-new paths, and
  the duplicate **staging insert** now stamps `last_action_by`/`last_action_context` too. Applies to
  vendor *and* HR duplicates. (`hrUpload.service.js`.)

### 2026-06-25 — Vendor-aware duplicate alert email (§6 wired up)
- When a vendor upload is a duplicate, the alert email is now chosen by comparing the incoming vendor
  to the existing candidate's current vendor: same vendor → `sendSameVendorDuplicateAlert`; different
  vendor → `sendDifferentVendorDuplicateAlert`; existing has no vendor (or HR manual upload) →
  `sendDuplicateAlertEmail`. Previously only the generic internal-HR alert fired. (`hrUpload.service.js`.)

### 2026-06-23 — UI polish: compact upload + animated dashboard
- **Vendor Upload page:** the dropzone is now **compact** (single row, no longer dominates the page),
  and a **"Uploading for: <vendor>"** chip confirms attribution (red prompt chip until one is picked).
  (`VendorPortal.jsx`.)
- **Vendor Dashboard:** an elegant entrance/animation pass reusing the theme's animation kit — KPI cards
  animate + lift on hover (existing), the hiring-pipeline card and recent-submissions card fade-in-up
  with stagger, the selection-rate gauge scales in, and the pipeline stage tiles scale in (staggered)
  with a gentle hover lift. New `.pipeline-tile` class in `theme/index.css`. Purely presentational —
  no data/logic change.

### 2026-06-23 — Pipeline buckets aligned to the real hiring workflow
- Rewrote the dashboard's `classifyStatus`/`statusColor` to match the actual `FinalStatus`
  vocabulary (Stage 0 Resume Screening → Stages 1–9 → Final Outcome). Lost outcomes are evaluated
  before positive/offer keywords so e.g. **"Offer Rejected"**, **"Did Not Join"**, **"Backed Out"**,
  **"Joined and Left"** no longer count as wins. (`VendorDashboard.jsx`, frontend-only — stored
  statuses unchanged; detailed tags + Recent Submissions still show the exact value.)
- Bucket mapping:
  - **Selected / Joined** — Selected, Offer Accepted, Joined.
  - **In Process** — Resume Shortlisted; any "… Approved/Passed/Shared"; Offer Shared; interview rounds in progress.
  - **On Hold** — any "… on Hold" / On Hold; **Future Prospect** (assumed parked-for-later; flip to Rejected if preferred).
  - **Rejected / Dropped** — any "… Rejected/Failed"; Resume-Rejected sub-reasons (High Salary, High Notice, Weak Communication, Skills Mismatch, Frequent Job Changes); Candidate Withdrew, Backed Out, Did Not Join, Joined and Left.
  - **Awaiting Screening** — blank `FinalStatus` / Stage 0 Resume Screening.

### 2026-06-23 — Recruiter "all vendors by default" overview
- **Vendor Dashboard** now defaults to an **all-vendors aggregate** for staff (no vendor pick needed):
  combined KPIs + hiring pipeline across every vendor, plus a new **Pending Review** KPI (duplicates
  awaiting review). The picker is a filter (placeholder "All Vendors"); selecting one drills in.
  Backend: `vendorStats`/`vendorStatusSummary` accept an optional scope (single vendor *or* all
  vendor-sourced candidates via `vendorScopeWhere`); `getVendorDashboard` returns the aggregate +
  `pendingReview` (from `rpa_upload_jobs.action_required`) when no vendor is chosen; `search` gained a
  `vendorOnly` filter for the recent list.
- **Vendor Upload → Upload Status table** now defaults to **all vendors** with its own Vendor + Status
  filters, **decoupled** from the (still-required) "on behalf of vendor" upload picker. Staff see total
  uploads + global Pending Review at a glance, then filter per vendor.
- Files: `candidate.service.js`, `vendor.controller.js`, `VendorDashboard.jsx`, `VendorPortal.jsx`.

### 2026-06-23 — Elegant required indicator + "Pending" renamed
- **Refined the mandatory cue:** replaced the loud red label/border/caption with a single muted
  "On behalf of vendor *" label (standard required asterisk). Enforcement stays via the disabled
  Upload button + on-submit message. (`VendorPortal.jsx`.)
- **"Pending" → "Awaiting Screening"** everywhere it surfaces: the blank-`FinalStatus` display label
  (`candidate.service.js` `vendorStatusSummary`), the dashboard pipeline tile, the recent-submissions
  fallback, and the bucket/colour matchers (`classifyStatus`, `statusColor`) in `VendorDashboard.jsx`.

### 2026-06-23 — Mandatory vendor picker highlight
- The vendor dropdown on the Vendor Upload page is now visibly **mandatory**: a red asterisk label
  ("Uploading on behalf of vendor *"), a red (error-state) border, and a caption that reads
  "* Required before uploading" until a vendor is chosen (turns green "✓ Vendor selected"). (`VendorPortal.jsx`.)
- **Glossary — "Pending" on the Vendor Dashboard:** candidates whose `FinalStatus` is empty/null —
  i.e. submitted but not yet moved into any interview/decision stage (no outcome recorded). Generated
  in `candidate.service.js` (`vendorStatusSummary` maps blank `FinalStatus` → "Pending") and bucketed
  client-side by `classifyStatus`.

### 2026-06-23 — Dashboard insights + picker placement consistency
- **Vendor picker placement unified:** on the Vendor Upload page the staff vendor dropdown now sits
  in the **top-right of the page header**, matching the Vendor Dashboard exactly (same style/position).
  An inline hint appears in the upload card until a vendor is chosen. (`VendorPortal.jsx`.)
- **Richer Vendor Dashboard:** replaced the sparse "Candidates by Status" tag list with a **Hiring
  Pipeline** section — a selection-rate gauge (`Selected ÷ (Selected + Rejected)`) plus stage tiles
  (Selected / In Process / On Hold / Rejected / Pending), with the detailed raw status tags kept
  below. All derived client-side from the existing status breakdown (no extra API). (`VendorDashboard.jsx`.)

### 2026-06-23 — Self-healing for Awaiting → Saved
- **Root cause:** the write-time hook in `submitPublicMissingData` only covers the public form and
  one job per candidate. In practice a candidate can be completed via other paths (recruiter edit,
  merge, re-upload) and can have **multiple** job rows, so some `Missing_Information` jobs were left
  stale even though `rpa_cv.statusActive = 'ACTIVE'`.
- **Fix:** `getUploadJobs` now **self-heals on every load** — a single SQL UPDATE flips any
  `Missing_Information` job whose linked candidate (`cv_id → rpa_cv`) is already `ACTIVE` to
  `Saved to Database`. Cheap (filtered on status) and best-effort. The live socket hook is kept for
  real-time updates of the common case. (`vendor.controller.js`.)
- **To clear existing stuck rows:** just reload the Upload Status dashboard.

### 2026-06-23 — Fail-safe when job table isn't provisioned
- Fixed `Cannot read properties of undefined (reading 'create')` — it occurs when the Prisma
  client has no `rpa_upload_jobs` model (table not yet provisioned / client not regenerated).
- Added `jobsModelReady()` guard in `uploadJob.service.js`; all job-tracking calls now **no-op
  gracefully** (one warning) instead of crashing the upload. The new `rpa_cv_tmp` review columns
  (`source`, `reviewStatus`) are only written when the model is present. `getUploadJobs` returns an
  empty list and `reprocessJob` returns 503 until provisioned.
- **Reminder:** the Prisma **model in `schema.prisma` is a client mapping only — it does not create
  or alter the database.** Provision the DB via the DDL in [Data model](#data-model), then
  `npx prisma db pull` + `npx prisma generate` to make the client aware of it.

### 2026-06-23 — Fixes: missing-info completion + merge status consistency
- **Merge now sets the right status:** if a merged candidate still has missing fields (a
  missing-data email is sent), the job is set to **Awaiting Candidate Details** instead of
  wrongly showing **Saved to Database**. Once the candidate submits the details it advances to
  Saved. (`hrUpload.service.js` — `mergeDuplicates` post-merge flip is now conditional on
  `updatedCv.missingData`.)
- **Missing-info completion made robust:** the advance-on-submission hook now matches the job by
  **`cv_id` *and* candidate email** (previously `cv_id` only), and the merge-status fix removes the
  case where a Missing-Information job had been prematurely marked Completed (which had blocked the
  hook). (`uploadJob.service.js` `updateJobByCvId`, `candidate.controller.js` `submitPublicMissingData`.)
- **Note:** requires a backend restart (and the Prisma client must include `rpa_upload_jobs`).

### 2026-06-23 — UX refinements from first test pass
- **Friendlier status labels** (UI only; stored values unchanged): `Completed → "Saved to Database"`,
  `Cancelled → "Rejected by Recruiter"`, `Missing_Information → "Awaiting Candidate Details"`,
  `Uploaded → "Received"`, `Queued → "Waiting in Queue"`, `Duplicate_Pending_Review → "Pending Recruiter Review"`,
  `Failed → "Processing Failed"`.
- **"Jobs" wording softened** for end users: the panel is now **"Upload Status"** (not "Upload Jobs"),
  the stat is **"Total Uploads"**, and the footer reads "Total N uploads".
- **Role-aware columns:** on a **vendor's** screen the recruiter-facing columns *Uploaded By*,
  *Vendor*, and *Action Required* are hidden (plus the *Pending Review* stat and *Show Action
  Required* filter); recruiters' vendor screens still show everything.
- **Missing-Information now completes:** when a candidate submits their missing details (and nothing
  remains missing), the originating upload job advances `Awaiting Candidate Details → Saved to
  Database`. Hooked into the missing-fields submission handler in `candidate.controller.js` via a new
  `updateJobByCvId` helper. Files: `VendorPortal.jsx`, `candidate.controller.js`, `uploadJob.service.js`.

### 2026-06-23 — Enterprise duplicate review queue + persistent dashboard + background processing
- **Vendor duplicates now go to a recruiter review queue** instead of just firing an alert email and skipping. A duplicate is staged in `rpa_cv_tmp` as *Duplicate – Pending Review* and the recruiter is notified (email + in-app).
- **New durable job-tracking table `rpa_upload_jobs`** — one row per uploaded resume; the upload page is now a **persistent dashboard** that survives refresh/navigation and reloads state from the DB.
- **Real-time updates via Socket.io** (`upload:job`, `review:new`); `NotificationBell` wired to live events (mock data removed).
- **Recruiter review actions**: Merge (update existing candidate, keep blanks, rebuild vector, missing-fields email) and Cancel (delete staging row, audit trail). Both flip the job status and write to `rpa_processing_log`.
- **Reprocess** capability for failed jobs.
- **Phase 2 — optional durable queue**: parsing can run on the existing BullMQ + Redis worker (off by default, `USE_RESUME_QUEUE=true`). When off, parsing runs in-process exactly as before.
- Files: `uploadJob.service.js` (new), `hrUpload.service.js`, `vendor.controller.js`, `vendor.routes.js`, `resumeWorker.js`, `resumeQueue.js`, `server.js`, frontend `VendorPortal.jsx`, `services/socket.js` (new), `NotificationBell.jsx`, `vendorService.js`.
- **DB:** applied **manually in PostgreSQL** (DDL in [Data model](#data-model)), then `prisma db pull` + `prisma generate`. No Prisma schema hand-edits and no auto-migration.

### 2026-06-23 — Recruiter uploads on behalf of a vendor
- Added a **required vendor picker** on the Vendor Upload page for internal staff (non-vendor roles). Staff choose which vendor they upload for; the candidate is attributed to that vendor (`VendorEmail` + `vendorName`) and gets the 90-day lock — so it appears in that vendor's isolated dashboard.
- Vendors logging in still upload for themselves (no picker), unchanged.
- Attribution is validated server-side against a real `role: 'vendor'` account.
- Files: `vendor.controller.js`, `vendor.routes.js`, frontend `VendorPortal.jsx`.

---

## Current Vendor Workflow

### 1. Background & vendor isolation (the foundation)

Vendor isolation hinges on a single column: **`rpa_cv.VendorEmail`**. A candidate "belongs to" a
vendor only if that column equals the vendor's email. Vendor dashboards and candidate lists are
hard-scoped to it server-side, so a vendor can never see another vendor's candidates. Vendor uploads
enter through `POST /api/vendor/upload` with source `vendor_portal`.

### 2. Who can do what (access control)

All `/api/vendor/*` routes require authentication. Beyond that:

| Capability | Vendor | Recruiter / HR | Admin / SuperAdmin |
|---|---|---|---|
| View dashboard (`/dashboard`) | ✅ own only | ✅ any vendor | ✅ any vendor |
| Vendor picker list (`/vendors`) | ❌ | ✅ | ✅ |
| Upload (`/upload`) | ✅ for self | ✅ on behalf of a vendor | ✅ on behalf of a vendor |
| List candidates / batches / jobs | ✅ own only | ✅ scoped to chosen vendor | ✅ |
| Reprocess failed job (`/jobs/:id/reprocess`) | ✅ | ✅ | ✅ |
| Review merge/cancel (`/review/*`) | ❌ **never** | ✅ | ✅ |

- Upload-family routes are additionally gated by `checkModuleAccess('vendor_upload')`, so even an
  allowed role needs the `vendor_upload` module toggle enabled.
- The legacy `hr` role is treated as recruiter-tier (`ROLE_RANK.hr = 20`). Vendors are rank 10 — the lowest.
- File constraints: only `.pdf`, `.docx`, `.zip`; max **50 MB/file**; up to **100 files** per request.

### 3. Attribution — whose vendor a resume belongs to

Decided at upload time:

- **Vendor uploads for self** → `vendorEmail` / `vendorName` = the logged-in vendor's own identity.
- **Staff uploads on behalf of a vendor** → must pass `vendorEmail` in the body, validated against a
  real `rpa_users` row with `role = 'vendor'`.
  - Missing `vendorEmail` → **400** "Please select a vendor to upload on behalf of."
  - Not a real vendor → **400** "Selected vendor not found."

The resulting `attribution = { vendorEmail, vendorName }` flows all the way into parsing. The Gemini
parser is explicitly instructed to **use the provided vendor as-is and never override it from resume text**.

### 4. Upload pipeline (`POST /api/vendor/upload`)

1. Reject if no files (**400**).
2. Resolve attribution (§3).
3. **Unzip**: `.zip` archives are flattened; directory entries, dotfiles, and `__MACOSX` are skipped;
   extracted files are renamed `vendor-resumes-*`. The temp zip is deleted.
4. If nothing valid remains after unzipping → **400** "No valid files found inside the uploaded ZIP archive(s)."
5. Create a **batch summary** row (`rpa_upload_batch_summary`) whose `details` records `vendor_email`,
   `vendor_name`, and the file list.
6. Create one **`rpa_upload_log`** row per file (status `pending`, source `vendor_portal`).
7. Create one durable **`rpa_upload_jobs`** row per file (status `Uploaded`) carrying the vendor
   attribution — this powers the persistent dashboard.
8. `dispatchBatchParsing(..., 'vendor_portal', attribution)`.
9. Respond immediately with `executionId` (parsing runs in the background).

**Dispatch mode**: if `USE_RESUME_QUEUE === 'true'`, each file becomes a durable BullMQ job
(status → `Queued`); otherwise it runs in-process via `setImmediate`.

### 5. End-to-end flow

```
Upload (vendor self / staff on-behalf)
  │
  ├─ create rpa_upload_jobs row  → status "Uploaded"      (every resume)
  ├─ create rpa_upload_log row + batch summary
  └─ dispatch parsing  ──────────────────────────────────────────────┐
                                                                      │
Parsing (runBatchParsing) per resume:                                │
  status "Processing"  →  extract text  →  AI parse  →  dedup check   │
        │                                                            │
        ├─ NEW candidate      → INSERT into rpa_cv (main table)      │
        │                       + stamp 90-day vendor lock           │
        │                       status "Completed" / "Missing_Information"
        │                                                            │
        └─ DUPLICATE          → INSERT into rpa_cv_tmp (review queue)│
                                status "Duplicate_Pending_Review"     │
                                action_required = true                │
                                notify recruiter (email + socket)     │
                                                                      │
Recruiter review (staff only):                                       │
  ├─ Merge  → update existing rpa_cv, rebuild vector, emails, job "Completed", audit
  └─ Cancel → delete staging row, job "Cancelled", audit
```

**Important clarifications:**
- `rpa_upload_jobs` rows and `upload:job` socket events are created for **every** resume.
- `rpa_cv_tmp` (staging) and the `review:new` notification happen **only for duplicates**.
- A **new** (non-duplicate) candidate is saved straight to `rpa_cv` — it never touches `rpa_cv_tmp`.

### 6. Per-resume parsing outcomes (every scenario)

For each file, text is extracted (PDF/DOCX, or each row of an `.xlsx`), parsed by Gemini, and the
original is uploaded to OneDrive (local-path fallback if OneDrive fails). Then one of these applies:

**Scenario A — Missing email.** If no `EmailID`/`unique_key` is parsed → an "EmailID NULL" alert email
is sent, the file is marked **Failed**, processing moves on.

**Scenario B — New candidate (no match in `rpa_cv`).** Match is attempted by **email OR contact-number
array intersection**. No match → inserted straight into `rpa_cv` with `VendorEmail`/`vendorName` set to
the attribution. Post-processing then stamps a **fresh 90-day vendor lock** (§8), generates the
embedding + AI insights, and sends welcome / missing-data emails. Job → `Completed` (or
`Missing_Information` if required fields are absent).

**Scenario C — Duplicate (match exists).** Because the source is `vendor_portal`, the resume is **routed
to the review queue** (`rpa_cv_tmp`, `reviewStatus = pending_review`) rather than auto-merged. The
staging row carries the incoming `VendorEmail`/`vendorName`. The job → `Duplicate_Pending_Review` with
`action_required = true`, emitting a `review:new` socket event to recruiter/hr/admin/superadmin.
A duplicate-alert email is sent, **chosen by comparing the incoming vendor to the existing candidate's
current vendor**:

| Existing candidate's vendor vs. incoming | Email sent | Recipient |
|---|---|---|
| Same vendor | `sendSameVendorDuplicateAlert` | that vendor |
| Different vendor | `sendDifferentVendorDuplicateAlert` | the incoming vendor |
| Existing has no vendor | `sendDuplicateAlertEmail` (internal HR) | HR team / uploading user |

**Scenario D — Parse failure.** Any extraction/Gemini error → file marked **Failed**, error accumulated.
At batch end, if any failed, a single consolidated `sendResumeErrorAlert` is sent.

> The "directly update existing candidate" branch in `runBatchParsing` is **only** for automated
> email-ingest sources — vendor uploads always go through the review queue.

### 7. Recruiter review of vendor duplicates (staff only)

**Merge — `POST /api/vendor/review/merge` → `mergeDuplicates`.** In a transaction, per staging id:
- Re-find a match in `rpa_cv` (email/contact intersection).
- **If matched**: merge fields — `ContactNumber`/`EmailID` get unique-appended; `employment_history`
  prefers non-empty; everything else prefers the newly parsed value, else keeps existing. Vendor
  attribution + lock are decided by §8, **not** by the generic field merge.
- **If no match**: insert as a new candidate; stamp a 90-day lock if it carries a vendor.
- Delete the staging row, write an `HR_APPROVED_MERGE` audit log (`rpa_processing_log`) with the actor
  + `actor_context` (`vendor_duplicate` when the staging row came from a vendor) and a human-readable
  `mergeOutcome`.
- After the transaction: vector + AI insights regenerated, welcome/missing emails sent, the originating
  job flipped to `Completed` (or `Missing_Information` if the merged record still has gaps). A
  best-effort n8n merge webhook fires if configured.

**Cancel — `POST /api/vendor/review/cancel` → `deleteDuplicates`.** Writes a `REVIEW_CANCELLED` audit
log (noting the vendor email), flips the job to `Cancelled`, deletes the staging rows, and fires a
best-effort n8n delete webhook.

### 8. The 90-day vendor lock-in (core ownership rule)

Helpers: `addDaysIso(90)` sets expiry = today + 90 days; `isVendorLockActive` is true while today ≤ expiry.

- **First save of a vendor-sourced candidate** (new insert in Scenario B, or insert-from-staging on
  merge): if it carries a vendor and has no lock → stamp a fresh 90-day lock.
- **Merge into an existing candidate:**
  - **Lock still active** → first vendor keeps ownership; incoming vendor/email/lock are **not**
    disturbed. (`"vendor attribution preserved (lock active until <date>)"`)
  - **Lock expired/never set AND incoming duplicate carries a vendor** → the new vendor **takes over**,
    with a fresh 90-day lock. (`"vendor attribution updated to <name> with a fresh 90-day lock"`)
  - **Incoming has no vendor** (e.g. internal HR duplicate) → existing attribution preserved as-is.

**Net rule:** whichever vendor submits a candidate first "owns" them for 90 days. A second vendor
submitting the same candidate during that window lands in the review queue with a *different-vendor*
alert but **cannot** seize ownership — only after the 90 days lapse can a later vendor's merge transfer it.

### 9. Dashboards & job tracking

- **`GET /dashboard`** — vendors see their own stats; staff see an all-vendors overview, or a single
  vendor via `?vendorEmail`. Includes a `pendingReview` count (jobs with `action_required`).
- **`GET /candidates`** — vendor's own candidates; staff get an **empty list** until they choose a vendor.
- **`GET /jobs`** — the durable per-resume feed, **hard-scoped to `source = 'vendor_portal'`** (HR manual
  uploads never appear here). Visibility by role: **admin/superadmin** see all vendor-portal jobs;
  **recruiter/hr** see only the records **they themselves uploaded** (`uploaded_by_id`) **plus** anything
  needing review (`action_required`, the shared review queue) — they do **not** see other recruiters'/admin's
  uploads; **vendors** see only their **own** self-uploads. Staff may still narrow to one vendor via
  `?vendorEmail`. On each call it **self-heals**: any `Missing_Information` job whose linked `rpa_cv` is now
  `ACTIVE` is advanced to `Completed`.
- **`POST /jobs/:id/reprocess`** — only **Failed** jobs (else 400). Finds the stored file on disk; if
  it's gone → **422** "please re-upload." Otherwise the job → `Queued` (attempts incremented), a
  `REPROCESS` log is written, and parsing is re-dispatched **with the original vendor attribution preserved**.
- **`GET /batches`** / **`GET /summary/:executionId`** — recent batches by uploader and a single
  batch's live summary.

Every status transition is persisted and pushed over Socket.io (`upload:job` to the uploader;
`review:new` to review roles when action is required).

### 10. Status lifecycle

Stored on `rpa_upload_jobs.status` (underscored values); the UI shows the friendly label:

| Stored value | UI label | Meaning |
|---|---|---|
| `Uploaded` | Received | Row created at upload, not yet processing |
| `Queued` | Waiting in Queue | Enqueued for the durable worker (only when `USE_RESUME_QUEUE=true`) |
| `Processing` | Processing | Text extraction + AI parse + dedup running |
| `Duplicate_Pending_Review` | Pending Recruiter Review | Candidate already exists → staged in `rpa_cv_tmp`, awaiting recruiter |
| `Missing_Information` | Awaiting Candidate Details | Saved, but mandatory fields missing (email sent); advances to *Saved to Database* once the candidate submits them |
| `Completed` | Saved to Database | Saved/merged successfully |
| `Failed` | Processing Failed | Processing error (eligible for Reprocess) |
| `Rejected_By_System` | Rejected by System | Resume had no valid email **and** no phone — cannot be identified/deduped; re-upload with at least one (not reprocessable) |
| `Cancelled` | Rejected by Recruiter | Recruiter rejected the duplicate |

### 11. Key concepts

**The "job table" — `rpa_upload_jobs`.** An ordinary PostgreSQL table (not a service, not paid) giving
durable, per-resume status tracking. The upload page reads it on open, so status survives page refresh,
navigation, and server restarts. Holds file name, candidate name/email, uploaded_by, vendor, status,
`is_duplicate`, `action_required`, links to `cv_id` / `cv_tmp_id`, and timestamps. Managed by
`uploadJob.service.js` (`createJobsForBatch`, `setJobStatus`, `updateJobByCvTmpId`, `serializeJob`).

**Socket.io — real-time updates.** A free, open-source WebSocket library already in the project. Lets
the server **push** updates to the browser instead of polling. Events: `upload:job` (a resume's status
changed → dashboard row updates live) and `review:new` (a duplicate needs review → recruiter's
NotificationBell updates live). Helpers in `socket/index.js` (`emitToUser`, `emitToRole`); client in
`services/socket.js`. If the socket can't connect, the dashboard still works — it reloads from the table.

**BullMQ job queue (optional, different from the job table).** A free, open-source background-job queue
(MIT) backed by Redis, already installed. **OFF by default.** With `USE_RESUME_QUEUE=true`, each resume
becomes a BullMQ job processed by `resumeWorker.js`; otherwise parsing runs in-process via
`setImmediate` (unchanged behavior). A "BullMQ job" (unit of work in Redis) ≠ an `rpa_upload_jobs` row
(a status record in Postgres) — they share the word *job* but are unrelated.

### 12. Graceful degradation

The entire job-tracking layer depends on the `rpa_upload_jobs` table being provisioned. If the Prisma
client lacks that model, `jobsModelReady()` returns false and job tracking silently no-ops — the core
upload/parse/merge flow still works, the dashboards just return empty feeds, and `reprocessJob` returns 503.

### 13. Data model

> **Applied manually in PostgreSQL** (the team owns the DB). The Prisma schema is **not** hand-edited;
> after running the DDL below, bring the models into Prisma with `npx prisma db pull` then
> `npx prisma generate`.

- **New `rpa_upload_jobs`** — durable per-resume job tracking (see §11). Indexed on `vendor_email`,
  `status`, `execution_id`, `action_required`, `updated_at`.
- **`rpa_cv_tmp`** — add `reviewStatus` (`pending_review | merged | cancelled`) and `source`
  (`vendor_portal | hr_manual_upload`). Vendor attribution (`VendorEmail`, `vendorName`) is carried so
  a merge stamps the vendor + 90-day lock.
- **`rpa_processing_log`** — reused for the audit trail (merge / cancel / reprocess events); no change.

**DDL to run (idempotent, additive, non-destructive):**

```sql
-- 1) Job-tracking table
CREATE TABLE IF NOT EXISTS rpa_upload_jobs (
  id              BIGSERIAL PRIMARY KEY,
  execution_id    VARCHAR(100) NOT NULL,
  file_name       TEXT NOT NULL,
  file_url        TEXT,
  status          TEXT NOT NULL DEFAULT 'Uploaded',
  candidate_name  TEXT,
  candidate_email TEXT,
  uploaded_by     TEXT,
  uploaded_by_id  INTEGER,
  vendor_email    TEXT,
  vendor_name     TEXT,
  source          TEXT DEFAULT 'vendor_portal',
  is_duplicate    BOOLEAN NOT NULL DEFAULT FALSE,
  action_required BOOLEAN NOT NULL DEFAULT FALSE,
  cv_id           BIGINT,
  cv_tmp_id       BIGINT,
  bull_job_id     TEXT,
  error_message   TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_upload_jobs_vendor  ON rpa_upload_jobs (vendor_email);
CREATE INDEX IF NOT EXISTS idx_upload_jobs_status  ON rpa_upload_jobs (status);
CREATE INDEX IF NOT EXISTS idx_upload_jobs_exec    ON rpa_upload_jobs (execution_id);
CREATE INDEX IF NOT EXISTS idx_upload_jobs_action  ON rpa_upload_jobs (action_required);
CREATE INDEX IF NOT EXISTS idx_upload_jobs_updated ON rpa_upload_jobs (updated_at DESC);

-- Auto-maintain updated_at at the DB level (so it works regardless of the ORM)
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_upload_jobs_updated ON rpa_upload_jobs;
CREATE TRIGGER trg_upload_jobs_updated
BEFORE UPDATE ON rpa_upload_jobs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2) Review-queue columns on the staging table
ALTER TABLE rpa_cv_tmp ADD COLUMN IF NOT EXISTS "reviewStatus" TEXT DEFAULT 'pending_review';
ALTER TABLE rpa_cv_tmp ADD COLUMN IF NOT EXISTS source TEXT;
CREATE INDEX IF NOT EXISTS idx_rpa_cv_tmp_review_status ON rpa_cv_tmp ("reviewStatus");
```

### 14. API endpoints

| Method & path | Purpose | Access |
|---|---|---|
| `POST /api/vendor/upload` | Upload resumes (vendor self / staff on-behalf, `vendorEmail` required for staff) | vendor + staff w/ `vendor_upload` |
| `GET /api/vendor/dashboard` | Dashboard summary (vendor-scoped, staff all-vendors or `?vendorEmail`) | vendor + staff |
| `GET /api/vendor/candidates` | Vendor's candidate list | vendor + staff |
| `GET /api/vendor/vendors` | Vendor list for the staff picker | staff |
| `GET /api/vendor/batches` | Recent upload batches | vendor + staff |
| `GET /api/vendor/jobs` | Persistent dashboard feed (paginated; vendor-scoped, staff by `?vendorEmail`) | vendor + staff |
| `POST /api/vendor/jobs/:id/reprocess` | Re-run a failed job | vendor + staff |
| `POST /api/vendor/review/merge` | Merge selected duplicates into main DB | staff only |
| `POST /api/vendor/review/cancel` | Cancel/reject selected duplicates | staff only |
| `GET /api/vendor/summary/:executionId` | Batch summary details | vendor + staff |

### 15. Configuration & operational steps

DB changes are applied **manually in PostgreSQL** (we do not auto-create schema). Order:
1. **Run the DDL in §13** against the database (psql / your DB tool).
2. **Stop the backend**, then introspect + regenerate the client so Prisma knows the new table/columns:
   `cd backend && npx prisma db pull && npx prisma generate`. *(`db pull` reads the live DB and adds
   `rpa_upload_jobs` + the new `rpa_cv_tmp` columns to `schema.prisma` automatically — no hand-editing.)*
3. **Restart the backend.** Until steps 1–2 are done, the new endpoints will error because the Prisma
   client doesn't yet know `rpa_upload_jobs`.
4. **(Optional, Phase 2)** to use the durable queue: set `USE_RESUME_QUEUE=true` and ensure Redis is
   running. Leaving it unset keeps the in-process path — all dashboard/review features still work.

### 16. File map

**Backend**
- [`services/uploadJob.service.js`](../backend/src/services/uploadJob.service.js) — job lifecycle + socket emits
- [`services/hrUpload.service.js`](../backend/src/services/hrUpload.service.js) — parsing, dedup→review queue, merge/cancel, 90-day lock, `runBatchParsing` / `dispatchBatchParsing` (shared engine)
- [`controllers/vendor.controller.js`](../backend/src/controllers/vendor.controller.js) — upload, attribution, jobs feed, reprocess, review actions
- [`routes/vendor.routes.js`](../backend/src/routes/vendor.routes.js) — vendor + staff routes & guards
- [`services/emailNotification.service.js`](../backend/src/services/emailNotification.service.js) — duplicate / same-vendor / different-vendor alert emails
- [`queues/resumeQueue.js`](../backend/src/queues/resumeQueue.js) / [`workers/resumeWorker.js`](../backend/src/workers/resumeWorker.js) — durable queue (optional)
- [`socket/index.js`](../backend/src/socket/index.js) — Socket.io server + emit helpers
- [`server.js`](../backend/src/server.js) — conditional worker startup

**Frontend**
- [`pages/VendorPortal.jsx`](../frontend/src/pages/VendorPortal.jsx) — upload + persistent job dashboard + review modal
- [`pages/VendorDashboard.jsx`](../frontend/src/pages/VendorDashboard.jsx) — vendor stats + hiring pipeline
- [`services/socket.js`](../frontend/src/services/socket.js) — Socket.io client singleton
- [`services/vendorService.js`](../frontend/src/services/vendorService.js) — API methods
- [`components/common/NotificationBell.jsx`](../frontend/src/components/common/NotificationBell.jsx) — live review notifications

---

## How to maintain this doc
When you change the vendor workflow:
1. Add a dated entry at the top of the [Update Log](#update-log) (newest first) — what changed and why.
2. Update the affected section(s) under [Current Vendor Workflow](#current-vendor-workflow)
   (flow, scenarios, statuses, data model, endpoints, file map).
3. Keep the language plain; assume the reader hasn't seen the code.
