# Phase 3 — the Evalground import keeps the whole row, and the dossier shows it

Scope: closes the **Evalground half of Phase 3** of
`docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md`. Plan and evidence:
`docs/phase3/ASSESSMENT-REPORT-UPLOAD-PLAN.md`.

---

## 0. The item changed shape once the real export was read

The tracked item was *"HR exports the per-candidate Evalground report and uploads it; the dossier attaches it"*
(download plan §4.2). Three real exports say that file does not exist.

- An Evalground export is **one workbook per test, one row per candidate** — 47 columns, byte-identical across
  the 2025 CSV, the 2026 CSV and the 2026 XLSX samples.
- Its `Public Report` column is **truncated by Evalground's own exporter** at 62 characters, cutting the report
  id mid-UUID (`…/candidatereport/2c6f9fd3-0424-47`), with no hyperlink behind the cell. `Candidate Resume` is
  truncated the same way, and `Contact Number` is destroyed by Excel's scientific notation (`8.48E+09`).
- So there is no per-candidate file to attach and no per-candidate link to follow.

**What was actually missing** was not a file: the import read all 47 columns and stored **7**. Everything else —
every correct/wrong/unattempted count, the easy/medium/hard split, the totals, the duration, the attempt date
and the test's own topic columns — was parsed and discarded.

**So: no new upload feature.** HR keeps using the same **Import Evalground results** button on the IQ / Tech
Assessment column. The import now keeps the candidate's whole row, and the dossier renders their test — the same
resolution §6.7 reached for the Zeko report when its PDF proved unreachable.

**The rule that outranks the rest:** the uploaded file is multi-candidate and **never travels in a pack**. A
dossier about one candidate carrying every other candidate's name, email, phone and score would be a worse leak
than any single field §8.2 forbids.

---

## 1. Schema

`backend/prisma/ddl/2026-09-03-assessment-result-detail.sql` (+ `.README.md`) — eleven nullable columns on
`rpa_assessment_results`: `raw_row`, `started_on_text`, `started_on`, `duration_text`, `total_correct`,
`total_wrong`, `total_unattempted`, `section_detail`, `topic_scores`, `attempt_status`, `marked_as`,
`public_report_url`.

Typed columns are what the renderers read; `raw_row` is the archive, and the redaction guard asserts it can
never reach a pack. Existing rows stay `NULL`, which the pack reports honestly rather than as a candidate who
answered nothing.

---

## 2. Reading the row

`backend/src/utils/evalgroundRow.js` (new, pure, unit-tested) — header-driven, deterministic. The AI parser
keeps only the fuzzy job it already had (which cell is the email, the overall percentage); a hallucinated
`S2 Wrong` would be a wrong number in front of an interviewer with nothing to flag it.

Two rules, both from the real file:

1. **Blank is blank, zero is zero.** `S1 Result` is empty in every export and must land as `null`, never a
   falsy `0` that renders as a score of nought. `Sql: 0` is an answer and survives as `0`.
2. **The topic tail is discovered, never hard-coded.** Anything that is not a known Evalground header is a
   topic, because "Sql, Coding, Python, Py Test, Playwright, Pywinauto" is one test's tail and the next test
   HR runs will have another.

`isUsableReportUrl()` refuses the truncated `Public Report` link: it is stored verbatim so the question can be
answered from data, but a dead link inside a file we cannot correct once sent reads as our failure.

---

## 3. Import

`backend/src/services/assessmentImport.service.js`

- `extractRowsFromFile()` returns the parsed row alongside the flattened text it already built.
- `detailColumns()` writes the breakdown on create, and on a score overwrite (a changed score brings a fresh
  breakdown rather than leaving the old one describing numbers that no longer exist).
- **One exception to skip-unless-changed:** a row already on file whose `raw_row` is `NULL` gets its breakdown
  filled in. A `NULL` has nothing to protect, and it is the only route by which a candidate assessed before this
  shipped ever gets a full report. Scores, status and `import_id` are untouched.
- Nullable `Json` columns are written with `Prisma.DbNull`, never a plain `null`.

---

## 4. Dossier

- `candidateDossier.service.js` — `fetchAssessments()` reads the breakdown and labels it from
  `section_label_map`; `includeAssessmentDetail` gates it; the manifest now has **four** outcomes (included /
  withheld by the recruiter / never captured / no result), because a reader's next step differs in each.
- `candidateDossier.export.js` — section 7 renders the sections table (marks, correct, wrong, unattempted,
  easy-med-hard, result), the totals sentence and the topic table; sheet 4 of the workbook carries the same,
  so "Spreadsheet only" loses nothing.
- `dossierModel.js` — `assessment_detail(n)` audit category, separate from `assessments(n)`: three numbers and
  the whole of someone's test are different disclosures.
- `dossierRedaction.js` — refuses `raw_row`, `marked_as`, `public_report_url`, `candidate_resume`,
  `candidate_email`, `previous_assessments`.
- `pipeline.controller.js` — `assessment_detail=0|1`, defaulting **on** (ours, redacted, no link, works offline).

**Bug found while building:** `section_label_map` stores `{skill_label, legacy_field}` per section, and
`fetchAssessments()` was using that object as the label — so section headings in already-shipped packs render as
JSON rather than "Python". Fixed in `sectionLabel()`, which reads both that shape and the plain string older
rows hold.

---

## 5. UI

- `DossierDownloadModal.jsx` — a ticked-by-default **"Include the written test breakdown"** checkbox, shown only
  when the candidate has one; a three-state summary row (included / scores only / never captured); and the
  "not included yet" panel now says the spreadsheet itself is never attached, and why.
- `AssessmentImportModal.jsx` — every preview row expands to show what the file said about that candidate,
  before the import is confirmed and while it can still be cancelled.
- `PipelineDrawer.jsx` — the Assessment result line carries the time taken and the correct/wrong counts.

---

## 6. Tests

- `evalgroundRow.test.js` (new) — built on the real sample row: all three sections, the totals, blank results
  staying null, a genuine zero surviving, the topic tail discovered, a renamed header degrading to null rather
  than to a wrong number, the truncated report URL refused, and a non-Evalground row yielding `null`.
- `candidateDossier.test.js` — section 7 renders the breakdown; vendor totals unaltered; topic labels cannot
  inject markup; a legacy result says so; a withheld breakdown still shows the section scores; sheet 4 carries
  the detail; the audit records `assessment_detail(n)`.
- `dossierRedaction.test.js` — each newly forbidden key throws; a clean breakdown passes.

**278 unit tests pass.** Verified end to end against three real exports (`TestReport-4/5/6.xlsx`) with a harness
that runs sheet → parser → model → renderer → packed ZIP, then greps every byte of the pack: no other
candidate's name, no truncated vendor link, no `docs.google.com`, no `8.48E+09`, no `Marked As`, no raw row.

**One decision reversed by an existing test.** `contact_number` was going to join the forbidden names;
`dossierRedaction.test.js` asserts it is *allowed*, deliberately — a guard that rejects ordinary key names is
one somebody turns off. The export's phone column cannot reach a pack anyway: it travels only inside `raw_row`.

---

## 7. Deployment

`prisma/ddl/2026-09-03-assessment-result-detail.sql` is applied on staging and `prisma db pull` has been run
(schema.prisma carries the twelve columns plus the two Zeko share-link columns). **`prisma generate` is still
owed** — it failed with `EPERM` while the dev server and queue worker held the query engine. Stop both, run
`npm run prisma:generate`, and the write path is live.

Still owed: a pass through the real import UI with a multi-candidate export, and a dossier download per
candidate — the one path a no-database harness cannot exercise.
