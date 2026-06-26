# HR Manual Upload

> **Single source of truth for the HR Manual Upload workflow.** Whenever it changes, add a dated entry
> to the [Update Log](#update-log) (newest first) and revise the affected section under
> [Current Behaviour](#current-behaviour). Plain language; assume the reader hasn't seen the code.

HR Manual Upload lets recruiters/HR bulk-upload resumes (`.pdf`, `.docx`, `.zip`, `.xlsx`) into the main
candidate database. It shares the **same parsing engine** as the Vendor flow (`hrUpload.service.js`
`runBatchParsing` / `dispatchBatchParsing`) with `source = 'hr_manual_upload'`, so background processing,
the durable job table, sockets, and the duplicate review queue all behave like the Vendor portal.

Source of truth in code:
- [`controllers/hrUpload.controller.js`](../backend/src/controllers/hrUpload.controller.js) — upload, jobs feed, reprocess, duplicates search/merge/delete
- [`routes/hrUpload.routes.js`](../backend/src/routes/hrUpload.routes.js) — routes & guards (`checkModuleAccess('hr_manual_upload')`)
- [`services/hrUpload.service.js`](../backend/src/services/hrUpload.service.js) — shared parsing/dedup/merge engine + 90-day lock + last-activity stamps
- [`services/uploadJob.service.js`](../backend/src/services/uploadJob.service.js) — durable `rpa_upload_jobs` lifecycle + socket emits
- [`pages/HRUpload.jsx`](../frontend/src/pages/HRUpload.jsx) — upload + live job dashboard + duplicate review
- [`services/hrUploadService.js`](../frontend/src/services/hrUploadService.js) — API methods

---

## Update Log

### 2026-06-26 — Premium pass refinement: quieter success + "Real-time" indicator
- Toned the premium pass to feel more professional: **removed the confetti** (now a single refined check
  with a soft ring), and replaced the bright uppercase **"● LIVE"** badge with an understated muted
  **"● Real-time"** pill (gentle halo, tooltip "updates automatically", no scale-ping). Everything else
  (count-up KPIs, green row-flash on live updates, dropzone progress, shimmer, tag glow, button sheen)
  stays. (`theme/index.css`, `UploadCelebration.jsx`, `HRUpload.jsx`, `VendorPortal.jsx`.)

### 2026-06-26 — Premium UI pass (HR + Vendor upload)
- "Awestruck" but professional polish on both upload screens, all CSS-driven (no new deps):
  **count-up KPI cards** (Total Uploads / Processing / Saved to Database / Pending Review) using the
  shared animated `KpiCard`; a pulsing **"● LIVE"** badge that pings on socket events; rows that **flash
  brand-green the moment their status changes** live; a **drag-active dropzone** + **upload progress bar**;
  a brief **success burst** (check ripple + confetti) on a successful upload; plus shimmer on in-flight
  rows, a glow on action-required tags, and a sheen on primary buttons. Respects `prefers-reduced-motion`.
- New shared pieces: `hooks/useCountUp.js`, `components/common/KpiCard.jsx`,
  `components/common/UploadCelebration.jsx`; a premium block in `theme/index.css`. Backend: `getUploadJobs`
  (vendor + HR) now returns `stats.processing/completed/total` via a cheap status `groupBy`;
  `hrUploadService.uploadResumes` accepts an `onUploadProgress` callback. Files: `HRUpload.jsx`,
  `VendorPortal.jsx`, `theme/index.css`, `hrUpload.controller.js`, `vendor.controller.js`.

### 2026-06-26 — Fix: "Last Activity" column always showed a dash
- The jobs table's **Last Activity** column read `last_action_by`, but that field lives on the candidate
  (`rpa_cv`/`rpa_cv_tmp`), not on the `rpa_upload_jobs` feed — so it was always `—`. Renamed the column to
  **Last Updated** showing the job's `updated_at` (the uploader is already in *Uploaded By*; the who/context
  of the last action is still shown in the full-details modal). (`HRUpload.jsx`.)

### 2026-06-26 — Consolidated to a single duplicate-review surface
- The page had **two** duplicate-review modules — the inline Review in the Upload Status table and a
  separate **Pending Duplicates Review Queue** below. Removed the bottom queue; the **Upload Status table is
  now the single surface** for both processing status and duplicate review (Review → full details →
  Merge / Reject, plus the *Show Action Required* filter to focus on pending duplicates). Dropped the
  now-unused name/email search and bulk merge/delete; the `/duplicates/search|merge|delete` endpoints are
  still used by the per-row Review flow. (`HRUpload.jsx`.)

### 2026-06-26 — Fix: rejection no longer triggers the "Resume Processing Error" email
- A rejected resume (no valid email/phone) was being counted in `failedCount`, so the batch-end
  **Resume Processing Error Alert** fired (Failed/Total 1/1) even though nothing actually failed to
  process. Rejections now increment a separate `rejectedCount`; the error alert fires **only** for genuine
  parse/extraction failures. The per-file "missing email/phone" notification (`sendEmailIdNullAlert`) is
  unchanged, and the job still shows **Rejected by System**. (`hrUpload.service.js`.)

### 2026-06-26 — Fix: parser fabricating an email from the name (bypassed rejection)
- A resume with a name but no email/phone was still **saved** with a made-up email like
  `riya.sharma@example.com` (derived from the name; `example.com` is a placeholder domain). Valid format,
  so it slipped past the reject gate.
- Fix (`hrUpload.service.js`): every parsed email/phone is now **verified against the resume text** — if
  the address/number doesn't actually appear in the source resume, it's dropped (a fabricated identifier
  never matches). Also hardened the parser prompt (rule 7) to forbid inventing/guessing emails & phones or
  using placeholder/example values. Net: this resume is now **Rejected by System**.

### 2026-06-26 — Fix: no-email resume inheriting the uploader's email (bypassed rejection)
- A resume with no email/phone was still being **saved** (not rejected) with `EmailID` set to the
  **uploader's own address** (e.g. `hmopuri@aapnainfotech.com`). Cause: `runBatchParsing` called the AI
  parser with `attrEmail || email` — for HR uploads `attrEmail` is null, so the **uploader's email** was
  passed as the "Vendor Email," and the model echoed it into `EmailID`/`unique_key`. Being a valid email,
  it passed the new reject gate.
- Fix (`hrUpload.service.js`): (1) pass the parser **only the real vendor attribution** (`attrEmail, attrName`)
  — never the uploader's email/name; (2) `sanitizeMatchEmails` now takes an **exclude list** and the
  parse-time call drops the uploader's/vendor's own email (`[email, attrEmail]`) from the candidate's
  identity keys. So this resume now correctly becomes **Rejected by System**.

### 2026-06-25 — Fix: stacked modals when opening "View full details"
- Clicking **View full details** in the Review modal opened the rich candidate modal *on top of* the
  still-open Review modal (two overlapping modals, two ✕). Now only **one modal shows at a time**: opening
  full details closes the compact Review modal and carries the job into the full-details modal, whose
  footer gains **Back to Review / Cancel-Reject / Merge** so the recruiter can still act. Merge/Cancel were
  unified into one `resolveDuplicate(action, job)` used by both modals; the rich modal opened from the
  duplicates queue (read-only) still shows just **Close**. (`HRUpload.jsx`.)

### 2026-06-25 — Fix: Duplicate Review modal footer layout
- The compact Review modal's three footer buttons (View full details / Cancel-Reject / Merge) overflowed
  and wrapped awkwardly. Reworked the footer into a flex row — **View full details** on the left, the two
  actions grouped on the right (wraps gracefully) — and widened the modal to 620px. (`HRUpload.jsx`.)

### 2026-06-25 — Fix: false-positive duplicate match + "Rejected by System"
- A resume with no usable email/phone was wrongly matched as a duplicate of an unrelated candidate and
  merged, fusing the records. The dedupe key fell back to the parser's `unique_key` without validation.
- Fix (`hrUpload.service.js`): match keys now built by `sanitizeMatchEmails` (valid-email-format only) +
  `sanitizeMatchContacts` (drops blanks + the `"9876543210"` placeholder), at **both** the parse-time
  match and the merge re-find. Existing find/merge logic unchanged — just clean keys.
- New rule: no valid email **and** no phone → **"Rejected by System"** (new status `Rejected_By_System`);
  with at least one identifier the candidate is saved and the existing missing-details email follows up.
- Frontend status label added in `HRUpload.jsx` + `VendorPortal.jsx`.

### 2026-06-25 — Green accent aligned to the Search Candidate page
- Reworked the green top accent to match `Candidates.jsx` (the Search Candidate page): the accent is now
  a `borderTop: '4px solid #7a922e'` **directly on the card** (which follows the rounded corners cleanly),
  replacing the inner 3px gradient bar + `overflow: 'hidden'` workaround. Secondary cards use
  `boxShadow: '0 4px 24px rgba(0,0,0,0.06)'` only (like the search results card). (`HRUpload.jsx`,
  `VendorPortal.jsx`.)

### 2026-06-25 — Fixes: dropzone empty-box + green accent overflow
- **Empty grey box:** AntD v5 applies a `Dragger`'s inline `style` to the outer `.ant-upload-wrapper`,
  so the grey background landed on the wrapper (not the drag area) and the `table-cell` content layout
  left it uncentred. Fixed by styling the real `.ant-upload.ant-upload-drag` via scoped `.upload-page`
  CSS (dashed border, flex-centred content, `min-height: 96px`) and removing the inline
  `background`/`borderRadius` from `<Dragger>`.
- **Green accent overflow:** the 3px accent bar stuck out past the cards' rounded corners — restored
  `overflow: 'hidden'` on every card that carries the bar.
- Files: `theme/index.css`, `HRUpload.jsx`, `VendorPortal.jsx`.

### 2026-06-25 — Elegant UI pass (HR + Vendor upload pages)
- Reused the theme's animation kit (`theme/index.css`) for a professional, animated feel — no logic change:
  - Cards **fade-in-up with stagger** on mount (`animate-fade-in-up`, `stagger-2/3`).
  - **Stat tiles** (Total Uploads / Pending Review) fade in and **lift on hover** (new `.stat-tile` class).
  - The **dropzone** lifts + tints on hover and the inbox icon springs (new `.upload-page` scoped CSS +
    `.upload-inbox-icon`).
  - **Hover text (tooltips)** added: every status tag explains what the status means; stat tiles explain
    what they count.
- Files: `theme/index.css` (new scoped block), `HRUpload.jsx`, `VendorPortal.jsx`.

### 2026-06-25 — HR Manual Upload: live job dashboard, reprocess & last-activity
- **Backend jobs feed:** added `GET /api/hr-upload/jobs` (paginated, scoped to `source='hr_manual_upload'`,
  with the same `Missing_Information → Completed` self-heal as Vendor) and `POST /api/hr-upload/jobs/:id/reprocess`.
  (`hrUpload.controller.js`, `hrUpload.routes.js`.) *(Background dispatch + `rpa_upload_jobs` rows + sockets
  already existed in the HR upload handler — only the read/reprocess endpoints were missing.)*
- **Last-activity tracking:** `last_action_by` / `last_action_context` are now stamped on duplicate
  **staging inserts** and on **merge resolution** (`mergeDuplicates`, both update-existing and create-new) —
  applied to **both** HR and Vendor flows. New-candidate inserts already set them. On resolve, last-activity
  records the recruiter who merged (`last_action_context = 'duplicate_merge'`). (`hrUpload.service.js`.)
- **Rebuilt the HR Upload screen** to mirror the Vendor portal: compact dropzone, a persistent **Upload
  Status** table with friendly status labels and **Socket.io live updates** (polling removed), Total
  Uploads / Pending Review stat cards, status + action-required filters, a **Last Activity** column, a
  **Reprocess** button on failed rows, and a **compact Review modal** (Merge/Cancel via the staging
  `cv_tmp_id`) with a **View full details** action. The original **rich Pending Duplicates Review Queue**
  (search + bulk merge/delete + full candidate detail modal) is kept below. (`HRUpload.jsx`,
  `hrUploadService.js` — added `getJobs` + `reprocessJob`.)
- **Known limitation:** Reprocess inherits the Vendor file-locating issue — the job row stores the OneDrive
  URL (or null), not the local filename, so it returns **422 "original file no longer available"** unless the
  file still sits under `/uploads/`. A durable fix (persist the local filename on the job row) is pending.

---

## Current Behaviour

### Access & limits
All `/api/hr-upload/*` routes require auth and the `hr_manual_upload` module toggle (admin/superadmin bypass).
Files: `.pdf`, `.docx`, `.zip`, `.xlsx`; up to 100 per request; 500 MB/request (a `.zip` bundles many).

### Upload pipeline
1. `POST /api/hr-upload/upload` — flattens any `.zip`, writes a `rpa_upload_batch_summary`, one
   `rpa_upload_log` per file, and one durable `rpa_upload_jobs` row per file (status `Uploaded`,
   `source = 'hr_manual_upload'`), then **background-dispatches** parsing and responds immediately.
2. Parsing (`runBatchParsing`) per resume: `Processing → extract → AI parse → dedup`. New candidate →
   inserted into `rpa_cv` (+ last-activity). Duplicate → staged in `rpa_cv_tmp` (`reviewStatus =
   pending_review`, last-activity stamped), job → `Duplicate_Pending_Review`, `action_required = true`,
   recruiter notified (email + `review:new` socket).

### Job dashboard (frontend)
`HRUpload.jsx` loads `GET /hr-upload/jobs` on mount and updates live on `upload:job` / `review:new`
sockets (debounced reload). Duplicate rows expose **Review** (compact Merge/Cancel + View full details);
failed rows expose **Reprocess**.

### Duplicate resolution (single surface — the Upload Status table)
- Duplicate rows (`Duplicate_Pending_Review`, `action_required`) expose a **Review** button →
  compact modal with **Merge** (`/hr-upload/duplicates/merge`) / **Cancel** (`/hr-upload/duplicates/delete`)
  / **View full details**, keyed by the job's `cv_tmp_id`. The full-details modal repeats Merge/Cancel and
  has **Back to Review**. Use the **Show Action Required** filter (or the *Pending Recruiter Review* status
  filter) to focus on the duplicates awaiting review.
- On merge, the resulting `rpa_cv` row records `last_action_by` (the recruiter) + `last_action_context =
  'duplicate_merge'` and a fresh `modifiedAt`.

### Status lifecycle
Same stored values + friendly labels as Vendor (`Uploaded→Received`, `Processing`, `Duplicate_Pending_Review→
Pending Recruiter Review`, `Missing_Information→Awaiting Candidate Details`, `Completed→Saved to Database`,
`Failed→Processing Failed`, `Rejected_By_System→Rejected by System`, `Cancelled→Rejected by Recruiter`). See
[VENDOR_PROCESS.md](./VENDOR_PROCESS.md) §10 for the table.

`Rejected_By_System` = the resume had no valid email **and** no phone, so it can't be identified or
deduped; it is rejected (not saved, not reprocessable). Re-upload with at least one identifier.

### Data model
No schema changes — reuses `rpa_upload_jobs`, `rpa_cv_tmp.reviewStatus/source`, and the existing
`rpa_cv` / `rpa_cv_tmp` `last_action_by` / `last_action_context` columns.

---

## How to maintain this doc
When you change HR Manual Upload: add a dated [Update Log](#update-log) entry (newest first), then revise
the affected [Current Behaviour](#current-behaviour) section. Keep the language plain.
