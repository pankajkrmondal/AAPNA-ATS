# Phase 3 — Candidate Closure Graceful-Exit Audit

**Date:** 2026-08-26 · **Scope:** the candidate-closure path end to end — `setFinalOutcome`,
the MRF close/re-open coupling, the four scheduled jobs, the legacy write-back layers, and the
Phase 3 decision register
**Method:** static review of the closure path and everything it touches, cross-read against
`04-QUESTIONS.md`, `02-BUSINESS-DESIGN.md` and the changelog set. No code executed, no code changed.

**Question asked:** when a candidate is closed — and when an MRF fills as a result — does
everything downstream wind down gracefully? The MRF, the screened/shortlisted records, the other
candidates in that MRF's pipeline, the interviews and invites already in flight?

**Scope note:** audit-and-log only, by instruction. Nothing below is authorised for
implementation. Two findings collide with recorded RT decisions (Q10, Q13/Q25) and one is a
recorded RT commitment that was never built (§D) — those need RT before code, not just a ticket.

> **Update 2026-08-26 (later same day).** Every finding was re-verified against the code, a fix
> plan was approved, and **the whole of §5 has since been built** — items 1–4 + 7 first, then
> §2.5 / §2.6 / §2.7 once the product owner answered Q32–Q34. Read
> **[§6a](#6a-verification-pass-and-approved-fix-plan-2026-08-26-later-same-day)** before acting on
> anything below: it corrects two claims here and records five downstream consequences this audit
> did not model.
>
> **Nothing in §2 is outstanding.** See
> [CHANGES-2026-08-26-candidate-closure-graceful-exit.md](./changelog/CHANGES-2026-08-26-candidate-closure-graceful-exit.md)
> and [CHANGES-2026-08-26-closure-followon-mrf-lifecycle.md](./changelog/CHANGES-2026-08-26-closure-followon-mrf-lifecycle.md),
> with live status in [PHASE3-CLOSURE-FOLLOWON-PROGRESS.md](./PHASE3-CLOSURE-FOLLOWON-PROGRESS.md).
>
> 🚨 One premise in §6a proved **false**: `pipeline_status` *does* carry a CHECK constraint, so 5 of
> the 7 closure values were silently rejected until `2026-08-26-shortlist-status-vocabulary.sql`
> widened it. That also fixes a month-old `future_prospect` write failure this audit never saw.

---

## 1. Summary

| | Count |
|---|---|
| Critical | **2** |
| High | **2** |
| Medium | **3** |
| Stale documentation | **1** (4 documents) |
| Verified sound, leave alone | **12** |

**Verdict: not graceful end to end.** The requisition side is solid and unusually
well-defended. The candidate side leaks.

Closure was built as a **per-journey state write**, not as a **process that winds things down**.
The row is set correctly, race-safely, with a clean audit trail — and then everything that row
was driving keeps running: the calendar booking, the reminder cron, the occurrence queue, the
shortlist status, the other candidates on the requisition.

One gap blocks the process outright: **five of the eight closure outcomes cannot be reached from
the UI at all.**

---

## 2. Findings

### 2.1 Closure is unreachable except at the Offer stage — `PipelineDrawer.jsx`

**Severity: critical.** `setClosureOpen(true)` is called from exactly one place in the whole
drawer — `PipelineDrawer.jsx:2036`, inside `OfferActions`, which renders only under
`selectedStageKey === 'offer'` (`PipelineDrawer.jsx:2023`). Every other stage gets the generic
Approve/Reject/Hold bar (`PipelineDrawer.jsx:2040`) with no closure path.

This contradicts the spec on both sides:

- RT, Q12 closure definitions (`04-QUESTIONS.md:192`) — *"**Candidate Withdrawn** — candidate
  voluntarily exits at **any** stage before joining."*
- `seed-email-templates.js:1052` — *"a journey can be closed from ANY stage — a candidate
  withdrawing at Tech 2 never reaches the offer stage."*
- The backend already agrees: `setFinalOutcome` accepts any `current_stage_key`
  (`pipeline.service.js:930`).

A candidate who withdraws at Tech 2 therefore **cannot be closed**. The recruiter's only options
are to reject them at the stage — wrong outcome, wrong email, and it starts a 6-month Q11
cooling-off they did not earn — or leave the journey open forever.

The API and the templates are ready. Only the button is missing.

### 2.2 Closing a journey does not cancel its interviews or reminders — `pipeline.service.js`

**Severity: critical.** `04-QUESTIONS.md:306`, §D accepted-risk confirmations, records this as
settled:

> **Withdrawing a candidate auto-cancels** their pending calendar invites and scheduled reminders.

**It was never built.** `setFinalOutcome` closes document tokens (`pipeline.service.js:1019`),
freezes the vendor lock on `joined` (`:1002`), and re-opens the MRF on a vacating outcome
(`:1038`) — but never touches `rpa_interview_schedule` and never cancels the Graph/Teams event,
though `cancelInterviewRound()` already exists (`interviewSchedule.service.js:800`).

A withdrawn or rejected candidate keeps a live Teams booking and still receives the 30-minute
reminder mail.

### 2.3 Three background jobs act on closed journeys

**Severity: high.** `documentReminder.js` and `offerSweep.js` both carry a `final_outcome: null`
guard. Three others do not — the same class of bug, unfixed:

| Job / query | Line | Effect on a closed candidate |
|---|---|---|
| `interviewReminder.js` | `148` | still emails the 30-min reminder |
| `interviewOccurrence.js` | `188` | still chases "did this happen?" |
| `listUnresolvedInterviews()` | `interviewSchedule.service.js:320` | sits in the recruiter queue forever |
| `assessmentDeadlineChecker.js` | `57` | fires an overdue bell (internal only) |

The correct guard is already written twice in this codebase — `documentReminder.js:46` and
`offerSweep.js:128`. Note the test record already names the guard's purpose: DOC-11,
*"Journey closed underneath an open request | ✅ **not** chased — the specific case the
`final_outcome: null` guard exists for."* The other three jobs never got it.

### 2.4 The screened / shortlisted layer is never updated on closure — `pipeline.service.js`

**Severity: high.** This is the "screened candidates" half of the question, and it is simply
missing.

`setStageOutcome` writes **both** legacy layers — `rpa_cv.FinalStatus` *and*
`rpa_shortlisted_candidates.pipeline_status` via `shortlistStatusFor()`
(`pipeline.service.js:779-787`).

`setFinalOutcome` writes **only** `rpa_cv.FinalStatus` (`pipeline.service.js:984`). There is no
`pipeline_status` write, and `shortlistStatusFor()` (`config/pipelineStages.js:298`) only maps
`STAGE_OUTCOMES` — it has no case for any of the 8 `FINAL_OUTCOMES`.

A candidate closed as `joined` therefore still reads `pipeline_status = 'shortlisted'`. That
column feeds the dashboard shortlist tile (`dashboard.service.js:76`), the recruiter leaderboard
(`:201`), and the screening result badges (`screening.service.js:1447`).

**Related — `joined_at` is dead.** Declared at `schema.prisma:241`, required by
`03-DEVELOPMENT-PLAN.md:169` *"for reporting continuity"*, read by `dashboard.service.js:95` and
`frontend/src/utils/dashboardAggregations.js:227` — **written by no code path anywhere.** The
hire *count* survives on the `offer_accepted_at` fallback, so nothing looks broken; time-to-hire
silently measures to offer acceptance instead of to joining.

### 2.5 Stranded candidates — decided, but the decision is buried and half-built

**Severity: medium.** When an MRF fills, `closeMrfIfFilled` counts the still-running journeys
(`mrfClosure.service.js:158-168`) and interpolates the number into **one** in-app notification.
Nothing else happens: no per-candidate notification, no email, no bulk action. Their journeys
stay `final_outcome = NULL` indefinitely. The only other signal is a passive orange "Role filled"
badge (`Pipeline.jsx:177`).

**This is deliberate, and correct.** The reasoning is recorded in
`CHANGES-2026-08-07-candidate-pipeline-fixes.md` §14:

> Per explicit decision, nothing is auto-decided about a candidate mid-process. Auto-closing them
> would silently end real applications and fire rejection emails, and is hard to undo now that
> #13 makes requisitions re-openable.

It is consistent with Q10 (*"Manual only — no automated review reminder, no auto-close"*) and
Q13/Q25 (*"no automated conflict logic — RT decides manually"*). **The auto-close is not the
problem.** Two other things are:

1. **The decision is filed where nobody will find it.** One changelog section, no Q-number, no
   entry in `04-QUESTIONS.md` or `02-BUSINESS-DESIGN.md`, no record of who made it or whether RT
   was told. §13 of that same changelog explicitly said *"That needs a product decision"*; §14 is
   that decision, unlabelled.
2. **The manual action RT asked for was never built.** Q13/Q25, closed 2026-07-14: *"the system's
   only job is to provide a manual action to pause/stop the other journey's status."* `is_paused`
   exists in the schema (`schema.prisma:685`), is read onto every card
   (`pipeline.service.js:341`) and exported to CSV (`exports/pipeline.export.js:108`) — and
   **nothing anywhere writes it.** There is no pause/resume route or service.

The recruiter is told a role filled and given no lever to act on it.

### 2.6 No manual MRF closure, and no closure reason

**Severity: medium.** `mrf.routes.js` has no close endpoint; the MRF page renders its status
`Select` as `disabled` (`MRF.jsx:1022`). Fill state is written only by `mrfClosure.service.js`,
and only on offer acceptance.

A requisition **cancelled by the business** — budget pulled, role withdrawn, hired externally —
therefore has no representation at all. It stays open in the JD dropdown forever. There is also
no closure-reason column anywhere on `rpa_mrf` (`grep -E 'closure_reason|reason_for_closure'`
returns zero hits repo-wide), so even the automatic closure records only *when*, never *why*.

**Mirror gap: there is no journey re-open either.** `assertJourneyOpen` tells the user *"Reopen
it before you…"* (`pipeline.service.js:91`), but no route or service clears
`final_outcome`/`closed_at`. The error message names an action that does not exist.

### 2.7 `joined` does not close an MRF

**Severity: medium.** `countAcceptedHires` counts only `rpa_offers.candidate_decision =
'accepted'` (`mrfClosure.service.js:50`), and `setFinalOutcome` calls `reopenMrfIfUnfilled` but
never `closeMrfIfFilled` (`pipeline.service.js:1037`).

The coupling is one-directional: an outcome can *free* a seat but never *fill* one. A journey
closed as `joined` or `closure_approved` without an in-app accepted offer row leaves the
requisition open forever. Narrow — the normal path records the offer first — but it is the exact
path an offer handled offline would take, and the Offer round is now record-only (RT,
2026-08-25).

### 2.8 Documentation that will mislead the next reader

**Severity: low, but it is how the 2026-08-11 regression gets re-introduced.**

- `docs/changelog/CHANGES-phase3-mrf-closure-on-offer-accepted.md` documents the superseded
  `approval_status='closed'` + `mrfstatus='closed'` mechanism as current, including its
  verification steps, and says *"Reopening is therefore a manual DB update today."* All of that
  was ripped out on 2026-08-11. **No superseded notice.**
- `02-BUSINESS-DESIGN.md` §2.7 and §3 promise *"each [closure status] triggers its
  communication."* False for 5 of 8 — `SILENT_FINAL_OUTCOMES`
  (`stageNotification.service.js:87`) short-circuits `joined`, `joined_and_left`, `backed_out`,
  `did_not_join`, `candidate_withdrawn`. The code's reasoning is sound; the doc was never
  corrected.
- `PipelineDrawer.jsx:2752-2760` shows recruiters *"A closure email is sent only if a template is
  mapped to the status you pick."* Wrong in both directions now — three outcomes always send via
  `GENERIC_FALLBACK_BY_OUTCOME`, five never send however they are mapped.
- `PHASE3-COVERAGE-AUDIT.md` §2.3 *"Built but inert — Closure emails never send"* is superseded
  by the template seeding and was never updated.

---

## 3. What is genuinely in place

Recorded because the requisition side is well-built and defensively written, and must not be
disturbed while §2 is fixed.

| Concern | Where |
|---|---|
| MRF auto-closes when all openings filled | `mrfClosure.service.js:90` |
| MRF re-opens when a hire vacates | `mrfClosure.service.js:218` |
| Both vacating doors wired (offer amend + journey closure) | `offer.service.js:362`, `pipeline.service.js:1038` |
| Race-safe close — conditional `updateMany` claim | `mrfClosure.service.js:112` |
| Race-safe journey closure — claim inside `$transaction` | `pipeline.service.js:959` |
| Fill state isolated in `filled_at`, never clobbers `approval_status` | `config/pipelineStages.js:200` |
| Closed journey blocks every further action | `pipeline.service.js:88` |
| Three-valued-logic bug in the vacancy count fixed (PIPE/OFFER-08) | `mrfClosure.service.js:70` |
| Document upload token closed on closure | `pipeline.service.js:1019` |
| Vendor lock frozen on a real hire (M6 audit) | `pipeline.service.js:1002` |
| Closed cards leave the board by default | `pipeline.service.js:170` |
| 90-day post-joining auto-close; recruiter's verdict wins | `offerSweep.js:121` |

**The atomicity model is deliberate and should stay.** A narrow `$transaction` covers only the
`final_outcome` claim and its audit event (`pipeline.service.js:955-980`); everything after it is
a best-effort tail where each step is individually try/caught, so nothing post-commit can roll
the closure back. `closeMrfIfFilled`/`reopenMrfIfUnfilled` use no transaction at all and never
throw — *"an offer acceptance must be recorded even if closing the requisition fails."*

---

## 4. The through-line

Two independent chains of evidence say the same thing:

- `documentReminder.js` and `offerSweep.js` got the `final_outcome: null` guard because someone
  hit the bug there. The three jobs nobody hit still lack it.
- `setStageOutcome` writes both legacy layers. `setFinalOutcome` — written later, for the
  terminal case — writes only one.

The closure feature was built as the terminal write on one row, and the surrounding machinery
was never enumerated. §2.5 is the one place where the gap is a *decision* rather than an
oversight, and the decision is defensible; its real defect is bookkeeping.

---

## 5. Suggested sequencing

Ordered by harm per unit of effort. **Nothing here is authorised** — this pass was audit only.

| # | Item | Note |
|---|---|---|
| 1 | **§2.1** — surface the closure action at every stage | Backend + templates already support it; a render-condition change. Highest harm, smallest fix. |
| 2 | **§2.3** — add `final_outcome: null` to the three job queries | Copy the guard from `documentReminder.js:46`. Mechanical. |
| 3 | **§2.2** — call `cancelInterviewRound()` from `setFinalOutcome` | Guarded best-effort, like the document-token close beside it. Delivers the §D commitment. |
| 4 | **§2.4** — extend `shortlistStatusFor()` to the 8 `FINAL_OUTCOMES`; write `pipeline_status` + `joined_at` | |
| 5 | **§2.5** — file the §14 decision as a numbered Q, then build the Q13/Q25 pause/stop action | ⚠️ **Needs RT confirmation before code.** |
| 6 | **§2.6 / §2.7** — manual MRF close + closure reason, journey re-open, `joined`→fill coupling | ⚠️ **Product decisions, not bug fixes.** |
| 7 | **§2.8** — stamp the stale docs | Cheap; prevents the next reader re-introducing the 2026-08-11 regression. |

Per house rule, anything removed in that pass is commented out with a dated reason rather than
deleted.

---

## 6. Verification, when the fixes are made

- `backend/src/tests/mrfClosure.test.js` and `integration/sweepJobs.test.js` already cover the
  requisition side. The sweeps are pure DB polling, so backdating the timestamps they select on
  exercises the new guards without touching cron.
- `integration/crossModuleE2E.test.js:162` already asserts one-opening auto-close — extend it to
  assert the interview row is cancelled and `pipeline_status` has moved.
- **No existing test covers closure from a non-Offer stage.** That is the §2.1 regression test,
  and it does not exist yet.

---

## 6a. Verification pass and approved fix plan (2026-08-26, later same day)

Every finding above was re-checked against the current code before any fix was authorised. **The
audit holds** — a few line references drift by ~40 lines (notably §2.8's `PipelineDrawer.jsx`
citation: the closure-modal Alert is at `:2794-2798`, not `:2752-2760`). Corrections and
additions:

**Two claims above are wrong and should not be acted on as written:**

- **§2.4 "`joined_at` declared at `schema.prisma:241`"** — correct, but note it is on
  `rpa_shortlisted_candidates`, **not** on `rpa_candidate_pipeline`. The journey model has no
  such column. The write belongs beside `offer.service.js:213-222` (`offer_sent_at`) and
  `:300-310` (`offer_accepted_at`), which are the two siblings that *are* written.
- **§2.8's implied drawer behaviour** — the Schedule / Cancel / Mark-Held buttons are in fact
  already suppressed on a closed journey, via the `outcomeEvent` check the closure event
  satisfies. The genuine leaks are different: `showInviteButton = isCurrent` at
  `PipelineDrawer.jsx:544` and `:549` has **no `!outcomeEvent` guard** (the Evalground Re-invite
  button survives closure *and* an ordinary reject), and the `TeamsDetails` card at `:1817` is
  gated only on `teams_join_url && !occurrence_status`.

**Five downstream consequences this audit did not model.** Each one makes a fix larger than §5
implies, and the first two are regressions the fix itself would introduce:

1. **Extending `shortlistStatusFor()` breaks the Analytics status strip.** Three places bucket
   `pipeline_status` with no final `else`, so any new value lands in `Total` and in no column:
   `screening.service.js:2424-2430`, `exports/screening.export.js:193-200`,
   `frontend/src/pages/Analytics.jsx:777-812`. This is the exact defect fixed for
   `future_prospect` on 2026-08-26, and the comment at `screening.service.js:2421-2423`
   explicitly instructs keeping all three **in lockstep**. A `closed` bucket must land in the
   same commit.
2. **It also deletes recruiter credit at the moment of success.** `dashboard.service.js:201` is
   `groupBy(shortlisted_by) where pipeline_status: 'shortlisted'` — once a hire writes a terminal
   value, the recruiter's leaderboard score drops. The inline comment already says the intent is
   "exclude reject stamps"; an equality test was the wrong instrument. Use `{ not: 'rejected' }`.
3. **`notifyVendor` is a live import in `interviewSchedule.service.js:29`.** Adding a destructured
   param of that name to `cancelInterviewRound` silently shadows it and the call at `:923`
   recurses into a boolean. Name any such param `notifyVendorStatus`.
4. **`scheduleInterviewRound` has no closure guard.** Its checks are stage-support,
   journey-exists, current-stage and one-live-booking — nothing about `final_outcome`. A stale tab
   can book a fresh interview on a closed journey *after* any cancel sweep has run.
5. **`cancelInterviewRound` is not idempotent** — it throws 400 on an already-cancelled row
   (`:837-839`) — and its `:837` read / `:843` write straddle an `await`, so two racers both pass
   and both email the panel. Any bulk caller must tolerate the 400, and the write should become a
   conditional `updateMany` claim.

**Decisions taken (product owner, 2026-08-26), so the fix does not need re-litigating:**

| Decision | Choice |
|---|---|
| Scope | §5 items **1–4 + 7**. §2.5 / §2.6 / §2.7 stay out of code — filed as Q32 / Q33 / Q34 in `phase3/04-QUESTIONS.md`. |
| §2.4 `pipeline_status` map | **Add distinct closure values.** ~~no DDL — the column is plain `VARCHAR(50)` with **no CHECK constraint** (`backend/prisma/ddl/2026-07-21-pipeline-stage-engine.README.md:39`).~~ 🚨 **The no-CHECK premise was FALSE — corrected 2026-08-26.** `rpa_shortlisted_candidates_pipeline_status_check` exists and rejected 5 of the 7 values, silently, because the write is a best-effort `try/catch`. DDL WAS needed: `2026-08-26-shortlist-status-vocabulary.sql`. The distinct-values decision itself stands. `joined`/`closure_approved` → `'hired'`; `closure_rejected` → `'rejected'`; `closure_on_hold` → `'on_hold'`; `candidate_withdrawn` → `'withdrawn'`; `backed_out` → `'backed_out'`; `did_not_join` → `'did_not_join'`; `joined_and_left` → `'joined_and_left'`. **The distinct values are the point:** only `closure_rejected` may write `'rejected'`, because that column drives the 6-month Q11 cooling-off (`screening.service.js:1256`) — a withdrawal must not trip a cooling-off it did not earn. |
| §2.4 `joined_at` | Stamp for `joined` **only**, using `closed_at` so the two reconcile. Not `closure_approved` (a verdict on the record, not evidence anyone started) and not `joined_and_left` (they joined, but "now" is the *leave* date, and there is no leave column). `dashboardAggregations.js:227` prefers `joined_at` over `offer_accepted_at`, so a fabricated date corrupts the one metric that reads it first. |
| §2.2 cancellation email | **Panel always, candidate never.** The Graph/Teams event is always cancelled. Rationale: 5 of the 8 outcomes are in `SILENT_FINAL_OUTCOMES` precisely because there is nothing to tell someone who withdrew — but the panel must not show up to a room. |
| §2.1 outcome picker | **All 8 at every stage, unfiltered** — matches the backend, which accepts any outcome at any stage, and matches Q10/Q13's "manual only, no system logic" posture. |

**Expected metric movements — these are the fix, not new bugs.** The shortlisted KPI
(`dashboard.service.js:76`) **falls**, because closed candidates dropping out of `'shortlisted'`
is precisely what §2.4 is correcting. The Hired count (`:97`) **rises**. And `closure_rejected`
arms the 6-month Q11 cooling-off from the closure path for the first time — those candidates
leave JD and Keyword search for six months. RT will feel that one.

**Ordering, when the work is picked up:** docs → `shortlistStatusFor()` + its unit test → the
`setFinalOutcome` tail write **plus the reader fixes in the same commit** → job guards →
interview cancellation → frontend last, because surfacing closure at every stage is what makes
every backend fix above reachable.

> ⚠️ **Surfacing closure at every stage (§2.1) promotes §2.7 from theoretical to routine.** A
> journey closed as `joined` without an in-app accepted offer row never fills its MRF. Today that
> path is nearly unreachable; afterwards it is one click from Tech 1 — and it will stamp
> `joined_at` and count as Hired while the requisition stays open in the JD dropdown forever.
> §2.7 must be reconsidered at that point even though it is out of scope now.

**Status: ~~logged only — no code changed~~ → BUILT, 2026-08-26.** The documentation half landed
first: the four stale documents in §2.8 are stamped, §2.5's orphaned decision is filed as **Q32**
with the three RT questions as **Q32-confirmation / Q33 / Q34** in `phase3/04-QUESTIONS.md`, and the
§D accepted-risk bullet at `04-QUESTIONS.md:306` is marked **NOT BUILT**.

**§5 items 1–4 + 7 are now implemented** — see
[CHANGES-2026-08-26-candidate-closure-graceful-exit.md](./changelog/CHANGES-2026-08-26-candidate-closure-graceful-exit.md).
Every decision in the table above was followed as written. The two regressions predicted in this
section (the status strip, the recruiter leaderboard) and the two hardening items (items 4 and 5)
landed in the same change set; the strip readers now end in a **catch-all** branch, so the "no final
`else`" defect cannot recur. The in-app copy at `PipelineDrawer.jsx:2797` is corrected and now states
the email outcome **per status**. One item beyond the letter of §5 was also fixed: the Evalground
Re-invite button, which §6a identified above as a genuine drawer leak, was the only action missing
the `!outcomeEvent` guard and could send an invite to a closed candidate.

**~~Still outstanding: §2.5 / §2.6 / §2.7 (Q32 / Q33 / Q34)~~ → RESOLVED, 2026-08-26, later same
day.** The product owner answered all three (§7 below) and they were built the same day as W1–W4 —
see [CHANGES-2026-08-26-closure-followon-mrf-lifecycle.md](./changelog/CHANGES-2026-08-26-closure-followon-mrf-lifecycle.md).
The ⚠️ about §2.7 being promoted from theoretical to routine is what W1 fixed:
`countAcceptedHires` → `countFilledSeats` now counts a hire-closure with no offer row, and dedupes
so an offer *and* a `joined` closure on the same journey never double-counts.

**~~The integration tests, which are written (E2E-06) but not run~~ → RUN, 2026-08-26.** The three
changed files were executed individually against staging (never via the `**` glob, which recurses
into `integration/`): `pipelineClosure.test.js` **21/21**, `sweepJobs.test.js` **10/10**,
`crossModuleE2E.test.js` **7/7** (including the extended E2E-01 and new E2E-06). The unit suite
stayed at 207/207 throughout.

**One provenance gap this audit and §6a both missed.** §6a's regression #2 caught
`dashboard.service.js:201`'s leaderboard `groupBy` equality-testing `pipeline_status`, but the
identical instrument error also sat in the two "Shortlisted by" vector-search `LATERAL` joins at
`screening.service.js:870` and `:1331` (§2.4's own text names the third site, the Prisma batch
lookup at `:1447`, but not these two). All three matched `= 'shortlisted'`, so a closed candidate's
sourcing attribution — the credit for who found the hire — vanished the moment §2.4 started writing
terminal values. Found independently during the follow-on work and fixed the same way: `<> 'rejected'`.
Verified with 20 targeted assertions across all three sites and all four outcome buckets.

---

## 7. Open questions for RT

*(All three were filed in `phase3/04-QUESTIONS.md` on 2026-08-26 — see §6a. All three were answered
by the product owner and built the same day.)*

1. ~~**The §14 stranded-candidate decision needs a Q-number**~~ — **filed as Q32**, then
   **✅ CONFIRMED** by the product owner: the shipped behaviour stands exactly as-is — manual only,
   the "Role filled" tag plus one aggregate notification is a sufficient signal, a recruiter decides
   each stranded candidate individually. No code follows. Recorded in D1; the Q32-confirmation item
   is closed out of D2.
2. ~~**Q13/Q25 pause/stop action**~~ — **filed as Q33**, **✅ ANSWERED "yes" and BUILT.** `is_paused`
   is finally written (`setJourneyPaused()`, `POST /api/pipeline/:id/pause`), and — the detail that
   makes the flag meaningful rather than cosmetic — a paused journey now drops out of all four
   automated sweeps.
3. ~~**Manual MRF closure (§2.6)**~~ — **filed as Q34**, **✅ ANSWERED "yes — action + reason" and
   BUILT.** New `rpa_mrf.closed_at` / `closure_reason` / `closure_note`, `POST /api/mrf/:id/close`
   and `/reopen`, never touching `approval_status` or `mrfstatus`. The missing journey **re-open**
   was folded into the same question and built alongside — `reopenJourney()`,
   `POST /api/pipeline/:id/reopen` — so `assertJourneyOpen`'s *"Reopen it before you…"* finally
   names an action that exists.
