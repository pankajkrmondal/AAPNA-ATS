# Phase 3 — Module 2: Evalground Bulk-CSV Import

Scope: builds the bulk-CSV path of `docs/phase3/07-EVALGROUND-IMPORT-PLAN.md`'s
M2 design. The automatic Outlook-mailbox-polling mechanism (single-result
ingestion) is **explicitly deferred** — not built this pass; see §7.

---

## 0. UI placement correction — import trigger moved out of the candidate drawer

Original build put the "Import Evalground results (CSV)" button inside
`PipelineDrawer.jsx`'s per-candidate Assessment round panel, gated to a
specific journey's `isCurrent` state. Corrected per feedback: **the import is
a bulk operation across every candidate currently in the round, not a
per-candidate action** — it doesn't belong scoped to one candidate's drawer,
and with 0 candidates in that column there was no card to open to reach it at
all.

- **`frontend/src/pages/Pipeline.jsx`** — the trigger now lives in the "IQ /
  TECH ASSESSMENT" column's header (next to its candidate-count badge),
  visible regardless of how many cards are in the column. `AssessmentImportModal`
  is now mounted here instead, alongside `PipelineDrawer`.
- **`frontend/src/components/pipeline/PipelineDrawer.jsx`** — the button,
  `showImportButton` computation, and the modal mount were removed entirely.
  The result **display** (score/detail line, "Evalground test pending" text,
  "Evalground suggests: Passed/Failed" tag) stays in the drawer — only the
  upload trigger moved, since viewing an already-imported result is still a
  per-candidate concern.

---

## 1. Real sample file changed two of doc 07's assumptions

A real Evalground export was provided (`docs/General Aptitude, Python, SQL
MCQ Test at AAPNA - 2025TestReport (15) 1.csv`) and materially differs from
doc 07's description:

- **No per-row "Test Name" column exists.** A Evalground "Test Report" export
  is scoped to one test; the test's identity is only in the file name. The
  importer derives the test name from the uploaded file name (verbatim, minus
  extension) rather than clustering by a row column — the AI row-parser still
  checks for an explicit in-row test-name field first, in case some export
  does carry one.
- **Section 1/2/3 "Marks" are raw marks, not percentages** — no "out of X"
  column exists, though the total per section is derivable from
  `Correct + Wrong + Unattempted` (verified against the file's own overall
  `Percentage` column). Rather than deriving a per-section 50% pass mark,
  **the suggested outcome uses Evalground's own overall `Result`/`Percentage`
  columns directly** — simpler, trusts the vendor's own computation.

## 2. New tables

`backend/prisma/ddl/2026-07-24-assessment-import.sql` + `.README.md`
(idempotent, additive — not yet applied to any environment as of this
commit; apply per the README before this feature can run):

- **`rpa_assessment_imports`** — one row per upload batch (file metadata,
  uploader, row-count tallies). `mechanism`/`source_message_id` columns exist
  only so the deferred mailbox path can reuse this table later.
- **`rpa_assessment_test_mappings`** — the remembered section→skill mapping
  cache doc 07 requires ("remembered by exact test name") but never names as
  a table — keyed by the file-derived test name, no `company_id` (no
  candidate-domain table in this schema carries tenant scoping today).
- **`rpa_assessment_results`** — one row per candidate-per-test-cycle result.
  `pipeline_id` is nullable (durably records unmatched/unresolved-multi-journey
  rows rather than dropping them). Retake dedup is scoped to
  `(pipeline_id, test_name)`, not raw `(email, test_name)`, so a candidate's
  separate hiring cycles years apart never collide.

## 3. Backend

- **`backend/src/services/assessmentImport.service.js`** (new) — row
  extraction reuses the exact schema-free "flatten row → AI parses JSON"
  pattern already in `hrUpload.service.js` (~lines 1083-1101), same
  `generateContentWithFallback()` call (OpenRouter → Gemini fallback, the
  codebase's existing standardized LLM path — no new provider introduced).
  One AI call per new/unconfirmed test-name cluster suggests a Section→skill
  mapping; candidate matching resolves concurrent open journeys (same email,
  multiple MRFs) by auto-matching the most-recently-entered Assessment-stage
  journey only, flagging the rest — resolves doc 04's previously-open Q24 for
  this feature's purposes. Preview results are cached in the existing shared
  Redis client (`backend/src/config/redis.js`) between the preview and commit
  calls; no new queue/worker.
- **`backend/src/routes/assessmentImport.routes.js`** +
  **`backend/src/controllers/assessmentImport.controller.js`** (new) — four
  endpoints under `/api/pipeline/assessment-import/*`
  (`preview`/`commit`/`history`/`candidate/:pipelineId`), mounted from inside
  `pipeline.routes.js` (inherits `authenticate` +
  `checkModuleAccess('recruitment_pipeline')` — no new module-permission
  key), registered before the generic `/:id` route.
- **`backend/src/config/pipelineStages.js`** — `finalStatusLabelFor()` gets an
  `assessment`-stage branch: `approved` → `'Evalground Test Passed'`,
  `rejected` → `'Evalground Test Failed'`, `hold` → `'Evalground Test on
  Hold'`. This is a deliberate exception to the otherwise-uniform
  `"{stage label} {outcome}"` convention (which RT explicitly asked to keep
  stage-prefixed elsewhere) — justified because `"Evalground Test Failed"` is
  already a pre-existing legacy string this codebase anticipates (see
  `VendorDashboard.jsx`'s `classifyStatus()` comment). No changes to
  `seed-pipeline-stages.js` or to the frontend's `OUTCOME_BUTTONS`/
  `OUTCOME_TAG` — the on-screen Approve/Hold/Reject buttons stay generic;
  only the underlying `rpa_cv.FinalStatus`/`rpa_pipeline_stage_events.status_label`
  text changes for this stage.
- On commit, each successfully matched row also writes
  `rpa_cv.FinalStatus = 'Evalground Test Shared'` (result received, HR
  decision still pending) plus a `rpa_pipeline_stage_events` audit row
  (`event_type: 'note'`, matching the existing ad-hoc-email note convention
  in `pipeline.service.js`) — distinct from the later Pass/Fail/Hold outcome
  event, which is written unchanged by the existing `setStageOutcome()`.
- **`backend/src/services/pipeline.service.js`** — `listPipeline()` gets an
  additive `assessment_pending` flag per card (mirrors the existing
  `zekoScoredCvIds` batch-lookup), for the "Evalground test pending" board
  badge. **Depends on the new `rpa_assessment_results` table existing** — see
  §6 deploy-order note.

## 4. Frontend

- **`frontend/src/services/assessmentImportService.js`** (new).
- **`frontend/src/components/pipeline/AssessmentImportModal.jsx`** (new) —
  Upload → AI reads rows → **conditional** mapping review (only when the
  batch has new/unconfirmed test-name clusters — a repeat import against
  known tests skips straight to the report, preserving the simplicity
  `CandidatePipelinePrototype.jsx`'s v5 pass settled on for this exact flow)
  → validation report (stat tiles, per-row status, inline "pick journey"
  control for multi-journey rows) → commit.
- **`PipelineDrawer.jsx`** — the Assessment stage's `buildPipelineSegments()`
  branch no longer falls through to the generic "Not available yet — needs
  Module 2/3" placeholder; it shows "Evalground test pending" until a result
  exists, then score/result detail, plus the import button and a "Evalground
  suggests: Passed/Failed" tag next to the existing (unchanged) Approve/Hold/
  Reject buttons.
- **`Pipeline.jsx`** — `cardStatus()` gets an "Evalground test pending" board
  chip, driven by the new `assessment_pending` field.
- **`NotificationBell.jsx`** — second `socket.on('assessment:import_done', …)`
  listener alongside the existing `review:new` one (doc 02 §5's distinct
  import-completion bell event).

## 5. Scope trims (explicit decisions, not oversights)

- No admin `GET`/`PUT /mappings` endpoints this pass — a wrong remembered
  mapping is corrected by re-importing that test and re-confirming.
- No relabeling of the on-screen Approve/Reject/Hold buttons — only the
  backend `FinalStatus`/event-log text is Evalground-specific.

## 6. Deploy-order dependency

The DDL (§2) has not been applied to any environment as of this commit. Both
`assessmentImport.service.js` and `pipeline.service.js`'s new
`assessment_pending` lookup reference `prisma.rpa_assessment_results`, which
doesn't exist in the generated Prisma client until the DDL is applied and
`npx prisma db pull && npx prisma generate` is run. **Applying the DDL is a
prerequisite, not optional cleanup** — until then, the pipeline board's
`listPipeline()` will throw for any request touching an in-progress
Assessment-stage journey.

## 7. Deferred (not built this pass)

Automatic Outlook-mailbox-polling ingestion (`assessmentResultIntake.js`,
`mailboxPoller.js` fan-out, sender-domain allowlist) — the `mechanism`/
`source_message_id` columns on `rpa_assessment_imports` exist purely so this
can be added later without another migration.
