# C2C Vendor Integration — Enterprise-Grade Plan (Reviewed & Detailed)

## 1. Context & purpose

The platform already runs a mature **placement-vendor (Category A)** workflow on a *single shared engine*:

- **Upload / parse / dedup / merge** — [hrUpload.service.js](../backend/src/services/hrUpload.service.js) → `runBatchParsing(executionId, files, user, source, attribution)` (1724 lines). It is **already parameterized by `source`** (`hr_manual_upload | vendor_portal | email_intake`), branching at line ~1260 on duplicate handling.
- **Screening / scoring** — [screening.service.js](../backend/src/services/screening.service.js) (2266 lines), `searchRoleCandidates(mrfId)` / `searchKeywordCandidates(filters)`, tightly coupled to `rpa_cv` with weighted axes (skills, education, stability…).
- **Durable job tracking + Socket.io** — [uploadJob.service.js](../backend/src/services/uploadJob.service.js) (`rpa_upload_jobs`, live `upload:job` / `review:new` events).
- **MRFs** live in `rpa_mrf_jd_send` ([mrf.controller.js](../backend/src/controllers/mrf.controller.js)); **roles/modules** in [config/roles.js](../backend/src/config/roles.js).

The flowchart adds **Category B — C2C vendor**, a parallel pipeline that differs on a handful of axes but **shares** the back half. The intent of this document is to (a) review the original draft, (b) lock the three architecture decisions, and (c) specify the build precisely enough to execute.

### 1.1 What actually differs for C2C (read from the flowchart, step by step)

| Step | Category A — Placement | Category B — C2C | Shared? |
|---|---|---|---|
| 1 Registration | vendor profile + module access | same **+ vendor_type=C2C** | mostly |
| 2 JD sharing | Share JD to vendors | same **+ Duration + Rate** (required) | new flow, both |
| 3 CV upload | recruiter or vendor uploads; selects vendor | same, **name only — no email/phone** | engine shared |
| 4 Dedup | **email + phone** (hard unique) | **name only** (soft, collisions expected) | engine shared, rule differs |
| 5 Storage | main `rpa_cv` + **90-day lock** | **separate table, no lock** | no |
| 6 Screening | full score (skills+education+stability) | **partial — skills only** | scorer shared, profile differs |
| 7 Status update | recruiter updates status | **same** | **yes** |
| 8 Notifications | candidate **+** vendor | **vendor only (NDA)** | rule differs |
| 9 Tracking | shared per-vendor dashboard | **same dashboard** | **yes** |
| 10 Pending review | Merge / Reject | **Accept-as-new** / Merge / Reject | UI parallel |

The key reading: **steps 7, 8 (recipient aside), and 9 are shared.** Any design that makes those three expensive is the wrong design.

---

## 2. Review of the original draft

**Strengths — keep as-is:**
- Separate C2C storage (`rpa_cv_c2c` / `rpa_cv_c2c_tmp`). Data isolation protects the main table's **hard email/phone unique constraints** and avoids a confusing nullable 90-day-lock column on `rpa_cv`. ✔
- `vendor_type` on `rpa_users`; NULL ⇒ `placement` (backward-compatible). ✔
- Net-new **Share JD** flow with Duration + Rate, dynamically appended to the email. ✔
- **"Accept as new"** action + **contextual UI tagging** (`Rahul Kumar | Vendor: Apex Corp | MRF: Senior Java`) rather than corrupting the raw `Name`. ✔
- Vendor-only notifications; never email the parsed candidate. ✔

**Primary flaw — forking the two engines.** The draft proposed:
- `c2cUpload.service.js` — a parallel clone of the 1724-line `runBatchParsing`.
- `c2cScreening.service.js` — a parallel clone of the 2266-line scorer.

The [VENDOR_PROCESS.md](VENDOR_PROCESS.md) Update Log shows the placement parse/dedup path was bug-fixed **five times in the last few days** (fabricated identifiers, uploader-email leak into `EmailID`, false-positive duplicate merge, no-identifier "Rejected by System", same/different-vendor alert routing). **A clone forces every future fix to be applied twice**, and the two copies *will* drift. This is precisely the technical debt the fork claims to avoid — relocated from the data layer (where it's cheap and isolated) to the service layer (where it's expensive and bug-prone). **Reject the fork; parameterize instead.**

**Secondary gaps:**
1. **Name-only dedup as the *only* signal** → the review queue floods with false "common name" collisions, and a genuine same-human resubmission across two C2C vendors goes undetected. (Fixed by Decision 2.)
2. **Dedup confined to the C2C pool** → a candidate already in the main `rpa_cv` (possibly under another vendor's *active 90-day lock*) can be re-submitted to the client through C2C, creating an ownership/double-submission conflict. (Fixed by Decision 3.)
3. **Shared steps 7–9 not addressed.** With two fully separate tables, the shared tracking dashboard and status views must `UNION` everywhere. (Fixed by a single read-side view, Decision 1.)

---

## 3. The three architecture decisions

### Decision 1 — Storage: separate `rpa_cv_c2c` table **+ one shared, parameterized engine** (not a fork)

Honor the flowchart's "separate C2C table" — data isolation is the correct, enterprise-grade choice. But drive it through the **existing** `runBatchParsing` by adding a new `source = 'c2c_vendor'` with a small **profile object** that declares the behavioural deltas:

```js
// hrUpload.service.js — source profiles
const SOURCE_PROFILE = {
  vendor_portal:    { targetTable: 'rpa_cv', stagingTable: 'rpa_cv_tmp',
                      dedup: 'email+phone', persistPII: true,  applyLock: true,  notify: 'candidate+vendor' },
  hr_manual_upload: { targetTable: 'rpa_cv', stagingTable: 'rpa_cv_tmp',
                      dedup: 'email+phone', persistPII: true,  applyLock: false, notify: 'candidate' },
  c2c_vendor:       { targetTable: 'rpa_cv_c2c', stagingTable: 'rpa_cv_c2c_tmp',
                      dedup: 'name+inMemoryPII', persistPII: false, applyLock: false, notify: 'vendor_only',
                      crossCheckMainPool: true },
};
```

**What stays single-sourced (the 90%):** unzip/flatten, text extraction, Gemini parse, `ResumeTechnicalTerms` counting, OneDrive upload, `rpa_upload_jobs` lifecycle, batch summary, Socket.io emits, error consolidation, reprocess. **What branches (the 10%):** the duplicate-match key, the cross-check, the insert shape (different table/columns), PII persistence, and the notification recipient. These are 4–5 small `if (profile.…)` forks inside the existing loop, not a new file.

**Shared steps 7–9 — one read-side view** keeps dashboards/status single-sourced:
```sql
CREATE OR REPLACE VIEW rpa_candidates_all AS
  SELECT id, "Name", "FinalStatus", "VendorEmail", "vendorName",
         'placement'::text AS candidate_type, source_mrf_id, "createdAt"
    FROM rpa_cv
  UNION ALL
  SELECT id, "Name", "FinalStatus", "VendorEmail", "vendorName",
         'c2c'::text AS candidate_type, source_mrf_id, "createdAt"
    FROM rpa_cv_c2c;
```
Reads (Step 9 tracking, Step 7 status list) go through the view with a `candidate_type` filter; writes use a thin type-aware helper. No scattered UNIONs.

### Decision 2 — PII: **match in-memory, never persist**

Parse extracts email/phone (the engine already does, with the hardened verify-against-resume-text logic at `hrUpload.service.js:1212-1232`). For C2C we **use those identifiers only to compute the dedup key in memory, then drop them before insert** — `persistPII:false` guarantees they are never stored, displayed, or emailed. NDA-compliant *and* a real dedup signal, strictly better than name-only. The candidate remains uncontactable; the vendor relationship is preserved.

> Note: this reuses the existing `sanitizeMatchEmails` / `sanitizeMatchContacts` + "verify the identifier is actually in the resume text" guards, so the C2C match inherits the recent fabricated-identifier fixes for free — another reason not to fork.

### Decision 3 — Cross-check the main pool: **yes, flag (never auto-act)**

For a C2C upload, after the in-memory PII match against `rpa_cv_c2c`, run a second in-memory match against `rpa_cv`. If the person already exists there — especially under an **active 90-day vendor lock** (`isVendorLockActive`) — route the staging record to review with an informational `already_in_main_pool = true` flag. It *informs* the recruiter (avoid double client-submission / ownership conflict); it must never auto-merge or auto-reject across the C2C/main boundary.

**Resulting C2C dedup routing:**

```
C2C upload → parse → (in-memory) email/phone + name
   ├─ no name match in c2c pool AND not in main pool → INSERT rpa_cv_c2c   (persist Name+skills+vendor, NO PII, NO lock)
   ├─ name match in c2c pool                         → rpa_cv_c2c_tmp  (review: Accept-as-new / Merge / Reject)
   └─ found in main rpa_cv (PII match)               → rpa_cv_c2c_tmp  (review, flagged already_in_main_pool)
```

"Accept as new" exists because **a name collision in C2C is the expected case, not an error** — two different real people often share a name, and PII is intentionally absent from storage.

---

## 4. Build — phase by phase

### Phase 1 — Data layer  *(manual PostgreSQL DDL, then `prisma db pull` + `prisma generate` — per VENDOR_PROCESS §15; the team owns the DB, schema is never hand-edited)*

```sql
-- 1) Vendor registration fields (NULL vendor_type ⇒ placement, backward-compatible)
ALTER TABLE rpa_users ADD COLUMN IF NOT EXISTS vendor_type    VARCHAR(20);
ALTER TABLE rpa_users ADD COLUMN IF NOT EXISTS contact_number VARCHAR(20);
ALTER TABLE rpa_users ADD COLUMN IF NOT EXISTS vendor_skills  TEXT;

-- 2) Separate C2C storage — NO email/phone unique constraint, NO lock column
CREATE TABLE IF NOT EXISTS rpa_cv_c2c (
  id BIGSERIAL PRIMARY KEY,
  "Name" TEXT NOT NULL, "Top5KeySkills" TEXT, "PositionApplied" TEXT,
  "TotalExperienceYears" TEXT, "CurrentLocation" TEXT, "CurrentCompany" TEXT,
  "CTC_LPA" TEXT, "ExpectedCTC_LPA" TEXT, "NoticePeriod" TEXT,
  "HighestQualification" TEXT, employment_history JSON,
  "VendorEmail" TEXT NOT NULL, "vendorName" TEXT,
  "cvFileUrl" TEXT, resume_full_text TEXT, resume_technical_terms JSON DEFAULT '[]',
  "FinalStatus" TEXT, "statusActive" TEXT DEFAULT 'ACTIVE',
  source_mrf_id BIGINT, ai_profile_insights JSON,
  "createdAt" TIMESTAMPTZ DEFAULT now(), "modifiedAt" TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rpa_cv_c2c_vendor ON rpa_cv_c2c ("VendorEmail");
CREATE INDEX IF NOT EXISTS idx_rpa_cv_c2c_name   ON rpa_cv_c2c (lower("Name"));

-- 3) C2C review/staging queue — mirrors rpa_cv_c2c + review columns
CREATE TABLE IF NOT EXISTS rpa_cv_c2c_tmp (LIKE rpa_cv_c2c INCLUDING DEFAULTS);
ALTER TABLE rpa_cv_c2c_tmp ADD COLUMN IF NOT EXISTS "reviewStatus" TEXT DEFAULT 'pending_review';
ALTER TABLE rpa_cv_c2c_tmp ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE rpa_cv_c2c_tmp ADD COLUMN IF NOT EXISTS already_in_main_pool BOOLEAN DEFAULT FALSE;

-- 4) Carry C2C through the existing durable job feed
ALTER TABLE rpa_upload_jobs ADD COLUMN IF NOT EXISTS vendor_type VARCHAR(20);

-- 5) Shared read view for steps 7–9 (Decision 1)
CREATE OR REPLACE VIEW rpa_candidates_all AS
  SELECT id,"Name","FinalStatus","VendorEmail","vendorName",'placement'::text AS candidate_type,source_mrf_id,"createdAt" FROM rpa_cv
  UNION ALL
  SELECT id,"Name","FinalStatus","VendorEmail","vendorName",'c2c'::text AS candidate_type,source_mrf_id,"createdAt" FROM rpa_cv_c2c;
```
All additive, idempotent, non-destructive. Existing placement behaviour untouched.

### Phase 2 — Registration (Step 1)
- [admin.controller.js](../backend/src/controllers/admin.controller.js): `createUser` / `updateUser` accept `vendor_type` (`placement|c2c`), `contact_number`, `vendor_skills` when `role = vendor`; missing ⇒ `placement`.
- AdminDashboard frontend: Vendor Type select + Contact Number + Skills, shown only when Role = Vendor.
- No change to [roles.js](../backend/src/config/roles.js) — `vendor_type` is a sub-attribute of the existing `vendor` role, not a new role (keeps the rank/module model intact).

### Phase 3 — Share JD to vendor (Step 2, net-new)
- New `POST /api/mrf/:id/share-jd` in [mrf.controller.js](../backend/src/controllers/mrf.controller.js): body = `{ vendorEmails[], c2c_rate?, contract_duration? }`. Loads the `rpa_mrf_jd_send` row; sends simultaneous email + in-app (Socket.io `review:new`-style) notification to each selected vendor.
- New `sendVendorJDEmail` in [emailNotification.service.js](../backend/src/services/emailNotification.service.js): **reuse** the existing `generateMrfEmailTable(...)` builder; append **Duration** and **Rate** blocks only when provided (required for C2C, optional for placement).
- MRF detail view: "Share JD" button → modal (multi-select vendors, optional Duration + Rate).

### Phase 4 — Upload & dedup through the SHARED engine (Steps 3–4)
- [hrUpload.service.js](../backend/src/services/hrUpload.service.js): introduce `SOURCE_PROFILE` (Decision 1) and add the `c2c_vendor` branch at the existing duplicate-routing site (~line 1260) and the insert site. Concretely:
  - dedup key: `profile.dedup === 'name+inMemoryPII'` → primary match `lower(Name)` against `rpa_cv_c2c`, secondary in-memory PII match against `rpa_cv` (Decision 3).
  - persistence: `profile.persistPII === false` → omit `EmailID`/`ContactNumber` from the `rpa_cv_c2c` insert.
  - lock: skip the `addDaysIso(90)` stamp when `applyLock === false`.
  - notify: `vendor_only` → send the vendor alert, suppress candidate welcome/missing-data emails.
- [vendor.controller.js](../backend/src/controllers/vendor.controller.js) `uploadResumes`: select source from `req.user.vendor_type` — `c2c` ⇒ `dispatchBatchParsing(..., 'c2c_vendor', attribution)`, else existing `vendor_portal`. Job rows carry `vendor_type` so the existing dashboard feed/statuses work unchanged.

### Phase 5 — Pending review & "Accept as new" (Step 10)
- New `c2cReview.controller.js` (parallels the vendor review actions in `vendor.controller.js`):
  - `POST /api/vendor/c2c-review/merge` — overwrite the matched `rpa_cv_c2c` row.
  - `POST /api/vendor/c2c-review/reject` — delete the staging row (+ audit).
  - `POST /api/vendor/c2c-review/accept-new` — promote staging → a **new** `rpa_cv_c2c` row alongside the existing (the expected-collision path).
- Routes registered in [vendor.routes.js](../backend/src/routes/vendor.routes.js) under the **staff-only** guard (review is never vendor-accessible — matches the existing `/review/*` rule).
- UI (review queue): **contextual tagging** (`Name | Vendor | MRF`), never mutate `Name`; surface `already_in_main_pool` as a warning chip. Reuse `NotificationBell` + `review:new` events.

### Phase 6 — Partial screening through the SHARED scorer (Step 6)
- [screening.service.js](../backend/src/services/screening.service.js): add a `scoringProfile` parameter. C2C profile = 3 axes (**Skills**, **CTC alignment**, **Notice period**), education + stability **weights zeroed**, source table = `rpa_cv_c2c`, and the Gemini prompt limited to those axes. **Reuse** the existing scoring scaffold (`searchRoleCandidates` / `searchKeywordCandidates`) — only the lean source query (fewer columns) and the weight vector are C2C-specific.
- [screening.controller.js](../backend/src/controllers/screening.controller.js): `GET /api/screening/c2c/search` invokes the scorer with the C2C profile.

### Phase 7 — Frontend
- New `frontend/src/pages/C2CVendorPortal.jsx`: tailored upload screen — no candidate email/phone fields; NDA banner ("C2C mode: candidate contact info is automatically stripped"). Reuses the existing premium upload components (`KpiCard`, `UploadCelebration`, Socket.io live rows).
- [App.jsx](../frontend/src/App.jsx): on vendor login, render `<C2CVendorPortal />` when `vendor_type === 'c2c'`, else `<VendorPortal />`.
- [VendorDashboard.jsx](../frontend/src/pages/VendorDashboard.jsx): C2C variant hides email/phone columns and reads the C2C candidate endpoint. The **shared tracking dashboard (Step 9)** reads `rpa_candidates_all` with a `candidate_type` filter, so both categories appear per-vendor with no UNION logic in the controller.

### Steps 7–9 (shared) — explicit handling
- **Step 7 status update** and **Step 9 tracking** read through `rpa_candidates_all`; writes go through a thin type-aware helper that targets `rpa_cv` or `rpa_cv_c2c`.
- **Step 8 notifications**: placement = candidate + vendor; C2C = vendor only (`profile.notify`).

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Shared-engine branch regresses placement | `SOURCE_PROFILE` defaults preserve exact current behaviour for `vendor_portal`/`hr_manual_upload`; Phase-1 DDL is additive; verification step 10 is a full placement regression. |
| Name-only collisions flood review | Decision 2 (in-memory PII match) + Decision 3 cross-check sharpen the signal; "Accept as new" makes the expected case one click. |
| C2C row leaks PII | `persistPII:false` omits the columns from the insert entirely; the C2C table has no email/phone columns to populate. |
| Schema drift between `rpa_cv_c2c` and `rpa_cv_c2c_tmp` | `CREATE TABLE … (LIKE rpa_cv_c2c INCLUDING DEFAULTS)` keeps them structurally identical. |
| Prisma client unaware of new tables | Same graceful-degradation pattern as `jobsModelReady()`; run `prisma db pull && prisma generate` before enabling C2C routes. |

## 6. Rollout order
1. Apply Phase-1 DDL → `prisma db pull && prisma generate` → restart backend.
2. Ship Phase 2 (registration) — safe, additive.
3. Ship Phase 3 (Share JD) — net-new, no impact on existing flows.
4. Ship Phase 4–5 (upload + review) behind `vendor_type` routing.
5. Ship Phase 6–7 (screening + portal).
6. Update docs (§8).

---

## 7. Verification

1. **DDL:** `rpa_cv_c2c` / `rpa_cv_c2c_tmp` have **no** email/phone unique constraint and **no** lock column; `rpa_candidates_all` returns both categories. Then `prisma db pull && prisma generate`.
2. **Registration:** create a C2C vendor; `vendor_type`/contact/skills persist; an existing vendor still resolves as placement.
3. **Share JD:** share an MRF with Duration + Rate → email + portal notification reach selected vendors; Rate/Duration blocks render.
4. **C2C routing:** log in as C2C vendor → `C2CVendorPortal` renders; upload → runs through the **shared** `runBatchParsing` with `source='c2c_vendor'`; lands in `rpa_cv_c2c` with **no** stored email/phone and **no** lock.
5. **Dedup (Decisions 2 & 3):** same name twice → second to `rpa_cv_c2c_tmp`. A resume whose email matches an `rpa_cv` candidate → staging row flagged `already_in_main_pool`. Confirm email/phone never persisted anywhere.
6. **Accept as new:** Accept-as-new on a name collision → both candidates exist independently; UI shows contextual tags; `Name` unchanged.
7. **Screening:** C2C search scores only Skills/CTC/Notice; education + stability absent; data from `rpa_cv_c2c`.
8. **Notifications:** **zero** emails to any parsed candidate address on C2C upload; vendor receives theirs.
9. **Shared 7–9:** update a C2C candidate's status → appears in the shared per-vendor tracking dashboard beside placement candidates.
10. **Regression:** a full placement vendor upload (dedup → 90-day lock → merge → emails) is unchanged — proves the shared engine wasn't regressed.

## 8. Docs
Add a dated entry to the [VENDOR_PROCESS.md](VENDOR_PROCESS.md) Update Log and supersede this plan with the as-built C2C section once implemented (honoring the repo's "log every change set in the relevant docs Update Log" convention).
