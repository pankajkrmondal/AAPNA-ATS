# 2026-09-03 — Evalground result detail

**What it does.** Adds eleven nullable columns to `rpa_assessment_results` so an Evalground import keeps the
candidate's whole export row instead of three section scores, and the candidate dossier can render the
assessment rather than apologising for it.

**Apply:**

```bash
psql "$DATABASE_URL" -f prisma/ddl/2026-09-03-assessment-result-detail.sql
cd backend && npm run prisma:pull && npm run prisma:generate
```

`prisma:generate` takes a file lock on the Windows client — stop the dev server **and** the queue worker first,
or it fails with `EPERM`.

**Safe to re-run.** Every statement is `ADD COLUMN IF NOT EXISTS`. Nothing is dropped, renamed or backfilled.

## Why these columns

The Evalground export is one workbook per test with one row per candidate — 47 columns, identical across every
sample we hold (2025 and 2026, CSV and XLSX). The import read all 47 and stored 7. Everything the dossier now
shows in section 7 — per-section correct/wrong/unattempted, the easy/medium/hard split, the totals, the time
taken, the attempt date, the test's own topic columns — was being parsed and discarded.

| Column | Read by | Notes |
|---|---|---|
| `raw_row` | nothing, by design | The archive. `dossierRedaction.js` asserts it can never reach a pack |
| `started_on_text` / `started_on` | dossier / future queries | The text is what renders; the timestamp is for sorting |
| `duration_text` | dossier | As printed |
| `total_correct` / `total_wrong` / `total_unattempted` | dossier | Vendor counts, never recomputed |
| `section_detail` | dossier | Array of `{index, marks, correct, wrong, unattempted, easy_correct, medium_correct, hard_correct, result}` |
| `topic_scores` | dossier | `[{label, value}]` — discovered per test, never hard-coded |
| `attempt_status` | drawer / internal | The `Report` column |
| `marked_as` | internal only | Our own recruiter's tag — excluded from the pack |
| `public_report_url` | internal only | Stored verbatim; truncated by Evalground in every sample, so it is never rendered as a link |

## Existing rows

Stay `NULL`, and that is a supported state. The pack tells the reader plainly that the breakdown was captured
from this point on, rather than implying the candidate answered nothing.

Re-importing the same unchanged file backfills them. That is the one deliberate exception to the import's
"a row already on file is skipped unless the score changed" rule: a `NULL` has nothing to protect, and it is
the only route by which a candidate assessed before this shipped ever gets a full report. See
`assessmentImport.service.js` and `docs/phase3/ASSESSMENT-REPORT-UPLOAD-PLAN.md` §4.2.
