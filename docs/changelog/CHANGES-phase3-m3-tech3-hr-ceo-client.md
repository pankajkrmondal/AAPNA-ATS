# Phase 3 — Interview rounds extended to Tech 3, HR, CEO/Final and Client Interview

**Date:** 2026-07-29 · **Module:** M3 (scheduling + scorecards), continued

## Why

The Pipeline Tracker already rendered all 12 stage columns, but Teams scheduling,
occurrence tracking and interviewer scorecards only worked for Technical Rounds 1
and 2. Tech Round 3, HR Round, CEO/Final Round and Client Interview showed
"Not available yet" inside the drawer even though the stage engine treated them
as first-class stages.

The scheduling stack was designed for this from the start
(`docs/phase3/INTERVIEWER-SCORECARD-PLAN.md` §1: *"architect for all rounds …
others activate as scheduling is extended"*), so the change is small: everything
downstream — `rpa_interview_schedule`, the occurrence gate, the scorecard tables,
the reminder and occurrence cron jobs, and the Graph calendar service — was
already stage-key generic and needed no edits.

## What changed

### Scheduling now covers six rounds

- `backend/src/services/interviewSchedule.service.js` — `SCHEDULABLE_STAGES`
  gains `tech3`, `hr_round`, `ceo` and `client`. The MRF already carried unused
  free-text interviewer-hint columns for three of them (`hr_round`,
  `ceo_management_round`, `client_round`), which are now read. There is no MRF
  column for a third technical round, so `tech3` maps to `null` and
  `mrfRoundHints()` returns "not specified" rather than being disabled.
- `frontend/src/components/pipeline/PipelineDrawer.jsx` — `isSchedulableStageKey`
  mirrors the same six keys, which flips these rounds from the generic
  "not available yet" fallback onto the real scheduled/occurrence/scorecard
  rendering already built for Tech 1–2.

Optional-round handling is unchanged: Tech 3 and Client Interview stay
`is_optional`, so the existing skip control works on them with no new code.

### HR Round scorecard brought to full parity with the legacy workbook

`docs/Interview Evaluation Format V2.xlsx` — the MS Forms + Power Automate
process the ATS scorecard replaces — collects ~16 fields on its HR Round sheet.
The table shipped with 5.

- New DDL `backend/prisma/ddl/2026-07-29-hr-scorecard-fields.sql` adds 10
  columns: family background, general/other, timings, separate
  communication/attitude comments, weakness, only-negative, other observation,
  final feedback, and next step for the recruitment team.
- `interviewScorecard.service.js` reads/writes them via one `HR_TEXT_FIELDS`
  list, and the per-candidate report attaches an `hr` block on HR cards only.
- `InterviewScorecard.jsx` renders the full HR form, grouped
  (background → ratings → availability/compensation → assessment). It also now
  **hides the skill matrix on HR cards** — the workbook's HR sheet has no
  Skill 1–5 columns, unlike the Technical/CEO sheets.

The Technical/CEO card needed no change: the workbook confirmed Technical 1–3
and CEO share one identical layout, which is what was already built.

### Non-prod recipient routing — candidate protected, panel honored

Two related fixes, scoped to interview/Teams/scorecard flows only:

- **The panel now receives real mail in every environment.** Previously the
  interviewer send reused the candidate's flow key, so both were redirected to
  the test inbox — meaning an address someone deliberately typed into the
  Schedule modal on staging never got anything. New `interviewScheduledPanel` /
  `interviewCancelledPanel` keys, plus a new `OPERATOR_ADDRESSED` bypass set in
  `emailRecipients.js` (documented as its own category, distinct from
  `NEVER_REDIRECT`'s internal-alert rationale) covering those two plus
  `scorecardInvite` and `occurrenceNudge`.
- **Real bug fixed: Teams invites had no non-prod safety net at all.**
  Calendar invites never pass through `resolveRecipients()`, so with
  `MS_CALENDAR_ENABLED=true` a real candidate was added as an attendee on a
  staging booking. `calendarCandidateEmail()` now substitutes the candidate with
  the test inbox outside production. Panel attendees are deliberately left as
  entered — same protected/honored split as the email fix.

The candidate's own email is unchanged: still redirected to the three fixed
testers outside production.

## Files

**New:** `backend/prisma/ddl/2026-07-29-hr-scorecard-fields.sql` (+ README)

**Changed:** `interviewSchedule.service.js`, `interviewScorecard.service.js`,
`config/emailRecipients.js`, `jobs/interviewReminder.js`,
`controllers/pipeline.controller.js`, `routes/pipeline.routes.js`,
`frontend/src/components/pipeline/PipelineDrawer.jsx`,
`frontend/src/pages/InterviewScorecard.jsx`

### Client Interview reverted to manual coordination (2026-07-30)

The first cut had Client Interview using the same automated Teams invite as an
internal round, which reversed `docs/phase3/04-QUESTIONS.md` **Q14** (*"the
system must not generate anything for the client"*). That has been **rolled
back**: the round is booked and tracked, but nothing goes outward.

- `SCHEDULABLE_STAGES` entries now carry an **`autoInvite`** flag; `client` is
  the only `false`. New helper `stageSendsInvites(stageKey)`.
- With `autoInvite:false`, `scheduleInterviewRound` / `rescheduleInterviewRound`
  skip `createInterviewEvent()` entirely (no Outlook event, no Teams meeting)
  and send neither the candidate nor the panel email. `cancelInterviewRound`
  likewise stays silent — a round the system never invited is not un-invited by
  it either. The booking row, occurrence gate and scorecard still work, so the
  round is tracked exactly like any other.
- `backend/src/jobs/interviewReminder.js` skips these rounds, so no T-30
  reminder goes out referencing a Teams link that was never created.
- The audit note records *"coordinated manually, no invite sent"*.
- Drawer: the schedule modal shows an explicit notice, hides the email editors,
  and its button reads **Record booking** instead of *Create invite*; the round
  segment reads *"Recorded (coordinated manually)"*.

To automate this later, flip `client.autoInvite` to `true` — nothing else
changes.

## Verification

1. Apply the HR-scorecard DDL, then `npx prisma db pull && npx prisma generate`.
2. Advance a candidate into each of Tech 3 / HR / CEO / Client; confirm
   "Schedule Interview" appears and a booking saves.
3. Confirm the candidate-side email lands only in the test inbox, while the
   interviewer address typed into the modal receives its own real mail.
4. With `MS_CALENDAR_ENABLED=true`, confirm the calendar event substitutes the
   candidate and keeps the panel as entered.
5. Mark held → confirm the HR round dispatches the `hr` card (full field set, no
   skills) and Tech 3 / CEO / Client dispatch the shared technical card.
6. Confirm the optional-skip control still works on Tech 3 and Client Interview.
