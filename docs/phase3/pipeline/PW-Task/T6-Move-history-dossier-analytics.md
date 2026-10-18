# T6: Move history report, dossier, analytics (plan §6 phase 6)

## Test plan

**Scope.**
- **Move history** button next to Export CSV → dialog with date range, "Moved by", Position/MRF → CSV from `GET /api/pipeline/move-history/export`. Columns: Candidate, Email, Position / MRF, From stage, To stage, Direction, Stages skipped, Moved by, Moved at. "Moved by" options from `GET /api/pipeline/move-history/users`.
- Direction and skipped count are taken from the note written at move time (not recomputed from today's stage order).
- Dossier stage history includes `moved` events (note kept even on Documents/Offer).
- Analytics: `moved` counts as an arrival and a transition (`STAGE_ARRIVAL_EVENT_TYPES`, `TRANSITION_EVENT_TYPES`); Evalground matching treats a `moved` arrival like `entered`.
- Outcome templates: none promises "the next round".

## Test cases

| ID | Case | Steps | Expected |
|---|---|---|---|
| T6-01 | Button | /pipeline with the flag on | "Move history" button beside Export CSV |
| T6-02 | Users list | Open the dialog | "Moved by" lists users who have moved candidates |
| T6-03 | CSV all | Download with no filters | CSV with the 9 columns; one row per move |
| T6-04 | Filter by user + date (scenario 11) | Pick me + today | Only my moves today (scenarios 1, 4, 7, 8) with correct from/to/direction |
| T6-05 | Filter by MRF | Pick an MRF | Only moves of that MRF's candidates |
| T6-06 | Audit | After a download | `rpa_processing_log` row `CSV_EXPORT`, key `pipeline_move_history` |
| T6-07 | Dossier | Download a dossier for a moved candidate | Stage history lists the moves in order with who/when |
| T6-08 | Funnel | Analytics page after moves | Funnel counts the moved arrivals; no errors |
| T6-09 | Days in stage | Board after a move | `days_in_stage` restarts at 0 for the moved card |
| T6-10 | Templates wording | Check `rpa_email_templates` bodies for "next round" | None found (or reworded) |
| T6-11 | Unit | `node --test src/tests/unit/stageState.test.js` | Note parser + filter tests pass |

## Results log

### Run 1: 16 Oct 2026

| ID | Result | Notes |
|---|---|---|
| T6-11 | PASS | `parseMoveNote` round-trips `moveNote`; filters validated; IST day bounds correct |
| T6-10 | PARTIAL | Seed file `prisma/seed-email-templates.js` and `stageNotification.service.js` contain no "next round" / "next stage" wording. Admin-edited DB rows not checked (DB unreachable) |
| T6-01 to T6-09 | BLOCKED | Staging DB unreachable |

### Run 2: 16 Oct 2026 (staging, Playwright, flag on)

| ID | Result | Notes |
|---|---|---|
| T6-01 | PASS | "Move history" button beside Export CSV |
| T6-02 | PASS | "Moved by" options: pankaj (the only user who moved anyone) |
| T6-03 | PASS | Downloaded `AAPNA-ATS_Pipeline-Move-History_….csv` with the 9 columns; 7 rows. Copy: `screenshots/T6-04-move-history.csv` |
| T6-04 | PASS | Scenario 11: user = pankaj + 16 Oct → 7 rows with correct from/to, direction and skip counts (2, 0, 9, 0, 1, 0, 0) |
| T6-05 | PASS | `mrf_id=686` → 7, `mrf_id=137` → 0, `moved_by=999999` → 0, 15 Oct → 0, 16 Oct → 7 |
| T6-06 | PASS | `rpa_processing_log` CSV_EXPORT rows "pipeline_move_history: 7 row(s); filters=…" with actor email |
| T6-07 | PASS | Dossier for 2370 lists "moved · Offer · Moved forward from HR Screening (Zeko) to Offer (skipped 9 stages) · pankaj"; the Offer stage's own note stays redacted |
| T6-08 | PASS | `/pipeline/analytics?mrf_id=686` funnel counts moved arrivals (Assessment 4, Tech 1 3, Offer 2); Analytics page renders with no page errors |
| T6-09 | PASS | Moved cards show 0 days in stage |
| T6-10 | PASS | No active `rpa_email_templates` row mentions "next round" or "next stage" |
