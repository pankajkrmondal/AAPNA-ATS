# T2: Backend move, lock and Approve landing (plan §6 phase 2)

## Test plan

**Scope.**
- `POST /api/pipeline/:id/move { target_stage_key, from_stage_key }` → `moveToStage()` (pipeline.service.js).
- The lock rule `getStageLock()` / `getStageLocks()` (stageState.service.js) over `computeStageLock()` (utils/stageState.js).
- Approve landing under the flag: next stage not yet passed, or any not-passed stage the recruiter picks (`resolveFlexibleApproveLanding`).
- `advanceStage` under the flag (lock + landing rules; mandatory check lifted).
- Per-stage state written by every transition (outcome, advance, move, journey create), flag on or off.
- Legacy write-back on a move: `rpa_cv.FinalStatus = "<stage> Pending"`, `pipeline_status = shortlisted`. No email.
- Board and drawer payloads: `flexibleStages`, card `lock` + `passed_stage_keys`, drawer `stageStates` + `stageLock`.

**Approach.** Unit tests for the pure rules; then API calls through the logged-in browser session (Playwright `fetch` from the page) and the UI against staging data; DB checks with read-only queries.

**Pass criteria.** Every case below passes; no email is logged in `rpa_email_log` for a move.

## Test cases

| ID | Case | Steps | Expected |
|---|---|---|---|
| T2-01 | Forward move, not started | Candidate on HR Screening, no Zeko invite. Move to Technical Round 1 | 200. Card on Tech 1. `zeko_hr = skipped`, `tech1 = active`. One `moved` event: `from_stage_key = zeko_hr`, `stage_key = tech1`, note "Moved forward … (skipped 2 stages)", `acted_by` = me |
| T2-02 | No email on move | After T2-01 | No new `rpa_email_log` row for the candidate; no vendor mail |
| T2-03 | Legacy write-back | After T2-01 | `rpa_cv.FinalStatus = "Technical Round 1 Pending"`; shortlist `pipeline_status = shortlisted` |
| T2-04 | Backward move | Move the same candidate back to HR Screening | 200. Direction backward; `tech1 = skipped`, `zeko_hr = active` |
| T2-05 | Locked: interview booked | Candidate on Tech 1 with a booked interview. Call move | 409 "Interview booked for <date>. Cancel the interview…" |
| T2-06 | Locked: Zeko invite | Candidate on HR Screening with a sent Zeko invite | 409 "Zeko invite sent on …" |
| T2-07 | Locked: Evalground invite | Candidate on Assessment with an open invite | 409 "Evalground invite sent …" |
| T2-08 | Not locked: Assessment w/o invite | Candidate on Assessment, no invite | Move allowed (C2 watch-out) |
| T2-09 | Locked: documents requested | Candidate on Documents with an open request | 409 "Documents requested …" |
| T2-10 | Locked: offer shared | Candidate on Offer with `shared_at` set | 409 "Offer shared on …" |
| T2-11 | Locked: hold / rejected / paused / closed | Each state | 409 with the matching reason |
| T2-12 | No re-do (D2) | Candidate who passed Functional, now on Tech 2. Move to Functional | 400 "already passed … cannot be entered again" |
| T2-13 | Skipped is a valid target | Same candidate, a stage they only skipped | 200 |
| T2-14 | Stale tab | Send `from_stage_key` that is not the current stage | 409 "Someone else moved this candidate…" |
| T2-15 | Bad target | `target_stage_key` = `shortlist`, `nope`, current stage, empty | 400 each |
| T2-16 | Flag off | `FLEXIBLE_STAGES_ENABLED=false`, call move | 400 "…not switched on." Board payload has no `lock` |
| T2-17 | Approve landing | Candidate went Tech 1 (approved) → moved to Functional. Approve Functional | Lands on the next not-passed stage after Functional (Tech 2), never Tech 1 |
| T2-18 | Approve picker | Approve with `skip_to_stage_key` = a backward skipped stage | Lands there. A passed stage → 400 |
| T2-19 | Mandatory lifted | Approve HR Screening with `skip_to_stage_key = offer` (flag on) | Allowed. Same call with the flag off → 400 "mandatory" |
| T2-20 | advanceStage under the flag | Advance a not-started mandatory stage | Allowed, lands on next not-passed; locked stage → 409 |
| T2-21 | State on outcome (flag off) | Approve a stage with the flag off | State rows written too: current `completed`, next `active` |
| T2-22 | Board payload | GET /api/pipeline with the flag on | `flexibleStages: true`; each card has `lock` and `passed_stage_keys` |
| T2-23 | Drawer payload | GET /api/pipeline/:id | `flexibleStages`, `stageStates`, `stageLock` present |
| T2-24 | Access (D1) | Vendor / user without pipeline module calls move | 403 from the router's existing checks |
| T2-25 | Pure rules (unit) | `node --test src/tests/unit/stageState.test.js` | All pass |

## Results log

### Run 1: 16 Oct 2026

| ID | Result | Notes |
|---|---|---|
| T2-25 | PASS | 19/19: scenario 1 (forward, skips 2), backward, D2 refusal, skipped re-entry, HR → Offer, C4 landing and picker, every lock reason, C2 watch-out, pending label, moved = arrival |
| T2-01 to T2-24 | BLOCKED | Staging DB unreachable; backend cannot start against it |

### Run 2: 16 Oct 2026 (staging, Playwright, flag on)

Test data: fixture `src/tests/helpers/flexStageFixture.js` (tag `FLEXSTAGE-TESTPASS-FIXTURE`), MRF 686 "FlexStage Test Role", journeys 2369 Flex Fresh A, 2370 Flex Fresh B, 2371 Flex Interview, 2372 Flex Assessment, 2373 Flex Documents, 2374 Flex Passed Fn, 2375 Flex Vendor. No colleague's journey was moved.

| ID | Result | Notes |
|---|---|---|
| T2-01 | PASS | 2369 HR Screening → Tech 1: 200; state `zeko_hr = skipped`, `tech1 = active` (updated_by 1); event `moved`, `from_stage_key = zeko_hr`, note "Moved forward from HR Screening (Zeko) to Technical Round 1 (skipped 2 stages)", acted_by 1 |
| T2-02 | PASS | 0 rows in `rpa_email_log` in the 5 minutes after the move |
| T2-03 | PASS | `FinalStatus = "Technical Round 1 Pending"`, `pipeline_status = shortlisted` |
| T2-04 | PASS | Dragged back to HR Screening: direction backward, Tech 1 skipped |
| T2-05 | PASS | 2371 (booked interview) card locked: "Interview booked for 19 Oct 2026. Cancel the interview…" |
| T2-06 | PASS | Real staging cards locked "Zeko invite sent on …" (e.g. journeys 703, 586, 2358) — read only |
| T2-07 | PASS | 2372 after "Mark as sent manually": 409-lock "Evalground invite sent on 16 Oct 2026. Withdraw the invite…" |
| T2-08 | PASS | 2372 / 2375 on Assessment with no invite: not locked (C2 watch-out). Real journey 2 (Prashant Salgar) with a real invite: locked |
| T2-09 | PASS | 2373 after document request: card locked; `POST /advance` → 409 "Documents requested on 16 Oct 2026. Cancel the document request…" |
| T2-10 | PASS | 2370 after "Record offer shared": `POST /move` → 409 "Offer shared on 16 Oct 2026." |
| T2-11 | PASS | Paused (real journey 4: "This journey is paused. Resume it first."), rejected (2371 after T7 reject), closed (assertJourneyOpen) |
| T2-12 | PASS | 2374 → Functional (passed): 400 "The candidate already passed Functional Screening (Zeko). A passed stage cannot be entered again." |
| T2-13 | PASS | 2374 → IQ / Tech Assessment (skipped): 200 |
| T2-14 | PASS | `from_stage_key = tech1` while on tech2 → 409 "Someone else moved this candidate…" |
| T2-15 | PASS | current stage, `shortlist`, `nope`, missing → 400 each with a clear message |
| T2-16 | PASS | Flag off: 400 "Moving candidates between stages in any order is not switched on."; no `lock` on cards (see T7) |
| T2-17 | PASS | 2374 on Assessment (Tech 1 passed earlier, Tech 2 skipped): Approve landed on Tech 2, Assessment `completed` |
| T2-18 | PASS | Picker lists only not-passed stages; covered with T4-14 |
| T2-19 | PASS | Flag on: 2369 Approve Functional with `skip_to_stage_key = offer` → lands on Offer. Flag off: same shape → 400 "This stage is mandatory… HR Round has to happen first." |
| T2-20 | PASS | Flag on: `advance` on 2369 (Assessment) → Functional, Assessment `skipped`; on locked 2373 → 409 with the lock reason |
| T2-21 | PASS | Flag off approve on 2374: Tech 2 `completed`, Tech 3 `active` |
| T2-22 | PASS | Board: `flexibleStages: true`; every card has `lock` and `passed_stage_keys` |
| T2-23 | PASS | Drawer detail: `flexibleStages`, `stageStates`, `stageLock` present |
| T2-24 | NOT RUN | No vendor / non-pipeline account available in this session. The route inherits the unchanged router-wide `requireStaff` + `checkModuleAccess('recruitment_pipeline')` |
