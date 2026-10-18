# T7: Regression with the flag off, and the full suite (plan §6 phase 7, scenario 12)

## Test plan

**Scope.** With `FLEXIBLE_STAGES_ENABLED=false` the pipeline must behave exactly as before: forward-only Approve, optional-only skip (N33), no move endpoint, no drag, no new buttons. The only flag-independent change is that stage-state rows are now written on every transition.

**Approach.**
1. Unit suites (`src/tests/unit/*.test.js`, `src/tests/*.test.js`).
2. Integration suites against staging (`src/tests/integration/`): pipelineStageEngine, pipelineClosure, schedulingAndScorecard, crossModuleE2E, rescheduleEmails, documentsAndOffer.
3. Playwright smoke of the board and drawer with the flag off.

## Test cases

| ID | Case | Steps | Expected |
|---|---|---|---|
| T7-01 | Unit suites | `node --test "src/tests/unit/*.test.js" "src/tests/*.test.js"` | All pass |
| T7-02 | Integration suites | Run each listed integration file against staging | All pass unchanged |
| T7-03 | Skip guard intact | Flag off: approve HR Screening with `skip_to_stage_key = offer` | 400 "mandatory" |
| T7-04 | Move endpoint off | Flag off: POST /move | 400 "not switched on" |
| T7-05 | Board unchanged | Flag off: /pipeline | No hint line, no swap icons, no lock icons, no Move history button, cards not draggable |
| T7-06 | Drawer unchanged | Flag off: drawer | Old strip ("stages after X are locked…"), no Move to…, no Stage history panel, no Withdraw / Cancel request buttons |
| T7-07 | State still written | Flag off: approve a stage | State rows updated (current completed, next active) so the flag can be switched on later |

## Results log

### Run 1: 16 Oct 2026

| ID | Result | Notes |
|---|---|---|
| T7-01 | PASS | 765/765 (unit 531 + loose 234) |
| T7-02 to T7-07 | BLOCKED | Staging DB unreachable |

### Run 2: 16 Oct 2026 (staging, `FLEXIBLE_STAGES_ENABLED=false`, backend restarted)

| ID | Result | Notes |
|---|---|---|
| T7-01 | PASS | 765/765 again after the six UI fixes; frontend builds |
| T7-02 | PARTIAL | `pipelineStageEngine.test.js`: 24/25 pass — PIPE-01/02/03, D3 stale tab, PIPE-06, PIPE-16, N33/N24/N25 (state rows written on every approve). PIPE-13 fails in setup: it needs the 2-opening fixture MRF (`PHASE3-TESTPASS-FIXTURE`, `number_of_positions = 2`), which was purged from staging on 28 Sep 2026; only MRF 137 (1 opening) remains. The cooling-off guard itself was re-checked on the flexible-stage fixture (`src/tests/helpers/flexStageCoolingOffCheck.js`): 409 "Candidate is in a 6-month re-application cooling-off period…" — PASS. `pipelineClosure.test.js` fails in `before()` for the same missing MRF ("Fixture MRFs missing"). The remaining suites (documentsAndOffer, schedulingAndScorecard, rescheduleEmails, crossModuleE2E) were **not run**: re-seeding the Phase 3 fixture puts journeys on MRF 137, which now carries a colleague's real candidates, and these suites close/fill that requisition. Stopped deliberately; verified afterwards that no test journey or CV was left behind and MRF 137 is unchanged (not filled, not closed) |
| T7-03 | PASS | Approve with `skip_to_stage_key = offer` → 400 "This stage is mandatory and cannot be skipped. HR Round has to happen first." |
| T7-04 | PASS | `POST /move` → 400 "Moving candidates between stages in any order is not switched on." |
| T7-05 | PASS | Board: no hint, 0 swap icons, 0 lock icons, 0 draggables, no Move history button; columns 260 px |
| T7-06 | PASS | Drawer: old text "stages after … are locked until the candidate gets there", no Move to…, no Stage history, no legend, no Cancel document request button. `screenshots/T7-06-drawer-flag-off.png` |
| T7-07 | PASS | Approve on 2374 (flag off): Tech 2 `completed`, Tech 3 `active` written |

**To finish T7-02:** re-create a tagged 2-opening fixture MRF (and point the suites at a fresh tagged 1-opening MRF instead of MRF 137), then run the six suites. Needs a decision from the team, since MRF 137 is shared.
