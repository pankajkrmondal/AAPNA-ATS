# Resume Upload Enhancements

> **Living document.** Every time we change the vendor/HR resume-upload workflow, add a
> dated entry to the [Update Log](#update-log) (newest first) and update the relevant
> section below. Keep explanations plain enough for a non-author to follow.

---

## Update Log

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
  or alter the database.** Provision the DB via the DDL in §5, then `npx prisma db pull` +
  `npx prisma generate` to make the client aware of it.

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
- Files: `uploadJob.service.js` (new), `hrUpload.service.js`, `vendor.controller.js`, `hrUpload.controller.js`, `vendor.routes.js`, `resumeWorker.js`, `resumeQueue.js`, `server.js`, frontend `VendorPortal.jsx`, `services/socket.js` (new), `NotificationBell.jsx`, `vendorService.js`.
- **DB:** applied **manually in PostgreSQL** (DDL in §5), then `prisma db pull` + `prisma generate`. No Prisma schema hand-edits and no auto-migration.

### 2026-06-23 — Recruiter uploads on behalf of a vendor
- Added a **required vendor picker** on the Vendor Upload page for internal staff (non-vendor roles). Staff choose which vendor they upload for; the candidate is attributed to that vendor (`VendorEmail` + `vendorName`) and gets the 90-day lock — so it appears in that vendor's isolated dashboard.
- Vendors logging in still upload for themselves (no picker), unchanged.
- Attribution is validated server-side against a real `role: 'vendor'` account.
- Files: `vendor.controller.js`, `vendor.routes.js`, frontend `VendorPortal.jsx`.

---

## 1. Background & vendor isolation (the foundation)

Vendor isolation hinges on a single column: **`rpa_cv.VendorEmail`**. A candidate "belongs to"
a vendor only if that column equals the vendor's email. Vendor dashboards and candidate lists
are hard-scoped to it server-side (a vendor can never see another vendor's candidates).

Two upload entry points:
- **Vendor Upload** (`/api/vendor/upload`, source `vendor_portal`) — vendors upload for
  themselves; internal staff upload **on behalf of** a selected vendor.
- **HR Manual Upload** (`/api/hr-upload/upload`, source `hr_manual_upload`) — internal,
  non-vendor candidates.

---

## 2. What happens to an uploaded resume (the flow)

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

**Important clarification** (a common point of confusion):
- `rpa_upload_jobs` rows and `upload:job` socket events are created for **every** resume.
- `rpa_cv_tmp` (staging) and the `review:new` notification happen **only for duplicates**.
- A **new** (non-duplicate) candidate is saved straight to `rpa_cv` — it never touches `rpa_cv_tmp`.

---

## 3. Key concepts explained

### 3a. The "job table" — `rpa_upload_jobs`
- **What:** an ordinary PostgreSQL table in your existing database (not a service, not paid).
- **Why:** durable, per-resume status tracking. The upload page reads it on open, so status
  survives page refresh, navigation, and server restarts.
- **Contents:** file name, candidate name/email, uploaded_by, vendor, status, `is_duplicate`,
  `action_required`, links to `cv_id` / `cv_tmp_id`, timestamps.
- **Managed by:** [`uploadJob.service.js`](../backend/src/services/uploadJob.service.js)
  (`createJobsForBatch`, `setJobStatus`, `updateJobByCvTmpId`, `serializeJob`).

### 3b. Socket.io — real-time updates
- **What:** a free, open-source real-time (WebSocket) library; **already** in the project
  (`socket.io` backend, `socket.io-client` frontend). **Not paid.**
- **Why:** lets the server **push** updates to the browser instantly instead of the page polling.
- **Events:**
  - `upload:job` → a resume's status changed → dashboard row updates live.
  - `review:new` → a duplicate needs review → recruiter's NotificationBell updates live.
- **Backend helpers:** [`socket/index.js`](../backend/src/socket/index.js) (`emitToUser`,
  `emitToRole`). **Frontend client:** [`services/socket.js`](../frontend/src/services/socket.js).
- **Resilience:** if the socket can't connect, the dashboard still works — it reloads from the
  table on demand.

### 3c. BullMQ job **queue** (different from the job table!) — optional
- **What:** a free, open-source background-job queue (MIT) backed by **Redis**. Already installed.
  **Not paid** — the only requirement is running a Redis server (free to self-host).
- **Why:** at enterprise scale (30–50k+ resumes, concurrent uploads) processing should be
  durable across restarts, with retries and controlled concurrency.
- **Status:** **OFF by default.** With `USE_RESUME_QUEUE=true`, each resume becomes a BullMQ job
  processed by [`resumeWorker.js`](../backend/src/workers/resumeWorker.js); otherwise parsing
  runs in-process via `setImmediate` (unchanged behavior).
- **Note:** "BullMQ job" (a unit of work in Redis) ≠ "`rpa_upload_jobs` row" (a status record in
  Postgres). They share the word *job* but are unrelated.

---

## 4. Status lifecycle

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
| `Cancelled` | Rejected by Recruiter | Recruiter rejected the duplicate |

---

## 5. Data model changes

> **Applied manually in PostgreSQL** (the team owns the DB). The Prisma schema is **not**
> hand-edited; after running the DDL below, bring the models into Prisma with
> `npx prisma db pull` then `npx prisma generate` (see §7).

- **New `rpa_upload_jobs`** — durable per-resume job tracking (see §3a). Indexed on
  `vendor_email`, `status`, `execution_id`, `action_required`, `updated_at`.
- **`rpa_cv_tmp`** — add `reviewStatus` (`pending_review | merged | cancelled`) and `source`
  (`vendor_portal | hr_manual_upload`). Vendor attribution (`VendorEmail`, `vendorName`) is
  carried so a merge stamps the vendor + 90-day lock.
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

---

## 6. API endpoints

| Method & path | Purpose | Access |
|---|---|---|
| `POST /api/vendor/upload` | Upload resumes (vendor self / staff on-behalf, `vendorEmail` required for staff) | vendor + staff w/ `vendor_upload` |
| `GET /api/vendor/jobs` | Persistent dashboard feed (paginated; vendor-scoped, staff by `?vendorEmail`) | vendor + staff |
| `POST /api/vendor/jobs/:id/reprocess` | Re-run a failed job | vendor + staff |
| `POST /api/vendor/review/merge` | Merge selected duplicates into main DB | staff only |
| `POST /api/vendor/review/cancel` | Cancel/reject selected duplicates | staff only |
| `GET /api/vendor/vendors` | Vendor list for the staff picker | staff |

(HR Manual Upload retains its own `/api/hr-upload/*` endpoints; the merge/cancel logic is shared.)

---

## 7. Configuration & operational steps

DB changes are applied **manually in PostgreSQL** (we do not auto-create schema). Order:
1. **Run the DDL in §5** against the database (psql / your DB tool).
2. **Stop the backend**, then introspect + regenerate the client so Prisma knows the new
   table/columns: `cd backend && npx prisma db pull && npx prisma generate`.
   *(`db pull` reads the live DB and adds `rpa_upload_jobs` + the new `rpa_cv_tmp` columns to
   `schema.prisma` automatically — no hand-editing.)*
3. **Restart the backend.** Until steps 1–2 are done, the new endpoints will error because the
   Prisma client doesn't yet know `rpa_upload_jobs`.
4. **(Optional, Phase 2)** to use the durable queue: set `USE_RESUME_QUEUE=true` and ensure Redis
   is running. Leaving it unset keeps the in-process path — all dashboard/review features still work.

---

## 8. File map

**Backend**
- [`services/uploadJob.service.js`](../backend/src/services/uploadJob.service.js) — job lifecycle + socket emits *(new)*
- [`services/hrUpload.service.js`](../backend/src/services/hrUpload.service.js) — parsing, dedup→review queue, merge/cancel, `runBatchParsing` / `dispatchBatchParsing`
- [`controllers/vendor.controller.js`](../backend/src/controllers/vendor.controller.js) — upload, attribution, jobs feed, reprocess, review actions
- [`controllers/hrUpload.controller.js`](../backend/src/controllers/hrUpload.controller.js) — HR upload + job creation
- [`routes/vendor.routes.js`](../backend/src/routes/vendor.routes.js) — vendor + staff routes
- [`queues/resumeQueue.js`](../backend/src/queues/resumeQueue.js) / [`workers/resumeWorker.js`](../backend/src/workers/resumeWorker.js) — durable queue (optional)
- [`socket/index.js`](../backend/src/socket/index.js) — Socket.io server + emit helpers
- [`server.js`](../backend/src/server.js) — conditional worker startup

**Frontend**
- [`pages/VendorPortal.jsx`](../frontend/src/pages/VendorPortal.jsx) — upload + persistent job dashboard + review modal
- [`services/socket.js`](../frontend/src/services/socket.js) — Socket.io client singleton *(new)*
- [`services/vendorService.js`](../frontend/src/services/vendorService.js) — API methods
- [`components/common/NotificationBell.jsx`](../frontend/src/components/common/NotificationBell.jsx) — live review notifications

---

## How to maintain this doc
When you change the upload workflow:
1. Add a dated entry at the top of the [Update Log](#update-log) (newest first) — what changed and why.
2. Update the affected section(s) above (flow, statuses, endpoints, data model, file map).
3. Keep the language plain; assume the reader hasn't seen the code.
