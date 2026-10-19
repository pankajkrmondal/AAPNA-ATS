# 03 · Data model

**For:** developers changing queries or the schema. **Checked against** `backend/prisma/schema.prisma` (53 models) on 20 Oct 2026.

The database is PostgreSQL with the **pgvector** extension, one database per environment (staging `recruitmentautomationdb`, production `recruitmentautomationdbProd`). All application tables are prefixed `rpa_` (from the n8n "RPA" era). Code reads them through Prisma (`backend/src/config/database.js`); about 26 files also use raw SQL (`$queryRaw`) for reports, vector search and batch updates.

---

## 1. The core: candidate → shortlist → journey

```
 rpa_mrf ───────────────┐                    rpa_cv  (candidate master, one row per person)
 (requisition, JD,      │                      │  "EmailID", "Name", "ContactNumber", skills, CTC,
  budget, openings)     │                      │  experience, resume OneDrive ids, MetaData …
        │               │                      ├── rpa_cv_vectors (embedding, pgvector)
        │               ▼                      │
        │   rpa_shortlisted_candidates  ◀──────┘  (cv_id, mrf_id; legacy status in pipeline_status)
        │               │
        │               ▼
        └──────▶ rpa_candidate_pipeline   one JOURNEY per candidate per MRF
                  cv_id, mrf_id, shortlist_id, current_stage_key, current_stage_status,
                  final_outcome, source, vendor_email, closed_at
                        │
     ┌──────────────────┼──────────────────────┬──────────────────────┬─────────────────┐
     ▼                  ▼                      ▼                      ▼                 ▼
 rpa_pipeline_     rpa_pipeline_       rpa_interview_schedule   rpa_assessment_   rpa_document_requests
 stage_events      stage_state         → rpa_interview_scorecard  invites / results → rpa_candidate_documents
 (audit: entered,  (per stage:          (+ _skill)               rpa_offers        rpa_notifications
  skip, outcome,    active/completed/  → rpa_interview_recording
  note, moved)      skipped/…)         → rpa_recording_share_link
```

- **`rpa_cv`** is the candidate master: 77 columns, many with PascalCase quoted names from the n8n era (`"EmailID"`, `"Name"`, `"PositionApplied"`, `"TotalExperienceYearsNumeric"`, `"ExpectedCTCNumeric"`). Quote them in raw SQL. Emails are matched case- and space-insensitively through `utils/emailMatch.js` (`emailMatchesSql`). `rpa_cv_tmp` has the same shape and holds duplicates waiting for recruiter review.
- **`rpa_candidate_pipeline`** is the journey. `cv_id` and `mrf_id` are plain columns, not foreign keys; joins are by convention. A candidate can have two open journeys for two MRFs (RT decision Q13).
- **`rpa_shortlisted_candidates`** predates the stage engine and is still written: its `pipeline_status` mirrors the journey for older screens and reports. See the CHECK pitfall below.
- **Stage configuration** lives in data, not code: `rpa_pipeline_stages` (key, label, order, type, optional flag), `rpa_stage_outcomes`, `rpa_outcome_reasons`, `rpa_stage_email_templates`. `config/pipelineStages.js` holds only the keys the code branches on.

## 2. Tables by area

| Area | Tables |
|---|---|
| Accounts | `rpa_companies`, `rpa_users`, `rpa_sessions`, `rpa_module_permissions` |
| MRF | `rpa_mrf`, `rpa_mrf_approval_tokens`, `rpa_mrf_approval_events` (append-only; trigger `trg_mrf_approval_events_guard`), `rpa_mrf_jd_send` |
| Candidates & intake | `rpa_cv`, `rpa_cv_tmp`, `rpa_cv_vectors`, `rpa_upload_jobs`, `rpa_upload_batch_summary`, `rpa_upload_log`, `rpa_processing_log`, `rpa_referral_audit` |
| Screening & pipeline | `rpa_shortlisted_candidates`, `rpa_candidate_pipeline`, `rpa_pipeline_stages`, `rpa_stage_outcomes`, `rpa_outcome_reasons`, `rpa_stage_email_templates`, `rpa_pipeline_stage_events`, `rpa_pipeline_stage_state` |
| Zeko | `rpa_zeko_jobs`, `rpa_zeko_candidate_pipeline` (one row per candidate + Zeko job + round), `rpa_zeko_interview_results`, `rpa_zeko_auth_token`, `rpa_zeko_auth_cookie`, `rpa_zeko_sync_log` |
| Assessment | `rpa_assessment_invites`, `rpa_assessment_imports`, `rpa_assessment_results`, `rpa_assessment_test_mappings` |
| Interviews | `rpa_interview_schedule`, `rpa_interview_scorecard`, `rpa_interview_scorecard_skill`, `rpa_interview_recording`, `rpa_recording_share_link` |
| Documents & offer | `rpa_document_requests`, `rpa_candidate_documents`, `rpa_document_checklist_items`, `rpa_offers` |
| Email | `rpa_email_templates`, `rpa_email_log` (every send; reminder counters), `rpa_email_messages` (conversation threads), `rpa_email_tracking` (opens), `rpa_email_notifications`, `rpa_outlook_accounts` |
| System | `rpa_settings` (key/value; see 05 §2), `rpa_notifications` (the bell), `rpa_error_log` (N42, kept 30 days), `chat_histories` (n8n leftover) |

## 3. Changing the schema (the DDL process)

There are **no Prisma migrations**. Every schema change is a hand-written, idempotent SQL file:

1. Write `backend/prisma/ddl/YYYY-MM-DD-<slug>.sql` **and** `…<slug>.rollback.sql`. Header: why, how to apply, what the rollback loses. Use `IF NOT EXISTS` / guarded `DO $$` blocks so a re-run changes nothing. Recent examples: `2026-10-16-flexible-stage-movement.sql`, `2026-10-20-error-log.sql`.
2. Update `schema.prisma` by hand to match (or `npm run prisma:pull` against staging and review the diff), then `npm run prisma:generate`. A running backend locks the query-engine DLL on Windows: stop it, or accept the EPERM if only the JS client changed.
3. Apply through the guarded runner, staging first, dry run first:
   ```
   cd backend
   node scripts/run-ddl.mjs --env .env.staging    --expect-db recruitmentautomationdb     --file prisma/ddl/<file>.sql --dry-run
   node scripts/run-ddl.mjs --env .env.staging    --expect-db recruitmentautomationdb     --file prisma/ddl/<file>.sql
   node scripts/run-ddl.mjs --env .env.production --expect-db recruitmentautomationdbProd --file prisma/ddl/<file>.sql
   ```
   `--expect-db` refuses to run if the env file points at a different database.
4. Release the DDL **before** the code that needs it, unless the code tolerates the missing object (say so in the header).
5. `prisma/ddl/pgadmin/` has the bundled scripts used for the September staging-to-production catch-up (`00-preflight`, `01-ddl-all`, `03-settings`, `04-verify`). See `docs/phase3/STAGING-TO-PRODUCTION-DB-AND-ONEDRIVE-PLAN.md`.

## 4. Known pitfalls

- **CHECK constraints swallowed by try/catch.** `rpa_shortlisted_candidates.pipeline_status` has a CHECK (`rpa_shortlisted_candidates_pipeline_status_check`). A new status value written by best-effort code (`try { … } catch {}`) fails silently. This happened to 5 of 7 closure statuses on 26 Aug 2026 (`CHANGES-2026-08-26-candidate-closure-graceful-exit.md`). Before writing a new value to any status column, check for a CHECK (`\d+ table` in psql, or `pg_constraint`) and widen it with a DDL file (`2026-08-26-shortlist-status-vocabulary.sql`). New tables use CHECKs too (`rpa_pipeline_stage_state.status`, `rpa_error_log.source`).
- **Prisma rejects unknown columns before the database sees them.** Code that writes a column missing from the generated client throws `PrismaClientValidationError` (mapped to a 500). This was the "Resume Processing Failed" incident of 22 Sep 2026: `cv_file_item_id` written to `rpa_cv_tmp` (`docs/phase3/RESUME-PROCESSING-FAILED-CV-TMP-ITEM-ID-RCA.md`). `rpa_cv` and `rpa_cv_tmp` must keep the same columns.
- **Staging and local share one database.** A destructive script run "locally" runs on staging. Production is a different database on the same host; always pass `--expect-db`.
- **Timestamps:** older tables use `timestamp` (no zone), newer ones `timestamptz`. Business days are India time (IST): use `backend/src/utils/dateFormat.js` and the IST day boundaries in `utils/dashboardMetrics.js` (frontend: `src/utils/dateFormat.js`, `istDateParts`) rather than the server's midnight.
- **Vectors:** `rpa_cv_vectors.embedding` is written with raw SQL (`$n::vector`). Prisma cannot read the column.
- **Append-only audit:** `rpa_mrf_approval_events` refuses updates and deletes except from the retention sweep inside its own transaction (`app.audit_retention = 'on'`).

## 5. Handy read-only queries

```sql
-- A candidate's journeys and where they are
SELECT p.id, p.mrf_id, p.current_stage_key, p.current_stage_status, p.final_outcome, p.closed_at
  FROM rpa_candidate_pipeline p JOIN rpa_cv c ON c.id = p.cv_id
 WHERE lower(trim(c."EmailID")) = lower(trim('someone@example.com'));

-- The audit trail of one journey
SELECT created_at, stage_key, event_type, outcome, reason_text, acted_by, email_sent, email_error
  FROM rpa_pipeline_stage_events WHERE pipeline_id = 123 ORDER BY created_at;

-- Errors for a ref (N42)
SELECT created_at, source, message, route, user_id FROM rpa_error_log WHERE request_id = 'K7Q2MX';

-- Job heartbeats (N42)
SELECT key, value FROM rpa_settings WHERE key LIKE 'job_heartbeat.%' ORDER BY key;
```
