# Evalground Bulk-CSV Import — DDL Apply Instructions

**File:** `2026-07-24-assessment-import.sql`
**Do not hand-edit `schema.prisma`** — per `docs/reference/VENDOR_PROCESS.md` §13, this repo always introspects the live DB.

## Steps to apply (requires staging DB access)

1. Run the SQL file against the staging Postgres database:
   ```
   psql "$DATABASE_URL" -f backend/prisma/ddl/2026-07-24-assessment-import.sql
   ```
   (or paste it into your usual DB tool). It is idempotent — safe to re-run.

2. Stop the backend, then introspect + regenerate the Prisma client:
   ```
   cd backend
   npx prisma db pull
   npx prisma generate
   ```
   This adds the 3 new models below to `schema.prisma` automatically — no hand-editing.

3. Restart the backend. Until steps 1–2 are done, `assessmentImport.service.js` will
   fail because the Prisma client doesn't yet know these tables.

## New tables this introduces

| Table | Purpose |
|---|---|
| `rpa_assessment_imports` | One row per bulk-CSV upload batch: file metadata, uploader, row-count tallies. `mechanism`/`source_message_id` columns exist only so the deferred Outlook-mailbox-polling path can reuse this table later without another migration — this build only ever writes `mechanism='bulk_csv'`. |
| `rpa_assessment_test_mappings` | Remembered section→skill mapping, keyed by exact test name (derived from the uploaded file name — see note below). Confirmed once by HR per distinct test; later imports of the same test apply it silently. |
| `rpa_assessment_results` | One row per candidate-per-test-cycle result: raw Section 1/2/3 marks, Evalground's own overall `Percentage`/`Result`, the frozen mapping actually applied, and a status (`matched`/`unmatched`/`duplicate_skipped`/`score_overwritten`/`error`). |

## No DDL needed on `rpa_cv`

`IQScore`/`TechScore` already exist as `String?` columns (`schema.prisma:112-113`).
Writeback from this feature serializes the matched section's raw marks value to a
plain string (no `%`) — same convention as every other writer of these columns.

## Note on the real sample file vs. doc 07's original design

`docs/phase3/07-EVALGROUND-IMPORT-PLAN.md` describes a per-row "Test Name" column
used to cluster mixed test types within one bulk file. The actual sample file
provided (`docs/General Aptitude, Python, SQL MCQ Test at AAPNA - 2025TestReport
(15) 1.csv`) has no such column — a Evalground "Test Report" export is scoped to
one test, with the test's name only present in the file name. `test_name` in
`rpa_assessment_test_mappings`/`rpa_assessment_results` is therefore derived from
the uploaded file name (schema-free extraction still checks for an explicit
in-row field first, in case some export does carry one).

## After this lands

- `backend/src/services/assessmentImport.service.js` — row extraction, AI mapping suggestion, matching, commit/writeback
- `backend/src/routes/assessmentImport.routes.js` — mounted from `backend/src/routes/pipeline.routes.js` at `/assessment-import`
- `backend/src/config/pipelineStages.js` — `finalStatusLabelFor()` gets an `assessment`-stage branch (`'Evalground Test Passed'`/`'Evalground Test Failed'`/`'Evalground Test on Hold'`)
- Frontend: `frontend/src/components/pipeline/AssessmentImportModal.jsx`, `frontend/src/services/assessmentImportService.js`, `PipelineDrawer.jsx`/`Pipeline.jsx` changes
