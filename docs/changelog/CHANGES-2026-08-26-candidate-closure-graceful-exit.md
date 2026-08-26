# Phase 3 — Candidate closure: winding the journey down, not just stamping it

**Date:** 2026-08-26 · **Modules:** M1 (stage engine), M3 (scheduling), M4 (assessment), M5 (offer/closure)
**Source:** [PHASE3-CLOSURE-AUDIT-2026-08-26.md](../PHASE3-CLOSURE-AUDIT-2026-08-26.md), §5 items **1–4 + 7**,
under the decisions recorded in that document's **§6a**.

**~~Not in scope, by decision:~~** §2.5 (stranded candidates / pause-stop), §2.6 (manual MRF closure,
closure reason, journey re-open) and §2.7 (`joined` → MRF fill) were held back as
**Q32 / Q33 / Q34**. ✅ **All three were answered and BUILT later the same day** — see
[CHANGES-2026-08-26-closure-followon-mrf-lifecycle.md](./CHANGES-2026-08-26-closure-followon-mrf-lifecycle.md).
The ⚠️ at the end is therefore resolved, not outstanding.

**No schema change in THIS change set, and no migration.** `joined_at` was already declared — the fix
writes columns that existed and were never populated.

> 🚨 **One claim here was wrong.** This said `pipeline_status` is *"plain `VARCHAR(50)` with no CHECK
> constraint"*, following `2026-07-21-pipeline-stage-engine.README.md`. **It is not** —
> `rpa_shortlisted_candidates_pipeline_status_check` exists, and it rejected 5 of the 7 closure
> values **silently**, because the write is a best-effort `try/catch`. So §2.4 below did not actually
> work until `2026-08-26-shortlist-status-vocabulary.sql` widened the constraint that same day. The
> distinct-values decision itself was sound; only the "no DDL needed" premise was false.

**Backfill:** none at the time of writing. A staging backfill was applied later the same day via
`backend/scripts/backfill-closure-pipeline-status.mjs` (2 rows); production was deliberately left
untouched.

---

## Why

The audit asked one question — when a candidate is closed, does everything downstream wind down? —
and found that it does not. Closure was built as a **per-journey state write**, not as a process:
the row was set correctly, race-safely, with a clean audit trail, and then everything that row was
driving kept running. The calendar booking. The reminder cron. The occurrence queue. The shortlist
status.

And one gap blocked the process outright: **five of the eight closure outcomes could not be reached
from the UI at all.**

---

## 1. Closure is reachable from every stage (§2.1 — critical)

`setClosureOpen(true)` was called from exactly one place in the drawer — inside `OfferActions`,
which renders only when `selectedStageKey === 'offer'`. Every other stage got the generic
Approve / Reject / Hold bar and no closure path.

This contradicted the spec on both sides. Q12 defines **Candidate Withdrawn** as *"candidate
voluntarily exits at **any** stage before joining"*, the seeded template copy says *"a journey can be
closed from ANY stage — a candidate withdrawing at Tech 2 never reaches the offer stage"*, and
`setFinalOutcome` has always accepted any `current_stage_key`. The API and the templates were ready.
Only the button was missing.

A candidate who withdrew at Tech 2 therefore could not be closed. The recruiter's only options were
to **reject** them — wrong outcome, wrong email, and it starts a 6-month Q11 cooling-off they did not
earn — or leave the journey open forever.

- `frontend/src/components/pipeline/PipelineDrawer.jsx` — a **Close this candidate's record** action
  now renders in the generic stage panel, opening the same 8-outcome modal the Offer stage uses. All
  eight outcomes are offered at every stage, unfiltered, matching the backend and Q10/Q13's
  "manual only, no system logic" posture. Kept visually quieter than the outcome buttons: closure is
  the rarer, heavier action, and the stage decision is still the normal path.

## 2. Closing a journey cancels its interviews (§2.2 — critical, an unmet commitment)

`04-QUESTIONS.md` §D records this as settled: *"Withdrawing a candidate auto-cancels their pending
calendar invites and scheduled reminders."* **It was never built.** A withdrawn or rejected candidate
kept a live Teams booking and still received the 30-minute reminder mail.

- `backend/src/services/pipeline.service.js` — `setFinalOutcome` now cancels every booking that has
  **not yet started**, best-effort and per-row, in the same guarded tail as the document-token close
  beside it. A round that already happened is a historical fact and is left alone; those only needed
  to stop being chased, which is §2.3 below.
- `backend/src/services/interviewSchedule.service.js` — `cancelInterviewRound` takes
  `notifyCandidateOfCancellation`. **Panel always, candidate never**: someone must not sit waiting in
  a room, but five of the eight outcomes are in `SILENT_FINAL_OUTCOMES` precisely because there is
  nothing to tell a candidate who withdrew, and a cancellation notice would smuggle that news back in
  through the side door. The Graph/Teams event is cancelled either way.
  - The param is deliberately **not** named `notifyVendor` — that is a live import in the same
    module, and a destructured param of that name would shadow it, turning the call below into a
    boolean invocation.

## 3. Three background jobs no longer act on closed journeys (§2.3 — high)

`documentReminder.js` and `offerSweep.js` carry a `final_outcome: null` guard because someone hit the
bug there. The jobs nobody hit never got it — the same class of bug, unfixed, in four more queries.

| Query | Was |
|---|---|
| `jobs/interviewReminder.js` | still emailed the 30-min reminder |
| `jobs/interviewOccurrence.js` | still chased "did this happen?" |
| `listUnresolvedInterviews()` in `services/interviewSchedule.service.js` | sat in the recruiter queue forever, with no upper bound |
| `jobs/assessmentDeadlineChecker.js` | fired an overdue bell (internal only) |

All four now carry the guard, copied from `documentReminder.js:46`. The assessment sweep is a raw
`DISTINCT ON` query, so there it is an `EXISTS` sub-select rather than a Prisma relation filter.

Deliberately **not** added to `interviewOccurrence.js`'s write-off `updateMany`: stamping a stale row
`unconfirmed` sends nothing, and letting it run keeps closed journeys' rows out of the pending state
other readers scan.

## 4. Closure writes both legacy layers, and `joined_at` at last (§2.4 — high)

`setStageOutcome` wrote **both** legacy layers — `rpa_cv.FinalStatus` *and*
`rpa_shortlisted_candidates.pipeline_status`. `setFinalOutcome`, written later for the terminal case,
wrote only the first. A candidate closed as `joined` therefore still read
`pipeline_status = 'shortlisted'` forever — and that column feeds the dashboard shortlist tile, the
recruiter leaderboard and the screening result badges.

- `backend/src/config/pipelineStages.js` — `shortlistStatusFor()` now maps the 8 closure outcomes.
  **Distinct values, not one rolled-up "closed"**, per §6a: `joined` / `closure_approved` → `hired`;
  `closure_rejected` → `rejected`; `closure_on_hold` → `on_hold`; `candidate_withdrawn` → `withdrawn`;
  `backed_out` → `backed_out`; `did_not_join` → `did_not_join`; `joined_and_left` → `joined_and_left`.
  New: `SHORTLIST_STATUSES` and `TERMINAL_SHORTLIST_STATUSES`.
  - **Only `closure_rejected` may write `'rejected'`.** That value drives the Q11 6-month cooling-off
    (`screening.service.js:1256`), and a withdrawal must not trip a cooling-off it did not earn —
    which is exactly the harm recruiters were causing by hand while §2.1 was unfixed.
- `backend/src/services/pipeline.service.js` — the closure tail writes `pipeline_status`, and stamps
  **`joined_at` for `joined` only**, taking the value **from `closed_at`** so the two reconcile
  exactly instead of drifting by however long the best-effort tail runs. Not `closure_approved` (a
  verdict on the record, not evidence anyone started) and not `joined_and_left` (they joined, but
  "now" is the *leave* date and there is no leave column). `dashboardAggregations.js:227` prefers
  `joined_at` over `offer_accepted_at`, so a fabricated date corrupts the one metric that reads it
  first.
  - `joined_at` had been declared, read by the dashboard and required by the development plan *"for
    reporting continuity"* — and **written by no code path anywhere.** The hire *count* survived on
    the `offer_accepted_at` fallback, so nothing looked broken while time-to-hire silently measured
    to offer acceptance instead of to joining.
- `backend/src/tests/shortlistStatus.test.js` — **new**, 9 unit tests.

### 4a. The two regressions this fix would otherwise have introduced

Both were caught in the §6a verification pass, and both land in the same change set:

- **The Analytics status strip would have stopped adding up.** Three readers bucket `pipeline_status`
  and must sum to their total, and all three ended without a final `else` — so any new value landed
  in `Total` and in no column. This is the identical defect fixed for `future_prospect` earlier the
  same day. All three now end in a **catch-all `closed` branch**, so the sum holds *by construction*
  and a status invented next year cannot silently vanish. The five terminal values roll into that one
  column; the column itself keeps them distinct.
  - `backend/src/services/screening.service.js` (rewritten as a classifier, not independent filters),
    `backend/src/exports/screening.export.js`, `frontend/src/pages/Analytics.jsx`.
- **The recruiter leaderboard would have deducted credit at the moment of success.**
  `dashboard.service.js` grouped `shortlisted_by` where `pipeline_status === 'shortlisted'`, so a
  recruiter's score **dropped when their candidate was hired**. The inline comment already said the
  intent was "exclude reject stamps" — an equality test was the wrong instrument. Now
  `{ not: 'rejected' }`.

## 5. Two hardening fixes the audit did not model (§6a items 4 and 5)

- **`scheduleInterviewRound` had no closure guard.** Its checks were stage-support, journey-exists,
  current-stage and one-live-booking — nothing about `final_outcome`. A stale browser tab could book
  a *fresh* interview on a closed journey **after** the cancel sweep had run, recreating precisely the
  live Teams invite that sweep exists to prevent. Latent before today; surfacing closure at every
  stage turns it from unreachable into a matter of time. Guard inlined rather than importing
  `assertJourneyOpen`, which would close an import cycle — the message is kept identical.
- **`cancelInterviewRound` was not idempotent and raced.** Its `status === 'cancelled'` read and its
  write straddled an `await` (the Graph call), so two racers — a recruiter cancelling by hand while a
  closure sweeps the same booking — both passed the check and **both emailed the panel**. The write
  is now a conditional `updateMany` claim, matching the pattern `setFinalOutcome` and
  `closeMrfIfFilled` already use. The bulk caller in `setFinalOutcome` tolerates the resulting 400,
  which is a no-op for a sweep, not a failure.

## 6. In-app copy corrected (§2.8 — the code half)

The documentation half was stamped earlier the same day. The remaining lie was in the product:

- `frontend/src/components/pipeline/PipelineDrawer.jsx` — the closure modal told recruiters *"A
  closure email is sent only if a template is mapped to the status you pick."* Written before the
  closure templates were seeded, it was by then wrong **in both directions**: three outcomes now
  always send via `GENERIC_FALLBACK_BY_OUTCOME` whether or not anyone mapped anything, and five never
  send however they are mapped. It now states the answer **per outcome**, as the recruiter picks —
  because the honest general statement is "it depends", which helps nobody at the moment of choosing.
- Same file — the **Evalground Re-invite button was the one action in the drawer missing the
  `!outcomeEvent` guard** that Schedule, Cancel, Client-round and Documents all carry. It survived
  both an ordinary reject and a closure, so a recruiter could email a fresh assessment invite to a
  candidate whose record was already closed. Fixed at both call sites. *(Beyond the letter of §5, but
  it is a send-capable leak on exactly the closed journeys §2.1 has just made common. The
  `TeamsDetails` card §6a also names is display-only and is left alone.)*

---

## Expected metric movements — these are the fix, not new bugs

- **Shortlisted KPI (`dashboard.service.js`) falls.** Closed candidates dropping out of
  `'shortlisted'` is precisely what §2.4 corrects.
- **Hired count rises**, and time-to-hire begins measuring to *joining* rather than to offer
  acceptance for every journey closed as `joined` from now on.
- **`closure_rejected` arms the 6-month Q11 cooling-off from the closure path for the first time.**
  Those candidates leave JD and Keyword search for six months. **RT will feel this one.**
- The Analytics role table gains a **Closed** column, in the table and in the CSV export.

## Verification

- `backend/src/tests/shortlistStatus.test.js` — new. **203 unit tests pass** across the suite
  (`node --test src/tests/*.test.js`), up from 194.
- `backend/src/tests/integration/crossModuleE2E.test.js` — **E2E-01 extended** (asserts
  `pipeline_status` moves to `hired` and that `joined_at` equals `closed_at`) and **E2E-06 added**:
  closure from a **non-Offer** stage, asserting the pending booking is cancelled, the withdrawal does
  not read as a rejection, and re-application is not barred. No test covered closure from a non-Offer
  stage before today — that absence is how §2.1 survived.
- ✅ **The integration tests were run on 2026-08-26** — `crossModuleE2E.test.js` reports **7 pass,
  0 fail**, including the extended E2E-01 and the new E2E-06. See the follow-on changelog for the
  full three-file run.
- `npm run build` (frontend) passes.

## ⚠️ §2.7 is now promoted from theoretical to routine

Surfacing closure at every stage means a journey can be closed as `joined` **without an in-app
accepted offer row** from one click at Tech 1. `countAcceptedHires` counts only
`rpa_offers.candidate_decision = 'accepted'`, and `setFinalOutcome` calls `reopenMrfIfUnfilled` but
never `closeMrfIfFilled` — the coupling is one-directional. Such a journey will now stamp `joined_at`
and count as Hired **while its requisition stays open in the JD dropdown forever.**

This was already true; it was just nearly unreachable. It is filed as **Q34** and was explicitly left
out of scope, but it should be reconsidered now rather than at the next audit.
