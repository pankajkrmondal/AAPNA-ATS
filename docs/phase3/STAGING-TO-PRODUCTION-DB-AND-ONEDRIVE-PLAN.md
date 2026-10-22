# Staging → Production: Database & OneDrive Migration Plan

**Date:** 2026-09-09 (re-verified against live databases the same day)
**Deployment branch:** `project-staging` @ `8017aee` (*Merge pull request #91 from pankaj-work-staging-v17*)
**Status:** analysis + plan only — no code changed
**Supersedes for the DB part:** [PHASE3-PRODUCTION-DEPLOYMENT.md](../deployment/PHASE3-PRODUCTION-DEPLOYMENT.md) (2026-08-06 — covers 11 of the 23 DDL files, misses the drift in §A.3, and describes a deploy that §0.2 shows never actually ran)

---

## 0. Scope, method, and what production is really running

### 0.1 Method

Both databases were introspected read-only on 2026-09-09 — twice, several hours apart —
comparing `pg_class`, `information_schema.columns`, `pg_constraint`, `pg_indexes`, `pg_proc`,
`pg_trigger`, `pg_views`, `pg_matviews`, `information_schema.sequences`, `pg_extension` and row
counts. Nothing was written to either database. Every figure below is a live production count,
not an estimate.

Between the two runs the **structural** comparison came back byte-identical; only row counts and
the mailbox sync cursor moved. That re-run matters — it is what proves the §A.4.1 blocker is
still actively growing (see there).

| | Staging | Production |
|---|---|---|
| Database | `recruitmentautomationdb` | `recruitmentautomationdbProd` |
| Host | `20.244.34.176:5432` | same host, same `appuser` role |
| PostgreSQL | 18.1 (Ubuntu) | 18.1 (Ubuntu) — **identical** |
| Extensions | 2 (incl. `vector`) | 2 — **identical versions** |
| Public tables | 49 | 28 |
| Columns | 789 | 461 |
| Constraints | 382 | 138 |
| Indexes | 160 | 56 |
| Sequences | 42 | 21 |
| Views / matviews | 0 | 0 |
| User functions | 5 | 5 |
| Triggers | 6 | 6 |
| DB size | — | **332 MB** |

**Production carries the real data** (9,139 CVs vs 443 in staging; 17,323 email messages vs
2,632). This is a *schema-forward* migration onto live data — never a data copy in either
direction.

### 0.2 ⚠ The current `project-staging` HEAD has never been deployed to production

`project-staging` is the deployment branch and has been released to production before. But the
release that is pending now is far larger than a normal increment, and the evidence is
unambiguous from two independent directions:

**From the repository.** The most recent production snapshot in the repo is
`origin/project-production-backup-06-08-2026` (*"Added ATS production backup (06-08-2026)"*).
Diffed against `project-staging`:

| Measure | Result |
|---|---|
| Backend files changed | **213 files, +44,777 / −1,444 lines** |
| DDL files (`backend/prisma/ddl/*.sql`) in the production snapshot | **0** — the folder does not exist |
| DDL files on `project-staging` | **23** |
| `src/routes/pipeline.routes.js` | absent from the snapshot |
| `src/services/interviewSchedule.service.js` | absent |
| `src/services/documentCollection.service.js` | absent |
| `src/jobs/interviewRecordings.js` | absent |
| `src/controllers/notification.controller.js` | absent |

**From the production database.** It holds **0 of the 21** Phase-3 tables, and
`rpa_email_templates_category_check` still lacks `stage_outcome` — which is Step 1 of the
2026-08-06 runbook. That runbook was written but **never executed**.

The two agree: production is running a **pre-Phase-3 codebase** and a Phase-2-baseline schema.
Nothing since 2026-08-06 has landed there. Treat this as a first-time Phase-3 release, not an
incremental one — in particular, do not assume any DDL file has already been applied.

> Branch note: `project-staging` and `pankaj-work-staging-v17` are **identical in code**. The
> only difference between the two trees is this planning document. Every code-side finding below
> was verified against `project-staging`'s own tree, including the 23-file DDL set.

---

# PART A — DATABASE

## A.1 Functions and triggers — near-identical, two exceptions

All **6 triggers** exist in both databases with **byte-identical definitions**:

| Trigger | Table | Function | When |
|---|---|---|---|
| `trg_rpa_cv_resume_tsvector` | `rpa_cv` | `fn_rpa_cv_resume_tsvector_update()` | BEFORE INSERT/UPDATE OF `resume_full_text` |
| `trg_rpa_cv_tmp_resume_tsvector` | `rpa_cv_tmp` | `fn_rpa_cv_tmp_resume_tsvector_update()` | BEFORE INSERT/UPDATE OF `resume_full_text` |
| `trg_email_templates_modified` | `rpa_email_templates` | `update_modified_at()` | BEFORE UPDATE |
| `trg_shortlisted_modified` | `rpa_shortlisted_candidates` | `update_modified_at()` | BEFORE UPDATE |
| `trg_upload_jobs_updated` | `rpa_upload_jobs` | `set_updated_at()` | BEFORE UPDATE |
| `after_user_insert` | `rpa_users` | `seed_module_permissions()` | AFTER INSERT |

All **5 user-defined functions** exist in both. The other 118 functions in each database belong
to the `vector` extension and need no attention. **Two function bodies differ:**

### A.1.1 `seed_module_permissions()` — production is missing two module keys · **ACTION REQUIRED**

Production's array seeds 7 modules; staging's seeds 8. Separately, `recruitment_pipeline` is
absent from **both** function bodies but present in staging's `rpa_module_permissions` data (so
it is being granted by application code or by hand, not by the trigger).

| Module key | In prod function | In staging function | Rows in staging | Rows in prod |
|---|---|---|---|---|
| `vendor_upload`, `new_mrf`, `search_candidates`, `hr_manual_upload`, `system_config`, `candidate_screening`, `screening_analytics` | ✅ | ✅ | yes | yes |
| **`outlook_email`** | ❌ | ✅ | yes | **no** |
| **`recruitment_pipeline`** | ❌ | ❌ | yes | **no** |

**Consequence if not fixed:** every user created in production after go-live silently gets no
row for `outlook_email` or `recruitment_pipeline`, so the Candidate Pipeline and Outlook Email
modules never appear for them — with no error anywhere. Existing users need a backfill too
(prod has 63 permission rows across 8 users; staging has 99 across 10).

### A.1.2 `fn_rpa_cv_tmp_resume_tsvector_update()` — whitespace only · **no action**

Identical logic, different indentation. Cosmetic; ignore.

---

## A.2 New tables — 21 tables from 23 DDL files

Every one of the 21 tables that exist only in staging is covered by a file in
`backend/prisma/ddl/` on `project-staging`. **Apply in filename (date) order** — later files
ALTER what earlier ones CREATE.

| # | DDL file | Creates | Alters |
|---|---|---|---|
| 1 | `2026-07-21-pipeline-stage-engine.sql` | `rpa_pipeline_stages`, `rpa_stage_outcomes`, `rpa_outcome_reasons`, `rpa_stage_email_templates`, `rpa_candidate_pipeline`, `rpa_pipeline_stage_events` | `rpa_email_templates` (widens category CHECK) |
| 2 | `2026-07-23-interview-scheduling.sql` | `rpa_interview_schedule` | — |
| 3 | `2026-07-24-assessment-import.sql` | `rpa_assessment_imports`, `rpa_assessment_test_mappings`, `rpa_assessment_results` | — |
| 4 | `2026-07-25-assessment-invites.sql` | `rpa_assessment_invites` | `rpa_assessment_results` |
| 5 | `2026-07-25-interview-occurrence.sql` | — | `rpa_interview_schedule` |
| 6 | `2026-07-25-interviewer-scorecard.sql` | `rpa_interview_scorecard`, `rpa_interview_scorecard_skill` | — |
| 7 | `2026-07-25-teams-meeting-details.sql` | — | `rpa_interview_schedule` |
| 8 | `2026-07-29-document-collection.sql` | `rpa_document_checklist_items`, `rpa_document_requests`, `rpa_candidate_documents` | — |
| 9 | `2026-07-29-hr-scorecard-fields.sql` | — | `rpa_interview_scorecard` |
| 10 | `2026-07-29-offer-management.sql` | `rpa_offers` | — |
| 11 | `2026-07-31-notifications.sql` | `rpa_notifications` | — |
| 12 | `2026-08-11-mrf-filled-at.sql` | — | `rpa_mrf` |
| 13 | `2026-08-12-vendor-status-templates.sql` | — | `rpa_email_templates`, `rpa_upload_jobs`, `rpa_cv` (index), `rpa_settings` (2 rows) |
| 14 | `2026-08-26-mrf-manual-closure.sql` | — | `rpa_mrf` |
| 15 | `2026-08-26-shortlist-status-vocabulary.sql` | — | `rpa_shortlisted_candidates` (widens status CHECK) |
| 16 | `2026-08-28-mrf-paused.sql` | — | `rpa_mrf` |
| 17 | `2026-09-01-interview-recording-options.sql` | — | `rpa_interview_schedule` |
| 18 | `2026-09-01-interview-recordings.sql` | `rpa_interview_recording` | `rpa_interview_schedule`, `rpa_settings` (3 rows) |
| 19 | `2026-09-02-onedrive-item-ids.sql` | — | `rpa_cv`, `rpa_candidate_documents` |
| 20 | `2026-09-03-assessment-result-detail.sql` | — | `rpa_assessment_results` |
| 21 | `2026-09-03-recording-share-links.sql` | `rpa_recording_share_link` | — |
| 22 | `2026-09-03-zeko-shared-report-link.sql` | — | `rpa_zeko_interview_results` |
| 23 | `2026-09-04-referral-candidate.sql` | `rpa_referral_audit` | `rpa_cv` |

Ordering note: files 5, 6 and 7 share the `2026-07-25` date. Alphabetical order puts
`assessment-invites` → `interview-occurrence` → `interviewer-scorecard` →
`teams-meeting-details`, which is safe (occurrence and teams-meeting only ALTER
`rpa_interview_schedule`, created in file 2). A plain `ls | sort` loop is fine.

Per §0.2, **none of these has run in production** — apply all 23.

This part of the migration is **purely additive** — nothing is dropped or renamed, so rollback
is cheap (§A.7).

---

## A.3 Drift on tables that ALREADY EXIST in production — the part no DDL file covers

This is the material finding of the analysis and the reason the 2026-08-06 runbook is not
sufficient on its own. Staging has objects on **pre-existing** tables that **no file in
`backend/prisma/ddl/` creates**. They arrived in staging by hand or by an ad-hoc script that was
never captured, so a run-the-DDL-folder deploy misses them entirely.

### A.3.1 Covered by a DDL file — no extra work

| Table | Object | Covered by |
|---|---|---|
| `rpa_cv` | `cv_file_item_id` | file 19 |
| `rpa_cv` | `is_referral`, `referred_by`, `referral_note`, `referral_set_by`, `referral_set_at`, `idx_cv_referral` | file 23 |
| `rpa_cv` | `idx_rpa_cv_vendor_lock` | file 13 |
| `rpa_mrf` | `filled_at` | file 12 |
| `rpa_mrf` | `closed_at`, `closure_reason`, `closure_note` | file 14 |
| `rpa_mrf` | `paused_at`, `paused_reason`, `paused_by`, `resume_on` | file 16 |
| `rpa_upload_jobs` | `advisory` | file 13 |
| `rpa_zeko_interview_results` | `shared_report_link`, `shared_report_link_at` | file 22 |
| `rpa_email_templates` | category CHECK += `stage_outcome` | file 1 |
| `rpa_email_templates` | category CHECK += `vendor_status` | file 13 |
| `rpa_shortlisted_candidates` | status CHECK += 6 values | file 15 |

### A.3.2 **NOT covered by any DDL file — must be scripted by hand**

| # | Table | Prod rows | Missing in production | Impact if skipped |
|---|---|---|---|---|
| D1 | `rpa_email_messages` | 17,323 | `PRIMARY KEY (id)` | Prisma model declares `@id`; no DB-level guarantee |
| D2 | `rpa_email_messages` | 17,323 | `UNIQUE (graph_message_id)` | **Live, growing data bug — see §A.4.1** |
| D3 | `rpa_email_messages` | 17,323 | 6 FKs → `rpa_outlook_accounts`, `rpa_cv`, `rpa_mrf`, `rpa_shortlisted_candidates`, `rpa_users`, `rpa_email_templates` | Orphan rows accumulate |
| D4 | `rpa_email_messages` | 17,323 | 8 indexes (`account`, `candidate`, `conversation`, `direction`, `from`, `mrf`, `sent_at DESC`, `shortlist`) | Email module scans 17k rows per query |
| D5 | `rpa_email_tracking` | 1,938 | `PRIMARY KEY (id)`, `UNIQUE (tracking_token)`, FK → `rpa_email_messages` ON DELETE CASCADE, 2 indexes | Open/reply tracking unreliable |
| D6 | `rpa_email_log` | 14,014 | columns `status TEXT NOT NULL DEFAULT 'sent'`, `error_message TEXT` | **Email Analytics endpoint 500s — see §A.4.2** |
| D7 | `rpa_cv_tmp` | 356 | `PRIMARY KEY (id)` | Staging-only integrity guarantee |
| D8 | `rpa_sessions` | 1 | `UNIQUE (token)`, FK `user_id` → `rpa_users(id)`, `created_at DEFAULT now()` | Duplicate session tokens possible |
| D9 | `rpa_cv` | 9,139 | `CHECK chk_resume_text_quality IN ('extracted','lossy','failed','unknown')` | Unvalidated values |
| D10 | `rpa_mrf` | 5 | `total_years_of_experience` and `relevant_years_of_experience` are **`text` in prod, `int4` in staging** | Prisma type mismatch on the MRF model |

**Recommendation:** capture D1–D10 as a new, reviewed DDL file
(`backend/prisma/ddl/2026-09-09-prod-parity-backfill.sql`) rather than pasting SQL into a
console, so production and staging finally agree on a single applied-file history. Draft SQL is
in §A.6 Step 3.

---

## A.4 Blockers — measured against live production data

Two of the D-items **cannot be applied as-is**. Both were confirmed by counting real production
rows, twice, on 2026-09-09.

### A.4.1 🔴 BLOCKER — `UNIQUE (graph_message_id)` will fail, and the problem is growing

| Measurement | Run 1 | Run 2 (same day) |
|---|---|---|
| Total rows in `rpa_email_messages` | 17,305 | **17,323** |
| Distinct `graph_message_id` values appearing more than once | 2,836 | **2,840** |
| Rows sitting inside a duplicate group | 11,689 | **11,706** |
| Rows to remove to make the column unique (keep lowest `id`) | 8,853 | **8,866** |
| Largest single duplicate group | 18 copies | **18 copies** |
| Duplicate groups whose rows differ in `direction` or `sent_at` | 0 | **0** |
| Rows with `graph_message_id IS NULL` (legal under UNIQUE) | 4,941 | 4,941 |

**Root cause.** [inboundEmailSync.js:117-143](../../backend/src/jobs/inboundEmailSync.js#L117-L143)
inserts each message and relies on the database raising a unique violation (`P2002`) to skip a
re-delivered message. Production has never had that constraint, so every poller restart and
every delta re-emit re-inserted the same message.

**It is still happening.** Between the two runs the deletable-row count rose 8,853 → 8,866 and
the `inbound_sync_last_sync` cursor advanced from `11:01:24Z` to `12:44:22Z`. The poller is live
and the duplicates accumulate every tick. Whatever numbers you act on, **re-count immediately
before running the dedup** — the figures above will be stale by the deploy date.

The zero on the second-to-last row is the important one: within every duplicate group the rows
are identical on `direction` and `sent_at`, so these are genuine re-inserts of one Graph
message, not distinct events. Deduplication is safe, but it deletes ~8,900 rows of production
data and therefore needs explicit sign-off, not a silent script.

**Decision needed before the deploy (see §D-1).** Recommended sequence:

1. Snapshot the losers first, so the delete is reversible without a full restore.
2. Re-point `rpa_email_tracking.message_id` from each loser to the surviving lowest `id`
   (do this **before** deleting, or the CASCADE in D5 would take tracking rows with it).
3. Delete the losers.
4. Add the UNIQUE constraint, which then also stops the growth for good.

### A.4.2 🔴 BLOCKER — Email Analytics is broken in production today

`rpa_email_log` in production has **no `status` column**, but
[emailTemplate.controller.js:199-222](../../backend/src/controllers/emailTemplate.controller.js#L199-L222)
runs `groupBy({ by: ['status'] })` and `findMany({ where: { status: 'failed' } })` against it.
Any production build carrying the current Prisma schema will 500 on the Email Analytics endpoint
until D6 is applied.

Adding the column is cheap — `DEFAULT 'sent'` backfills all **14,014** existing rows in one
statement, which is the correct historical value (rows were only ever written on a successful
send).

### A.4.3 🟡 CAUTION — 34 orphan rows block three foreign keys

| FK | Orphan rows | `id` range |
|---|---|---|
| `rpa_email_messages.candidate_id` → `rpa_cv` | **1** | 3271 |
| `rpa_email_messages.mrf_id` → `rpa_mrf` | **8** | 3279–3387 |
| `rpa_email_messages.shortlist_id` → `rpa_shortlisted_candidates` | **25** | 3271–3401 |
| `account_id`, `template_id`, `sent_by_user_id` | 0 | — |

Stable across both runs. All 34 sit in a narrow `id` band (3271–3401) and every one of the
staging FKs is `ON DELETE SET NULL` — so nulling the orphaned pointers matches the intended
semantics exactly and loses no message. Note `rpa_shortlisted_candidates` is **empty (0 rows)**
in production, so all 25 shortlist pointers are necessarily dangling.

### A.4.4 🟢 CLEARED — everything else applies without remediation

Verified zero-conflict against live production data, in both runs:

| Check | Result |
|---|---|
| `rpa_email_messages.id` NULL or duplicate | 0 / 0 |
| `rpa_email_tracking` id NULL/dup, token NULL/dup, orphan `message_id` | 0 / 0 / 0 |
| `rpa_cv_tmp.id` NULL or duplicate | 0 |
| `rpa_sessions` token NULL/dup, orphan `user_id` | 0 / 0 |
| `rpa_cv.resume_text_quality` outside the CHECK domain | 0 |
| `rpa_mrf` experience values not castable to integer | 0 (values: `NULL/10, 3/1, 0/4, 3/3, 2/2`) |
| `rpa_email_templates.category` outside prod's current CHECK | 0 |
| `rpa_shortlisted_candidates.pipeline_status` outside staging's widened CHECK | 0 |

D7, D8, D9, D10 and both CHECK widenings are therefore safe to apply directly.

---

## A.5 Reference and configuration data to seed

### A.5.1 Seed scripts (already exist, `:prod` variants present in `package.json`)

| Command | Creates | Expected count |
|---|---|---|
| `npm run seed:stages:prod` | pipeline stages, outcomes, reasons | 12 / 45 / 9 |
| `npm run seed:documents:prod` | document checklist items | 3 |
| `npm run seed:recipients:prod` | email-recipient settings rows | — ⚠ see §A.5.4 |
| `NODE_ENV=production node prisma/seed-email-templates.js` | email templates | see A.5.2 |

### A.5.2 ⚠ Email templates — 29 missing, and the seed can overwrite production wording

Staging holds **44** templates; production holds **15**. The 29 absent from production:

- **stage_outcome (8):** `Closure — Approved`, `Closure — Backed Out`, `Closure — Candidate Withdrawn`, `Closure — Did Not Join`, `Closure — Joined`, `Closure — Joined and Left`, `Closure — On Hold`, `Closure — Rejected`
- **stage_outcome (3):** `Stage Outcome — Approved`, `Stage Outcome — Hold`, `Stage Outcome — Rejected`
- **interview (10):** `Interview Scheduled — Candidate` / `— Panel`, `Interview Rescheduled — Candidate` / `— Panel`, `Interview Cancelled — Candidate` / `— Panel`, `Interview Reminder — Candidate` / `— Panel`, `Interview Attendance Check`, `Interview No-Show Notice`
- **interview (2):** `Scorecard Invitation — Interviewer`, `Scorecard Invitation — Leadership Round`
- **onboarding (2):** `Document Collection Request`, `Document Collection Reminder`
- **offer (1):** `Offer Approval Reminder`
- **vendor_status (2):** `Vendor — Candidate Status Update`, `Vendor — Candidate Milestone (No Detail)`
- **general (1):** `Recruitment Process & Interview Stages`

Three hazards:

1. `seed-email-templates.js` **upserts**, so any of production's 15 templates that the seed
   matches is silently reverted to the seed's wording. Export first.
2. Two seed entries match by **category** (`shortlist`, `rejection`) using `findFirst` — if
   production has more than one row in either category the seed overwrites an arbitrary one.
   Run the pre-flight query in §A.6 Step 5 before seeding.
3. The `vendor_status` and `stage_outcome` categories only become legal after DDL files 1 and 13
   run. **Never seed before the DDL.**

### A.5.3 `rpa_settings` — 15 keys absent from production (prod has 19, staging 34)

| Key | Staging value | Seeded by | Action |
|---|---|---|---|
| `interview_reminder_enabled` | `true` | *nothing* | **insert by hand** |
| `interview_reminder_interval_min` | `2` | *nothing* | **insert by hand** |
| `interview_reminder_lead_min` | `15` | *nothing* | **insert by hand** |
| `interview_occurrence_enabled` | `true` | *nothing* | **insert by hand** |
| `interview_occurrence_interval_min` | `2` | *nothing* | **insert by hand** |
| `interview_occurrence_grace_min` | `5` | *nothing* | **insert by hand** |
| `assessment_deadline_days` | `2` | *nothing* | **insert by hand** |
| `assessment_auto_advance_enabled` | `true` | *nothing* | insert as **`false`** for go-live |
| `interview_recording_enabled` | `true` | DDL 18 (as `false`) | DDL inserts `false`; flip deliberately |
| `interview_recording_interval_min` | `15` | DDL 18 | ✅ automatic |
| `interview_recording_grace_min` | `10` | DDL 18 | ✅ automatic |
| `email_recipients.vendorStatus.to` | `''` | DDL 13 | ✅ automatic (then set real addresses) |
| `email_recipients.vendorStatus.cc` | `''` | DDL 13 | ✅ automatic |
| `ZEKO_CLIENT_ID` | `69f0588cf518e199e4c3f3a8` | *nothing* | insert only if Zeko goes live in prod |
| `mailbox_delta_link` | *(runtime cursor)* | — | **DO NOT COPY** — prod has its own, live cursor |

**Why the hand-inserted rows matter.** A missing settings row reads as *disabled*, not as the
code default — the interview-recording job shipped broken for weeks for exactly this reason (see
the comment in `2026-09-01-interview-recordings.sql:61-64`). Without these rows the interview
reminder and occurrence-sweep crons **never register at all** in production, with no error in
the log.

### A.5.4 Settings that intentionally differ — **do not overwrite**

Production already holds correct, live values that staging does not. These must survive the
deploy untouched:

| Key | Production (keep) | Staging (do not copy) |
|---|---|---|
| `email_recipients.mrfApproval.to` | `aroy@…, sroy@…` | `hmopuri@…, saukumar@…, pkmondal@…` |
| `email_recipients.mrfOutcome.to` | `recruitment@aapnainfotech.in` | `hmopuri@…, saukumar@…` |
| `email_recipients.mrfOutcome.cc` | `sroy@…, nsatywali@…, cverma@…` | *(empty)* |
| `email_recipients.mrfSubmitHrNotify.to` | `recruitment@aapnainfotech.in, nsatywali@…, cverma@…` | `hmopuri@…, saukumar@…` |
| `email_recipients.missingEmailAlert.to` | `nsatywali@…, cverma@…` | `hmopuri@…` |
| `email_recipients.shortlistCc.cc` | `recruitment@aapnainfotech.in` | `pkmondal@…` |
| `email_recipients.duplicateAlert.to` | `claudepankajmondal@gmail.com` | `pkmondal@…` |
| `reminder_interval_days` / `reminder_max_count` | `2` / `2` | `1` / `1` |
| `email_intake_last_sync`, `inbound_sync_last_sync`, `mailbox_delta_link` | live cursors | stale |

⚠ **`npm run seed:recipients:prod` may overwrite the `email_recipients.*` rows above.** Read
`prisma/seed-email-recipients.js` before running it, or skip it and insert only the two
`vendorStatus` keys by hand. Export `rpa_settings` first either way.

### A.5.5 Module permissions backfill

After fixing `seed_module_permissions()` (§A.1.1), existing production users still have no rows
for the two new modules. Backfill them, disabled-by-default except for admins, then grant the
pipeline module to the recruiters who need it —
`prisma/grant-recruiter-pipeline-access.js` already exists for this.

### A.5.6 Sequence type mismatch — informational, no action

`rpa_email_tracking_id_seq` and `rpa_sessions_id_seq` are `bigint` in production and `integer`
in staging. Production's is the wider type; both feed `int4` columns and neither is anywhere
near the `int4` ceiling. Leave alone.

---

## A.6 Execution runbook

> Run in order. Each step has its own verification — do not proceed past a failed check.
> Take the maintenance window during a quiet period: the poller is actively writing to
> `rpa_email_messages`, which Step 3 rewrites.

### Step 0 — Stop the writers

```bash
pm2 stop ats-prod-backend ats-prod-worker
```

Necessary, not optional: the mailbox poller inserts into `rpa_email_messages` every 5 minutes
and would race the dedup in Step 3. §A.4.1 measured that traffic directly.

### Step 1 — Back up

```bash
pg_dump "<PROD_DATABASE_URL>" -Fc -f prod-predeploy-$(date +%Y%m%d).dump   # ~332 MB source
psql "<PROD_DATABASE_URL>" -c "\copy (SELECT * FROM rpa_email_templates) TO 'prod-templates-backup.csv' CSV HEADER"
psql "<PROD_DATABASE_URL>" -c "\copy (SELECT * FROM rpa_settings)        TO 'prod-settings-backup.csv'  CSV HEADER"
```

Verify the dump restores into a scratch database before continuing. A backup that has not been
restored once is not a backup.

### Step 2 — Apply all 23 DDL files in date order

```bash
git checkout project-staging
cd backend/prisma/ddl
for f in $(ls *.sql | sort); do
  echo "== $f"
  psql "<PROD_DATABASE_URL>" -v ON_ERROR_STOP=1 -f "$f" || break
done
```

**Verify — 21 tables:**

```sql
SELECT count(*) FROM information_schema.tables
 WHERE table_schema='public' AND table_name IN (
  'rpa_pipeline_stages','rpa_stage_outcomes','rpa_outcome_reasons','rpa_stage_email_templates',
  'rpa_candidate_pipeline','rpa_pipeline_stage_events','rpa_interview_schedule',
  'rpa_interview_scorecard','rpa_interview_scorecard_skill','rpa_assessment_imports',
  'rpa_assessment_results','rpa_assessment_test_mappings','rpa_assessment_invites',
  'rpa_document_checklist_items','rpa_document_requests','rpa_candidate_documents',
  'rpa_offers','rpa_notifications','rpa_interview_recording','rpa_recording_share_link',
  'rpa_referral_audit');
-- expect 21

SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='rpa_email_templates_category_check';
-- must now list BOTH 'stage_outcome' AND 'vendor_status'
```

### Step 3 — Parity backfill (D1–D10) · **the part no DDL file covers**

**Re-count the duplicates first** (§A.4.1) — they grow every poller tick, so the figure you
sign off on will not be the figure you execute against:

```sql
SELECT count(*) FROM (SELECT id, row_number() OVER (PARTITION BY graph_message_id ORDER BY id) rn
  FROM rpa_email_messages WHERE graph_message_id IS NOT NULL) t WHERE rn > 1;
-- was 8,866 on 2026-09-09; expect higher
```

The script is written and committed: **[`backend/prisma/ddl/2026-09-09-prod-parity-backfill.sql`](../../backend/prisma/ddl/2026-09-09-prod-parity-backfill.sql)**.
Its eleven numbered sections are in the required execution order, which is *not* alphabetical —
duplicates before the UNIQUE that rejects them, the primary key before anything referencing it,
orphans nulled before the foreign keys that would refuse them. Read it before running it.

It is idempotent throughout. Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, so each constraint
is guarded by an explicit `pg_constraint` lookup rather than DROP-then-ADD — dropping a live
primary key to re-add it would be a worse failure mode than the one being avoided.

#### Rehearsed end-to-end on 2026-09-09

Validated against a throwaway PostgreSQL 18.6 cluster restored from a **read-only**
`pg_dump --schema-only` of production (27 of 28 tables; only `rpa_cv_vectors` was skipped, as
pgvector was absent locally and no DDL file touches it). Production itself was never written to.

| Rehearsal step | Result |
|---|---|
| All 23 DDL files applied in `ls \| sort` order | **0 failures**, 27 → 48 tables |
| Parity script against seeded production-shaped failure data | exit 0 |
| Duplicate groups of 3 and 2 | lowest id kept; 3 losers deleted and snapshotted |
| Rows with `graph_message_id IS NULL` | both survived — UNIQUE correctly ignores NULLs |
| Tracking row pointing at a deleted duplicate | re-pointed to the keeper and **survived the CASCADE** |
| Tracking row pointing at a keeper | untouched |
| 3 orphan pointers / valid pointers on another row | nulled / left alone |
| `rpa_mrf` cast of `'3'`, `''`, `'  10  '`, NULL, `'0'` | → `3`, NULL, `10`, NULL, `0`; type now `integer` |
| All 15 promised constraints | present |
| Re-inserting a known `graph_message_id` | **rejected** — the poller's P2002 path finally works |
| Writing a bad `resume_text_quality` | rejected by the CHECK |
| Module-permission backfill | admin enabled, recruiter disabled |
| **Running the whole script a second time** | exit 0, every count 0, state unchanged |

The tracking/CASCADE interaction was the subtlest risk in the script — deleting before the
re-point would have silently destroyed tracking rows — and it is the one the rehearsal
specifically confirms.

> **The snapshot lives in its own `ats_backup` schema, not in `public`.** A backup table in
> `public` would be introspected by `prisma db pull` and appear in `schema.prisma` as a bogus
> model, breaking the empty-diff check in Step 6 that is the deployment's proof of parity.
> `appuser` was confirmed able to `CREATE SCHEMA`.

> `recruitment_pipeline` is absent from **staging's** function body too. Adding it is a
> deliberate improvement over parity — confirm it is wanted (§D-4). Drop that one string from
> both section 10 and section 11 of the script if you would rather match staging exactly.

Retain `ats_backup.email_messages_dupes_20260909` for at least one full retention cycle, then
drop it.

### Step 4 — Settings rows (§A.5.3)

```sql
INSERT INTO rpa_settings (key, value) VALUES
  ('interview_reminder_enabled',        'true'),
  ('interview_reminder_interval_min',   '2'),
  ('interview_reminder_lead_min',       '15'),
  ('interview_occurrence_enabled',      'true'),
  ('interview_occurrence_interval_min', '2'),
  ('interview_occurrence_grace_min',    '5'),
  ('assessment_deadline_days',          '2'),
  ('assessment_auto_advance_enabled',   'false')   -- deliberately OFF for go-live
ON CONFLICT (key) DO NOTHING;   -- DO NOTHING protects the values in §A.5.4
```

`ON CONFLICT DO NOTHING` is load-bearing here — it is what stops this step from clobbering
production's live recipient addresses and sync cursors.

### Step 5 — Seed reference data

```sql
-- pre-flight FIRST: more than one row in either category means the seed picks arbitrarily
SELECT id, name, category FROM rpa_email_templates
 WHERE category IN ('shortlist','rejection') ORDER BY category, id;
```

```bash
cd backend
npm run seed:stages:prod        # 12 stages / 45 outcomes / 9 reasons
npm run seed:documents:prod     # 3 checklist items
NODE_ENV=production node prisma/seed-email-templates.js
# seed:recipients:prod — read the script first; it may overwrite §A.5.4 values
```

**Verify:**

```sql
SELECT (SELECT count(*) FROM rpa_pipeline_stages)          AS stages,     -- 12
       (SELECT count(*) FROM rpa_stage_outcomes)           AS outcomes,   -- 45
       (SELECT count(*) FROM rpa_outcome_reasons)          AS reasons,    --  9
       (SELECT count(*) FROM rpa_document_checklist_items) AS checklist,  --  3
       (SELECT count(*) FROM rpa_email_templates)          AS templates;
```

Then diff `rpa_email_templates` against `prod-templates-backup.csv` and re-apply by hand any
wording the recruitment team had customised.

### Step 6 — Regenerate the Prisma client

```bash
cd backend
NODE_ENV=production npx prisma db pull
npx prisma generate
git diff prisma/schema.prisma     # expect NO diff — that is the parity proof
```

An empty diff is the single best end-to-end confirmation that §A.2 and §A.3 both landed.

> On Windows, `prisma generate` throws `EPERM` while the dev server **or the queue worker** holds
> the client open — stop both first.

### Step 7 — Deploy `project-staging` code, restart, verify

Per §0.2 this is a 213-file jump from what production runs, so `npm ci` is required — an
incremental `npm install` is not enough for a delta this size.

```bash
# backend
cd /var/www/html/ats-platform/backend
git fetch && git checkout project-staging && git pull
npm ci --omit=dev
# frontend
cd ../frontend && npm ci && npm run build
pm2 start ats-prod-backend ats-prod-worker
curl -s https://<prod-host>/api/health
```

There is still **no `deploy-production.sh`** — only `deploy-staging.sh`. Worth adding one
modelled on it so production deploys stop being manual.

Confirm the boot log registers **all** crons — in particular the interview reminder and
occurrence sweep, which is the direct proof that Step 4 worked.

### Step 8 — Final verification

```sql
-- object parity (compare against staging's column in §0.1)
SELECT (SELECT count(*) FROM information_schema.tables  WHERE table_schema='public')                  AS tables,   -- 49
       (SELECT count(*) FROM information_schema.columns WHERE table_schema='public')                  AS columns,  -- 789
       (SELECT count(*) FROM pg_indexes                 WHERE schemaname='public')                    AS indexes,  -- 160
       (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
          JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal) AS triggers; --  6

-- the blocker is closed and cannot reopen
SELECT count(*) FROM (SELECT graph_message_id FROM rpa_email_messages
  WHERE graph_message_id IS NOT NULL GROUP BY 1 HAVING count(*)>1) x;   -- expect 0

-- the analytics fix landed
SELECT status, count(*) FROM rpa_email_log GROUP BY 1;                  -- expect one 'sent' row ≈14,000+
```

---

## A.7 Rollback

The §A.2 work is purely additive and rolls back by doing nothing — leave the 21 new tables in
place, redeploy the previous build (the tree at
`origin/project-production-backup-06-08-2026`). They are unreferenced by the old code and
harmless, and a later retry then needs no schema work.

The §A.3/Step 3 work is **not** purely additive. Its reversal path:

| To undo | How |
|---|---|
| Duplicate delete | `INSERT INTO rpa_email_messages SELECT * FROM ats_backup.email_messages_dupes_20260909;` after dropping the UNIQUE constraint |
| Constraints / indexes / FKs | `ALTER TABLE … DROP CONSTRAINT …`, `DROP INDEX …` |
| `rpa_mrf` type change | `ALTER COLUMN … TYPE text USING …::text` (lossless — the originals were digit strings) |
| Nulled orphan pointers | recover the 34 `id`s from the Step 1 dump |
| `seed_module_permissions()` | re-apply the 7-key body from the dump |
| Templates / settings | restore from the Step 1 CSV exports |

Wrap Step 3 in the single transaction shown so a mid-script failure leaves nothing half-applied.
A full restore loses all recruitment activity since the deploy — last resort only.

---

# PART B — MICROSOFT ONEDRIVE

## B.1 How the code picks a drive — one env var decides everything

Every Graph drive call in the codebase builds its base URL the same way
([onedrive.service.js:92-94](../../backend/src/services/onedrive.service.js#L92-L94),
[:158-160](../../backend/src/services/onedrive.service.js#L158-L160),
[:200-201](../../backend/src/services/onedrive.service.js#L200-L201),
[:294-295](../../backend/src/services/onedrive.service.js#L294-L295),
[:363-364](../../backend/src/services/onedrive.service.js#L363-L364),
[:477-478](../../backend/src/services/onedrive.service.js#L477-L478),
[interviewRecording.service.js:134-135](../../backend/src/services/interviewRecording.service.js#L134-L135)):

```js
`https://graph.microsoft.com/v1.0/users/${MS_DEFAULT_SENDER_EMAIL}/drive`
```

So **`MS_DEFAULT_SENDER_EMAIL` is the OneDrive account**, not just the sending mailbox. It also
runs app-only (client credentials, `getAccessToken()` at
[onedrive.service.js:19-59](../../backend/src/services/onedrive.service.js#L19-L59)) — there is
no signed-in user and therefore no "my files" fallback.

| | Staging | Production |
|---|---|---|
| `MS_DEFAULT_SENDER_EMAIL` | `pkmondal@aapnainfotech.com` | **`recruitment@aapnainfotech.in`** |
| `MS_CLIENT_ID` | `6dc40383-30fc-42e5-8fb1-748e45f81c25` | **`13970867-284c-4a4b-8908-04ce0c595f65`** |
| `MS_TENANT_ID` | `96875b81-…` | `96875b81-…` (same tenant) |
| `MS_ONEDRIVE_PARENT_ID` | `015VOMPCPMTPAM74ASCVEYVZXTXXEZYOMJ` | `01G5FTREQK6XGR6VF3RVGJ2IJTJZNYXJ6P` |

Two consequences that dominate Part B:

1. **Different mailbox, different domain** (`.in` vs `.com`). Everything below must be created
   in `recruitment@aapnainfotech.in`'s drive — nothing carries over from
   `pkmondal@aapnainfotech.com`.
2. **Different app registration.** The Graph grants proven on staging's `HR_RPA` app
   (`Calendars.ReadWrite`, `OnlineMeetings.ReadWrite.All`, `OnlineMeetingArtifact.Read.All`,
   plus the `Grant-CsApplicationAccessPolicy` scoped to `MS_CALENDAR_MAILBOX`) are held by app
   `6dc40383-…`, **not** by the production app `13970867-…`. They do not transfer. See §B.4.

## B.2 Folders each module uses

Two roots, and they are siblings — not nested.

### Root 1 — the resume parent, `MS_ONEDRIVE_PARENT_ID`

Reached through `ensureOneDriveFolderPath()`
([:314-325](../../backend/src/services/onedrive.service.js#L314-L325)).

| Module | Path under the parent | Call site |
|---|---|---|
| Vendor / HR resume upload | *(flat — no subfolder)* | [hrUpload.service.js:1137](../../backend/src/services/hrUpload.service.js#L1137) |
| Candidate CV upload | *(flat)* | [candidate.controller.js:393](../../backend/src/controllers/candidate.controller.js#L393) |
| MRF JD + test paper | *(flat)* | [mrf.controller.js:629](../../backend/src/controllers/mrf.controller.js#L629), [:645](../../backend/src/controllers/mrf.controller.js#L645) |
| Assessment report import | *(flat)* | [assessmentImport.service.js:423](../../backend/src/services/assessmentImport.service.js#L423) |
| **Document Collection** | **`Document Collection/<Candidate Name> (…)`** | [documentCollection.service.js:372-374](../../backend/src/services/documentCollection.service.js#L372-L374) |

### Root 2 — the drive ROOT, `MS_RECORDING_ARCHIVE_FOLDER`

Reached through `ensureDriveFolderPathFromRoot()`
([:155-175](../../backend/src/services/onedrive.service.js#L155-L175)), which deliberately
anchors at the drive root so recordings are **not** buried inside the CV folder.

| Module | Path from drive root | Call site |
|---|---|---|
| Interview recording archive | **`Recordings_ATS/<Candidate Name> (pipeline-<id>)/<Stage> - <YYYY-MM-DD>.mp4`** | [interviewRecordings.js:348-361](../../backend/src/jobs/interviewRecordings.js#L348-L361) |

Resulting production layout:

```
recruitment@aapnainfotech.in — OneDrive
├── <folder id 01G5FTREQK6XGR6VF3RVGJ2IJTJZNYXJ6P>   ← MS_ONEDRIVE_PARENT_ID
│   ├── <resumes, JDs, test papers, assessment reports — flat>
│   └── Document Collection/                          ← NEW in production
│       └── <Candidate Name> (…)/
└── Recordings_ATS/                                   ← NEW in production, at the ROOT
    └── <Candidate Name> (pipeline-N)/
        └── <Stage> - <date>.mp4
```

**Both new folders are auto-created on first use** — `ensureChildFolder()`
([:90-140](../../backend/src/services/onedrive.service.js#L90-L140)) creates any missing level
with `@microsoft.graph.conflictBehavior: 'fail'` so two concurrent uploads converge on one
folder rather than producing `Name 1`. Creating them by hand up front is still worth doing: it
proves the drive is reachable and the permissions are right *before* a real candidate is waiting
on an upload page.

## B.3 Production env gaps

`backend/.env.production` is missing eight `MS_*` keys that staging sets. Each falls back to a
code default — mostly safe, but `MS_CALENDAR_MAILBOX` is the one to set deliberately.

| Key | Staging | Prod | Code default | Note |
|---|---|---|---|---|
| `MS_RECORDING_ARCHIVE_FOLDER` | `Recordings_ATS` | *(unset)* | `Recordings_ATS` ([config/index.js:219](../../backend/src/config/index.js#L219)) | Same value; set it explicitly anyway |
| `MS_CALENDAR_MAILBOX` | `pkmondal@aapnainfotech.com` | *(unset)* | falls back to `MS_DEFAULT_SENDER_EMAIL` ([:112](../../backend/src/config/index.js#L112)) | **Set explicitly** — it must match the mailbox the app-access policy is scoped to |
| `MS_ATTENDANCE_MIN_SECONDS` | `60` | *(unset)* | `60` ([:133](../../backend/src/config/index.js#L133)) | fine |
| `MS_ATTENDANCE_GUEST_CANDIDATE` | `true` | *(unset)* | `true` ([:147](../../backend/src/config/index.js#L147)) | fine |
| `MS_MEETING_PRESENTERS` | `organization` | *(unset)* | — | confirm |
| `MS_MEETING_TRANSCRIBE` | `true` | *(unset)* | — | confirm |
| `MS_RECORDED_STAGES` | `tech1,tech2,tech3,hr_round,ceo` | *(unset)* | same list ([:188](../../backend/src/config/index.js#L188)) | fine |
| `MS_RECORDING_RETAIN_MONTHS` | `12` | *(unset)* | — | confirm the retention policy |

Feature flags are `false` in production across the board (`MS_CALENDAR_ENABLED`,
`MS_ATTENDANCE_ENABLED`, `MS_MEETING_RECORD_AUTO`, `MS_RECORDING_FETCH_ENABLED`,
`MS_RECORDING_ARCHIVE_ENABLED`). That is the correct starting state — turn them on one at a
time, after §B.4.

## B.4 The production app's Graph grants — ✅ complete; one Teams policy outstanding

> **CORRECTED 2026-09-11.** This section previously claimed the production app registration
> "almost certainly lacks the Graph grants" and listed all of them as work to request from IT.
> **That was wrong** — it was written before the `HR_RPA_PROD` API-permissions blade had been
> seen. All 10 Application permissions are granted on production, identical to staging.
> Full detail, and the exact PowerShell for the one remaining item:
> **[MS-GRAPH-PRODUCTION-SETUP.md](../deployment/MS-GRAPH-PRODUCTION-SETUP.md)**.

Production uses app `13970867-284c-4a4b-8908-04ce0c595f65` (`HR_RPA_PROD`) in the **same tenant**
as staging. Verified state:

| Item | Status |
|---|---|
| `Calendars.ReadWrite`, `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`, `OnlineMeetings.ReadWrite.All`, `OnlineMeetingArtifact.Read.All`, `OnlineMeetingRecording.Read.All`, `OnlineMeetingTranscript.Read.All`, `Sites.Selected`, `User.Read.All` (all Application) | ✅ **Granted** |
| `Files.ReadWrite.All` / `Files.Read.All` (Application) | ❌ **Not granted, and must not be requested** — declined by IT 2026-09-02 as tenant-wide. OneDrive access runs on `Sites.Selected` instead |
| Tenant-wide Teams meeting settings (recording on, auto-expiry off, licence) | ✅ same tenant as staging — already done |
| **Teams application access policy for `13970867-…` on `recruitment@aapnainfotech.in`** | ⚠ **OUTSTANDING — the one required IT action** |
| `Sites.Selected` per-site grant on the `.in` OneDrive | claimed done by IT 2026-09-02; **re-confirm** (§B.5) |
| Transcript API tenant switch | ⚠ outstanding, tenant-wide; recordings work without it |

The access policy is what gates every `onlineMeetings` call — attendance reports, recordings,
the `recordAutomatically` PATCH, and the Meeting ID/Passcode lookup. Without it those return
`403 No application access policy found for this app …`, so flags 2–5 in the setup doc stay
broken until it propagates (~30 min).

## B.5 OneDrive checklist

1. **Confirm `recruitment@aapnainfotech.in` has a provisioned OneDrive.** A licensed mailbox
   does not imply a provisioned drive; OneDrive is created on first sign-in or by admin
   pre-provisioning. If it is missing, every upload fails at `GET /users/{upn}/drive` → `404`.
   ```bash
   curl -H "Authorization: Bearer $TOKEN" \
     "https://graph.microsoft.com/v1.0/users/recruitment@aapnainfotech.in/drive?\$select=id,name,webUrl"
   ```
2. **Verify `MS_ONEDRIVE_PARENT_ID` resolves inside that drive** and is a folder. This id was
   set for production but has never been checked against the recording/document code paths.
   ```bash
   curl -H "Authorization: Bearer $TOKEN" \
     "https://graph.microsoft.com/v1.0/users/recruitment@aapnainfotech.in/drive/items/01G5FTREQK6XGR6VF3RVGJ2IJTJZNYXJ6P?\$select=id,name,folder,webUrl"
   ```
   Expect a `folder` facet. A `404` means the id belongs to a different drive — likely the cause
   of a silent upload failure later.
3. **Create `Document Collection/`** under that parent folder.
4. **Create `Recordings_ATS/`** at the **drive root** — a sibling of the parent, *not* a child.
   Getting this wrong is the specific mistake `ensureDriveFolderPathFromRoot()` exists to
   prevent.
5. **Set the eight env keys** from §B.3 in `backend/.env.production`, `MS_CALENDAR_MAILBOX`
   first.
6. **Create the Teams application access policy** for app `13970867-…` on
   `recruitment@aapnainfotech.in` (§B.4) before flipping any Teams-dependent flag. The Graph
   API permissions themselves are already granted — see
   [MS-GRAPH-PRODUCTION-SETUP.md](../deployment/MS-GRAPH-PRODUCTION-SETUP.md).
7. **Decide retention.** `MS_RECORDING_RETAIN_MONTHS=12` in staging; interview recordings of
   real candidates are personal data with a real retention obligation. Confirm 12 months is the
   agreed production policy before recordings start accumulating.
8. **Smoke test, flags off → on, one at a time:**
   - upload a CV → lands flat under the parent folder;
   - raise a document request, upload through the public link → lands in
     `Document Collection/<name>/`;
   - only after §B.4 is confirmed: book an interview, join it, let the archive job run → an
     `.mp4` appears under `Recordings_ATS/<name> (pipeline-N)/`.

---

# PART C — SUGGESTED ORDER OF WORK

| Phase | Work | Blocking? |
|---|---|---|
| 1 | §D decisions signed off (below) | **yes** |
| 2 | §B.5 items 1–2 — prove the production drive and parent id resolve | **yes** — a broken parent id makes half the modules fail silently after go-live |
| 3 | §B.4 — Teams application access policy created for the production app (API permissions are already granted) | yes, for calendar/attendance/recording only |
| 4 | Write and review `2026-09-09-prod-parity-backfill.sql` (§A.6 Step 3) | **yes** |
| 5 | Maintenance window: Steps 0 → 8 | — |
| 6 | §B.5 items 3–5 — create folders, set env keys | — |
| 7 | Smoke tests; flags on one at a time; `EMAIL_REDIRECT_TO_TEST=false` **last** | — |

`EMAIL_REDIRECT_TO_TEST` remains the master switch for every candidate-facing email, the
candidate address on calendar invites, and the address in the Zeko schedule payload. Production
has it `true` today, so production emails nobody but the internal test inbox. Leave it `true`
until every other check has passed — it is the true point of no return.

Because §0.2 shows this is effectively a first-time Phase-3 release rather than an increment,
budget a full maintenance window and a real smoke-test pass, not a routine deploy slot.

---

# PART D — DECISIONS NEEDED BEFORE EXECUTION

1. **Delete the ~8,900 duplicate `rpa_email_messages` rows?** (§A.4.1) Required for
   `UNIQUE (graph_message_id)`, which is required for the poller's idempotency to work at all.
   The rows are verified re-inserts of the same Graph messages, and the plan snapshots them into
   `ats_backup.email_messages_dupes_20260909` first, and the delete/re-point logic has been
   rehearsed against a schema copy of production (§A.6 Step 3). **Recommendation: yes.**
2. **Null the 34 orphan pointers?** (§A.4.3) Matches the `ON DELETE SET NULL` semantics staging
   already uses; no message is lost. **Recommendation: yes.**
3. **Run `seed:recipients:prod`, or skip it?** (§A.5.4) It may overwrite production's live
   recipient addresses with staging's test addresses. **Recommendation: skip it; insert only the
   two `vendorStatus` keys by hand.**
4. **Add `recruitment_pipeline` to `seed_module_permissions()`?** (§A.1.1) Absent from both
   databases' function bodies, but present in staging's data. Adding it is an improvement over
   strict parity. **Recommendation: yes, and backfill existing users.**
5. **Go-live values for `interview_reminder_enabled` / `interview_occurrence_enabled`** — `true`
   as in staging, or start `false` and enable after the first real interview is booked?
6. **`MS_RECORDING_RETAIN_MONTHS`** — is 12 months the agreed production retention policy for
   candidate interview recordings? (§B.5 item 7)
7. **The five `Closure — *` templates** flagged in the 2026-08-06 runbook §4.1b are still
   unresolved: they correspond to outcomes the code deliberately never emails
   (`SILENT_FINAL_OUTCOMES`). Delete, re-label, or change the policy — but decide, rather than
   shipping templates that will never send.
