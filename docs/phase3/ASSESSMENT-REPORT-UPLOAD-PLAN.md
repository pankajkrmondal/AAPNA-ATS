# Evalground "Assessment Report Upload" — Implementation Plan

**Status:** **Phases A, B and E built 2026-09-03** — the import keeps the candidate's whole row, and the dossier
renders their written test in section 7 instead of naming it. 168 unit tests pass across the three affected
files (`evalgroundRow`, `dossierRedaction`, `candidateDossier`), including a new parser suite built on the real
sample export. **This closes the Evalground half of Phase 3** of `CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md`.
The import preview now expands to show what the file said about each candidate, and the drawer's result line
carries the time taken and the correct/wrong counts. Remaining here: **D** only (a per-candidate file slot,
which §9 Q2 may well close as unnecessary).

**Deployment state (2026-09-03):** the DDL is **applied on staging** and `prisma db pull` has been run — the
schema carries all twelve columns, exactly as hand-written, plus the two Zeko share-link columns that had not
been pulled before. **`prisma generate` is still owed:** it fails with `EPERM` while the dev server and the
queue worker hold the query engine, so stop both and run `npm run prisma:generate` before importing anything.
**Date:** 2026-09-03
**Owner:** Pankaj
**Priority:** P0 — named in `CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md` §4.2 as the separate item that plan depends on,
and confirmed by HR as the next item after the dossier.
**Related:** `docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md` (§3, §4.2, §6.4, §6.7, §8, §9 Phase 3),
`docs/phase3/07-EVALGROUND-IMPORT-PLAN.md` (the bulk import this extends)

---

## 0. The one-paragraph summary

The item was written as *"HR exports the per-candidate Evalground report and uploads it, and the dossier
attaches it."* **Three real Evalground exports say that file does not exist.** What Evalground gives us is one
workbook **per test with one row per candidate** — the same file the bulk import already consumes — and its two
link columns (`Public Report`, `Candidate Resume`) are **truncated by Evalground's own exporter** to the point
of being unusable. So there is no per-candidate file to attach and no per-candidate link to follow.

The answer is therefore not a new upload feature. It is: **keep the candidate's whole row at import time
(we currently throw away 40 of 47 columns), and render it into the dossier ourselves** — exactly the move §6.7
made for Zeko when its report PDF turned out to be unreachable. HR's workflow does not change at all: they keep
using the **Import Evalground results** button on the IQ / Tech Assessment column, which already accepts
`.csv` and `.xlsx` and already stores the raw file.

**And one rule that outranks everything else in this document:** the uploaded file is a **multi-candidate**
document. It must never travel inside a dossier. A pack for one candidate that carries a file listing every
other candidate's name, email, phone and score would be a worse leak than any single field §8.2 forbids.

---

## 1. What the export actually is — verified, not assumed

Read with `xlsx` on 2026-09-03, all three samples in `docs/`:

| File | Format | Sheets | Columns | Data rows |
|---|---|---|---|---|
| `General Aptitude, Python, SQL MCQ Test at AAPNA - 2025TestReport (15) 1.csv` | CSV | — | 47 | 1 |
| `General Aptitude, Python, SQL MCQ Test at AAPNA - 2026TestReport -2.csv` | CSV | — | 47 | 1 |
| `General Aptitude, Python, SQL MCQ Test at AAPNA - 2026TestReport-3.xlsx` | XLSX | one, named `in` | 47 | 1 |

**The 47 columns are byte-identical across all three**, including across the 2025 → 2026 boundary. That
stability is what makes a deterministic header mapping safe (§4.2).

```
Candidate Name · Candidate Location · Candidate Email · Contact Number · Candidate Resume ·
Started On · Previous Assessments · Duration · Marks Scored · Percentage · Result ·
Report · Certificate · Public Report ·
Section 1 Marks · S1 Correct · S1 Wrong · S1 Unattempted · S1 Easy Correct · S1 Medium Correct · S1 Hard Correct · S1 Result ·
Section 2 Marks · S2 … (same eight) ·
Section 3 Marks · S3 … (same eight) ·
Total Correct · Total Wrong · Total Unattempted ·
Sql · Coding · Python · Py Test · Playwright · Pywinauto ·        ← test-specific tail, NOT fixed
Marked As
```

### 1.1 Four findings that shape the design

1. **One file, many candidates.** One row per candidate-attempt, scoped to one test. The test's identity comes
   from the file name — `assessmentImport.service.js:64-67` already relies on this, because no row carries a
   test-name column. This is the whole reason §0's rule exists.

2. **`Public Report` is truncated and unusable.** The cell holds
   `https://evalground.com/code4/#/candidatereport/2c6f9fd3-0424-47` — 63 characters, with the report UUID cut
   at 16 of its 36 characters. There is **no hyperlink target** behind the cell either (checked `.l.Target` on
   the XLSX — absent). It cannot be opened, repaired, or guessed.
   *Caveat worth naming:* the **same** truncated string appears in all three files for three different
   candidates, and `Duration` is identical across all three too — these samples look like hand-edited copies of
   one original export. So this may be an artifact of the samples rather than of Evalground. **§9 Q1 asks HR for
   one fresh, unedited, multi-candidate export before we conclude anything about this column.** Either way it is
   not something to build on today.

3. **`Candidate Resume` is truncated the same way** — `https://docs.google.com/`, 24 characters, no document
   id. Never ingest it; the pack already carries the real resume from OneDrive (download plan §6.3).

4. **`Contact Number` is destroyed by the export** — `8.48E+09`, `9.19989E+11`. Excel scientific notation, the
   real digits gone. This file is not a contact source and must never be treated as one; the pack's contact
   block comes from `rpa_cv` under decision #10.

### 1.2 What we keep today, and what we throw away

`rpa_assessment_results` (schema.prisma:877-904) stores **7 of 47 columns**: `section_1..3_score`,
`overall_percentage`, `overall_result`, `overall_marks_scored`, plus the matched email. Everything else — every
correct/wrong/unattempted count, every difficulty split, every per-section result, the duration, the start time,
the whole test-specific topic tail — is read by `extractRowsFromFile()` (`assessmentImport.service.js:50-62`),
handed to the AI parser, and discarded.

That is the actual gap. Not a missing file: a missing 85% of the file we already have.

The raw file itself **is** kept — `assessmentImport.service.js:343-349` uploads it to OneDrive and stores the
URL on `rpa_assessment_imports.raw_file_url`. So nothing is lost forever; it is just unreadable per candidate.

---

## 2. Decisions

Marked ✅ where I am confident and would proceed; ❓ where §9 needs an answer first.

| # | Decision | Rationale |
|---|---|---|
| 1 ✅ | **No new upload UI.** HR keeps using the existing **Import Evalground results** button on the IQ / Tech Assessment column | It already takes `.csv`/`.xlsx`, matches by email to journeys on that stage, previews before writing, and archives the raw file. Adding a second upload path for the same file would split the audit trail and confuse the one person who uses it. |
| 2 ✅ | **The uploaded file NEVER enters a dossier** | It is multi-candidate. See §0 and §6.3. This is asserted by a test, not just by omission. |
| 3 ✅ | **The per-candidate report is rendered by us into the pack**, not attached as a file | Same resolution §6.7 reached for Zeko: we hold the data, so the reader needs no link and no second file, and it works offline and cannot be withdrawn later. |
| 4 ✅ | **Store the candidate's row verbatim (`raw_row` JSONB) *and* typed columns** | The typed columns are what the renderer reads — no schema guessing at render time. The verbatim row is the archive, so a column we did not anticipate is still recoverable next year without re-reading the file out of OneDrive. |
| 5 ✅ | **Deterministic header mapping for the new fields; the AI parser keeps only the fuzzy job it has today** | 47 stable headers across a year (§1) do not need an LLM, and an LLM must not be able to hallucinate a score. Renamed headers fall back to the existing AI path, and `raw_row` means nothing is lost either way. |
| 6 ✅ | **The detailed breakdown is ON by default in the pack** (`assessment_detail=1`) | It is ours, it is redacted, it travels offline. Same reasoning as §6.7's default: the safe half happens by itself. |
| 7 ✅ | **No separate `attachments/02_Evalground-Assessment-Report.xlsx`** | The HTML section plus the existing `Candidate-Summary.xlsx` sheet 4 carry it. A third file saying the same thing invites someone to "just attach the original" instead — the exact mistake decision #2 forbids. The attachment slot stays, empty, for §7 Phase D. |
| 8 ❓ | **Per-topic and per-difficulty detail may go to an external interviewer** | It is assessment substance, which is what the dossier is for — but it is more granular than anything HR has signed off. §9 Q3. |
| 9 ❓ | **A usable `Public Report` link, if one exists, ships OFF by default** | It would be a no-login link outside our redaction that we cannot revoke — precisely the §6.6 Zeko situation, and it gets the same construction: opt-in, warning at the tick, its own audit category. §9 Q1/Q4. |

---

## 3. Data model

Hand-written DDL per house convention (`prisma/ddl/`, then `npm run prisma:pull` + `prisma:generate` — this
project does not use `prisma migrate`). One file, additive and idempotent, with the `.README.md` the substantial
ones carry.

```
prisma/ddl/2026-09-XX-assessment-result-detail.sql
prisma/ddl/2026-09-XX-assessment-result-detail.README.md
```

On `rpa_assessment_results`, all nullable — every existing row stays valid and simply has no detail:

| Column | Type | Holds |
|---|---|---|
| `raw_row` | `JSONB` | The candidate's own row, header → value, verbatim (decision #4) |
| `started_on_text` | `VARCHAR(60)` | `"27 Jul  2026, 15:59"` as printed — kept as text because the format is Evalground's, not ours |
| `started_on` | `TIMESTAMPTZ` | Parsed where parseable; `NULL` rather than a guess |
| `duration_text` | `VARCHAR(60)` | `"  37 minutes  27 seconds "`, trimmed |
| `total_correct` / `total_wrong` / `total_unattempted` | `INT` | The three totals |
| `section_detail` | `JSONB` | Per section: `{ marks, correct, wrong, unattempted, easy_correct, medium_correct, hard_correct, result }` |
| `topic_scores` | `JSONB` | The test-specific tail (`Sql`, `Coding`, `Python`, …) as ordered `{ label, value }` — **not** fixed columns, because these change with every test |
| `attempt_status` | `VARCHAR(30)` | The `Report` column (`"Completed"`) |
| `marked_as` | `VARCHAR(60)` | Evalground's own recruiter tag; internal only (§6.2) |
| `public_report_url` | `VARCHAR(512)` | The `Public Report` column **as given**, truncated or not, so §9 Q1 can be answered from data rather than from memory |

No new table. One assessment result already means one candidate × one test; these are attributes of that row.

**Indexes:** none needed. Every read is by `pipeline_id`, which is already indexed
(`idx_assessment_results_pipeline`).

---

## 4. Import changes

### 4.1 Capture (the only real backend work)

`extractRowsFromFile()` (`assessmentImport.service.js:50-62`) currently flattens each row to text and drops the
structure. It should return **both**: the flattened `rawText` the AI parser needs, and the parsed
`row` object it already has in hand. Nothing else about the AI path changes.

A new pure module — testable without a DB, an Express app, or an AI key, the same constraint `csvExport.js`
documents:

```
backend/src/utils/evalgroundRow.js
  parseEvalgroundRow(row)    → { sectionDetail, topicScores, totals, durationText, startedOn, … }
  EVALGROUND_KNOWN_HEADERS   → the 41 fixed headers, so the tail can be identified as "everything else"
```

Two rules it enforces:

- **The topic tail is whatever is left.** Columns after `Total Unattempted` and before `Marked As` that are not
  a known header are topic scores. Hard-coding `Sql`/`Python`/`Playwright` would break on the next test HR runs.
- **Blank is blank, zero is zero.** `S1 Result` is empty in all three samples; it must land as `null`, never as
  a falsy `0` that renders as a score of nought in front of an interviewer.

### 4.2 Write

`saveAssessmentImport()` (`assessmentImport.service.js:409-418` and the result rows below it) writes the new
columns alongside the existing ones. Two behaviours to get right:

- **Detail backfills on re-import even when the score is unchanged.** The confirm dialog's rule today is *"a row
  already on file is skipped unless the score changed — a changed score only overwrites the score, nothing
  else."* That rule exists to stop an old export rewriting a newer outcome, and it stays. But a row with
  `raw_row IS NULL` has no detail to protect, so filling it is not an overwrite — it is the only way existing
  candidates ever get a report. Narrow, explicit exception; stated in the confirm dialog's copy.
- **Nothing else about matching, auto-advance or the stage timeline changes.** Email matching
  (`emailMatchesSql`), the concurrent-journey rule, auto pass/fail at >50 marks — all untouched.

### 4.3 Optional one-off backfill

Existing results (before this ships) can be filled by re-reading each import's `raw_file_url` from OneDrive and
re-matching rows by email. Worth ~half a day, but **not on the critical path**: the manifest tells the reader
honestly that an older result carries scores only (§6.4 outcome 4). Recommend building it only if HR asks for a
dossier on a candidate assessed before this lands.

---

## 5. What HR sees in the app

Small, and deliberately so.

- **Import modal** (`AssessmentImportModal.jsx`): unchanged flow. The validation step's per-row preview gains
  the section breakdown, so a recruiter can see the import read the file correctly before confirming, and the
  confirm copy gains one line about detail backfill (§4.2).
- **Pipeline drawer, Assessment stage**: today it shows section scores. It gains the breakdown — correct /
  wrong / unattempted, the difficulty split, the topic table, duration and attempt date. This is the internal
  view, so it shows everything, including `Marked As` and the `public_report_url` exactly as stored (which will
  make §9 Q1 obvious to whoever looks).
- **No new button anywhere.** Decision #1.

---

## 6. What the dossier shows

### 6.1 HTML — section 7

`candidateDossier.export.js:628` builds the assessment block today from `model.assessments`; §7 is emitted at
`:714`. It grows from a scores line into a real report, following the shape §6.7 established for Zeko:

```
7. Assessment results
   General Aptitude, Python, SQL MCQ Test at AAPNA          Taken 27 Jul 2026 · 37m 27s · Passed
   Overall: 57 marks · 90.5%          Answered: 55 correct · 2 wrong · 0 unattempted

   Section            Marks   Correct  Wrong  Unattempted   Easy/Med/Hard correct
   General Aptitude     24      24       1        0              8 / 8 / 7
   Python               23      23       1        0              8 / 9 / 7
   SQL                   8       8       0        0              8 / 0 / 0

   Topic scores       Sql 0 · Coding 0 · Python 6 · Py Test 5 · Playwright 6 · Pywinauto 7
```

Section labels keep coming from `section_label_map` (`fetchAssessments()`, `candidateDossier.service.js:326-334`)
so a pack generated a year later still reads "Python", not "Section 2". Every value HTML-escaped at render, per
§6.2 of the download plan — the topic labels are vendor free text and reach this file.

A candidate with a result but no detail (legacy row) renders the scores and says so. Absence is not failure —
the lesson already learned in `applyAttachments()`.

### 6.2 Redaction — the columns that must not travel

The pack's whitelist construction applies: the renderer reads named fields, never `raw_row`. Added to
`dossierRedaction.js`'s forbidden names so a future regression fails loudly:

| Column | Why it stays behind |
|---|---|
| `Contact Number` | Corrupted by the export (§1.1), and contact details are decision #10's business, sourced from `rpa_cv` |
| `Candidate Email` | Same — the pack has one contact block, under one toggle |
| `Candidate Resume` | Truncated, and an external link outside our redaction |
| `Candidate Location` | The pack's location comes from the whitelisted `rpa_cv.CurrentLocation`; two sources would eventually disagree in front of a reader |
| `Previous Assessments` | Other journeys for the same person — not this MRF's business |
| `Marked As` | An internal recruiter tag |
| `raw_row` (whole) | The archive, not a render source. Named in the guard so nobody wires it up as a shortcut |
| `public_report_url` | Until §9 Q1/Q4 resolve, and then only as an off-by-default opt-in (decision #9) |
| **the uploaded file itself** | Decision #2. Asserted by the cross-candidate test in §8 |

### 6.3 The leak this feature can create, named plainly

Every other field the download plan forbids is a *column*. This one is a *row*: candidate B's name, email,
phone and score sitting in the same file as candidate A's. The controls are (a) the pack never attaches the
uploaded file, (b) `fetchAssessments()` is already scoped `where: { pipeline_id }`, and (c) an explicit test
that imports a two-candidate file, downloads A's pack, and greps every byte of it for B's email (§8).

### 6.4 Manifest — four honest outcomes

`buildManifest()` (`candidateDossier.service.js:601-607`) says today *"The original PDF report is not yet stored
in the ATS"*. That line becomes:

| Situation | Line |
|---|---|
| Detail present, included | "Included in section 7 of this report — full section and topic breakdown." |
| Detail present, recruiter unticked it | "Scores only — the detailed breakdown was left out of this download." |
| Result imported before this feature | "Section scores only — this result was imported before the full breakdown was captured. Ask the recruiter if you need the original." |
| No result at all | "No assessment result has been recorded for this candidate." (unchanged) |

### 6.5 Modal and audit

- `DossierDownloadModal.jsx` gains one checkbox — **Assessment result detail**, ticked by default (decision #6),
  sitting with the screening-detail tick it mirrors. The `Public Report` opt-in is built only if §9 Q1 makes it
  real, and then off by default with the §6.6 warning treatment.
- `describeIncludedCategories()` gains `assessment_detail(n)`, so `rpa_processing_log` and the timeline note say
  what actually left — the §8.4 rule.

### 6.6 XLSX — sheet 4

`candidateDossier.export.js:842-851` already emits `Assessment | test | label | value` rows. Sections, totals,
duration and topics append in the same shape. No new sheet, no new format argument.

---

## 7. Phasing

| Phase | Scope | Estimate |
|---|---|---|
| **A** | DDL + `evalgroundRow.js` + capture and write in the import | ~~1.5–2 days~~ **✅ BUILT 2026-09-03** |
| **B** | Dossier: section 7, sheet 4, manifest, modal checkbox, audit category, redaction guard entries | ~~1–1.5 days~~ **✅ BUILT 2026-09-03** |
| **C** | Drawer breakdown for internal users | 0.5–1 day — **not built** |
| **D** | *Optional, deferred:* a per-candidate file slot in the drawer, for a PDF HR saves by hand out of Evalground's UI — only if §9 Q2 says such a PDF exists and HR wants it. This is where `attachments/02_…` finally gets filled | 1 day — **not built** |
| **E** | Unit tests §8 | ~~0.5–1 day~~ **✅ BUILT** — 168 pass. The staging pass with a real multi-candidate export is still owed, and is the one that matters (integration test 1) |

**Phases A + B + E close Phase 3 of the download plan.** C is polish, D is conditional.

### 7.1 What shipped, file by file

| File | Change |
|---|---|
| `prisma/ddl/2026-09-03-assessment-result-detail.sql` (+ README) | Eleven nullable columns on `rpa_assessment_results` |
| `src/utils/evalgroundRow.js` (new) | The row parser — header-driven, pure, unit-tested |
| `src/services/assessmentImport.service.js` | Keeps the parsed row; `detailColumns()` written on create, on a score overwrite, and as the NULL-only backfill |
| `src/services/candidateDossier.service.js` | `fetchAssessments()` reads the breakdown; manifest's four outcomes; `assessment_details` count; `includeAssessmentDetail` option |
| `src/exports/candidateDossier.export.js` | Section 7 renders the breakdown; sheet 4 carries it too |
| `src/utils/dossierModel.js` | `assessment_detail(n)` audit category |
| `src/utils/dossierRedaction.js` | `raw_row`, `marked_as`, `public_report_url`, `candidate_resume`, `candidate_email`, `previous_assessments` refused |
| `src/controllers/pipeline.controller.js` | `assessment_detail=0\|1`, defaulting ON |
| `DossierDownloadModal.jsx` | The tick, the three-state summary row, and honest "not included yet" copy |

**One thing found while building.** `section_label_map` stores `{skill_label, legacy_field}` per section, and
`fetchAssessments()` was using that object as the label — so section headings in already-shipped packs render
as JSON rather than "Python". Fixed in `sectionLabel()`, which reads both that shape and the plain string older
rows hold.

**One decision reversed by an existing test.** `contact_number` was going to be added to the redaction guard's
forbidden names; `dossierRedaction.test.js` asserts it is *allowed*, deliberately — a guard that rejects
ordinary key names is one somebody turns off. The export's phone column cannot reach a pack anyway: it travels
only inside `raw_row`, which is refused.

---

## 8. Testing

**Unit** (`npm run test:unit`, no DB):

- `evalgroundRow.test.js` — the 47-column header maps exactly; the topic tail is discovered, not hard-coded; a
  renamed header degrades to `null` rather than to a wrong number; blank `S1 Result` is `null`, not `0`; a
  truncated `Public Report` is stored as-is and never rendered as a link.
- `dossierRedaction.test.js` — each name in §6.2 makes the guard throw; `raw_row` on the model throws.
- `candidateDossier.test.js` — section 7 renders sections, totals and topics; a legacy row renders scores plus
  the "imported before" line rather than an empty table; topic labels containing `<script>` are escaped; sheet 4
  carries the new rows.

**Integration (staging):**

1. Import a **two-candidate** export. Download candidate A's dossier. Grep the unzipped tree for candidate B's
   name, email and phone → **zero hits**. This is the regression test for decision #2 and §6.3.
2. Re-import the same file unchanged → scores untouched, detail backfilled once, no duplicate result row.
3. Import an export for a **different test** with a different topic tail → topics render from the new labels.
4. Untick **Assessment result detail** → section 7 carries scores only and the manifest says it was the
   recruiter's choice, not a failure.
5. A candidate with an assessment result imported **before** this feature → pack downloads, manifest outcome 3.
6. Add the same greps to the §10.3 leak scan script: `Contact Number`, the other candidates' domains,
   `docs.google.com`, `evalground.com/code4`.

---

## 9. Open questions

1. **A fresh, unedited, multi-candidate export from HR.** The three samples in `docs/` appear to be hand-edited
   copies of one file (§1.1). One genuine export with several candidates settles three things at once: whether
   `Public Report` is per-candidate and untruncated, whether the column set holds when more rows exist, and
   whether the topic tail varies per test. **Blocks nothing in Phase A; blocks decision #9 entirely.**
2. **Does Evalground's own UI offer a per-candidate report PDF that HR can save?** If yes, Phase D is worth
   building and the attachment slot finally fills. If no, the rendered section *is* the report and the slot
   should be closed in the download plan rather than left open forever.
3. **HR: may the per-difficulty and per-topic breakdown go to an external interviewer?** (Recommendation: yes —
   it is the substance of the assessment, and an interviewer given only "90.5%" will ask for it anyway.)
4. **If a usable public report URL exists, does HR want it in the pack at all?** It would be a second no-login,
   non-revocable link, i.e. the §11 item 3 conversation again. Worth asking in the same breath as that one.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| **A dossier carries another candidate's row** — the leak this feature uniquely enables | The uploaded file is never attached (decision #2), reads are scoped by `pipeline_id`, and §8 integration test 1 asserts it against a real two-candidate import |
| Evalground renames or reorders columns | Deterministic mapping falls back to the existing AI parse, and `raw_row` keeps the original regardless — no import ever fails because of a header change |
| The topic tail is mistaken for a fixed schema | It is discovered as "not a known header", never hard-coded (§4.1), and test 3 uses a different test's export |
| Detail backfill overwrites a newer outcome | The exception is narrowed to rows where `raw_row IS NULL` — there is nothing to overwrite (§4.2) |
| Someone later "improves" the pack by attaching the source file | Decision #2 is in the plan, in the guard, and in a test that fails loudly. Also why decision #7 refuses a separate derived attachment: no habit of attaching assessment files gets established |
| The truncated `Public Report` column is stored and later assumed usable | Stored as-is but excluded from the pack by the redaction guard until §9 Q1 says otherwise |
