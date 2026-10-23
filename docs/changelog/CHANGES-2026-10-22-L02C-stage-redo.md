# L02-C · Re-do a passed stage

**Date:** 22 Oct 2026 · **Plan:** L02-C in the L01/L02 plan; the design boards "Re-do a passed stage" and "Drawer on a re-done stage" were approved.
**Decisions (Harish, 22 Oct):**
- Re-dos are allowed anywhere, lifting HR's D2 of 16–19 Oct.
- A re-done Zeko round uses a **different Zeko job**.
- **Documents and Offer** cannot be re-done.

**Status:**
- **DDL `2026-10-22-stage-redo.sql` is applied on staging** (22 Oct).
- **Tested on 22 Oct against the staging database:**
  - unit tests pass (683);
  - new `integration/stageRedo.test.js` passes 4/4 (interview, assessment and Zeko re-dos; Documents refused) and sent no email;
  - regressions pass with flexible stages off: `pipelineStageEngine` 17/17, `pipelineClosure` 22/22, `schedulingAndScorecard` 20/20, `rescheduleEmails` 2/2, `documentsAndOffer` 16/16, `sweepJobs` 10/10, `crossModuleE2E` 6/6;
  - `journeyMove` passes 4/4 with the flag on;
  - the frontend builds.
- **Test email:** the regression suites send real outcome and scheduling emails to the staging redirect list. The first runs that day still had saukumar@ on that list, so it was removed from `backend/.env` (HIGH PRIORITY, Harish). The final runs went only to `n8npankajmondal@gmail.com` and `hmopuri@`.
- **Not checked in the browser yet.**
- Behind `FLEXIBLE_STAGES_ENABLED`. Nothing is deployed or committed.

---

## What users see (flag on)

**Board**
- While a card is dragged, a passed column shows a dashed amber outline and accepts the drop ("Passed · drop to re-do this stage"). Documents and Offer stay greyed.
- The card's "Move to…" menu marks those stages "Passed · re-do".

**Move popup**
- For a passed stage it reads "Re-do <stage>?" and explains that the earlier attempt stays as history.
- It requires a reason. The button reads "Re-do stage".

**Drawer**
- "Move to…" offers passed stages as "passed · re-do".
- On a re-done stage the actions (Schedule, Invite, Approve) come back.
- An **Earlier attempt** panel shows the old booking (real status), its scorecards and recording, Zeko job, Evalground result, and who re-did it, when and why.

**Approve**
- Approving a re-done stage lands back on the stage the candidate came from, labelled "(where the candidate came from)". Later passed stages stay passed.
- The "Send email notification" box starts unticked, with a hint.

**History**
- The move-history CSV gains "Re-do" and "Reason" columns.

## How it works

A visit to a stage is a **re-do** when the stage's state row was entered after it was completed (`utils/stageState.js` `redoVisitStart`). Only re-do visits are time-scoped. A first visit's `entered_at` can be the backfill time, later than its real activity, so it filters nothing.

| Area | On a re-do visit |
|---|---|
| Interviews | The move marks the stage's existing bookings `superseded_at`. They keep their status as history. The live-booking unique index and every live-booking reader (`getLiveSchedule`, `getSchedulesByStage`, client round, board, lock) ignore superseded rows, so a new booking can be made. |
| Scorecards | Score = scorecards submitted since the re-do began. The drawer splits cards by booking. |
| Evalground | Invite state, withdraw, score and import look only at invites and results since the re-do began, so a new attempt gets its own result row. The overdue check counts only a result that arrived after the invite. |
| Zeko | The round result is the round row created since the re-do began. Assigning the earlier attempt's job is refused (409). |
| Lock and board badges | Same visit scoping. |
| Approve | Lands on the `from_stage_key` of the re-do move when that stage is not passed. |
| Leaving a re-done stage without an outcome | It goes back to `completed`, not `skipped`. |

## Code

**DDL:** `backend/prisma/ddl/2026-10-22-stage-redo.sql` + rollback.
- `rpa_interview_schedule.superseded_at`.
- `uq_interview_schedule_live` now `WHERE status <> 'cancelled' AND superseded_at IS NULL`.
- Table comment.
- `schema.prisma` is updated by hand.

**Backend**
- `utils/stageState.js`: `REDO_EXCLUDED_STAGE_KEYS`, `isRedoable`, `redoVisitStart`, `inVisit`; `planMove` handles `redo` and `reason`; `moveNote` adds the re-do suffix; `resolveFlexibleApproveLanding` takes `returnToStageKey`.
- `services/stageState.service.js`:
  - `stageVisitStart`, `redoVisitStarts`, `redoVisitsFor`, `redoReturnStageKey`;
  - `getStageLocks` is visit-scoped and ignores superseded bookings.
- `services/pipeline.service.js`:
  - `moveToStage` takes a reason, supersedes bookings and has the `leftStatus` fix;
  - `stageHasScore` and `findZekoRoundResult` are visit-scoped;
  - board badges;
  - `getPipelineDetail` adds `redoVisits`, `currentStageRedo`, `redoReturnStageKey`, `earlierAttempts`;
  - the Approve and advance landing.
- `interviewSchedule.service.js` (live readers, `getSupersededSchedules`), `clientRound.service.js`, `assessmentInvite.service.js`, `assessmentImport.service.js`, `jobs/assessmentDeadlineChecker.js`, `screening.service.js` (Zeko job guard), `interviewScorecard.service.js` (`schedule_id` on report rows), `exports/moveHistory.export.js`, `controllers/pipeline.controller.js` (`reason`).

**Frontend**
- `components/pipeline/stageMove.js`
- `MoveStageModal.jsx` (reason)
- `pages/Pipeline.jsx` (menu, drop columns, `confirmMove` reason)
- `PipelineDrawer.jsx` (move menu, outcome-after-arrival, landing, email default, scorecard split)
- `EarlierAttemptPanel.jsx` (new)
- `theme/index.css`

**Tests:** `unit/stageState.test.js` (+4); new `integration/stageRedo.test.js` (interview, assessment and Zeko re-dos, Documents refused).

**Docs:** D2 / C7 in `docs/phase3/pipeline/FLEXIBLE-STAGE-MOVEMENT-DRAG-DROP-PLAN.md`.

## Release steps
1. Apply `2026-10-22-stage-redo.sql` (done on staging) **before** deploying this backend: the live-booking readers filter on `superseded_at`. Then run `prisma db pull` / `generate`.
2. Deploy the backend, then the frontend.
3. Staging UAT with RT on a real requisition, with `FLEXIBLE_STAGES_ENABLED=true`.

## Still to test
- Browser: drag to a passed column, the reason popup, the Earlier attempt panel, the Approve landing and the unticked email.
