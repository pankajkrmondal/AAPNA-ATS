# Manual Candidate / CV Deletion via pgAdmin

> **Runbook for removing a candidate or their CV by hand in the database.** There is no admin UI for
> this — no delete endpoint and no "remove resume" handler exists in the codebase, so it is a manual
> pgAdmin procedure. Plain language; assume the reader hasn't seen the schema.

The headline facts, because both are counter-intuitive:

1. **There is no "CV file" table.** A candidate's CV is a single nullable TEXT column —
   `rpa_cv."cvFileUrl"` — holding a OneDrive/SharePoint `webUrl` (with a `/uploads/<file>` local path
   as a degraded fallback). No BLOB, no `candidate_cv` table, no `file_id`. The table
   `rpa_candidate_documents` sounds right but is **not** the CV — it holds post-offer joining
   documents (PAN, Aadhaar, payslips) and has no link to the CV at all.
2. **`DELETE FROM rpa_cv` alone is unsafe.** Only two tables have a real foreign key to `rpa_cv`. The
   tables that matter most carry a `cv_id` column with **no FK constraint**, so Postgres lets the
   delete succeed and silently strands a nine-table pipeline subtree behind it.

Source of truth in code:
- [`prisma/schema.prisma`](../../backend/prisma/schema.prisma) — `rpa_cv` model (CV columns at lines 137–143), `rpa_cv_tmp`, `rpa_candidate_pipeline`
- [`prisma/ddl/`](../../backend/prisma/ddl/) — hand-written DDL; there is no `prisma/migrations/` directory
- [`prisma/cleanup-test-data.js`](../../backend/prisma/cleanup-test-data.js) — the closest existing automation (bulk/date-windowed, not per-candidate)
- [`services/hrUpload.service.js`](../../backend/src/services/hrUpload.service.js) — writes `cvFileUrl` (line 1129)
- [`pages/Candidates.jsx`](../../frontend/src/pages/Candidates.jsx) — frontend guard for a null CV (line 308)

---

## Decide first: clear the CV, or delete the candidate?

These are very different operations. Pick before you start.

| Goal | Operation | Risk |
|---|---|---|
| Hide/remove the resume, keep the person | `UPDATE rpa_cv SET "cvFileUrl" = NULL WHERE id = <id>;` | None. Blocks nothing, reversible, UI already handles it |
| Stop the resume appearing in search too | Above, plus clear `resume_full_text`, `resume_tsvector`, `resume_technical_terms`, `resume_text_quality` and delete the `rpa_cv_vectors` rows | Low |
| Remove the candidate entirely | The [full procedure](#full-deletion-procedure) below | **High** — orphans data if done naively |

If you only need the first row of that table, stop after running that one `UPDATE`. The frontend
already shows *"Resume is not available for this candidate right now."*
([`Candidates.jsx:308`](../../frontend/src/pages/Candidates.jsx#L308)).

---

## The foreign key map

**Real FKs to `rpa_cv(id)` — only these two exist:**

| Table | Column | ON DELETE |
|---|---|---|
| `rpa_email_messages` | `candidate_id` | SET NULL |
| `rpa_shortlisted_candidates` | `cv_id` | **CASCADE** |

That cascade chains onward: `rpa_zeko_candidate_pipeline.candidate_id → rpa_shortlisted_candidates(id)
ON DELETE CASCADE`, and `rpa_email_messages.shortlist_id` SET NULLs.

**Columns holding a candidate ID with NO FK — these orphan silently:**

| Table | Column | Evidence |
|---|---|---|
| `rpa_candidate_pipeline` | `cv_id` | [`schema.prisma:677`](../../backend/prisma/schema.prisma#L677) — bare `BigInt?`, no relation to `rpa_cv` |
| `rpa_cv_vectors` | `candidate_id` | [`schema.prisma:636`](../../backend/prisma/schema.prisma#L636) — index only |
| `rpa_assessment_results` | `cv_id` | [`2026-07-24-assessment-import.sql:82`](../../backend/prisma/ddl/2026-07-24-assessment-import.sql#L82) — bare `BIGINT` |
| `rpa_upload_jobs` | `cv_id`, `cv_tmp_id` | [`schema.prisma:657-658`](../../backend/prisma/schema.prisma#L657-L658) |

### Why `rpa_candidate_pipeline` is the one that matters

Nine tables cascade correctly **from** the pipeline row — `rpa_pipeline_stage_events`,
`rpa_interview_schedule`, `rpa_interview_scorecard`, `rpa_assessment_invites`,
`rpa_document_requests` (and `rpa_candidate_documents` beneath it), `rpa_offers`, with
`rpa_notifications` and `rpa_assessment_results` as SET NULL.

But because `cv_id` has no FK pointing **up** to `rpa_cv`, deleting the candidate row touches none of
them. Deleting the pipeline row explicitly collapses that entire subtree in one statement. This is the
single most important line in the procedure.

`rpa_cv_tmp` (the HR review queue) is standalone — zero FK constraints, safe to delete from
independently.

### Verifying this map yourself

Don't trust this document — these two queries print the live truth.

```sql
-- Every column that could reference a candidate
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE column_name IN ('cv_id','candidate_id','cv_tmp_id')
  AND table_schema = 'public'
ORDER BY table_name;
```

```sql
-- Which of those are actually enforced by a foreign key
SELECT tc.table_name, kcu.column_name,
       ccu.table_name AS references_table, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name IN ('rpa_cv','rpa_candidate_pipeline','rpa_shortlisted_candidates')
ORDER BY ccu.table_name, tc.table_name;
```

Rows present in the first result but absent from the second are exactly the silent-orphan columns.

In the pgAdmin GUI the same information lives under **Servers → Databases → Schemas → public →
Tables → rpa_cv → Constraints**; *incoming* references appear on each child table's own Constraints
node.

---

## Full deletion procedure

### Opening the Query Tool

1. In the left **Browser** tree: **Servers** → your server → **Databases** → click your ATS database
   **once to select it**. The Query Tool runs against whatever is selected.
2. **Tools → Query Tool** (or right-click the database → Query Tool).
3. **▶ Execute** is the play arrow, or **F5**.

### Two syntax gotchas

- **pgAdmin does not support `:cv_id` placeholders.** Type the real number instead — e.g. `12345`.
  (pgAdmin's own `:'cv_id'` form pops a parameter dialog, but it's fiddlier than just typing the ID.)
- **camelCase columns need double quotes.** `"Name"`, `"EmailID"`, `"cvFileUrl"`, `"reviewStatus"`
  will fail without them — unquoted, Postgres folds them to lowercase and errors with
  `column "emailid" does not exist`. Lowercase columns like `id` need no quotes.

### Step 1 — Identify the candidate

```sql
SELECT id, "Name", "EmailID", "cvFileUrl",
       resume_text_quality, ("resume_full_text" IS NOT NULL) AS has_text
FROM rpa_cv
WHERE "EmailID" = 'candidate@example.com';   -- or: WHERE id = 12345
```

Also check the review queue — an HR-uploaded CV lands there first and the row persists after approval:

```sql
SELECT id, "Name", "EmailID", "cvFileUrl", "reviewStatus", "uploadedAt"
FROM rpa_cv_tmp
WHERE "EmailID" = 'candidate@example.com';
```

Note the `rpa_cv.id` and any `rpa_cv_tmp.id`. If the second query returns nothing, there is no tmp
copy — omit the `rpa_cv_tmp` line in Step 4.

### Step 2 — Check the blast radius

Substitute your real ID in all six places:

```sql
SELECT 'pipeline' AS t, count(*) FROM rpa_candidate_pipeline WHERE cv_id = 12345
UNION ALL SELECT 'shortlisted', count(*) FROM rpa_shortlisted_candidates WHERE cv_id = 12345
UNION ALL SELECT 'vectors',     count(*) FROM rpa_cv_vectors        WHERE candidate_id = 12345
UNION ALL SELECT 'assessments', count(*) FROM rpa_assessment_results WHERE cv_id = 12345
UNION ALL SELECT 'upload_jobs', count(*) FROM rpa_upload_jobs        WHERE cv_id = 12345
UNION ALL SELECT 'emails',      count(*) FROM rpa_email_messages     WHERE candidate_id = 12345;
```

**Read the `pipeline` count carefully.** `0` means the candidate never entered the hiring pipeline and
the retention caveat below doesn't apply. `1` or more means check how far they got.

### Step 3 — Back up the row

```sql
CREATE TABLE IF NOT EXISTS _manual_cv_backup AS SELECT * FROM rpa_cv WHERE false;
INSERT INTO _manual_cv_backup SELECT * FROM rpa_cv WHERE id = 12345;
```

Expect `INSERT 0 1` in the **Messages** tab. This preserves `cvFileUrl`, so the OneDrive file stays
reachable if this needs undoing.

### Step 4 — Dry run

Paste the Step 5 block but change the final `COMMIT;` to **`ROLLBACK;`**, then execute. pgAdmin runs
everything, prints `DELETE 1`, `DELETE 3` etc. in **Messages**, then discards it all. Compare those
counts against Step 2. Zero risk, and it catches typos before they matter.

### Step 5 — Delete, children before parents

```sql
BEGIN;

-- 1. Pipeline subtree. No FK from cv_id, so this MUST be explicit.
--    Cascades: stage_events, interview_schedule, interview_scorecard,
--    assessment_invites, document_requests (+ candidate_documents), offers.
DELETE FROM rpa_candidate_pipeline WHERE cv_id = 12345;

-- 2. Embeddings — no FK; would otherwise keep serving this candidate in semantic search.
DELETE FROM rpa_cv_vectors WHERE candidate_id = 12345;

-- 3. Assessment results — pipeline_id just went SET NULL above; cv_id has no FK.
DELETE FROM rpa_assessment_results WHERE cv_id = 12345;

-- 4. Upload-job audit rows — no FK either way.
DELETE FROM rpa_upload_jobs WHERE cv_id = 12345 OR cv_tmp_id = 678;

-- 5. The candidate. Cascades rpa_shortlisted_candidates (and rpa_zeko_candidate_pipeline
--    beneath it); NULLs rpa_email_messages.candidate_id.
DELETE FROM rpa_cv WHERE id = 12345;

-- 6. The review-queue copy. Standalone table, no constraints. Omit if none exists.
DELETE FROM rpa_cv_tmp WHERE id = 678;

COMMIT;   -- or ROLLBACK; if any count looks wrong
```

**Execute the whole block in one go** (select all, F5). Do not run statements one at a time — running
`BEGIN;` alone and walking away leaves an open transaction holding row locks, and the app will start
hanging.

Ordering only matters for statement 1 relative to statement 3; the rest are independent. The single
transaction is what makes a mistake anywhere recoverable.

### Step 6 — Verify

Re-run the Step 2 query. Every count should be `0`. Then open the candidate list in the app and
confirm the candidate is gone and no pipeline card references a missing candidate.

---

## Recovery

| Situation | Fix |
|---|---|
| `current transaction is aborted, commands ignored until end of transaction block` | One statement errored mid-transaction. Run `ROLLBACK;` alone, fix, start over. Nothing was saved. |
| Tab closed mid-transaction | Choose rollback when pgAdmin prompts. If the app hangs, check `SELECT * FROM pg_stat_activity WHERE state = 'idle in transaction';` |
| Need the candidate back | `INSERT INTO rpa_cv SELECT * FROM _manual_cv_backup WHERE id = 12345;` — restores the row and `cvFileUrl`, but **not** the pipeline/vector/assessment rows, which are gone permanently. |

---

## Caveats

- **Joining documents are retention-protected.** [`2026-07-29-document-collection.sql:16`](../../backend/prisma/ddl/2026-07-29-document-collection.sql#L16)
  records an RT-confirmed policy that these are *never* deleted — records get pulled up to 3 years
  later for appraisals, and there is deliberately no hard-delete or expiry job anywhere in that
  module. Step 5 statement 1 cascades them away via `rpa_document_requests`. **If the candidate
  reached offer/joining stage, confirm with RT before running this.**
- **Emails are kept by design.** `rpa_email_messages.candidate_id` is SET NULL, so correspondence
  survives with the candidate link removed. To remove it too, delete its children first
  (`rpa_email_tracking`, `rpa_email_notifications`) as
  [`cleanup-test-data.js:204-206`](../../backend/prisma/cleanup-test-data.js#L204-L206) does.
- **The OneDrive file is not touched.** Only the DB link goes. The file remains in the folder under
  `MS_ONEDRIVE_PARENT_ID`. Delete it in OneDrive separately if the CV must genuinely be destroyed
  (e.g. a data-deletion request).
- **Don't repurpose the cleanup script.** [`cleanup-test-data.js`](../../backend/prisma/cleanup-test-data.js)
  is date-windowed and bulk (dry-run by default, `--confirm` to apply). It notably does **not** delete
  `rpa_candidate_pipeline`, so it orphans pipelines — the same trap this runbook exists to avoid.
- **Rehearse on staging.** `Excel/staging-DB-21072026.sql` is a full dump, so staging is recoverable
  if the procedure needs adjusting for a specific candidate.
