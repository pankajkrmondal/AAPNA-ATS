# Phase 3 — Evalground Import Plan (Format Verification + Mapping Decision + M2 Build Plan)

**Document 7** · Status: **Format verification complete, mapping decision made, M2 build plan below — 2026-07-20.** Closes Action Item #1 (`04-QUESTIONS.md` §C — Harish's format verification of the two sample files) and Action Item #3 (bulk-CSV section→skill mapping approach, also owed by Harish). Companion docs: [01-PROCESS-UNDERSTANDING.md](01-PROCESS-UNDERSTANDING.md) · [02-BUSINESS-DESIGN.md](02-BUSINESS-DESIGN.md) · [03-DEVELOPMENT-PLAN.md](03-DEVELOPMENT-PLAN.md) §M2 · [04-QUESTIONS.md](04-QUESTIONS.md) Q1 · [05-TASK-LIST-ETA.md](05-TASK-LIST-ETA.md) A2/A3.

This doc does not reopen anything RT already confirmed on the 2026-07-14 call
(email as the match key, retake overwrites only the score, latest-row-wins,
Evalground 50% pass mark, generic Section 1/2/3 import labels) — see
`04-QUESTIONS.md` Q1 for those. It settles the two things that were still
open, then lays out the M2 build against the settled design.

---

## 1. Format verification (Action Item #1 — closed)

### 1.1 Bulk CSV (Naveen, shared 2026-07-14)

Verified against the Section 1/2/3 design agreed on the call:
- Candidate email present and usable as the unique match key; no header-row
  anomalies.
- Columns are generic as RT described — no fixed "GA" / "Technical" headers,
  just three score columns (Section 1/2/3) plus candidate identity fields.
- Multiple rows per candidate are possible (retakes), confirming Q1.
- **New finding, not covered by the written Q1 answer:** the file carries a
  free-text **Test Name** column (e.g. *"Java Developer – Technical
  Assessment"*, *"General Aptitude + English"*) even though the score columns
  themselves stay generic. RT's stated intent — "import as Section 1/2/3, RT
  renames the labels afterward" — assumed a purely manual relabeling step.
  The Test Name column means there's a real signal to relabel *from*, which
  is what makes the AI-suggested mapping in §2 possible instead of asking RT
  to guess a skill from three unlabeled numbers.

### 1.2 Single-result Outlook report (Chhaya, shared 2026-07-14)

- **This is not an attachment to upload — it's Evalground's own transactional
  notification email**, landing directly in the shared recruitment mailbox
  one candidate/test at a time. Subject carries the test title and candidate
  name; the body is an HTML table with the same Section 1/2/3-shaped scores
  as the bulk file, scoped to one candidate.
- A manual "single-result entry screen" (as sketched in
  `03-DEVELOPMENT-PLAN.md` §M2: *"a lighter single-result entry path for the
  Outlook mechanism"*) would mean RT reads an email Evalground already sent
  into a mailbox the ATS already polls, then retypes it into a form. That's
  the wrong shape for something already arriving as structured inbox
  traffic — see §3.

---

## 2. Mapping decision (Action Item #3 — closed)

**Decision: section→skill mapping is AI-suggested from the test title text,
confirmed by RT once per import batch — never once per row.**

How it works:
- The importer clusters rows by their exact Test Name string. A single bulk
  file can (and per Q1, does) mix test types across rows — e.g. some
  candidates on GA + English, others on a role-specific technical test — so
  clustering happens within the batch, not per file.
- For each distinct cluster, AI suggests a `{ Section 1 → skill, Section 2 →
  skill, Section 3 → skill }` mapping read off the test title text (e.g.
  *"Java Developer – Technical Assessment"* → Section 1 = General Aptitude,
  Section 2 = Java, Section 3 = Problem Solving), shown with the row count it
  covers.
- RT sees **one review screen per import**, listing every cluster found in
  that batch with its suggested mapping, editable inline. **One "Confirm
  mapping for this batch" action** applies every cluster's mapping to every
  row in it — not a per-row prompt, not a per-cluster prompt.
- Confirmed mappings are remembered by exact Test Name text. A later import
  containing a previously-confirmed test name applies the remembered mapping
  automatically and doesn't ask again; only genuinely new test-name strings
  surface for review.
- The single-result mailbox path (§3) reuses this same remembered-mapping
  table. A message whose test name has already been confirmed in a prior
  batch ingests silently; an unrecognized test name is queued into a short
  "needs mapping" list rather than blocking that day's ingest.

This closes the "bulk mapping approach not yet decided" item — the
single-candidate path no longer needs its own separate "prompt at entry
time" behavior either, since both paths now share the same clustered,
batch-confirmed mapping mechanism.

---

## 3. Ingestion redesign: single-result path becomes automatic mailbox polling

`03-DEVELOPMENT-PLAN.md` §M2 currently describes the second mechanism as a
manual "single-result entry path." Verification (§1.2) shows the result
already arrives as ordinary inbox traffic in the same shared mailbox the ATS
already polls via `backend/src/services/outlookReader.service.js` and
`backend/src/jobs/mailboxPoller.js` (the consolidated Graph delta poller,
P5-A/P6.1, which fans a single per-tick delta fetch out to
`processIntakeMessages` (resume intake, `emailResumeIntake.js`) and
`processInboundMessages` (conversation sync, `inboundEmailSync.js`)).

**Decision: no manual upload/entry screen for the single-result path at
all.** Instead, add a third fan-out processor to the same poll tick:

- New `backend/src/jobs/assessmentResultIntake.js`, same shape as the two
  existing processors, exporting `processAssessmentResultMessages(messages)`.
- `mailboxPoller.js`'s `runMailboxPoll()` calls all three processors against
  the one delta-fetched batch — no second polling loop, no second Graph
  subscription, no watermark to manage separately.
- Detection: match Evalground's sender address (exact `from` match, or
  domain fallback) before handing a message to the processor — non-matching
  messages fall through untouched to the other two processors, so this is
  additive to the existing poller, not a fork of it. **Open item:** the exact
  sender address/domain needs confirming against the real sample email
  header before this ships (assumed `evalground.com` for now).
- Per matched message: read the subject for the test title, then extract
  candidate email + Section 1/2/3 scores from `msg.bodyHtml` using the same
  schema-free row-reading described in §4 — one extraction function serves
  both the bulk CSV rows and the single-result email body row, so there's
  only one place that knows how to read a Evalground-shaped result.
- Idempotency: `rpa_assessment_imports.source_message_id` (set only for this
  path) means a message re-emitted by the Graph delta poller (which resends
  unchanged messages whose metadata changed, e.g. read flag) is a no-op on
  a second pass — mirrors how the existing two processors are already
  idempotent on `graph_message_id`.
- RT-facing surface: the Assessment round's import history gains a
  `mechanism` column (`bulk_csv` / `single_outlook`) so auto-ingested single
  results show up next to manually-uploaded bulk batches with no separate
  screen to check.

---

## 4. Schema-free row reading (mirrors hrUpload.service.js)

Both mechanisms read rows the same way: no column-position mapping for the
bulk CSV, no hand-written HTML-table cell parser for the single-result
email. Each row — a CSV row, or the single body-table row in a result email —
is flattened to `key: value` text and handed to an AI parser that returns
`{ email, name, testName, section1, section2, section3 }` regardless of
header wording, column order, or table markup.

This is the same pattern already used for the HR bulk resume upload in
`backend/src/services/hrUpload.service.js` (~lines 1083–1100): Excel rows are
flattened via `Object.entries(row).map(([k, v]) => \`${k}: ${v ?? ''}\`).join('\n')`
and handed to the AI parser rather than mapped through fixed column
positions. The v5 pass on the Pipeline Prototype
(`docs/changelog/CHANGES-pipeline-prototype-v5-ai.md`) already previews this
UX for the bulk path in the mock; this doc's M2 build makes it real, and
extends it to the mailbox path as well.

---

## 5. New tables

Supersedes the vaguer "result columns/rows linked to the candidate"
placeholder in `03-DEVELOPMENT-PLAN.md` §M2:

- **`rpa_assessment_imports`** — one row per import event. `mechanism`
  (`bulk_csv|single_outlook`), `source_message_id` (Graph message id,
  nullable — set only for the mailbox path; the idempotency key for §3),
  `file_name`/`uploaded_by`/`uploaded_at` for the bulk path, row counts
  (`matched`/`unmatched`/`error`), raw file or message reference.
- **`rpa_assessment_results`** — one row per candidate-per-test-cycle
  result. `import_id` FK → `rpa_assessment_imports`, `pipeline_id` FK (the
  candidate's Assessment-round journey), `test_name` (raw text from the file
  or email), `section_label_map` JSONB (the confirmed Section 1/2/3 → skill
  mapping applied to this row, per §2), `section_1_score`/`section_2_score`/
  `section_3_score`, `email_matched`, `status`
  (`matched|unmatched|duplicate_skipped|score_overwritten`), timestamps.

---

## 6. M2 build plan (supersedes/refines 03-DEVELOPMENT-PLAN.md §M2)

**Backend**
- `backend/src/services/assessmentImport.service.js` — shared row extraction
  (§4), batch mapping-cluster suggestion + confirm (§2), commit logic
  (skip-unless-score-changed per Q1's retake rule), preview/validation
  report generation.
- `backend/src/jobs/assessmentResultIntake.js` — new fan-out processor,
  wired into `mailboxPoller.js` per §3.
- Endpoints under `/api/pipeline/assessment-import`:
  `POST /preview` (bulk file → parsed rows + suggested mapping clusters),
  `POST /commit` (batch mapping confirmed → writes
  `rpa_assessment_imports`/`rpa_assessment_results`, updates the candidate's
  IQ/Technical scores on the Assessment round), `GET /history`.

**Frontend** (inside the Assessment round panel — placement unchanged from
RT's 2026-07-10 decision, never a standalone screen):
- Upload → AI-suggested mapping review (clusters grouped by test-name, one
  "Confirm mapping for this batch" action, never per-row) → validation
  report (matched/unmatched/malformed) → commit. Same shape already mocked
  in the Pipeline Prototype's v5/v6 import modal, now wired to the real
  endpoints above instead of static mock data.
- Import history list gains the `mechanism` column and shows auto-ingested
  single results as they land, with no upload action attached to those rows.

**Verification** (extends the `03-DEVELOPMENT-PLAN.md` §M2 checklist)
1. Bulk CSV with 2+ distinct test-name clusters → AI suggests 2+ mapping
   groups → one RT confirm action applies both → per-row Section labels
   correct for every row in each cluster.
2. A later batch reusing a previously-confirmed test name → mapping applied
   automatically, no re-prompt; a genuinely new test name still surfaces.
3. A crafted Evalground-shaped email dropped into the shared mailbox is
   picked up on the next `mailboxPoller.js` tick → lands in
   `rpa_assessment_results` with `mechanism='single_outlook'` and
   `source_message_id` set → re-delivery of the same message id (delta
   re-emit) is a no-op.
4. Retake row (same email, same test, changed score) → only the score column
   is overwritten, no other candidate fields touched.
5. Import history shows both mechanisms side by side, correctly labeled.

---

## Open items carried forward

- **Evalground sender allowlist** — exact `from` address/domain for
  `assessmentResultIntake.js` needs confirming against the real sample email
  header before build starts; currently assumed `evalground.com`.
- Everything else still open in `04-QUESTIONS.md` §C (🚨 Zeko API validation,
  Q24 shared-assessment dedup across concurrent journeys, storage capacity,
  MS Access feasibility, etc.) is unrelated to Evalground import and remains
  tracked there, unaffected by this doc.
