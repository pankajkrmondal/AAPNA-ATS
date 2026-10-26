# L12 · One-record exports as Field | Value, and the dossier's round feedback (23 Oct 2026)

**Sheet:** Phase 3 Enh - Later, row 17 ("Dossier Enhancements"). **Plan:** PLAN-Phase3-in-Phase4.md › Other bugs › L12.

## Why
- "Dossier was giving details in horizontal, also edited tech 1 feedback was not added here. Can we make this vertical, it will be easy to read."
- Harish, 23 Oct: not only the dossier. Every export that holds one record should be transposed, with column A the field and column B the value. That includes the file inside the dossier ZIP, which had a header row and data rows.

## The rule (`backend/src/utils/fieldValueExport.js`)
- A one-record export has two columns, **Field | Value**.
- A section is a heading row: its name in capitals in column A, column B empty, with a blank row before it. Neither a CSV nor the community xlsx writer can make a row bold.
- List exports (candidates, MRF list, pipeline, screening…) keep one row per record, because those are sorted and filtered, not read.
- `toFieldValueRows()` feeds the CSVs, through `runExport`. `toFieldValueAoa()` feeds the dossier workbook.

## Exports changed
| Export | Before | After |
|---|---|---|
| MRF details CSV (`/api/mrf/:id/export`) | Section, Field, Value | Field, Value, with section heading rows |
| Role report CSV (`/api/pipeline/analytics/positions/:mrfId/export`) | Section, Item, Detail, Value | Field, Value: each line written in full, e.g. "Applied → 14 (previous period 9)", "Stuck → Priya Nair · Tech 1 · 6 days" (`roleReportLines`) |
| Dossier `Candidate-Summary.xlsx` (in the ZIP and as "Spreadsheet only") | Summary in 3 columns; Scorecards in 7 (one row per round × skill, no written comments); Stage History in 6; Assessments in 4 | **All four sheets** Field, Value: one block per round, decision or test |
| Dossier HTML | Wide grids that scroll sideways (progress, AI screening, assessments, interviews, recordings, manifest, employment history) | One small card per record, label / value lines (`recordList`). Only the 3-column scorecard skill grid stays. |

## Dossier content fixes
- **The edited Tech 1 feedback.**
  - Scorecards are submit-once. The "Tech round 1" feedback edited in Search Candidate lives on `rpa_cv."TechRoundOne"`, and the dossier never selected it.
  - New whitelist `CV_ROUND_NOTE_FIELDS` (`dossierRedaction.js`): TechRoundOne / Two / Three, HRInterview and ManagerialOrCEOFeedback, each mapped to its stage.
  - Each prints as "Round feedback recorded in the ATS" under that round's current scorecard. A round with feedback but no scorecard gets its own card.
  - HRQuickcomments and the Heat / IQ / Tech scores stay internal.
- **Written comments:** the scorecard's comments, communication, attitude, overall rating, submitted date and HR-round narrative are now in the spreadsheet too.
- **Round order:** scorecards follow the pipeline order. They used to be alphabetical by stage key, which put CEO and HR before Technical Round 1.
- **Re-done stages (L02-C):** a card or booking whose booking was superseded is labelled "Earlier attempt". The consolidated feedback and the overall average count only the current attempt (`buildConsolidatedFeedback` is now exported for this).
- **Client round:** the client-round feedback (recorded on the booking) is shown under Interview history. Other rounds' booking notes stay out, because they are internal.

## Tests
- `candidateDossier.test.js`:
  - 6 pinned layout tests were updated, including a new check that every sheet is two columns with a Field | Value header;
  - 3 new tests: earlier attempt labelled, round feedback printed once under the current attempt, a feedback-only round gets its own card / block.
- `fieldValueExport.test.js` (new, 9): the helper, the CSV shape, the MRF details columns, and role report lines and rows.
- Full unit run: 981/981.
- **Real data:** three packs built read-only from staging journeys (including one with round feedback) all pass `dossier-leak-scan`, and were checked in Chrome.
- **Still to check:** open both CSVs in Excel.

## Files
- `backend/src/utils/fieldValueExport.js` (new)
- `backend/src/exports/mrfDetail.export.js`
- `backend/src/exports/roleReport.export.js`
- `backend/src/exports/candidateDossier.export.js`
- `backend/src/services/candidateDossier.service.js`
- `backend/src/utils/dossierRedaction.js`
- `backend/src/services/interviewScorecard.service.js` (export only)
- `backend/src/tests/unit/candidateDossier.test.js`
- `backend/src/tests/unit/fieldValueExport.test.js` (new)
