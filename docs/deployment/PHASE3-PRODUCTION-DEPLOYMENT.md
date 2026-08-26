# Phase 3 — Production Deployment Runbook

**Date:** 2026-08-06 · **For:** dev / ops
**Target:** full go-live — all Phase 3 feature flags ON, candidate email enabled
**Companion:** [Module status (RT/PM)](../phase3/PHASE3-MODULE-STATUS.md) · [Code review](../phase3/PHASE3-CODE-REVIEW-2026-08-06.md) · [V16 deployment guide](V16-CHANGES-AND-DEPLOYMENT.md)

---

## Environments

| | Database | Notes |
|---|---|---|
| development | `recruitmentautomationdb` | **Shares the staging database** |
| staging | `recruitmentautomationdb` | Same DB as development |
| production | `recruitmentautomationdbProd` | Separate database, same host |

All three sit on host `20.244.34.176`. Because dev and staging share one database, "verified
on staging" and "verified on dev" mean the same data.

---

## Part 1 — What Phase 3 adds over production today

### 1.1 The gap, measured

Verified 2026-08-06 by read-only inspection of the production database:

| | Production | Staging/Dev |
|---|---|---|
| Public tables | **28** | 46 |
| Phase 3 tables | **0 of 18** | 18 of 18 |
| `rpa_email_templates` | 15 | 42 |
| `rpa_cv` | 8,811 | 195 |
| `rpa_shortlisted_candidates` | **0** | 101 |
| `rpa_mrf` | 4 | 41 |
| `rpa_settings` email-recipient rows | 14 | 14 |

**Production is at the Phase 2.1 (M0) baseline.** No Phase 3 schema, seeds or features exist
there. Note production holds the real candidate volume (8,811 CVs) while staging is a small
working set — the DDL must be applied against a live, populated database.

### 1.2 Schema — 18 new tables from 11 DDL files

Each file was read to confirm what it creates. **Apply in date order**: later files ALTER
tables that earlier ones create.

| # | DDL file | Creates | Alters |
|---|---|---|---|
| 1 | `2026-07-21-pipeline-stage-engine.sql` | `rpa_pipeline_stages`, `rpa_stage_outcomes`, `rpa_outcome_reasons`, `rpa_stage_email_templates`, `rpa_candidate_pipeline`, `rpa_pipeline_stage_events` | `rpa_email_templates` — **the category CHECK, see §2.1** |
| 2 | `2026-07-23-interview-scheduling.sql` | `rpa_interview_schedule` | — |
| 3 | `2026-07-24-assessment-import.sql` | `rpa_assessment_imports`, `rpa_assessment_results`, `rpa_assessment_test_mappings` | — |
| 4 | `2026-07-25-assessment-invites.sql` | `rpa_assessment_invites` | `rpa_assessment_results` |
| 5 | `2026-07-25-interview-occurrence.sql` | — | `rpa_interview_schedule` |
| 6 | `2026-07-25-interviewer-scorecard.sql` | `rpa_interview_scorecard`, `rpa_interview_scorecard_skill` | — |
| 7 | `2026-07-25-teams-meeting-details.sql` | — | `rpa_interview_schedule` |
| 8 | `2026-07-29-document-collection.sql` | `rpa_document_checklist_items`, `rpa_document_requests`, `rpa_candidate_documents` | — |
| 9 | `2026-07-29-hr-scorecard-fields.sql` | — | `rpa_interview_scorecard` |
| 10 | `2026-07-29-offer-management.sql` | `rpa_offers` | — |
| 11 | `2026-07-31-notifications.sql` | `rpa_notifications` | — |

All 18 tables are accounted for. Nothing is dropped or renamed — the change is purely
additive, which is what makes rollback cheap (§5).

### 1.3 New API surface

| Route | Auth | Purpose |
|---|---|---|
| `/api/pipeline/*` | session + `recruitment_pipeline` module | Board, journey detail, outcomes, closure, scheduling, documents, offers, admin config |
| `/api/scorecard/*` | **public** (uuid token) | Interviewer scorecard form |
| `/api/documents/*` | **public** (uuid token) | Candidate document upload |
| `/api/notifications/*` | session | Notification centre |
| `POST /api/email/templates` | session + admin | Create an email template (new) |

The two public routes are intentionally unauthenticated — candidates and interviewers have no
ATS login. The uuid token is the only credential, validated server-side, single-use and
time-limited for scorecards.

### 1.4 New background jobs

| Job | Cron (default) | Sends | Gated by |
|---|---|---|---|
| Interview reminder | every 2 min (DB setting) | Pre-interview reminder to candidate + panel | `interview_reminder_enabled` setting |
| Occurrence sweep | every 5 min (DB setting) | "Did this interview happen?" nudge; releases scorecards | `interview_occurrence_enabled` setting |
| Assessment deadline checker | `0 * * * *` | In-app only, no email | always on |
| Offer sweep | `0 7 * * *` | Daily approval nudge (internal); 90-day auto-close | always on |
| **Document reminder** *(new)* | `0 9 * * *` | Chases outstanding documents, max 3, ≥24h apart | always on |
| Mailbox poller | `*/5 * * * *` | — (reads) | `EMAIL_INTAKE_ENABLED` / `INBOUND_SYNC_ENABLED` |
| Zeko sync | hourly | — (reads) | `ZEKO_SYNC_ENABLED` |

The three "always on" jobs are pure DB polling with no external API, so there is nothing to
feature-gate — only the cadence is configurable.

### 1.5 New frontend surfaces

Candidate Pipeline (the tracker + candidate drawer) · Interviewer scorecard page (public) ·
Document upload page (public) · Notification centre in the top bar · Pipeline configuration
panel on Settings (admin only).

The demo/walkthrough pipeline has been **retired from the sidebar** but remains reachable by
direct URL for client demos.

---

## Part 2 — Deployment sequence

> Run these in order. Each step has its own verification — do not proceed past a failed check.

### Step 0 — Back up

```bash
pg_dump "<PROD_DATABASE_URL>" -Fc -f phase3-pre-deploy-$(date +%Y%m%d).dump
```

Separately export the email templates, because Step 3 overwrites them (§4.1):

```bash
psql "<PROD_DATABASE_URL>" -c "\copy (SELECT * FROM rpa_email_templates) TO 'templates-backup.csv' CSV HEADER"
```

### Step 1 — Apply the DDL

Apply files 1–11 **in the order in §1.2**. File 1 contains the category CHECK extension, so
it must run before any seeding.

```bash
cd backend/prisma/ddl
for f in 2026-07-21-* 2026-07-23-* 2026-07-24-* 2026-07-25-assessment-invites.sql \
         2026-07-25-interview-occurrence.sql 2026-07-25-interviewer-scorecard.sql \
         2026-07-25-teams-meeting-details.sql 2026-07-29-* 2026-07-31-*; do
  echo "== $f"; psql "<PROD_DATABASE_URL>" -v ON_ERROR_STOP=1 -f "$f" || break
done
```

**Verify — 18 tables and the extended constraint:**

```sql
SELECT count(*) FROM information_schema.tables
 WHERE table_schema='public'
   AND table_name IN ('rpa_pipeline_stages','rpa_stage_outcomes','rpa_outcome_reasons',
     'rpa_stage_email_templates','rpa_candidate_pipeline','rpa_pipeline_stage_events',
     'rpa_interview_schedule','rpa_interview_scorecard','rpa_interview_scorecard_skill',
     'rpa_assessment_imports','rpa_assessment_results','rpa_assessment_test_mappings',
     'rpa_assessment_invites','rpa_document_checklist_items','rpa_document_requests',
     'rpa_candidate_documents','rpa_offers','rpa_notifications');
-- expect 18

SELECT pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conname='rpa_email_templates_category_check';
-- must now include 'stage_outcome'
```

> **Why this matters.** Production's constraint today allows only
> `general | shortlist | interview | offer | rejection | follow_up | onboarding`. It is
> **missing `stage_outcome`**, so Step 3 fails on the stage-outcome templates unless Step 1
> ran first.

### Step 2 — Regenerate the Prisma client

```bash
cd backend
NODE_ENV=production npx prisma db pull
npx prisma generate
```

### Step 3 — Seed

```bash
npm run seed:stages:prod        # 12 stages, 45 outcomes, 9 reasons
npm run seed:recipients:prod    # per-flow email recipients
npm run seed:documents:prod     # document checklist
NODE_ENV=production node prisma/seed-email-templates.js
```

⚠ **Read §4.1 before running the template seed.**

**Verify** (counts confirmed against staging on 2026-08-06):

```sql
SELECT (SELECT count(*) FROM rpa_pipeline_stages)          AS stages,       -- 12
       (SELECT count(*) FROM rpa_stage_outcomes)           AS outcomes,     -- 45
       (SELECT count(*) FROM rpa_outcome_reasons)          AS reasons,      -- 9
       (SELECT count(*) FROM rpa_document_checklist_items) AS checklist,    -- 3
       (SELECT count(*) FROM rpa_email_templates)          AS templates;    -- see §4.1
```

The seed defines **34** templates. Production holds 15 today, so the final count depends on
how many of those 15 the seed matches — it is *not* simply 15 + 34. Run the pre-flight query
in §4.1 to see exactly which will be overwritten.

### Step 4 — Deploy code

There is **no `deploy-production.sh`** — only `deploy-staging.sh`. Either adapt that script
or run the equivalent manually:

```bash
# backend
cd /var/www/html/ats-platform/backend
npm ci --omit=dev
pm2 reload ats-prod-backend ats-prod-worker

# frontend
cd ../frontend
npm ci && npm run build          # dist/ served by nginx/IIS
```

**Verify:** `curl -s https://ats.aapnainfotech.com/api/health` → `200`, and the boot log
lists all five cron registrations from §1.4.

### Step 5 — Flag changes for full go-live

Edit `backend/.env.production`, then `pm2 reload`:

| Flag | Now | Set to | What it gates | If left unchanged |
|---|---|---|---|---|
| `MS_CALENDAR_ENABLED` | `false` | `true` | Outlook calendar event + Teams meeting on booking | Interviews still book and both sides are emailed the time — but with no calendar entry and no join link |
| `MS_ATTENDANCE_ENABLED` | `false` | `true` | Automatic held/no-show detection | Falls back to the human "Mark as Held" nudge. **Also needs the IT Graph grant** — leave `false` until it lands |
| `ZEKO_SYNC_ENABLED` | `false` | `true` | Zeko token refresh, job catalog, results fetch | Zeko scores never sync into the pipeline |
| `MS_CALENDAR_MAILBOX` | unset | set explicitly | Which mailbox owns interview events | Falls back to `MS_DEFAULT_SENDER_EMAIL` — acceptable, but set it deliberately |
| `EMAIL_REDIRECT_TO_TEST` | `true` | **`false`** | **Every candidate-facing email** | **No candidate receives anything.** See §4.2 |

### Step 6 — Smoke tests

Run in this order; each mirrors a check already proven in staging.

| # | Test | Expected |
|---|---|---|
| 1 | `GET /api/pipeline` as a recruiter | `200`, board renders (empty — see §4.3) |
| 2 | `GET /api/pipeline` with no token | `401` |
| 3 | Settings → Pipeline Configuration as admin | Stages, outcomes and reasons all load |
| 4 | Same page as a recruiter | Not visible; direct API call `403` |
| 5 | Shortlist one real candidate from Candidate Screening | A journey appears on the board |
| 6 | Record an Approve on that journey | Candidate emailed; card advances; bell fires |
| 7 | Book an interview on a technical round | Calendar event + Teams link created; both sides emailed |
| 8 | Open the scorecard link from the panel email | Form loads without login |
| 9 | Raise a document request; open the emailed link | Upload page loads; a test upload lands in OneDrive |
| 10 | Deactivate a stage that has candidates on it | `409` with the live candidate count |
| 11 | Close a journey, then try to advance it | `409` |

**Test 6 is the point of no return** — it sends a real email to a real candidate. Do it with a
candidate you control.

---

## Part 3 — Risks and cautions

### 4.1 The template seed overwrites production templates — and two entries match by *category*

`seed-email-templates.js` defines **34** templates and upserts each one: it updates the
existing row if it finds a match, otherwise creates it. Production holds **15** templates
today, so anything edited through the Email Templates page and matched by the seed will be
**silently reverted** to the seed's copy.

**32 entries match by name.** Two match by category instead:

```js
find: { category: 'shortlist' }   // → whichever template has this category
find: { category: 'rejection' }
```

⚠ These use `findFirst`. If production has **more than one** template in either category, the
seed overwrites an arbitrary one of them. Check before running:

```sql
-- pre-flight: which production templates will the seed touch?
SELECT id, name, category FROM rpa_email_templates
 WHERE category IN ('shortlist','rejection')
 ORDER BY category, id;
-- more than one row per category ⇒ resolve by hand before seeding
```

**Do this:** export first (Step 0), run the pre-flight query above, run the seed, then diff
against the export and manually re-apply any wording the recruitment team had customised.

### 4.1b Eight staging templates the seed will NOT create

Staging holds 42 templates; the seed defines 34. These **8 exist only in the staging database**
and will therefore be absent from production after seeding:

`Follow-Up Reminder` · `Interview Invitation` · `Offer Letter` ·
`Closure — Joined` · `Closure — Joined and Left` · `Closure — Backed Out` ·
`Closure — Did Not Join` · `Closure — Candidate Withdrawn`

**The five `Closure — *` templates are a live mismatch worth resolving before go-live.** They
correspond exactly to the five closure outcomes the code deliberately **never** emails
(`joined`, `joined_and_left`, `backed_out`, `did_not_join`, `candidate_withdrawn` — the
`SILENT_FINAL_OUTCOMES` rule). Whoever created them will expect mail to go out; it will not,
because the suppression short-circuits before any template lookup.

Resolve one way or the other:
- **Keep the suppression** (recommended — emailing "Congratulations" to someone who backed
  out is what the rule exists to prevent) and delete or clearly re-label these five; or
- **Change the policy** for specific outcomes, which is a code change plus an RT decision.

The other three (`Follow-Up Reminder`, `Interview Invitation`, `Offer Letter`) appear to be
legacy or unused — confirm before copying them across.

### 4.2 `EMAIL_REDIRECT_TO_TEST` is the master email switch

Production currently has this set to **`true`**, which means production emails nobody but the
internal test inbox today. It is worth understanding how far it reaches — every one of these
keys off that single flag:

- all candidate-facing email (invites, outcomes, reminders, documents);
- the candidate's address on **Outlook calendar invites** (substituted with the test inbox);
- the candidate's address in the **Zeko schedule/cancel payload** (Zeko sends its own invite);
- the vendor cc on outcome emails.

So while it is `true`, a "successful" interview booking in production puts the *test inbox* on
the invite and tells Zeko to invite the *test inbox*. Turning it off is the single change that
makes production start talking to real candidates.

**Recommendation:** make it the **last** step, after smoke tests 1–5 and 10–11, and before
test 6.

### 4.3 The pipeline will be empty on day one

`rpa_shortlisted_candidates` is **0** in production. Journeys are created when a recruiter
shortlists someone from Candidate Screening, so the board is empty until that happens. This is
correct behaviour, not a failed deployment — say so before anyone raises it.

### 4.4 Other cautions

- **`MS_ONEDRIVE_PARENT_ID` already differs per environment** (`01G5FTREQK…` in production vs
  `015VOMPCPM…` in staging). This is correct — do **not** copy staging's value across.
- **No `deploy-production.sh` exists.** Worth adding one modelled on `deploy-staging.sh` so
  production deploys stop being manual.
- **8,811 CV rows in production vs 195 in staging.** The DDL is additive and indexed, so the
  volume is not a risk in itself, but it means Step 1 runs against real data — take the backup.
- **Three open code findings** carry into production; none is a deployment blocker. See
  [the code review §3](../phase3/PHASE3-CODE-REVIEW-2026-08-06.md). The one to know about:
  a very large Evalground CSV import can time out mid-run and leave a partial import.

---

## Part 4 — Rollback

Phase 3 is **purely additive** — no existing table is dropped, renamed or restructured, and
the only change to an existing object is widening a CHECK constraint. So:

1. Redeploy the previous backend/frontend build and `pm2 reload`.
2. Restore the flags: `EMAIL_REDIRECT_TO_TEST=true`, `MS_CALENDAR_ENABLED=false`,
   `ZEKO_SYNC_ENABLED=false`.
3. **Leave the new tables in place.** They are unreferenced by the old build and harmless; a
   later re-deploy then needs no schema work.
4. Only if templates were damaged, restore `rpa_email_templates` from the Step 0 export.

A full database restore should not be necessary and is the last resort — it would lose any
recruitment activity since the deploy.
