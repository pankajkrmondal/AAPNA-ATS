# Candidate Pipeline: move candidates between stages in any order (drag and drop)

**Status:** Analysis and plan only. No code has been changed.
**Date:** 16 Oct 2026. All §5 decisions answered by HR/RT on 16 Oct 2026. Nothing is open; ready to build.
**Related:** Flexible stages (L03) in [PLAN-Phase3-in-Phase4.md](../../Phase%203%20Enhancements%20or%20Feedback/PLAN-Phase3-in-Phase4.md) §L03. This document replaces the L03 design with the rules HR has now given.

---

## 0. Resume here (for a new session)

This file is the **single source of truth** for this feature. Everything agreed so far is written here; nothing is kept anywhere else.

**To continue in a new session**, say: *"Read docs/phase3/pipeline/FLEXIBLE-STAGE-MOVEMENT-DRAG-DROP-PLAN.md and start phase 1 of §6"*, or name whichever phase is next.

**Where things stand (16 Oct 2026, end of build session 1, test run 2):**
- The analysis is done, and every HR/RT decision is answered (§5: D1-D8, O1).
- **Code for phases 1-6 is written** (uncommitted, branch `pankaj-work-staging-v23`). Unit tests pass (765/765, incl. `src/tests/unit/stageState.test.js`); the frontend builds.
- **DDL applied to staging** (`recruitmentautomationdb`) on 16 Oct 2026 with the guarded runner: dry run, apply, idempotent re-run. 101 state rows backfilled for the 26 journeys. **Not applied to production.**
- **Browser-tested on staging with Playwright** (test plans and results: [PW-Task/README.md](PW-Task/README.md)). Scenarios 1-8, 10, 11 and 12 (partly) pass. Six UI issues were found and fixed (PW-Task README, "Issues found"). Not run: scenario 9 (no vendor account), the live Zeko cancel (external API), and most flag-off integration suites (they need a Phase 3 fixture MRF purged on 28 Sep; see T7).
- **Next step:** RT UAT on staging (phase 8), finish T7-02 once a safe fixture MRF is agreed, then one production release (DDL first, then backend + frontend, flag on).

**DB change log:**
| Date | DB | File | Result |
|---|---|---|---|
| 16 Oct 2026 | staging `recruitmentautomationdb` | `2026-10-16-flexible-stage-movement.sql` | Applied. Backfill 101 rows; re-run 0 rows |

**What was built (file map):**
| Area | Files |
|---|---|
| DDL + rollback | `backend/prisma/ddl/2026-10-16-flexible-stage-movement*.sql`, `schema.prisma` |
| Flag | `FLEXIBLE_STAGES_ENABLED` → `config.pipeline.flexibleStagesEnabled` (`backend/src/config/index.js`) |
| Rules (pure) | `backend/src/utils/stageState.js` (states, move plan, landing, lock) |
| State + lock (DB) | `backend/src/services/stageState.service.js` |
| Move / landing / state writes | `pipeline.service.js` (`moveToStage`, `setStageOutcome`, `advanceStage`, `createPipelineJourney`, board + drawer payloads); route `POST /api/pipeline/:id/move` |
| Undo actions | `assessmentInvite.service.js` (`withdrawAssessmentInvite`), `documentCollection.service.js` (`cancelDocumentRequest`), Zeko cancel note in `screening.service.js`, deadline filter, late-result flag in `assessmentImport.service.js`, `VENDOR_EVENTS.ASSESSMENT_CANCELLED`, template seed *Evalground Test Cancelled* |
| Move history | `backend/src/exports/moveHistory.export.js`; routes `/move-history/export`, `/move-history/users`; dossier includes `moved` events |
| Frontend | `MoveStageModal.jsx`, `stageMove.js`, `MoveHistoryExport.jsx`, `Pipeline.jsx` (menu, lock, dnd-kit), `PipelineDrawer.jsx` (Move to…, strip, Stage history, Withdraw / Cancel dialogs, landing picker), `theme/index.css` |

**Build decisions taken during coding (within the plan's rules):**
- No row in `rpa_pipeline_stage_state` = not visited, so a stage an admin adds later needs no insert.
- State rows are written on every transition **whether or not the flag is on**, so the flag can be switched on later with no second backfill. The DDL must therefore ship before the backend build.
- A move marks only the stage being left as Skipped; stages jumped over stay Not visited (both are valid targets).
- Under the flag, `advanceStage` follows the move rules (lock check, next not-passed stage).
- A move writes `rpa_cv.FinalStatus = "<stage> Pending"` ("Evalground Test Pending" for Assessment).
- Cancel document request sends no email and takes an optional reason; Withdraw Evalground requires a reason.

**The rules in one place:**
1. Any user with Candidate Pipeline menu access can move a candidate to any stage, from HR Screening (Zeko) to Offer, forward or backward (D1, D4, D7).
2. A candidate whose current stage has **started** (invite sent, interview booked, test sent, documents requested, offer shared, results awaiting a decision) is **locked** until Approve, Reject/Hold, or cancel/withdraw of that activity (§2, C11).
3. A candidate can **never re-enter a stage they passed** (Approved). Skipped stages can be visited later (D2).
4. One active stage at a time; no parallel stages (D8).
5. A move sends **no email**. Every move needs a **confirmation popup**, and **no reason** is asked (D5, D6).
6. Every move is **recorded**: candidate, who, when, from, to, direction. It is shown in the drawer timeline, a Move history CSV and the dossier (C12).
7. Undo actions: Cancel interview and Cancel Zeko interview **already exist**. **New:** Withdraw Evalground invite and Cancel document request. **Offer: no change from today**; a shared offer has no withdraw (D3, O1).
8. Everything is built behind the `FLEXIBLE_STAGES_ENABLED` flag. With the flag off, the pipeline behaves exactly as today.

**History of this plan:** first draft written 16 Oct 2026, then HR/RT answered in this order: D3 = yes (withdraw/cancel) → D2 = no re-dos → D1, D4, D5, D6, D7 → O1 = keep current offer behaviour.

**Correction recorded:** an early draft said only interviews can be cancelled. That was wrong: **Cancel Zeko interview already exists** in the pipeline drawer (C11).

---

## 1. The ask

Today a candidate on the Candidate Pipeline board only moves left to right:

```
HR Screening (Zeko) → IQ / Tech Assessment → Functional Screening (Zeko) → Technical Round 1
  → Technical Round 2 → Technical Round 3 (optional) → HR Round → CEO / Final Round (optional)
  → Client Interview (optional) → Documents → Offer
```

HR wants to **drag a candidate card to any stage column, from HR Screening (Zeko) to Offer, in either direction**. For example:

- HR Screening (Zeko) → Technical Round 1 → Functional Screening (Zeko) → Technical Round 3 → Technical Round 2
- Technical Round 2 → Functional Screening (Zeko) → HR Screening (Zeko)
- HR Screening (Zeko) → Offer

**HR's rules:**
1. Once a candidate has **started** work in a stage, they cannot be moved until that stage is **finished, or HR marks it "Approve"**.
2. A candidate can **never go back into a stage they already passed** (D2).
3. **Every move asks for confirmation** in a popup, so an accidental drag does not move anyone (D5).
4. **Every move is recorded:** which candidate, moved by whom, when, from which stage, to which stage (D6).

**Short answer: yes, this can be built.** The stage engine stores one "current stage" per candidate and moves it forward by list position. Changing the movement rules is a contained change, not a rewrite. HR's lock rule also makes this **simpler** than the original L03 design, because a candidate is only ever active in one stage at a time (see §2.3).

---

## 2. How the lock rule works

### 2.1 The states a stage can be in

Every candidate's current stage is in one of these states. The board already shows most of them as chips on the card.

| State | What it means | Shown on the card today as | Can the candidate be dragged out? |
|---|---|---|---|
| **Not started** | Candidate has arrived; nothing has been sent or booked yet | "In progress" (no other chip) | **Yes** |
| **Started** | One of: a Zeko invite has gone out; an interview is booked; an Evalground invite has been sent; a scorecard is awaited; a document request has been sent; an offer has been shared; results have arrived with no decision yet | "Invited", "Scheduled", "Evalground test pending", "Ready for decision" | **No** (locked) |
| **Approved** | HR clicked Approve | The card has already moved on to the next stage, where it is "Not started" | **Yes**, from the new stage |
| **On Hold** | HR clicked Hold | "On Hold" | **No.** Take it off hold first |
| **Rejected** | HR clicked Reject | "Rejected" | **No.** Reopen it first |
| **Paused / Closed** | Journey paused, or closed (joined, withdrew, etc.) | "Paused" / closure label | **No** |

Approve already moves the candidate to the next stage today. After an Approve, the candidate sits in the next column as "Not started" and can be dragged straight away. The lock rule needs nothing extra for this case.

### 2.2 Ways to unlock a started stage

A started stage can be left in one of three ways:

1. **Approve.** The candidate moves forward, then can be dragged.
2. **Reject or Hold.** The candidate stays in the stage (existing behaviour).
3. **Cancel or withdraw the activity.** The stage goes back to "Not started" and the card can be dragged again. **Decided (D3): yes.** See §4 C11 for each stage.

### 2.3 Why this is simpler than the original L03 design

The original L03 design let a candidate be active in **two stages at once**. In its walk-in case, Evalground was reopened in parallel while Tech 1 continued. HR's lock rule rules that out: **one active stage at a time** (D8).

With that rule, every existing feature that checks "is the candidate on this stage?" keeps working. Interview booking, Zeko scheduling and the Evalground invite all assume the candidate is on the stage being worked, and under this rule they always are. This removes the riskiest part of L03.

The walk-in case still works, one step after another: drag to Tech 1, run it, Approve, then drag to IQ / Tech Assessment for the weekend test.

---

## 3. What the code does today

| Area | Where | What it assumes |
|---|---|---|
| Stage list and order | `rpa_pipeline_stages.sort_order`, `is_optional` | One fixed order for all candidates |
| Candidate position | `rpa_candidate_pipeline.current_stage_key` and `current_stage_status` | A single pointer. There is **no record per stage** of done, skipped or not visited |
| Approve → next stage | [pipeline.service.js:1047-1066](../../../backend/src/services/pipeline.service.js#L1047-L1066), [stageSkip.js:46-70](../../../backend/src/utils/stageSkip.js#L46-L70) `resolveApproveLanding` | Next stage = position + 1. Only **optional** stages may be jumped |
| Move without an outcome | [pipeline.service.js:1221](../../../backend/src/services/pipeline.service.js#L1221) `advanceStage` | Always + 1, and only off an optional stage (`assertSkippable`, Skip guard N33) |
| Backward move | none | `reopenJourney` only undoes a closure |
| Who can act on the pipeline | [pipeline.routes.js:10-15](../../../backend/src/routes/pipeline.routes.js#L10-L15) | `authenticate → requireStaff → checkModuleAccess('recruitment_pipeline')` on every route. This is exactly D1, so **no new permission is needed** |
| Concurrency guards | [pipeline.service.js:994](../../../backend/src/services/pipeline.service.js#L994) stale-tab check, [:1085](../../../backend/src/services/pipeline.service.js#L1085) claim-then-act `updateMany` | Reusable as they are |
| Audit trail | `rpa_pipeline_stage_events` (`entered`, `skip`, `outcome`, `note`), with `acted_by` and `created_at` | `skip` = arrived by bypassing optional stages. No DB CHECK on `event_type`, so a new type needs no DDL. There is **no "from stage" column** |
| Board card chips | [pipeline.service.js:403-415](../../../backend/src/services/pipeline.service.js#L403-L415) | Computes `invited`, `scheduled`, `ready_for_decision`, `assessment_pending`. This is the basis for the "started" check |
| Evalground invite | [assessmentInvite.service.js:60](../../../backend/src/services/assessmentInvite.service.js#L60) | Candidate must be on `assessment` |
| Evalground import | [assessmentImport.service.js:266](../../../backend/src/services/assessmentImport.service.js#L266), [:691](../../../backend/src/services/assessmentImport.service.js#L691) | Matches only journeys on `assessment`; auto-advances by position |
| Interview booking | [interviewSchedule.service.js:776-781, 889, 1371](../../../backend/src/services/interviewSchedule.service.js#L776) | Stage must equal the current stage |
| Documents / Offer | `documentCollection.service.js`, `offer.service.js` | **No current-stage check.** They work wherever the candidate is. One document request and one offer per journey. A document link can already be `closed` ([documentCollection.service.js:353](../../../backend/src/services/documentCollection.service.js#L353)) |
| Drawer stage strip | [PipelineDrawer.jsx:2529](../../../frontend/src/components/pipeline/PipelineDrawer.jsx#L2529), [:1847-1873](../../../frontend/src/components/pipeline/PipelineDrawer.jsx#L1847-L1873) | "Stages after X are locked until the candidate gets there". Uses position, not history |
| Funnel analytics | [pipeline.service.js:2088-2112](../../../backend/src/services/pipeline.service.js#L2088-L2112) | Uses arrival events (fine for any order). Falls back to `sort_order` when events are missing |
| Stage durations | [pipelineAnalytics.helpers.js:125](../../../backend/src/services/pipelineAnalytics.helpers.js#L125) | Adds up repeat visits |
| Drag and drop | `frontend/package.json` | **No drag-and-drop library installed.** The board has no drag code today |

---

## 4. Challenges

Ordered from hardest to easiest.

### C1. There is no per-stage history; only a "current stage" pointer
The system knows where a candidate **is**, not which stages are **passed**, **skipped** or **never visited**. Once movement is not one-directional, "everything to the left is done" is no longer true. The no-re-do rule (D2), the drawer strip, the Approve landing and the funnel fallback all need a real answer.

**Approach:** add the `rpa_pipeline_stage_state` table proposed in L03: `(pipeline_id, stage_key)` unique, with `status` = `not_visited | active | completed | skipped | rejected | hold`, plus timestamps and actor. Backfill it from `rpa_pipeline_stage_events`. Keep `current_stage_key` as "where the candidate is now". Because only one stage is active at a time, there is no parallel "reopened" state.

### C2. "Started" is spread across several tables
No single column says a stage has started. The signal comes from:

| Stage | "Started" when |
|---|---|
| HR Screening (Zeko), Functional (Zeko) | Zeko invite sent and not cancelled (`rpa_zeko_candidate_pipeline`) |
| IQ / Tech Assessment | Evalground invite sent and not withdrawn (`rpa_assessment_invites`), or a result imported (`rpa_assessment_results`) |
| Tech 1/2/3, HR Round, CEO | Interview booked and not cancelled (`rpa_interview_schedule`), or a scorecard awaited (`rpa_interview_scorecard`) |
| Client Interview | Client round marked arranged |
| Documents | Document request sent and its link not closed (`rpa_document_requests`) |
| Offer | Offer shared (`rpa_offers`) |

**Approach:** one server function, `getStageLock(pipeline)`, that returns `{ locked, reason }` (for example "Interview booked for 18 Oct"). Both the board and the move endpoint use it. The board's chip logic at pipeline.service.js:403-415 already does most of this work and can be reused.

**Watch out:** `assessment_pending` ("Evalground test pending") is true for **every** card on Assessment that has no result, even when no invite was sent. In the screenshot, Prashant Salgar may never have been invited. The lock must check `rpa_assessment_invites`, not this chip. Otherwise every Assessment card is locked from the moment it arrives.

### C3. The server rules only allow forward movement
`resolveApproveLanding`, `assertSkippable` and `advanceStage` all assume "+1, optional stages only". The Skip guard (N33) **deliberately blocks** skipping a mandatory stage. HR has now decided that any stage may be skipped (D4), so under the flag this mandatory check is lifted. Access stays controlled by the existing Candidate Pipeline module access (D1).

**Approach:** add a new endpoint, `POST /pipeline/:id/move` → `moveToStage({ targetStageKey, fromStageKey, actedBy })`. It inherits the router's module-access check and will:
1. Check that the journey is open and not paused.
2. Check that the target is `not_visited` or `skipped` (D2), and is not the shortlist stage (which is not a board column).
3. Run `getStageLock` and refuse with 409 and the reason when locked.
4. Run the stale-tab check (`fromStageKey` must equal the current stage).
5. Claim-then-act `updateMany` in a transaction.
6. Mark the stage being left as `skipped` (it was not started; a passed stage is already `completed`).
7. Mark the target as `active`.
8. Write one `moved` event (see C12).
9. Write the legacy status (see C6). Send **no** email.

Approve keeps its current endpoint.

### C4. What Approve does when the order is free
Approve today lands on position + 1. After free moves, position + 1 may be a stage that is already passed. For example, a candidate went Tech 1 → Functional, so approving Functional would land on Tech 1 again, which D2 forbids.

**Approach:** Approve lands on the **next stage in order that is not yet passed**. The Approve modal shows that landing and lets HR pick a different one, using the "land on" picker it already has for optional stages. Any not-passed stage is allowed there too. Either way, the card can be dragged afterwards.

### C5. Documents and Offer are on the board, and there is no mandatory gate
**Decided (D4, D7):** a candidate may be moved straight from HR Screening (Zeko) to Offer, and Documents and Offer take part in drag-and-drop like every other stage. There is **no** check that mandatory stages were done first.

What this means for the build:
- **Nothing blocks it technically.** The Documents and Offer services do not check the candidate's current stage, so they work wherever the candidate is dropped.
- **Leaving Documents or Offer** follows the same lock rule. Once a document request is sent or an offer is shared, the card is locked (C11 covers the undo).
- **Risk: a big jump by accident.** HR Screening → Offer in one drag is easy to do by mistake, and an accepted offer takes a requisition seat. The confirmation popup (C8) therefore shows **how many stages are skipped** and, for a move into Documents or Offer, an extra warning line.
- **Reporting:** a candidate can reach Offer having skipped every interview. That is now valid. The move history (C12) shows how they got there.

### C6. Emails and vendor
**Decided (D5): a move sends no email** to the candidate or the vendor, for now.

- The next real activity (Zeko invite, interview invite, Evalground link, document request, offer) is what the candidate sees.
- Moving a candidate into a stage that was **skipped** earlier must not re-send any old invite automatically. HR sends deliberately.
- Outcome email templates are keyed by stage and outcome. Check that none of them names "the next round", because the next round is no longer fixed.
- **Legacy status write-back is not an email** and should still happen. `rpa_cv.FinalStatus` and `rpa_shortlisted_candidates.pipeline_status` drive the Vendor Dashboard and exports. A move writes a label like "Technical Round 1 Pending" so those screens show where the candidate really is.

### C7. Re-doing a stage the candidate already passed: not allowed
**Decided (D2): NO re-dos.** A candidate can be moved only into a stage that is `not_visited` or `skipped`. A stage the candidate has **passed** (Approved, i.e. `completed`) can never be entered again, by anyone. The server enforces it (`moveToStage` returns 400) and the board greys out that column while the card is dragged.

- **Skipped is not passed.** A stage the candidate was moved past without doing it can still be visited later. That is what the walk-in case needs.
- **Side benefit:** a second Zeko round for the same job (which collides with the unique key `(candidate_id, zeko_job_id, stage)`) and a second Evalground score (which would overwrite the first) cannot happen through a move. No data-model work is needed for them.
- **Approve landing (C4)** follows the same rule.
- A stage where the candidate was **Rejected** ends the journey (reopening is a separate, existing action), so it is never a move target either.

### C8. Drag and drop, and the confirmation popup
- **Library:** none is installed. Use `@dnd-kit/core` (small, maintained, works with keyboard). Native HTML5 drag-and-drop is weak on touch screens and for accessibility.
- **Hidden columns:** the board scrolls sideways with arrow buttons, and later columns (Tech 3, CEO, Documents, Offer) are off-screen. Dragging to a hidden column needs auto-scroll at the edges.
- **Feedback during the drag:** locked cards show a lock icon, with the reason in a tooltip, and cannot be picked up. Columns the card cannot go to are greyed out: stages the candidate already passed (D2) and the current stage.
- **Confirmation popup on every drop (D5):** nothing moves until the user confirms.

  ```
  Move candidate?

  Panmon · QA Automation Engineer
  From:  HR Screening (Zeko)
  To:    Technical Round 1          ← FORWARD (skips 2 stages)

  • HR Screening (Zeko) will be marked "Skipped". You can move back to it later.
  • No email is sent to the candidate or the vendor.
  • This move is recorded under your name.

                                    [ Cancel ]   [ Yes, move ]
  ```

  - **Direction is shown clearly:** "FORWARD" or "BACKWARD". Backward moves use a warning colour.
  - **Moves into Documents or Offer** add one line: "This moves the candidate to Offer without the interview rounds in between."
  - **Cancel is the default button,** so pressing Enter by accident does not confirm.
  - **No reason field (D6).**
- **Undoing an accidental move:** the stage just left is "Skipped", not passed, so the user can drag the card straight back, as long as nothing has started in the new stage. Both moves stay in the history.
- **Server is the authority:** after confirmation, the card moves at once and is put back, with the server's message, on 409 (someone else moved the candidate, or it became locked).
- **Menu alternative:** add a "Move to…" menu on the card and in the drawer, going through the same popup. It covers keyboard users and small screens, and it lets the rules be tested before the drag UI exists.

### C9. Drawer, dossier, exports and analytics
- **Drawer stage strip:** show each stage's real state (Passed, Skipped, Current, Not visited) from the new table, instead of "locked after current". The panels for passed stages stay viewable.
- **Dossier** ([dossierModel.js](../../../backend/src/utils/dossierModel.js)) and the board's CSV export: print stages in the order the candidate actually went through them, with skips marked.
- **Analytics:** add `moved` to `TRANSITION_EVENT_TYPES` and `STAGE_ARRIVAL_EVENT_TYPES` in [pipelineStages.js](../../../backend/src/config/pipelineStages.js#L104-L111) so the funnel and the days-in-stage clock count moves correctly. Stage-to-stage conversion rates become less meaningful when the order varies; label them as such.

### C10. Tests that assume forward order
`pipelineStageEngine`, `pipelineClosure`, `schedulingAndScorecard`, `crossModuleE2E`, `rescheduleEmails` and `documentsAndOffer` all assume forward movement. They must still pass with the flag off, and new tests cover the flag-on paths.

### C11. Unlocking a started stage: cancel / withdraw (decided: yes)

Without an undo, a candidate whose stage has started but will never finish is stuck. Example: a Zeko invite is out, then the plan changes. HR could only escape by approving without a score, which records a false "Approved" in the history. HR/RT have agreed (D3) that started activities get an undo.

| Stage | Undo action | Exists today? | What it does |
|---|---|---|---|
| Tech 1 / 2 / 3, HR Round, CEO | Cancel interview | **Yes** ([PipelineDrawer.jsx:1516](../../../frontend/src/components/pipeline/PipelineDrawer.jsx#L1516)) | Cancels the Teams booking, emails the candidate and panel |
| HR Screening (Zeko), Functional (Zeko) | Cancel Zeko interview | **Yes** ([PipelineDrawer.jsx:1447](../../../frontend/src/components/pipeline/PipelineDrawer.jsx#L1447) → [screening.service.js:2813](../../../backend/src/services/screening.service.js#L2813)) | Calls Zeko's `cancel-scheduled-candidates` API, sets the Zeko row to `cancelled`, emails the candidate |
| IQ / Tech Assessment | **Withdraw Evalground invite** | **No, new** | See below |
| Documents | **Cancel document request** | **No, new** (the link's `closed` state exists; no button sets it) | Closes the upload link, so the candidate sees "link closed". Card unlocks |
| Offer | **none, by decision (O1)** | n/a | Unchanged from today. Once shared, an offer ends only through the candidate's decision or "Close this candidate's record". Before it is shared, the Offer card is "Not started" and can be dragged like any other |

**Why Evalground needs more care:** Evalground has **no API** ([assessmentInvite.service.js:1-12](../../../backend/src/services/assessmentInvite.service.js#L1-L12)). An "invite" is either an email carrying a link the recruiter created in Evalground's dashboard, or a note that the link was sent outside the app. Our system cannot switch the link off.

**Withdraw Evalground invite: design**
- **Button:** in the Assessment panel of the drawer, shown when the latest invite is open (no result yet, not withdrawn). Opens a dialog with:
  - a reason (required)
  - "Email the candidate that the test is cancelled" (on by default; uses a new template, *Evalground Test Cancelled*)
  - a reminder: *"Also disable this candidate's link in the Evalground dashboard. We cannot do it for you."*
- **Data:** add `withdrawn_at`, `withdrawn_by` and `withdraw_reason` to `rpa_assessment_invites` (nullable; small DDL). The row stays, so the history is kept, the same way re-invites stay as rows.
- **History:** a `note` event on the journey, for example "Evalground invite withdrawn by X: reason".
- **Deadline reminders:** [assessmentDeadlineChecker.js:58-66](../../../backend/src/jobs/assessmentDeadlineChecker.js#L58-L66) picks the latest invite per journey. Add `AND li.withdrawn_at IS NULL` so a withdrawn invite never rings the overdue bell.
- **Lock check:** `getStageLock` treats a withdrawn invite as "not started". The card unlocks.
- **Vendor:** the vendor was told "assessment invited". Send a matching "assessment cancelled" status line (new `VENDOR_EVENTS` value). This is a withdraw, not a move, so it is outside D5's "no email on move".
- **Late result:** the candidate may still take the test from the link if the recruiter forgot to disable it. The import matches only journeys **currently on Assessment** ([assessmentImport.service.js:266](../../../backend/src/services/assessmentImport.service.js#L266)). A candidate who has been moved away is therefore not matched, and the result goes to manual review. If the candidate is still on Assessment, the import should flag "result arrived after the invite was withdrawn" rather than auto-approving.
- **Re-invite:** "Send Evalground invite" works again after a withdraw and creates a new row, as re-invites already do.

**Small gap in the Zeko cancel to fix during the build:** it is reached through the legacy `/screening/analytics/cancel` route and does not write a stage event to `rpa_pipeline_stage_events`. For the candidate's history to be complete, the pipeline drawer's cancel should also write a `note` event ("Zeko interview cancelled by X: reason").

### C12. Move history: who, when, from, to (D6)

HR wants every move tracked, without asking for a reason.

**What is stored.** Each move writes one row in `rpa_pipeline_stage_events`:

| Field | Value |
|---|---|
| `event_type` | `moved` (new value; no DDL needed) |
| `stage_key` | the stage moved **to** |
| `from_stage_key` | the stage moved **from**. **New nullable column** (small DDL) so reports do not have to parse text |
| `notes` | readable sentence, for example "Moved forward from HR Screening (Zeko) to Technical Round 1 (skipped 2 stages)" |
| `acted_by` | the user who confirmed the popup |
| `created_at` | when |

The direction (forward / backward) is worked out at the moment of the move and kept in `notes`. Stage order can be changed by an admin later, so the direction should not be recomputed afterwards.

**Where HR sees it:**
1. **Candidate drawer:** a "Stage history" timeline, for example *"16 Oct 2026, 3:42 pm · harish.mopuri moved Panmon from HR Screening (Zeko) → Technical Round 1 (forward)"*. It sits alongside the existing outcome and note entries.
2. **Move history report:** a new option next to **Export CSV** on the pipeline page. It downloads every move, filterable by date range, user and position. Columns: Candidate, Email, Position / MRF, From stage, To stage, Direction, Stages skipped, Moved by, Moved at.
3. **Dossier:** the moves appear in the dossier's stage history section.

Approve, cancel and withdraw already write their own events, so the full story of a candidate is in one timeline.

---

## 5. Decisions (answered by HR / RT, 16 Oct 2026)

| # | Question | Decision |
|---|---|---|
| D1 | Who may move candidates? | **Any user with access to the Candidate Pipeline menu.** Already enforced by `checkModuleAccess('recruitment_pipeline')` on every pipeline route; no new setting |
| D2 | Can a candidate be moved back into a stage they already passed? | **NO.** Only not-visited or skipped stages are move targets (C7) |
| D3 | Can HR unlock a started stage by cancelling the activity? | **YES.** Interviews and Zeko already have cancel. New: Withdraw Evalground invite, Cancel document request (C11) |
| D4 | Must every mandatory stage be done before Documents? | **NO.** Any move from HR Screening (Zeko) to Offer is allowed (C5) |
| D5 | Does a move email the candidate or the vendor? | **No, not for now.** Every move needs a **confirmation popup** so accidental drags do nothing (C8) |
| D6 | Is a reason required for every move? | **NO,** but every move is **tracked**: candidate, by whom, when, from, to (C12) |
| D7 | Are Documents and Offer excluded from drag-and-drop? | **NO.** They are draggable like every other stage (C5) |
| D8 | One active stage at a time (no parallel stages)? | **Yes.** Follows from HR's lock rule (§2) |
| O1 | Once an **offer has been shared**, can HR withdraw it and move the candidate elsewhere? | **Keep the current behaviour; no change.** There is no "withdraw offer" action today and none is added. A shared offer ends only as it does now: the candidate's decision (accept / decline) or "Close this candidate's record". So once an offer is shared, the card is locked (C11) |

---

## 6. Build plan

Behind a feature flag `FLEXIBLE_STAGES_ENABLED` (named in L03). With the flag off, behaviour is exactly as today. Work goes to staging first, with a full test, then one production release.

| Phase | Work | Estimate |
|---|---|---|
| 1 | DDL: `rpa_pipeline_stage_state` + idempotent backfill + rollback; `rpa_pipeline_stage_events.from_stage_key`; `rpa_assessment_invites.withdrawn_*` | 9 h |
| 2 | Backend: `getStageLock` (all stages incl. Documents/Offer), `moveToStage` + route, `moved` event, Approve landing on the next not-passed stage, mandatory check lifted under the flag, legacy write-back for moves | 18 h |
| 3 | Backend: Evalground import uses the new landing rule; check Zeko, interview, scorecard, documents and offer paths under the flag; **Withdraw Evalground invite** (endpoint, deadline-checker filter, template, vendor event, late-result flag); **Cancel document request**; stage event on Zeko cancel | 20 h |
| 4 | Frontend: "Move to…" menu (card and drawer), **confirmation popup**, drawer strip showing real stage states, drawer stage-history timeline, Withdraw Evalground / Cancel document request dialogs | 16 h |
| 5 | Frontend: drag-and-drop on the board with `@dnd-kit`: locked cards, greyed columns, edge auto-scroll, move after confirm with rollback on 409 | 16 h |
| 6 | **Move history report** (CSV, filters), dossier history, board CSV export, analytics event lists, outcome template wording check | 10 h |
| 7 | Tests: unit tests for lock and landing rules; integration tests for the scenarios below; full pipeline suite with the flag on and off | 14 h |
| 8 | Staging UAT on 3 real requisitions with RT; production release | n/a |
| | **Total (rough)** | **≈ 103 h** |

Compared with L03's 72 h: dropping parallel stages, the role setting and the mandatory gate saves time. The drag-and-drop board, the lock check across all stages, the two new undo actions and the move history report add more than that saves.

**Ship order:** phases 1-4 can go to staging on their own with the "Move to…" menu, so RT can test the rules early. Drag-and-drop (phase 5) adds the drag gesture on top of the same endpoint and popup.

### Scenarios that define "done"
1. HR Screening (not started) → drag to Tech 1. The popup shows "FORWARD (skips 2 stages)". Cancel: nothing changes. Confirm: the card moves, HR Screening shows "Skipped", no email is sent, and one `moved` event records from, to, user and time.
2. A candidate on Tech 1 with a booked interview cannot be dragged. Tooltip: "Interview booked for …".
3. Cancel that interview. The card is draggable again. The same works for a Zeko round (Cancel Zeko interview), Assessment (Withdraw Evalground invite: no overdue reminder fires, the candidate gets one cancellation email, the vendor sees "assessment cancelled") and Documents (Cancel document request: the candidate's link shows closed).
4. Approve Tech 1, which lands on the first stage not yet passed, then drag to Tech 3, then to Tech 2. The drawer timeline shows every step.
5. Walk-in: Tech 1 first, Approve, drag to Assessment, the Evalground import matches and approves, and the candidate lands on the next not-passed stage. Each stage sends at most one email.
6. A candidate who passed Functional Screening and is now on Tech 2: the Functional column is greyed out during the drag, and a direct API call to move them there returns 400. A stage they only **skipped** is still a valid target.
7. HR Screening → Offer in one drag: the popup shows the extra Offer warning line. After confirming, an offer can be raised and shared. Before sharing, the card can still be dragged. Once shared, the card is locked, and the offer screens behave exactly as they do today (accept / decline / close record). No withdraw option appears.
8. Accidental move: drag to the wrong column, confirm, then drag straight back. Both moves appear in the history.
9. A user without Candidate Pipeline access gets 403 from the move API (existing module check). Vendors never reach it.
10. Two tabs: tab A moves the candidate and tab B's move is refused with 409 and the card snaps back.
11. The Move history CSV, filtered by user and date, lists the moves from scenarios 1, 4, 7 and 8 with the correct from/to/direction.
12. With the flag off, every existing pipeline integration test passes unchanged.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Accidental drag, especially a big jump to Documents or Offer | Confirmation popup with Cancel as the default; skipped-stage count and Offer warning; the move can be reversed by dragging back; every move is in the history |
| Backfill marks stages wrongly for existing candidates | Dry-run report on staging first; compare against the drawer for about 20 candidates; the backfill is idempotent |
| Lock check misses an activity type, so a started stage can be moved | One shared `getStageLock` used by both the API and the board; a test per activity type |
| Funnel and conversion numbers change meaning | Add `moved` to the arrival event list; add a note on the analytics page |
| Vendor Dashboard shows a stale status after a move | Legacy status write-back on every move (not an email) |
| Staging and production share a DB host | Apply the DDL to the staging schema only; production release afterwards per the staging-first rule |
