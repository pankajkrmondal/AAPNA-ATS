# Changelog

Reverse-chronological log of changes. One entry per change set, listing files touched and the what/why.
Feature-level detail lives in [docs/reference/screening.md](./reference/screening.md).

---

## 2026-08-27 — Pipeline drawer: the conversation reply box gets a real rich-text editor
**Why:** direct feedback on the Conversation panel shipped earlier the same day — the reply box was
plain single-line text, unlike every other email-composing surface in the app. Full write-up:
[CHANGES-2026-08-27-conversation-reply-rich-text.md](./changelog/CHANGES-2026-08-27-conversation-reply-rich-text.md).

- Swapped the plain `<Input>` for `EmailEditorTabs` (the same rich-text editor used everywhere
  else), called bare/no-wrapper so a reply doesn't inherit the branded email shell — mirrors
  `DecisionEmailModal.jsx`'s existing no-wrapper usage. No new dependency, no backend change.
- Along the way, found and fixed two latent bugs in how the shared editor behaves on a genuinely
  empty body (a case none of its other callers ever hit): a literal "Empty." placeholder leaking
  into the reply, and the editor not visually clearing after a successful send (it's
  "uncontrolled after mount"). Both fixed at this call site only.
- `npx vite build` clean; manually verified in-browser (toolbar, bold formatting, empty/disabled
  state, no Enter-to-send). No message was sent against real data during verification.

## 2026-08-27 — Candidate Pipeline gap closeout: rejected filter, real conversations, my candidates
**Why:** the Recruitment Team FAQ/gap doc's real remaining gaps (G2 remainder, G4, G6), after
verifying against the live code that the doc's G1/G3/G2-core claims were already stale — those
three shipped same-day on 2026-08-26 in a session the doc never saw. Full write-up:
[CHANGES-2026-08-27-pipeline-gap-closeout.md](./changelog/CHANGES-2026-08-27-pipeline-gap-closeout.md).

- **G2 remainder** — a "Rejected only" board filter, a "Show closed (N)" count, and a
  reject-and-close checkbox in the outcome modal (two sequential API calls, not a combined one).
- **G4** — a real Outlook "Conversation" tab in the pipeline drawer, alongside the existing
  synthetic "Emails in this round" log. Reuses `screeningService.getOutlookConversations()`
  (now accepting multiple addresses, matched via `emailMatchesSql()`) rather than forking a query.
  Reply reuses the existing `/screening/outlook/reply` endpoint, which had a frontend wrapper but
  was wired to no UI anywhere until now.
- **G6** — a "my candidates" board filter, resolved server-side to the caller's own username. A
  staging data-quality check first (only 36% of `shortlisted_by` values match a current username,
  the rest are stale test data) — decided a plain string filter needs no new column or backfill.
- **No schema change.** Targeted unit tests green (63+ across `emailMatchSql`, `shortlistStatus`,
  `mrfClosure`, `pipelineAnalytics`, `csvExport`, `analyticsParams`); `vite build` clean after each
  item. **G5 (click reduction) logged, not started this session.**

## 2026-08-26 — Closure follow-on: the requisition lifecycle closes both ways
**Why:** the closure audit's remaining findings (§2.5–§2.7), built once the product owner answered
**Q32–Q34**. Full write-up:
[CHANGES-2026-08-26-closure-followon-mrf-lifecycle.md](./changelog/CHANGES-2026-08-26-closure-followon-mrf-lifecycle.md).

- **Two manual DDL files, both applied to staging and verified.**
- **§2.7 — the MRF coupling ran one way.** An outcome could FREE a requisition seat but never FILL
  one, so a journey closed as `joined` without an in-app accepted offer counted as Hired while its
  requisition **stayed open in the JD dropdown forever**. Wiring `closeMrfIfFilled` in was not
  enough: the seat count only counted `rpa_offers` rows, so it would have counted 0 in exactly that
  case. `countAcceptedHires` → **`countFilledSeats`**, now counting **journeys, not offer rows** —
  the normal path carries both an accepted offer and a `joined` closure on one journey, and counting
  the two separately would have **filled a 2-opening requisition on a single hire**.
- **§2.6 — journeys can be re-opened.** `assertJourneyOpen` has said *"Reopen it before you…"* since
  Module 1, naming an action that did not exist. `reopenJourney()` also undoes what closure's tail
  wrote — `pipeline_status`, `joined_at` — and recounts the requisition seat, otherwise a live
  journey would read `hired` with a `joined_at` for someone who never joined.
- **Q33 — the pause lever RT asked for on 2026-07-14.** `is_paused` was read onto every card and
  exported to CSV, and **nothing wrote it**. A paused journey now also drops out of all four sweeps;
  without that the flag would be decorative.
- **Q34 — manual requisition closure with a reason.** A business-cancelled requisition had no
  representation at all. New `closed_at` / `closure_reason` / `closure_note`, a widened
  `idx_rpa_mrf_open`, `isMrfClosed()`, and `AND closed_at IS NULL` in `getApprovedRoles()` — the line
  that actually removes the role from the JD dropdown. **Never writes `approval_status` or
  `mrfstatus`**; that lossy bug was removed on 2026-08-11 and stays removed.
- 🚨 **A documented premise proved false.** `2026-07-21-pipeline-stage-engine.README.md` states in
  bold that `pipeline_status` has **no CHECK constraint**. It does. Because every writer of that
  column is a best-effort `try/catch`, the rejections were **silent**: `future_prospect` has been
  refused since 2026-07-21 (staging has **zero** such rows), and 5 of the 7 closure statuses from
  earlier the same day were refused too — meaning §2.4 could not move a candidate off
  `'shortlisted'`, **the exact defect it set out to fix**. Its unit tests covered the pure mapping
  function and never touched the database. Fixed by
  `2026-08-26-shortlist-status-vocabulary.sql`; both source documents stamped.
- Verified by targeted staging smoke tests that create rows directly and **send no mail**: seat
  counting (5 cases incl. the dedup), re-open (flag + both legacy layers + MRF seat), pause (sweep
  guard both ways), and the full manual close/re-open loop. **207 unit tests still pass.**
- **Integration suite run 2026-08-26** — the three changed files, individually:
  `pipelineClosure` **21 pass**, `sweepJobs` **10 pass**, `crossModuleE2E` **7 pass**, 0 fail.
  The first run surfaced four failures, **all in the tests, none in the product**.
- **Q32 confirmed** (stranded candidates stand as shipped, manual only); Q33/Q34 and the §D
  accepted-risk bullet refreshed in `04-QUESTIONS.md`. **Backfill applied to STAGING only** (2 rows,
  idempotent); production deliberately untouched.

## 2026-08-26 — Candidate closure: winding the journey down, not just stamping it
**Why:** the closure audit's code half, executed under the decisions in its **§6a**. Closure was
built as a per-journey state write, not as a process that winds things down — the row was set
correctly, race-safely, with a clean audit trail, and then everything that row was driving kept
running. And one gap blocked the process outright: **five of the eight closure outcomes could not be
reached from the UI at all**, because `setClosureOpen(true)` was called from exactly one place in the
drawer — inside `OfferActions`. A candidate who withdrew at Tech 2 could not be closed; the
recruiter's only options were to reject them (wrong outcome, wrong email, and a 6-month Q11
cooling-off they did not earn) or leave the journey open forever. Full write-up:
[CHANGES-2026-08-26-candidate-closure-graceful-exit.md](./changelog/CHANGES-2026-08-26-candidate-closure-graceful-exit.md).

- **No schema change, no migration, no backfill** — `pipeline_status` is plain `VARCHAR(50)` with no
  CHECK constraint and `joined_at` was already declared. The fix writes columns that existed and were
  never populated; rows closed before today are left as they are.
- **Scope: audit §5 items 1–4 + 7.** §2.5 / §2.6 / §2.7 stay out of code as **Q32 / Q33 / Q34**.
- `frontend/src/components/pipeline/PipelineDrawer.jsx` — **§2.1:** a *Close this candidate's record*
  action now renders at **every** stage, all 8 outcomes unfiltered, matching a backend that has always
  accepted any `current_stage_key`. Also: the closure modal's email warning was wrong **in both
  directions** (three outcomes always send via `GENERIC_FALLBACK_BY_OUTCOME`, five never send however
  they are mapped) and now states the answer per outcome as the recruiter picks; and the Evalground
  **Re-invite button was the one action missing the `!outcomeEvent` guard**, so it survived both a
  reject and a closure.
- `backend/src/services/pipeline.service.js`, `services/interviewSchedule.service.js` — **§2.2:**
  closure cancels every **not-yet-started** booking, delivering the §D commitment that was recorded as
  settled and never built. **Panel always, candidate never**: nobody should sit waiting in a room, but
  five outcomes are deliberately silent and a cancellation notice would smuggle the news back in.
- `backend/src/jobs/interviewReminder.js`, `jobs/interviewOccurrence.js`,
  `jobs/assessmentDeadlineChecker.js`, `services/interviewSchedule.service.js` — **§2.3:** the
  `final_outcome: null` guard `documentReminder.js` and `offerSweep.js` already carried, added to the
  four queries that never got it.
- `backend/src/config/pipelineStages.js`, `services/pipeline.service.js` — **§2.4:**
  `shortlistStatusFor()` maps the 8 closure outcomes to **distinct** values, and the closure tail
  writes `pipeline_status` plus **`joined_at` (for `joined` only, taken from `closed_at`)** — a column
  declared, read by the dashboard, required "for reporting continuity", and **written by nothing**.
  Only `closure_rejected` may write `'rejected'`, because that value drives the Q11 cooling-off.
- `backend/src/services/screening.service.js`, `exports/screening.export.js`,
  `frontend/src/pages/Analytics.jsx`, `services/dashboard.service.js` — **the two regressions the fix
  would otherwise have introduced.** The status strip would have stopped adding up again (all three
  readers now end in a catch-all `closed` branch, so the sum holds *by construction*), and the
  recruiter leaderboard **deducted credit at the moment of success** — a hire dropped the recruiter's
  score, because `=== 'shortlisted'` was the wrong instrument for "exclude reject stamps". Now
  `{ not: 'rejected' }`.
- `backend/src/services/interviewSchedule.service.js` — hardening §6a caught: `scheduleInterviewRound`
  had **no closure guard** (a stale tab could book a fresh interview on a closed journey *after* the
  cancel sweep ran), and `cancelInterviewRound`'s read/write straddled an `await`, so two racers both
  passed and **both emailed the panel**. Now a conditional `updateMany` claim.
- `backend/src/tests/shortlistStatus.test.js` (**new**, 9 tests), `tests/integration/crossModuleE2E.test.js`
  (E2E-01 extended, **E2E-06 added** — closure from a non-Offer stage, which no test covered before;
  that absence is how §2.1 survived). **203 unit tests pass.** The integration tests are written but
  **not run**: they hit shared staging and send real mail.
- **Expected metric movements, which are the fix and not new bugs:** the Shortlisted KPI **falls**,
  the Hired count **rises**, time-to-hire starts measuring to joining rather than offer acceptance,
  and **`closure_rejected` arms the 6-month cooling-off from the closure path for the first time** —
  those candidates leave JD and Keyword search for six months. RT will feel that one.

## 2026-08-26 — Candidate closure audit: decision register brought up to date (**docs only**)
**Why:** the closure audit ([PHASE3-CLOSURE-AUDIT-2026-08-26.md](./PHASE3-CLOSURE-AUDIT-2026-08-26.md))
found that closure was built as a per-journey state write, not as a process that winds things down —
and that four documents would actively mislead the next reader into re-introducing the 2026-08-11
regression. Every finding was re-verified against the code and a fix plan approved; **only the
documentation half was executed.** The code fixes (audit §5 items 1–4) remain outstanding.

- **No code changed. No schema change.**
- `docs/PHASE3-CLOSURE-AUDIT-2026-08-26.md` — new **§6a** records the verification pass: it corrects
  two claims in the audit (`joined_at` is on `rpa_shortlisted_candidates`, not the journey model; the
  drawer's real closed-journey leaks are the Evalground Re-invite button and the Teams card, not the
  Schedule/Cancel buttons), documents **five downstream consequences the audit did not model**, and
  fixes the four decisions the work needs — so it does not have to be re-litigated when picked up.
- `docs/phase3/04-QUESTIONS.md` — the stranded-candidate decision, which existed only as an
  unnumbered changelog section since 2026-08-07, is filed as **Q32** with its answer-sheet row. The
  three questions RT still owes are filed as **Q32-confirmation / Q33 / Q34** (§D2). The §D
  accepted-risk bullet *"Withdrawing a candidate auto-cancels their pending calendar invites and
  scheduled reminders"* is marked **🚨 NOT BUILT** — it was recorded as settled and never
  implemented, and is an unmet commitment to RT.
- `docs/phase3/02-BUSINESS-DESIGN.md` — §2 rule 7 and the §3 Closure row promised *"each [closure
  status] triggers its communication."* False for 5 of 8: `SILENT_FINAL_OUTCOMES` blocks them inside
  `resolveTemplate()` *before* any lookup, so an admin mapping cannot re-enable them. Also records
  that the UI reaches closure from the Offer stage only, contradicting Q12's *"at any stage."*
- `docs/phase3/PHASE3-COVERAGE-AUDIT.md` — §2.3 *"Closure emails never send"* stamped superseded
  (Pattern B, scoped separately from the notice already covering that section's other three items).
- `docs/changelog/CHANGES-phase3-mrf-closure-on-offer-accepted.md` — stamped superseded-in-part
  (Pattern A): fill state is `filled_at`, not `approval_status`; *"reopening is a manual DB update"*
  is false; its verification steps check the wrong columns.

## 2026-08-26 — Recruitment Analytics: four metrics that were silently wrong
**Why:** the reported defect was that the **Zeko Passed** tile reads `0` while Zeko Sent reads `10`.
It is not a display bug — the tile counted `rpa_zeko_candidate_pipeline.status = 'passed'`, and
**nothing in this repo has ever written that value**. The four writers of that column produce only
`pending` / `sent` / `completed` / `cancelled`; when a score syncs back, `zeko.service.js:917` marks
the row `completed`. **There is no passing threshold anywhere in the system**, so the tile was
structurally zero from the day it shipped while its tooltip described a score comparison that does
not exist. Auditing the page for the same failure mode — *a metric filtered on a state the write path
never produces, or aggregated in a way that silently drops rows* — found three more. Full write-up:
[CHANGES-2026-08-26-recruitment-analytics-metric-fixes.md](./changelog/CHANGES-2026-08-26-recruitment-analytics-metric-fixes.md).

- **No schema change, no migration, no backfill** — every fix is a read-side correction.
- `frontend/src/pages/Analytics.jsx`, `frontend/src/constants/metricDefinitions.js` — the tile is
  now **Zeko Score Received**, reading `tiles.zeko_completed`: the thing the system can actually
  justify, being candidates whose result has come back. Icon changed from a check mark to a document,
  because a check mark asserts a verdict the ATS never reaches, and the tooltip now says outright
  that this is **not** a pass count. The three unreachable status aliases stay in the SQL under a
  comment recording the real four-value vocabulary, so a future writer would be counted rather than
  silently dropped.
- `backend/src/services/screening.service.js`, `frontend/src/pages/Analytics.jsx`,
  `backend/src/exports/screening.export.js` — **`future_prospect` fell out of every total.** It is
  one of the four `CORE_OUTCOME_KEYS`, offered in the pipeline drawer, and `shortlistStatusFor()`
  writes it to `pipeline_status` — but all three readers bucketed shortlisted/rejected/on-hold with
  no final `else`, so such a candidate counted toward `Total` and nothing else. The strip adds up
  today (79+21+2=102) **only because nobody has used the outcome yet**; the first one breaks the
  arithmetic silently, on a strip whose own Total tooltip promises the parts account for the whole.
  Fixed in all three, plus a Future Prospect column on the Role Summary table and CSV.
- `backend/src/services/pipelineAnalytics.helpers.js` (new `timeToHireFor()`),
  `backend/src/services/pipeline.service.js` — **time-to-hire summed averages taken over different
  populations.** The headline was `sum(per-stage averages)` published as "Average days, shortlist to
  offer", but each stage is averaged over a different set of journeys — someone rejected at Tech-1
  sits in Tech-1's average and no other — so the total described a duration **no candidate has ever
  experienced**. It is now the **median** end-to-end duration of journeys that closed as a hire.
  Median because hiring sets are small and long-tailed. **`median_days` is `null`, never `0`**, when
  nothing has been hired (the old panel rendered a confident "0 days" while the bars beneath it
  correctly said "No closed journeys yet"), and **sample size is now published** beside the headline
  and on every stage row. The computation moved into the helpers module because importing
  `pipeline.service.js` opens Redis and hangs `node --test` — it was previously untestable.
- `backend/src/services/screening.service.js` — **the Zeko tiles counted invitations while the four
  tiles beside them counted candidates.** The table is unique on `(candidate_id, zeko_job_id, stage)`
  and both Zeko rounds reuse the same job, so a candidate who sits both had two rows. Now
  `COUNT(DISTINCT candidate_id)`. ⚠ **Zeko Sent will fall** for anyone who has run both rounds.
- `backend/src/services/pipeline.service.js` — **the funnel counted stages that were skipped.** The
  test was `current_stage.sort_order >= this stage's`, but a bypassed optional stage gets no event at
  all (`setStageOutcome()` logs the `'skip'` against the stage the candidate *lands in*, `:762`), so
  a stage nobody entered scored as though everyone had. An actual arrival event is now the primary
  test; the `sort_order` rule survives only as a fallback for rows predating the event log, since
  dropping it outright would swap an over-count for an under-count.
- `frontend/src/theme/index.css` — the rename exposed a latent bug in the shared `KpiCard`:
  `.kpi-card__label` had `white-space: nowrap` against the card's `overflow: hidden`, so a label
  too long for its column was **silently truncated**. "Zeko Score Received" rendered as *"ZEKO
  SCORE RECEIV"* at 1280px and took the info-tooltip icon off the card with it, since the icon
  sits inside that span. The label now wraps, with `min-height` reserving both lines on every KPI
  card so one wrapped tile cannot leave the strip ragged (these sit in a top-aligned Ant `Row`).
  Shared component — every KPI card in the app gains ~10px of height, uniformly.
- **Tests:** `pipelineAnalytics.test.js` had **no** time-to-hire coverage. Seven cases added —
  null-not-zero on an empty set, the outlier case that justifies a median, hired-only membership,
  and that a stage taking minutes reports `0d` rather than being dropped by the old `avg_days > 0`
  filter. **23 pass, 0 fail** (16 pre-existing + 7 new).
- ⚠ **Published numbers move**, all of them away from a wrong figure: Zeko Score Received rises off
  zero, Zeko Sent falls, the time-to-hire headline changes statistic and population, and the funnel
  falls for any MRF with a skipped optional stage. The write-up carries the full table.

---

## 2026-08-25 — Client Round and Offer trimmed to "mark only" (+ a Q14 defect fix)
**Why:** RT's instruction is that both modules happen entirely offline and the app is used to mark
the rounds, nothing more. Auditing both stages against that found seven things the app still did
beyond marking — and one outright contradiction of Q14: **marking a Client Interview "held" emailed
a no-login scorecard link to whatever address was typed as the interviewer**, on a round where that
field was *required* and the obvious value to type is the client's own contact. `dispatchScorecards()`
had no client-stage exclusion, unlike `interviewReminder.js`, which has gated on the same switch
since M3. Full write-up:
[CHANGES-2026-08-25-client-round-and-offer-mark-only.md](./changelog/CHANGES-2026-08-25-client-round-and-offer-mark-only.md).

- **Nothing is deleted — every removal is commented out with a dated reason.** Both halves reverse
  decisions RT gave in writing, and this area has already seen one reversal (Client Interview
  shipped with automated Teams invites in M3, then rolled back days later). The
  `rpa_offers.approval_*` columns and existing `client` bookings are left in place and simply stop
  being written, so a restore needs no DDL. **No schema change.**
- `backend/src/services/interviewSchedule.service.js` — the `client` entry in `SCHEDULABLE_STAGES`
  is commented out, which alone removes the booking modal, Schedule/Reschedule/Cancel, the
  held/no-show controls, the Teams card and the double-booking refusal, since all were keyed off
  it. **`stageSendsInvites()` was rewritten to read a dedicated `MANUALLY_COORDINATED_STAGES` list
  rather than that entry** — the old `SCHEDULABLE_STAGES[k]?.autoInvite !== false` would have
  returned `undefined !== false` → **`true`** once the entry was commented out, silently
  re-enabling outward mail on the one round that must never send any. Also fixes the MRF hint,
  which pointed at the Yes/No `client_round` column and rendered "Interviewer: **Yes**"; it now
  reads `client_round_coordinator`.
- `backend/src/services/interviewScorecard.service.js` — `dispatchScorecards()` returns early for a
  manually-coordinated round. This is the actual defect fix, and it holds for historical bookings too.
- `backend/src/jobs/interviewOccurrence.js` — the sweep skips these rounds in both places it touches
  a row: the per-row loop (no confirmation nudges) and the write-off `updateMany` (no stamping
  `unconfirmed`, which would be a verdict the ATS has no basis for — it never saw the meeting).
- `backend/src/services/offer.service.js`, `controllers/pipeline.controller.js`,
  `routes/pipeline.routes.js`, `frontend/src/services/pipeline.js`,
  `frontend/src/components/pipeline/PipelineDrawer.jsx` — **the internal offer approval commented
  out as one chain** (service → controller → routes → frontend service → mutation branches →
  the two buttons and their status lines), so nothing is left importing a disabled symbol.
- `backend/src/jobs/offerSweep.js`, `config/emailRecipients.js`, `prisma/seed-email-templates.js`,
  `services/notification.service.js` — `runApprovalNudges()`, the `'Offer Approval Reminder'`
  template, the `offerApprovalNudge` recipient key and `OFFER_APPROVAL_REQUESTED` all disabled.
  **This was the only outbound email the Offer stage generated.** `runPostJoiningAutoClose()` (Q12),
  the MRF close/re-open coupling and the bare vendor lines are kept.
- `frontend/src/components/pipeline/PipelineDrawer.jsx` — the Client round panel now reads
  *Stage Entry → Arranged Offline → Client Feedback → Approve/Reject*, pointing the recruiter at the
  outcome notes for the transcribed verdict; an existing booking is still shown read-only. The
  Offer round's **first progress segment was rebuilt to key off stage arrival instead of
  `approval_status`** — left as-is it would have parked every offer on "Internal approval not
  requested yet" forever.
- **Tests:** `SCHED-02` and `E2E-05` now assert the client round is *refused* (400) rather than
  booked silently, plus a new case proving a legacy client booking marked held dispatches no
  scorecard and sends no email. ⚠ **`SCHED-05/08/09/10` and the scorecard cases moved to the CEO
  round** — they used `client` precisely *because* it sent nothing, so they now send real panel mail
  on every run where they previously sent none; the file header records this. `OFFER-01/02` and the
  `OFFER-14` nudge block are commented out with their imports.
- **Each item in the Client Round is individually markable** — new
  `backend/src/services/clientRound.service.js` + two routes under `/api/pipeline/:id/client-round/*`:
  *Mark as held* (when it happened, optional client-side contact) and *Record client feedback* (the
  transcribed verdict). Both write to `rpa_interview_schedule`, which already models a round, its
  date, whether it was held and free-text notes — **no DDL**. Neither has a code path to an outbound
  message. Previously the panel told the recruiter to "put their feedback in the outcome notes" while
  pointing at nothing clickable.
- **Three defects the trim itself introduced, all Client Round, all fixed:** (a) the segment buttons
  resolved `interviewSchedule` to the component-level `data?.interviewSchedule`, which
  `getPipelineDetail` only populates when `isSchedulableStage(current_stage_key)` — false once
  `client` was commented out — so "Mark as held" never became "Edit date" and the **feedback button
  never rendered at all**; fixed by hoisting a `stageSchedule` local in `renderStagePanel()`.
  (b) `liveRow()` filtered `status: 'scheduled'` while `uq_interview_schedule_live` is UNIQUE
  `(pipeline_id, stage_key) WHERE status <> 'cancelled'`, so a legacy round sitting at `'completed'`
  would have hit the unique index and **500'd**. (c) an arranged-but-not-fed-back round matched every
  clause of `listUnresolvedInterviews()` and reappeared in the confirm-it-happened queue this change
  set removed; `MANUALLY_COORDINATED_STAGES` is now excluded there.
- **Copy fixed for both states:** the row was labelled "Arranged Offline" before anything had been
  arranged. Labels are fixed for a row's lifetime, so it is now **"Client Meeting"** with the
  sentence underneath carrying the state ("Arrange this with the client, then mark it here once it
  has happened" → "Arranged offline — held 24 Aug, 04:44 pm with …").
- **The Offer round's "Accepted / Declined" segment showed interview copy.** The offer branch of
  `buildPipelineSegments()` set segments 1–3 and never touched `s4`, so it fell through to the
  generic interview tail — *"Awaiting your decision once results are in"*. An offer has no results,
  and the decision is the **candidate's**, not the recruiter's; the real decision was meanwhile being
  rendered into "Awaiting Response" while the row labelled for it sat empty. Segments 3 and 4 now
  mean what their labels say (3 = the wait, 4 = the answer), and the offer stage explicitly opts out
  of that tail — placed after the `outcomeEvent` branch so a closed journey still shows its final
  status. "Offer Shared" now names the control that exists ("use *Record offer shared* below")
  instead of a dead-end instruction.
- **Marking the final closure now returns the recruiter to the board.** `closureMutation` refreshed
  the board but left the drawer open on a journey whose card had just been removed, with every action
  bar disabled. It now calls `onClose()` after `onChanged()`, which also clears the `?candidate=` URL
  param — so a refresh or a shared link cannot reopen a closed journey into a dead drawer.
- **Verified:** `node --check` clean on all modified backend files (it caught one real bug mid-change
  — a `/* */` wrapper whose inner JSDoc `*/` closed the comment early and left `approveOffer` live);
  the pipeline route→controller→service import graph resolves; `npx vite build` clean. Integration
  suites not run — they hit shared staging and send real mail.
- **Known, not fixed** (a technical round, outside this pass's scope): the Teams card is gated on
  `isSchedulableStageKey(stage.stage_key)` but not on `isCurrent`, so viewing a past round shows the
  *current* round's join link and interviewer. The same `stageSchedule` hoist would close it.
- **Still open:** this reverses RT's written answer to **Q3** and the in-house **Q26** decision, and
  is owed a written confirmation recorded in `docs/phase3/04-QUESTIONS.md`.

---

## 2026-08-25 — Pipeline Configuration: quicker stage/outcome reordering, filterable reasons, clearer Outcome Emails feedback
**Why:** admins reshaping the pipeline had to open an edit modal and retype a raw `sort_order`
number just to swap two adjacent stages or outcomes, the Reject/Hold Reasons list had no way to
scope down a growing mixed (stage-specific + global) list, and the Outcome Emails tab autosaved
every change with only a transient toast and no way to undo a misclick. Scoped as a usability
pass ahead of demoing the screen to the recruitment team's admins — no backend changes needed,
since `updateStage`/`updateStageOutcome`/`updateReason` already accept partial `{ sort_order }`
payloads.

- `frontend/src/components/pipeline/PipelineConfigPanel.jsx` — **Move Up/Down buttons replace
  manual sort_order entry** for reordering existing stages and existing outcomes-within-a-stage.
  Clicking swaps `sort_order` with the adjacent row and saves both immediately (optimistic local
  reorder, rolled back with an error toast if either `PUT` fails). The `sort_order` field is
  dropped from the *edit* stage/outcome forms (redundant now) and kept only on *add*, where it
  still pre-fills the next available value. Deliberately not drag-and-drop — nothing in this
  codebase used a DnD library yet, and a plain swap-with-neighbor fully covers "move this one
  above/below that one" without a new dependency.
- `frontend/src/components/pipeline/PipelineConfigPanel.jsx` — **Reject/Hold Reasons tab gets a
  stage filter.** A `Select` next to "Add reason" narrows the table to one stage's reasons plus
  the global ("All stages") ones; purely a client-side filter over data already loaded, no
  service/API change. Left the Reasons table's own `sort_order` field as a plain number — that
  order is a single global sequence shared across differently-scoped rows (`listReasons` orders
  everything by one `sort_order`), so swap-with-neighbor doesn't map cleanly onto a filtered view
  the way it does for stages/outcomes.
- `frontend/src/components/pipeline/PipelineConfigPanel.jsx` — **Outcome Emails tab keeps
  autosave-on-change but replaces the bare toast with an inline "Saved ✓ · Undo"** under the
  changed row's `Select`, auto-clearing after ~6s. Tracks the row's previous `template_id` in
  local state; Undo re-invokes the same save with that value.
- **Verified:** `npx vite build` clean — 4103 modules, only the pre-existing >500 kB chunk
  warning. Not click-tested against a live login in this pass — no admin credentials were
  available for automated browser verification; manual verification handed off to the user.
## 2026-08-25 — Only published Zeko jobs are offered when scheduling an interview
**Why:** the "Schedule Zeko Interview" job picker offered **Junior Python QA Automation Engineer
Hiring**, which is in **Draft** on Zeko. Booking against it hands the candidate a dead link — Zeko
serves *"Unpublished Interview – Testing Mode — Kindly publish it before conducting interview."* Two
real bookings had already gone out that way.

**Root cause — a missing filter on the read, not a stale sync.** `getZekoJobs()` excluded archived
jobs and nothing else, so all **25** draft jobs were returned alongside the **30** published ones.

The hourly sync was already doing its half correctly: it asks Zeko for all three states
(`published`/`notPublished`/`archived`) on purpose, derives `status` from `isPublished ||
isWorkflowPublished`, and **`status` was already in the upsert's `update` clause** — so publish ⇄
unpublish flips already propagated within the hour, in both directions. The state was sitting in the
column, current and correct; only the read ignored it.

**The trap this avoided.** The obvious fix — `where: { is_published: true }` — would have been wrong.
`is_workflow_pub` was set on `create` only and never updated, so a job first seen as a draft and later
*workflow*-published kept `false` there forever: **8 rows on staging read `status: 'published'` with
both publish booleans `false`**. An `is_published` filter would have hidden all 8 genuinely published
jobs — trading "shows too much" for "hides what you need". `status` is the only field derived from
both routes *and* kept current, so that is what the filter uses.

- `backend/src/services/screening.service.js` (`getZekoJobs`) — `where: { status: 'published' }`,
  replacing `is_archived: false` rather than adding to it: `status` is derived as a chain where
  archived beats published, so published already implies not-archived.
- `backend/src/services/screening.service.js` (`assignCandidateToZekoJob`) — refuses a non-published
  job with a 400 naming the job and its current state. The dropdown filter is a UI-level guard only; a
  stale tab, a cached list or a direct API call could still book a draft, and the failure is silent on
  our side and visible only to the candidate.
- `backend/src/services/zeko.service.js` (`syncZekoJobs`) — the upsert's `update` clause now refreshes
  every mutable field. `is_workflow_pub`, `is_hr_screening`, `is_coding`, `slug`, `email` and
  `job_ref_id` were create-only and froze at whatever the job looked like when first seen.
  `created_at_zeko` and `company_name` stay create-only on purpose — the first is immutable, the second
  carries a local default a sync should not stamp back over.
- `backend/src/routes/screening.routes.js` — route comment corrected; it claimed "active jobs".
- **Verified by calling the real `getZekoJobs()` against staging:** 30 rows (was 55), 0 non-published,
  0 archived, 0 missing a `primary_interview_id` (which would throw at booking time). The drawer's own
  split leaves 11 HR-round and 19 non-HR options, both non-empty, so its "offer everything" fallback
  cannot fire. The 8 stale-flag jobs are still included, confirming the `status` choice. The reported
  draft row is gone from the "juni" search while both published siblings remain. 72/72 unit tests pass.
- **Not changed:** the drawer's type-filter fallback, which offers every job when none matches the
  round's type. It cannot fire today, and post-fix could only offer published jobs.
- **Two existing bookings still point at the draft job** (Abhishek Singh, PANKAJ MONDAL — both `sent`).
  Untouched: this stops new draft bookings, it does not repair existing ones. Either publish that job
  on Zeko or cancel and rebook — the cancel path resolves jobs without a status filter, so it still
  works. Listed in §8 of the RCA.
- Full analysis: [RCA-2026-08-25-zeko-draft-jobs-in-schedule-dropdown.md](./RCA-2026-08-25-zeko-draft-jobs-in-schedule-dropdown.md).

---

## 2026-08-25 — A Zeko round no longer shows the other Zeko round's score
**Why:** PANKAJ MONDAL passed the Evalground round and moved to **Functional Screening (Zeko)**. That
round immediately showed **Awaiting Results ✅ Done · 95 INTERVIEW** — the **HR** round's score — for a
functional interview that had never been scheduled. The drawer contradicted itself on screen: the line
directly above read "Schedule Interview · Not started yet · Not yet assigned to a Zeko job".

**Root cause — a per-CANDIDATE column read as if it were per-ROUND.** `rpa_cv."ZekoInterviewScore"` /
`"ZekoCodingScore"` / `"ZekoCommunicationScore"` are one set of columns per candidate, and **both** Zeko
rounds write to them, so a value there carries no record of which round produced it. Two paths read it
without round scoping:

- `getPipelineDetail()` seeded `zekoScores` from `rpa_cv`, and the round-scoped correction that was
  meant to replace it is wrapped in `if (zekoHrPipeline)`. For `zeko_fn` the booking lookup correctly
  filters `stage: 'functional'`, finds nothing, and returns null — so the override never ran and the HR
  value survived. The old comment named the hazard but its last clause was the bug: *"overrides this …
  whenever one exists."*
- `listPipeline()` derived the board's `ready_for_decision` chip from `rpa_cv` **directly**, with no
  round scoping at all — so any candidate ever scored by Zeko read as "Ready for decision" on whichever
  Zeko round they were standing on.

**Worse than a wrong number: the round could not be progressed.** `PipelineDrawer.jsx` hides the
Schedule Interview button once a score is present (`showScheduleButton = isCurrent && !zekoScores &&
!outcomeEvent`) — a sound rule fed a score from the wrong round, so the UI concluded a never-booked
round was already finished. Approve/Reject was live too, so the round could have been approved on
another round's result — the same failure shape the Evalground auto-advance stage gate already guards
against.

Fixed by removing the source that cannot be made correct, rather than adding rules around it: `rpa_cv`
has no round provenance, so any attempt to attribute it to a round is guessing.

- `backend/src/services/pipeline.service.js` (`getPipelineDetail`) — the `rpa_cv` read now selects only
  `cvFileUrl`. The round-scoped `rpa_zeko_interview_results` lookup is the **only** source of
  `zekoScores`; a round with no result row of its own reports no score.
- `backend/src/services/pipeline.service.js` (`listPipeline`) — `ready_for_decision` is now keyed
  `${shortlist_id}:${round}` and resolved the same two-step way the drawer does: the round's own booking
  names its external interview id, and the candidate's own address picks their row out of that
  interview's roster (one interview is shared by every candidate booked against the job, so the id alone
  would match a stranger's score). It now sits beside the `invited` flag that already worked this way —
  the two share **one** query instead of two, so they can never disagree about which round a card is on.
- **No frontend change needed.** The drawer already had honest copy for this exact state — *"Awaiting
  Zeko to sync the score, once invited."* It was simply never reached.
- **Option B was considered and rejected:** gating the fallback on "this round has a booking" is not
  enough — the HR score reappears the moment a functional interview is booked but not yet synced. That
  state exists on staging today (one `functional` booking in `sent`), and it is pinned by test.
- **Legacy cost measured, not assumed:** every non-cancelled Zeko booking carrying an `rpa_cv` score also
  has a matching `rpa_zeko_interview_results` row (**0** exceptions), so nothing was relying on the
  fallback to display a legitimate score.
- **Verified against the staging database by calling the real service functions:** journey 768
  (`zeko_fn`) now returns `zekoScores: null` and `ready_for_decision: false` — was 95 / "Ready for
  decision"; journey 703 (`zeko_hr`, with its own booking and result) still returns its own 94 /
  `true`. All 13 Zeko board cards audited: 768 is the only value that changed. `cvFileUrl` still
  resolves. 72/72 backend unit tests pass, including 8 new ones in
  `src/tests/unit/zekoRoundScoreScoping.test.js`; `vite build` clean.
- **No data repair.** Every row was stored correctly and correctly attributed — this was a read/display
  defect only.
- Full analysis: [RCA-2026-08-25-zeko-functional-round-shows-hr-score.md](./RCA-2026-08-25-zeko-functional-round-shows-hr-score.md).

---

## 2026-08-25 — Evalground import no longer misses candidates who have two email addresses
**Why:** an Evalground result for `aiuserpankajmondal@gmail.com` imported as **Unmatched — "No
candidate found for this email"**, while the pipeline drawer plainly showed that address on PANKAJ
MONDAL, sitting on IQ / Tech Assessment, `in_progress`, invite already sent.

**Root cause — a list compared as a scalar.** `rpa_cv."EmailID"` holds *every* address we hold for
a candidate, comma-joined (`pankaj.mondal@example.com,aiuserpankajmondal@gmail.com`) — that is how
`hrUpload.service.js`'s `appendUnique` merge stores a candidate re-uploaded under a second address.
`matchRowToPipeline()` compared that whole column against the one address Evalground reports:

```sql
WHERE cv."EmailID" ILIKE ${email}   -- wildcard-free ILIKE is just a case-insensitive `=`
```

which Postgres evaluates as `'a@x.com,b@y.com' = 'b@y.com'` → false. The match could **never**
succeed for any candidate with more than one address on file. Nothing was wrong with the
spreadsheet, the AI row parser, or the candidate's stage — the preview reporting `Unmatched`
rather than `Malformed` already showed the parse had succeeded and only the lookup had failed.

**Why the message was actively misleading.** The fallback query that decides between "we don't know
this person" and "we know them, but they have no open Assessment journey" carried the *same*
defect, so it also found nothing and the UI escalated to the strongest possible claim.

**Why it looked impossible from the outside.** The outbound invite path splits the address column on
commas (`resolveRecipients`), so the invite was delivered and the candidate sat the test; only the
inbound match path did not split. Reachable, but not findable.

This class of bug had already been fixed once for Zeko — `emailCandidates()` exists precisely for
it, and `hrUpload.service.js:583` already does the SQL-side equivalent. `assessmentImport.service.js`
had adopted neither. Rather than add a third copy, the SQL form now lives beside the JS one.

- `backend/src/utils/emailMatch.js` — **new** `emailMatchesSql(columnSql, value)`, the SQL sibling of
  `emailCandidates()`: splits the stored column the same way (`[,;]`, whitespace-stripped,
  lower-cased) and tests array overlap. Takes the column as a `Prisma.Sql` fragment so one predicate
  serves every caller. Uses `'[[:space:]]'` rather than `'\s'` — a backslash escape would be
  swallowed by the JS template literal before Postgres ever saw it. A `value` with no usable address
  returns the literal `false`, never a predicate that matches everything: it is interpolated into an
  `UPDATE` in `zeko.service.js`, where "match nothing" and "match every candidate" are very
  different failures.
- `backend/src/services/assessmentImport.service.js` — both queries in `matchRowToPipeline()` (the
  journey match *and* the "does this candidate exist at all?" fallback) now use it. Fixing only the
  first would have left the UI still reporting the wrong one of the two messages.
- `backend/src/jobs/inboundEmailSync.js` — same defect in `lookupCandidate()`: a candidate replying
  from the second address we hold for them was never linked to their shortlist.
- `backend/src/services/zeko.service.js` — same defect in the by-email score write-back fallback.
  The sharper of the two siblings: a **silent** failed write, in the same file that already imported
  `emailCandidates` for its *read* path. Read side had been fixed, write side had not.
- **Dropped `ILIKE` as an equality operator throughout.** `_` and `%` are wildcards to `ILIKE` and
  `_` is legal in an email local-part, so `'first_last@x.com'` also matched `firstXlast@x.com` —
  attributing a result to the *wrong* candidate. A latent silent-wrong-write, not the reported bug,
  but it lived on the same lines.
- **No performance regression.** `ILIKE` on a text column could not use a B-tree index either, so
  this was already a sequential scan.
- **Verified against the staging database (read-only):** the old predicate returns 0 rows
  (reproducing the bug exactly); the new one returns cv 287 / PANKAJ MONDAL; the full fixed
  `matchRowToPipeline()` query returns `pipeline_id 768, cv_id 287` — the exact journey the import
  needs. 4 candidates currently carry multi-address `EmailID` values and were all unmatchable; 0 use
  semicolons, so the `[,;]` split is a harmless superset. A stored `"a@x.com, b@y.com"` (space after
  the comma) matches on either half, mixed case matches, a *partial* address matches nothing, and
  a null needle matches nothing. 64/64 backend unit tests pass, including 18 new ones in
  `src/tests/unit/emailMatchSql.test.js`.
- Full analysis: [RCA-2026-08-25-evalground-import-multi-email-unmatched.md](./RCA-2026-08-25-evalground-import-multi-email-unmatched.md).

---

## 2026-08-25 — Zeko scores now read from the per-candidate report API
**Why:** the Functional (Zeko) round still showed `0` after the HR fix. `interview-responses`
returns `interviewScore: 0` for functional interviews too — the same defect as HR, in a different
field. Four *completed* candidates on job `69df92eff96fd5bee20f8fdc` reported `0` there while
their reports held **1, 61, 56 and 65**.

`interview-responses` is a **list/summary** endpoint whose score fields are unreliable per round
type. `GET /mygurukul/ait/interview-report?candidateId=&jobId=` — the API behind Zeko's own report
page — is the only source correct for every round type. Full analysis in
[PLAN-2026-08-25-zeko-report-api-score-sync.md](./PLAN-2026-08-25-zeko-report-api-score-sync.md).

It also fixes a structural gap: jobs expose different result tabs (`Meets Criteria` exists on some
and not others), and on that job the **Completed tab reads 0 while Meets Criteria reads 4** — so
any logic keyed to a tab silently skipped genuinely scored candidates. The report API is keyed on
the candidate, so tab layout stops mattering.

- `backend/src/services/zeko.service.js` — new `fetchCandidateReport()` (cookie auth, the existing
  `getDashboardCookieHeader()`; **HTTP 410 Gone** is Zeko's "no report exists" signal and returns
  `null` rather than throwing). `fetchInterviewResults()` is now two-step: `interview-responses`
  **enumerates only** (it is the sole source of `candidateId`, and its pagination must stay — Haris
  sits beyond page 1 of a 430-candidate interview), then the report supplies the score.
- `pickZekoScore()` rewritten — each round type carries its score in a different field, and only
  one is ever meaningful:

  | Round | `fit_percentage` | `codingScore` | `totalScore` |
  |---|---|---|---|
  | HR screening | **95** | absent | `0` ← junk |
  | Coding | absent | **61** | `61` ← duplicate |
  | Panel | absent | absent | **79** |

  All three mean "this round's headline score" (Zeko's own labels: Recruiter Screening / Coding
  Score / **Interview Score**), so `interview = fit_percentage ?? codingScore ?? (totalScore || null)`,
  `coding = codingScore`, `communication = null`.
- **`ZekoCommunicationScore` stays null on purpose.** `softSkillsEvaluation` and
  `language_proficiency` were checked — qualitative text only. Zeko exposes no numeric
  communication score, so filling that column with `totalScore` would have written `0` on every HR
  round and a duplicate on every coding round.
- **`newEvaluation.overallScore` is deliberately never read** — it is a *different* number (49
  where the UI gauge shows 79) that Zeko's own report page ignores. Reading it would put one score
  in the ATS and another in Zeko for the same candidate. Pinned by a test.
- `backend/src/config/index.js` — `reportApiBase` (`ZEKO_REPORT_API_BASE`).
- `backend/src/tests/unit/zekoScoreField.test.js` — rewritten, 18 cases over the real payloads.
- **Both tables still written.** Since the round-scoping fix the drawer no longer falls back to
  `rpa_cv`, so the two now feed different surfaces: `rpa_zeko_interview_results` → drawer + board;
  `rpa_cv` → Search Candidate, View Candidate, CSV export, analytics.
- **Verified on staging:** `repairZeroZekoScores()` → 3 processed, 7 skipped. PANKAJ MONDAL's
  functional round went **`0 → 1` (coding 1)**; HR 95 and Panmon 94 unchanged; four `slotMissed`
  rows skipped with no write; unmatchable rows logged at `info`. 216/216 unit tests pass.
- **Follow-up not done:** the functional round now renders `Interview 1 · Coding 1` — two identical
  chips, since the coding score is also the headline score. Cosmetic; awaiting confirmation.

---

## 2026-08-25 — Open pipeline drawer now updates live when the cron syncs a score
**Why:** with the drawer open and untouched, the cron wrote PANKAJ MONDAL's score of 95 — and
the drawer went on showing "Awaiting Results". Opening the same candidate in a new tab showed 95
immediately. The UI only caught up on a manual reload.

**Root cause — nothing was ever telling the browser.** react-query refetches on exactly three
triggers: query mount, a mutation's `invalidateQueries`, or window focus. `refetchOnWindowFocus`
is **disabled globally** (`main.jsx`), the `pipeline-detail` query has no `refetchInterval`, and
a cron writing to the database fires none of them. So an open drawer kept rendering the snapshot
it fetched when it was opened — indefinitely. Not a caching bug; there was simply no path from a
server-side background write to an already-mounted component.

The board behind it *did* self-heal (`pipeline-board` polls every 60s and refetches on focus),
which is exactly why a fresh tab looked right — and why only the drawer was stuck.

Fixed by pushing, not polling: the socket infrastructure was already in place and simply had
nothing wired to the Zeko sync.

- `backend/src/services/zeko.service.js` — after a score is committed,
  `emitToRole(role, 'pipeline:updated', …)` for each of `NOTIFY_ROLES`. `emitToRole` targets one
  room, so the roles are emitted to in turn (the same fan-out `notification.service.js` uses).
  Emitted to roles, not one user: a journey has no single owner, so whoever has it open should
  see it. Best-effort inside try/catch — the row is already committed, so a failed push only
  degrades to the previous behaviour.
- `backend/src/services/zeko.service.js` — the pending-rows query's lateral join now also selects
  `id AS journey_id`. It already joined `rpa_candidate_pipeline` for `cv_id`; the drawer is keyed
  on the journey id, so the payload can name the exact candidate.
- `frontend/src/components/pipeline/PipelineDrawer.jsx` — subscribes to `pipeline:updated` while
  open and **invalidates** `['pipeline-detail', pipelineId]` rather than trusting the payload,
  keeping the detail endpoint the single source of truth so the drawer can never drift from what
  a reload would show. Events for other candidates share the role room and are filtered by
  `pipelineId`, so one candidate's sync does not make every open drawer refetch. A payload
  without a `pipelineId` is treated as "resync" rather than dropped.
- **No polling added.** A `refetchInterval` on the drawer would have been the lazy fix — it would
  hammer the detail endpoint for every open drawer forever to catch an event that happens once.
- **No toast.** This deliberately does not call `onChanged()`, which shows "Pipeline updated." —
  correct for a user's own action, wrong for a background sync the recruiter did not trigger.
- **Verified:** with a real Socket.io server and a stubbed `io.to`, the emit block reaches all
  four staffing rooms — `role:recruiter`, `role:hr`, `role:admin`, `role:superadmin` — carrying
  `{pipelineId: 768, stageKey: 'zeko_hr', reason: 'zeko.score_synced', score: 95}`; 768 is
  PANKAJ MONDAL's journey, the exact drawer from the report. Confirmed `journey_id` resolves for
  every pending row. `vite build` clean (4103 modules); 205/205 unit tests pass. No circular
  import: the socket layer imports neither service.
- **Still needs a browser check** — the emit and the listener are each verified in isolation, but
  the end-to-end "leave the drawer open and watch it flip" has not been observed in a live app.

---

## 2026-08-25 — Zeko results fetch moved to a 5-minute cadence
**Why:** requested — an hourly sweep meant a finished interview's score could sit unseen for up
to an hour before a recruiter could act on the round.

`ZEKO_RESULTS_CRON` `30 * * * *` → `*/5 * * * *` (24 runs/day → 288). Config default and both
env files updated. The job-catalog sync stays hourly — the role list barely changes.

The interval alone is a one-line change, but the job was written for an hourly cadence and
needed three guards before running 12× more often:

- `backend/src/jobs/zekoScheduler.js` — **overlap guard.** node-cron fires on schedule whether
  or not the previous run finished. A measured run takes **~15.5s** and grows with the number of
  pending interviews, so a slow Zeko response or a backlog could exceed 5 minutes and stack
  concurrent syncs — doubling API load and racing two writers onto the same rows. An overlapping
  tick is now skipped with a warning; the next is only minutes away. Released in `finally`, so a
  throwing run cannot wedge the job permanently.
- `backend/src/services/zeko.service.js` — the "no expired interviews" line dropped from `info`
  to `debug`. It is the common case at this cadence and would otherwise write ~288 identical
  "nothing to do" lines a day, burying real events. That path already early-returns **before**
  `getDashboardCookieHeader()`, so an idle tick is one indexed query and **zero** network calls.
- `backend/src/services/zeko.service.js` — the "none match" warning is now rate-aware. A row can
  be *permanently* unmatchable (candidate re-booked in the ATS but never added on Zeko's side —
  Haris M), and would have emitted ~288 identical warnings a day forever. Past the 24h staleness
  window it drops to `info` with an "unmatched for Nh — likely never added on Zeko" note: still
  discoverable, no longer drowning the log.
- **Cost measured, not assumed:** one real staging run = 3 pending rows, 3 API calls, 15.5s.
  Each interview is fetched **once per run** regardless of how many candidates share it, and the
  query only ever returns rows whose interview has already ENDED and is still `sent` — so the
  work is bounded by real activity, not by the cadence.
- **Verified:** `cron.validate('*/5 * * * *')` true, fires at :00/:05/…/:55; overlap guard
  proven to skip a concurrent tick and to recover after a throw; 205/205 unit tests pass.
- **Note:** production still has `ZEKO_SYNC_ENABLED=false`, so neither cron runs there yet.
- **Bonus confirmation:** during this work the new sync picked up PANKAJ MONDAL at **95**
  automatically on a fresh interview — the endpoint fix working unprompted, end to end.

---

## 2026-08-24 — Zeko HR scores always synced as 0 (wrong API endpoint)
**Why:** Panmon attended his Zeko HR screening and scored **94**, but the ATS showed **0** —
in the pipeline drawer, on the card, and in View Candidate. The cron was faithfully storing
what it was told; it was asking the wrong endpoint.

Zeko keeps two different scores in two different fields, and which one is populated depends on
the interview type. The response flags it via `isHRScreeningPresent`:

| Interview type | `isHRScreeningPresent` | Score field | old endpoint |
|---|---|---|---|
| `screening-interview` (our HR round) | `true` | **`fitPercentage`** (94) | ✗ returns `interviewScore: 0` |
| `functional-interview` | `false` | **`interviewScore`** (83) | ✓ works |

`GET /api/v1/interview/<id>/results` only ever exposes `interviewScore`, which Zeko leaves at a
literal 0 for screening interviews — so **the HR round could never produce a real score**.
Confirmed on staging: all 5 screening interviews returned 0 for all ~50 candidates, while all 6
functional interviews returned real varied scores through the same call. That split is why some
candidates had believable numbers and every HR round showed 0.

- `backend/src/services/zeko.service.js` — `fetchInterviewResults()` now calls
  **`POST /dashboard/api/v2/pipeline/interview-responses`** (cookie auth, the same
  `getDashboardCookieHeader()` the job-catalog sync already uses; `dashboardApiBase` already
  pointed at the right host, so no config change). Body is snake_case
  `{ company_id, job_id, interview_id, page, limit }` — the endpoint 422s and names the fields
  if they are wrong. Paged at 100/request with the same MAX_PAGES guard as the job sync, and
  each interview is fetched **once** and reused across all its candidate rows.
- `pickZekoScore()` — reads `fitPercentage` for screening rounds, `interviewScore` for
  functional, each falling back to the other. Both land in `rpa_cv.ZekoInterviewScore` as
  requested. This fixes HR rounds **without disturbing the functional rounds that already
  worked** (Tushar's 83 is untouched).
- `ZEKO_NO_RESULT_STATUSES` — `slotMissed` / `leftInMiddle` / `notAttempted` / `scheduled` are
  now skipped instead of being written as 0. Recording 0 for a no-show is what made
  "never attended" read as "interviewed and scored zero".
- Screening rounds store `null` for coding/communication rather than the 0s the old endpoint
  returned — Zeko exposes no such split for them.
- `findResultForCandidate()` — accepts the new flat `candidateEmail` alongside the old nested
  `candidate.email`. The `rpa_cv` email fallback used the nested shape too and would silently
  never have fired.
- **Result rows are now updated in place**, not blindly inserted: a re-sync must be able to
  correct a wrong score, and blind inserts would stack duplicates (the table has no unique
  constraint, so the match is explicit on `pipeline_id` + `candidate_email`).
- `repairZeroZekoScores()` — **new**, one-off repair. Rounds synced before this fix are
  `status='completed'`, which the normal sweep skips, so their bogus 0 would survive forever.
  This re-reads completed rows through the new endpoint. Same code path as the cron, just a
  wider row set; safe to re-run.
- `backend/src/tests/unit/zekoScoreField.test.js` — **new**, 12 cases over the real captured
  payloads: screening reads `fitPercentage` and never the placeholder 0, functional keeps
  reading `interviewScore`, a *genuine* 0 is preserved in both directions, and no-show statuses
  never yield a score.
- **No scheduler change** — the hourly `ZEKO_RESULTS_CRON` already calls
  `fetchInterviewResults()`; it was changed from the inside.
- **Verified against live staging:** ran `repairZeroZekoScores()` — logged
  `correcting claudepankajmondal@gmail.com … 0 → 94`, and `rpa_cv.ZekoInterviewScore` went
  `0 → 94` with the result row corrected in place, not duplicated. `slotMissed` rows correctly
  recorded nothing. 202/202 unit tests pass.
- **Known, not a bug:** Haris M is skipped ("none match"). He has two bookings — his 75 lives on
  the *Junior Python QA* interview, which we **cancelled**; his active row points at the
  *Associate Accountant* interview where Zeko genuinely does not list him. He was re-booked but
  never added on Zeko's side, so skipping is correct.

### Follow-up — "View full report on Zeko" deep link
The endpoint switch above dropped `reportLink`: the old results endpoint returned one, the
responses endpoint does not, so the first repair run **overwrote Panmon's stored link with
null** and the drawer's link disappeared. Fixed in the same pass.

- `backend/src/services/zeko.service.js` — new `zekoReportUrl(candidateId, jobId)` builds
  `…/app/new-report?candidateId=&jobId=&tab=Overview` from `candidateId` (on the response entry)
  and the `zeko_job_id` we already store. This is the URL **Zeko's own Responses table opens**,
  and it is better than what it replaces: the old `shared-report?linkId=` was a static snapshot,
  whereas this is the candidate's live report page with the Recruiter Screening / Resume /
  Transcript tabs one click away. Returns null if either id is missing, so a broken link is
  never rendered, and falls back to any link already stored so a re-sync cannot blank a good one.
- `backend/src/config/index.js` — `reportLinkBase` (`ZEKO_REPORT_LINK_BASE`, default
  `https://app.zeko.ai/app/new-report`), matching how every other Zeko base URL is configured.
- **No frontend change.** `PipelineDrawer.jsx` already renders `zekoReportLink` as
  "View full report on Zeko" whenever the round has one; it had simply been fed null. The
  current-stage gate on that link is correct as-is — the backend only loads the current round's
  link, so passing it to a historical card would show the wrong round's report.
- **Verified on staging:** re-ran the repair — Panmon's row now stores
  `…new-report?candidateId=6a8bfcca5e57c481d6c906ee&jobId=69a15687abfe6f852d7d7d50&tab=Overview`,
  byte-identical to the URL in the browser. 205/205 unit tests pass, including 3 new cases
  covering the builder and its null guards.

---

## 2026-08-24 — Notification bell restored to the header
**Why:** the notification centre was fully built — DB table, service, 16 producer call sites,
REST routes, socket push, and a finished `NotificationBell` component — but **nothing rendered
it**, so the header had an empty gap where the bell belonged. The backend had been writing
notifications the whole time: staging holds **1,021 rows in `rpa_notifications`, every one
unread**, newest 2026-08-24 09:14. Nobody had ever read one, because there was no bell to open.

History: the bell was live at `2b8077a` ("First Upload"). `57ea00e` ("bugs fix", 17 Jun 2026
10:35) deliberately hid it — import and JSX both commented out, marked `Hidden as requested` —
alongside the dark-mode toggle, for the same reason. `861710f` (the rebrand, 17 Jun 2026 19:40)
then rewrote the header for the collapsible sidebar: it **restored the ThemeToggle but not the
bell**, deleting the commented-out JSX and leaving only a dead commented import. Nine hours
between hiding it and losing it.

- `frontend/src/layouts/MainLayout.jsx` — import uncommented; `<NotificationBell />` added to
  the header's right-hand `Space`, before `<ThemeToggle />`. **Two lines, one file** — this was
  the only break in the chain.
- **Nothing else changed.** Verified present and working end to end beforehand:
  `rpa_notifications` (+ `idx_notifications_user_created`), `notification.service.js`
  (`notify`/`list`/`unreadCount`/`markRead`/`markAllRead`), `notification.controller.js`,
  `notification.routes.js` mounted at `/api/notifications`, `emitToUser()` + the `user:${id}`
  socket room, `notificationService.js`, `getSocket()`, and the `--gold` / `--gold-subtle` /
  `--border-light` tokens in both light and dark. The response shape
  (`success(res, {items, unread})` → `res.data.data`) already matched the component's `select`.
- **Known on first load, not a bug:** the four staffed accounts carry 197–282 unread each, so
  the badge opens at AntD's `99+` over a backlog reaching early August. Left as-is by decision —
  the popover's built-in "Mark all read" clears it in one click, and no data was written.
- `git log -S 'NotificationBell'` does **not** find `57ea00e`: commenting a line out leaves the
  occurrence count unchanged. Searching the `Hidden as requested` marker is what surfaced it.
- **Verified:** `npx vite build` clean — 4103 modules, only the pre-existing >500 kB chunk warning.

---

## 2026-08-24 — Zeko round showed another candidate's score and report link
**Why:** Haris M's HR Screening (Zeko) round read "0 Interview" and its "View full report on
Zeko" link opened **Samarth Tiwari's** report (a different person's name, email and scores).
Both symptoms were one bug, and it is a cross-candidate data leak, not just a wrong number.

`rpa_zeko_interview_results.pipeline_id` holds Zeko's **interview** id, which belongs to the
*job* — every candidate booked against that job shares it, and the table therefore holds one row
per candidate under the same `pipeline_id`. The drawer's lookup filtered on `pipeline_id` alone
and took `orderBy: created_at desc`, so it returned whichever candidate had synced most recently.
On staging this mis-attributed **5 of 11** non-cancelled Zeko pipeline rows.

- `backend/src/services/pipeline.service.js` — the `rpa_zeko_interview_results` lookup in
  `getPipelineDetail()` now also matches `candidate_email` against the candidate's own
  address(es), case-insensitively. When we hold no address for them the round reports no result
  rather than guessing. This feeds both `zekoScores` (the chips) and `zekoReportLink` (the
  report link), so one filter fixes both symptoms.
- `backend/src/utils/emailMatch.js` — **new.** `emailCandidates()` splits a stored address column
  into comparable addresses; `rpa_shortlisted_candidates.candidate_email` and `rpa_cv."EmailID"`
  sometimes hold several joined with commas ("a@x.com, b@y.com") while Zeko reports the single
  address the interview was booked against, so plain equality misses the match.
- `backend/src/services/zeko.service.js` — its private copy of that splitter (used by
  `findResultForCandidate()`, which already scoped the *write* side correctly) now imports the
  shared helper, so both sides of the sync identify a candidate the same way.
- `backend/src/tests/unit/zekoResultAttribution.test.js` — **new**, 8 cases pinning the
  regression: a stranger's row on the same interview is never returned, the candidate's own row
  still is (including when Zeko reports a different letter case), multi-address columns match,
  and a null address matches nothing rather than everything.
- **No frontend change.** `PipelineDrawer.jsx` renders whatever the API attributes to the round;
  it was fed the wrong row.
- **No data cleanup needed.** The five legacy result rows (all synced 2026-06-13, before
  `findResultForCandidate()` replaced the n8n-era `data[0]`) are each internally consistent —
  right name, right email, right report link — they were only ever reachable by the wrong
  candidate. With the email filter they resolve to their own candidate only.
- **Verified:** replayed the old and new queries against staging across every non-cancelled Zeko
  pipeline row — 5 leaks before, 0 after, and no row that legitimately had its own result lost
  it. Haris M's round now reads "Awaiting Zeko to sync the score" (his window closed 24 Aug
  6pm IST and nothing has synced), with no report link and no "Ready for decision" badge.
  117/117 pure unit tests pass.

---

## 2026-08-17 — Search Candidate: three filters, fixed ordering, lighter list query
**Why:** the page's filter and Advanced filter "don't make any sense" — keep Name, Email and
Phone, nothing more; order by id descending; no sorting in the UI, only search. Full detail in
[docs/changelog/CHANGES-2026-08-17-search-candidate-filter-simplification.md](./changelog/CHANGES-2026-08-17-search-candidate-filter-simplification.md).

- `frontend/src/pages/Candidates.jsx` — **three overlapping ways to narrow the same table
  collapsed into one.** The page carried a debounced free-text quick-search box, a collapsible
  Advanced filters panel (email, name, phone, position, location) with an active-filter counter,
  *and* per-column sort arrows. Now: one card with Candidate Name, Email ID, Phone / Contact
  Number, plus Search and Reset. The quick-search box, the Advanced toggle, the counter strip and
  the position/location fields are gone.
- `frontend/src/pages/Candidates.jsx` — **sorting removed from the UI entirely.** `sorter: true`
  dropped from Name, Email and Position; the `sort` state deleted; `loadCandidates()` always asks
  for `sort: 'id', order: 'desc'` (newest first, first-ever-added last) and `handleTableChange`
  handles pagination only. Sorting is removed from this page only — the API still accepts
  `sort`/`order` for the CSV export and other callers.
- `backend/src/services/candidate.service.js` — `resolveSortField()` gained an `id` branch. It
  knew only name / email / position / modifiedAt and **silently fell back to `createdAt`**, so
  without this the page would have asked for `id` and quietly got date order. `id` is also the
  primary key: an index walk instead of sorting every matching row, where `createdAt` is
  nullable and unindexed and sorted NULL-dated legacy rows to the top of page 1 under DESC.
- `backend/src/services/candidate.service.js` — **`search()` no longer ships the two heaviest
  columns.** The list was already paginated server-side (25/request, max 100 — it never pulled
  4k), so the cost was per-row weight: `findMany` ran with no `select`, returning all ~80 `rpa_cv`
  columns including `resume_full_text` (the whole resume as plain text) and `ai_profile_insights`.
  Now omitted. Nothing on that path reads either — `mapCandidate()` references neither and
  `screening.service.js` pulls both via its own raw SQL. Export untouched (already uses the
  narrow `EXPORT_SELECT` allowlist).
- **Known behaviour, not introduced here:** `buildWhereClause()` ORs name/email/phone *with each
  other* (legacy "search by any identifier"), so filling two fields returns rows matching either,
  not both. Left as-is — the same clause serves other callers and the export.
- **Verified:** `npx vite build` clean (only the pre-existing >500kB chunk warning); 182/182
  backend unit tests pass. Re-confirmed after the 2026-08-17 merge.

## 2026-08-13 — Placement vendor process: pre-push audit (4 issues logged, not yet fixed)
**Why:** checked the staged M6 vendor changes against
[docs/reference/VENDOR_PROCESS.md](./reference/VENDOR_PROCESS.md) before pushing. The 160-test
unit suite passes clean, but it only covers the pure guard functions in isolation — the call
sites wiring them together were not exercised. Full detail, failure scenarios and fix plan in
[docs/changelog/CHANGES-2026-08-13-vendor-audit.md](./changelog/CHANGES-2026-08-13-vendor-audit.md).

- **Closure notification silently dropped** when a journey closes while parked on the Documents
  stage — `notifyVendor()` applies the Documents `'never'` stage policy to the `CLOSURE` event
  too, contradicting §18's "closure notifies the vendor even for outcomes silent to the
  candidate." (`vendorNotification.service.js`, `pipeline.service.js`)
- **JOINED closure can freeze a stale/unrelated vendor's lock permanently** — the freeze check
  only tests `VendorEmail: { not: null }`, not whether that lock is actually live or owned by the
  vendor who sourced the hired candidate. (`pipeline.service.js`)
- **Every vendor notification reads "Hello partner,"** — `pipelineRow.vendor_name` is always
  `undefined` (no such column on `rpa_candidate_pipeline`; only `vendor_email` is stamped).
  Cosmetic, no functional impact. (`vendorNotification.service.js`)
- **`getVendorDashboard` re-implements vendor scoping** instead of calling
  `enforceVendorScope()` like the candidate list and CSV export do — same "two implementations
  drift apart" shape as the `b671236` export hole, on an untrimmed role comparison.
  (`vendor.controller.js`)
- **Status:** logged only, no code changed in this pass. Fix order: closure-suppression bug →
  stale-lock freeze → dashboard scoping drift → vendor_name cosmetic fix.

## 2026-08-11 — QA test-pass fixes (HR Upload → Zeko HR → pipeline)
**Why:** the team's 118-case pass returned four defects. Two were real bugs; two were features
that already shipped but looked absent. Full detail in
[docs/changelog/CHANGES-2026-08-11-qa-testpass.md](./changelog/CHANGES-2026-08-11-qa-testpass.md)
and items #19–#22 of
[CHANGES-2026-08-07-candidate-pipeline-fixes.md](./changelog/CHANGES-2026-08-07-candidate-pipeline-fixes.md).

- `backend/src/utils/experienceParser.js` (new) + `backend/src/services/hrUpload.service.js` —
  **Total Experience was fabricated on every upload.** A resume with any employment history took
  a date-computed total, and the date reader could not handle `Jun-2022` / `May'21` / `05.2022`,
  so those candidates were stored as `"0"` years; with no history at all a hardcoded `"2"` was
  written. `"0"` also passed the missing-data check, so it was never chased. The computed value
  now wins only when it computed something. The other fabricated defaults in the same block
  (`9876543210`, `B.Tech`, `Delhi`, `Software Developer`) are now null, five parsed-but-unstored
  columns are written, and an out-of-range reading no longer throws away the whole candidate.
  Two copies of the date logic collapsed into one tested module.
- `backend/scripts/report-experience-anomalies.js` (new) — read-only diagnostic for how many
  existing rows carry a fabricated value. **No backfill has been run.**
- `backend/src/services/interviewSchedule.service.js`, `backend/prisma/seed-email-templates.js`,
  `frontend/src/components/pipeline/PipelineDrawer.jsx` — **interviewer name now reaches the
  invite email.** The name was already stored; the token map and the panel templates lacked it.
  Threaded through the *preview* as well as the send, because the modal posts its compiled body
  back and the server prefers it. ⚠️ Needs `seed-email-templates.js` re-run on deploy, which
  overwrites HR's edits to those three templates.
- `frontend/src/pages/DocumentUpload.jsx` — the submit button already existed; what was missing
  was any acknowledgement until HR *verified* (days later). Added a submitted state.
- `backend/src/services/documentCollection.service.js` — automatic document reminders already
  existed; the panel never said so. Fixed the copy, plus two real counter bugs: a failed send
  burned the candidate's reminder budget, and a re-request after three reminders was never
  auto-chased again.
- Verified: unit suite 122 passing (15 new), frontend build clean. Not yet exercised against a
  running stack — see the re-test steps in the test-pass note.

## 2026-08-11 — Export one requisition from the MRF details modal
**Why:** MRF could only export the filtered **list**. Everything worth forwarding — the
New MRF Request fields and the ~45-field MRF the Hiring Manager submitted — lives in the
details modal, and there was no way to get it out short of a screenshot. Full detail in
[docs/changelog/CHANGES-csv-export.md](./changelog/CHANGES-csv-export.md) §6 and
[CHANGES-2026-08-07-candidate-pipeline-fixes.md](./changelog/CHANGES-2026-08-07-candidate-pipeline-fixes.md) #18.

- `backend/src/exports/mrfDetail.export.js` (new) — export spec for a single requisition,
  transposed to `Section, Field, Value` (one row per field) because a 65-column single-row
  file is unreadable. Joins `rpa_mrf_jd_send` + `rpa_mrf`, groups and labels fields exactly
  as the modal does, honours the modal's conditional "Other" fields, and mirrors the modal's
  status tags — which differ from the list table's ("COMPLETED" vs "MANAGER SUBMITTED").
- `backend/src/controllers/mrf.controller.js`, `backend/src/routes/mrf.routes.js` —
  `GET /api/mrf/:id/export`, same `MRF_EXPORT_ROLES` + `exportLimiter` as the list export.
  Suppresses `X-Export-Row-Count`, since a "row" here is a field, not a record.
- `frontend/src/pages/MRF.jsx`, `frontend/src/services/mrfService.js` — `ExportButton` in the
  modal footer, view mode only (the file is read from the DB, so it would disagree with
  unsaved edits).
- `backend/src/tests/mrfDetailExport.test.js` (new) — 12 DB-free tests over the pure row
  builder. Verified: unit suite 107 passing, frontend production build clean.

## 2026-07-14 — Docs reorganization (`docs/reference/`, `docs/changelog/`, `docs/deployment/`)
**Why:** the doc set had grown past 30 files flat under `docs/`, making it hard to tell living
reference docs apart from dated session worklogs. Full detail in
[docs/changelog/CHANGES-docs-reorganization.md](./changelog/CHANGES-docs-reorganization.md).

- Moved 13 architecture/how-it-works docs into `docs/reference/` (`BACKEND.md`, `FRONTEND.md`,
  `VENDOR_PROCESS.md`, `screening.md`, etc.), 10 dated worklogs into `docs/changelog/` (all
  `CHANGES-*.md` + `UI_FIXES.md`), and `V16-CHANGES-AND-DEPLOYMENT.md` into `docs/deployment/`.
  `docs/CHANGELOG.md`, `docs/phase3/`, `docs/proposals/`, `docs/test-plans/`, and
  `frontend/UI-CHANGELOG.md` were left in place. No files deleted or content rewritten — pure
  regrouping, done with `git mv` to preserve history.
- Fixed every relative link broken by the move: markdown cross-links, `../backend` / `../frontend`
  source-code links inside the relocated reference docs, and plain-text `docs/Foo.md` path mentions
  in changelog prose and one backend comment (`seed-email-templates.js`). Verified with a scripted
  link-resolution pass — 0 broken links across 74 checked.

## 2026-07-13 — Friendly 429 messages with wait time
**Why:** Rate-limit responses said only "please try again later" — users had no idea how long to wait.

- `backend/src/utils/rateLimitHandler.js` (new) — `friendlyRateLimitHandler(whatHappened)` factory:
  computes the remaining wait from the limiter's per-client `resetTime` and responds
  `429 { status, message: "<what happened> Please try again in about X minutes." }`.
- `backend/src/app.js` — global + auth limiters use the handler ("You've made too many requests…" /
  "Too many failed sign-in attempts. For your security, sign-in is temporarily paused.").
- `backend/src/routes/auth.routes.js` — forgot-password limiter likewise ("Too many password reset
  requests."). No frontend change needed — pages already display the API's `message` field.

## 2026-07-13 — Forgot password (emailed time-limited reset link)
**Why:** A user who forgot their password had no self-service recovery — the only path was an admin
reset. Completes the account-management work from 2026-07-10.

- **Design:** stateless single-use reset tokens — a 30-minute JWT `{ userId, type: 'password-reset',
  fp }` signed with the existing `JWT_SECRET`, where `fp` fingerprints the CURRENT `password_hash`
  (sha256, first 16 hex). Resetting rotates the salt+hash, so the fingerprint stops matching and the
  token can't be replayed. No token table — deliberate, since the repo has no migration tooling.
  Reset tokens can't act as bearer tokens (`authenticate` also requires an `rpa_sessions` row).
- `backend/src/services/auth.service.js` — `generatePasswordResetToken`, `requestPasswordReset`
  (anti-enumeration: silent unless user exists + active + has email; fire-and-forget email; logs the
  reset URL in non-prod for dev testing), `resetPasswordWithToken` (expired/invalid/already-used all
  return distinct 400s — never 401, which the frontend interceptor hard-redirects on; deletes ALL
  sessions on success).
- `backend/src/services/emailNotification.service.js` — `sendPasswordResetEmail` (branded template,
  button + raw link, 30-min/single-use copy; logs `email_type: 'password_reset_request'`).
- `backend/src/config/emailRecipients.js` — new `passwordReset` flow, added to `NEVER_REDIRECT`
  (reset links always go to the account owner, even in staging).
- `backend/src/routes/auth.routes.js` + `auth.controller.js` — `POST /api/auth/forgot-password`
  (always generic 200; dedicated 5-per-15-min limiter counting ALL requests, since the global auth
  limiter only counts failures) and `POST /api/auth/reset-password` (newPassword min 8 max 128).
- `frontend/src/pages/ForgotPassword.jsx`, `ResetPassword.jsx` (new) — AuthLayout pages: generic
  success state; missing-token / expired / used-link states with "Request a new link"; confirm
  validator; success state pointing to Sign In.
- `frontend/src/layouts/AuthLayout.jsx` — pathname→heading map for the two new pages.
- `frontend/src/App.jsx` — routes under the `PublicRoute > AuthLayout` group. `Login.jsx` +
  `AdminLogin.jsx` — "Forgot password?" link under the submit button.
  `frontend/src/services/authService.js` — `forgotPassword()`, `resetPassword()`.
- No schema changes, no new env vars/dependencies. Verified end-to-end (17 API + 11 browser checks:
  anti-enumeration byte-identical responses, single-use replay rejection, all-session invalidation,
  429 rate limit, full UI journey incl. used-link state).

## 2026-07-10 — Login by email, admin username control, self-service password change
**Why:** Login accepted username only; the admin UI auto-generated usernames (`first.last123`) with no
way to set or change them; and non-admin roles (recruiter/vendor) had no way to change their own
password — the only password path was the admin portal. Overview + deploy notes in
[docs/deployment/V16-CHANGES-AND-DEPLOYMENT.md](./deployment/V16-CHANGES-AND-DEPLOYMENT.md).

- `backend/src/services/auth.service.js` — new `findUserByLogin()` (case-insensitive `username` OR
  `email`); `login()` uses it. New shared `hashPassword()` (same `salt:sha512` format). JWTs now carry
  a unique `jti` claim — fixes a race where two same-second logins produced identical tokens and
  violated the `rpa_sessions.token` unique constraint.
- `backend/src/controllers/auth.controller.js` + `routes/auth.routes.js` — new
  `POST /api/auth/change-password` (authenticated, **all roles**; current password verified; new
  password min 8/max 128). Deletes the user's other sessions; the current session survives. No
  credential email for self-chosen passwords (admin resets still email).
- `backend/src/controllers/admin.controller.js` — `createUser`: `username` now optional, defaults to
  the email; `updateUser`: case-insensitive email/username duplicate pre-check (excluding the edited
  user) returning the friendly `409 EMAIL_EXISTS` (was a raw Prisma P2002); both hash blocks replaced
  with the shared `hashPassword()`.
- `frontend/src/pages/AdminDashboard.jsx` — optional Username field in the Add/Edit User modal
  ("Defaults to the email address"); random username auto-gen removed (Auto-Generate = password only);
  username included in create/update payloads; 409 flags both email + username fields.
- `frontend/src/components/common/ChangePasswordModal.jsx` (new) — current/new/confirm form, inline
  error on wrong current password. Wired into the avatar dropdown (`MainLayout.jsx`) and the admin
  top-bar user chip.
- `frontend/src/pages/Login.jsx`, `AdminLogin.jsx` — labels now "Username or Email" (request field
  unchanged). `frontend/src/services/authService.js` — `changePassword()`.
- No schema changes, no new env vars or dependencies. Verified end-to-end (20 API + 8 browser tests).

## 2026-07-10 — Light/Dark/System theme + dark-mode contrast sweep (frontend)
**Why:** The app "randomly rendered black" — the old `ThemeContext` fell back to the OS
`prefers-color-scheme` when no stored theme existed and then persisted it, pinning OS-dark users to
dark with no rendered toggle to escape. After shipping a proper theme system, dark mode surfaced
contrast bugs (light-on-light / dark-on-dark text) across screens.

- `frontend/index.html` — anti-FOUC inline script: applies `data-theme`, `color-scheme`, and the
  `theme-color` meta before first paint. Default **Light**; OS honored only in System mode.
- `frontend/src/context/ThemeContext.jsx` — rewritten: three modes (`light`/`dark`/`system`) in
  `localStorage['ats_theme']`; OS listener only while in System mode; theme flips run through the
  transition helper.
- `frontend/src/utils/themeTransition.js` (new) — circular-reveal switch animation (View
  Transitions API) with cross-fade fallback and `prefers-reduced-motion` bypass.
- `frontend/src/components/common/ThemeToggle.jsx` (new) — animated sun↔moon toggle; wired into the
  main header + admin top bar (`MainLayout.jsx`); Appearance card added to `Settings.jsx`.
- `frontend/src/theme/themeConfig.js` — `darkTheme` now uses `algorithm: theme.darkAlgorithm`
  (fixes AntD-derived light status backgrounds: unreadable Alerts, Tag presets, disabled fills);
  dark component tokens refined (Modal/Drawer/Tooltip/links).
- `frontend/src/theme/index.css` — defined previously-missing vars (`--colorBgContainer` family,
  `--color-primary*`, `--text-secondary`, `--olive`, …); new semantic tokens (`--warn-*`,
  `--success-text`, `--info-strong`, `--overlay-scrim`); `:root, [data-theme='light']` selector
  enables scoped light re-theming; dark overrides for dropzone hover, CodeMirror shell, admin bar.
- `frontend/src/App.jsx` — `ForceLight` wrapper pins the public token-link routes (`/mrf-submit`,
  `/mrf/:id/approve`, `/missing-jd-upload`) always-light (external users have no toggle).
- Page sweep (~200 hardcoded hexes → theme vars, light mode visually unchanged):
  `Candidates.jsx`, `MRF.jsx`, `HRUpload.jsx`, `CandidateDetail.jsx`, `AdminDashboard.jsx`
  (Module Access switches/tiles/pills), `VendorPortal.jsx`, `VendorDashboard.jsx`,
  `CandidateScreening.jsx` (loading overlays), `EmailManagement.jsx` (CodeMirror dark theme),
  `Analytics.jsx`, `Dashboard.jsx`.
- Full detail: [frontend/UI-CHANGELOG.md](../frontend/UI-CHANGELOG.md) (2026-07-10 entries).

## 2026-07-10 — Fix frequent 429 "Too many requests from this IP" errors
**Why:** The global limiter allowed only 100 requests/15 min per IP over ALL of `/api` — a single SPA
user (let alone a whole office behind one NAT IP, or everyone behind the un-trusted reverse proxy)
exhausted it in minutes during normal use. Replaced with a two-tier scheme: generous global abuse
protection + strict brute-force limiting on login only. Full detail in
[docs/changelog/CHANGES-rate-limit-429-fix.md](./changelog/CHANGES-rate-limit-429-fix.md).

- `backend/src/app.js` — global limiter raised to 2000 req/15 min per IP (`/api/health` exempt); new
  auth limiter on `/api/auth` (20 per 15 min, **failed attempts only** via `skipSuccessfulRequests`);
  `app.set('trust proxy', 1)` when `TRUST_PROXY=true` so limits key on the real client IP.
- `backend/src/config/index.js` — limits env-configurable: `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`,
  `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_AUTH_WINDOW_MS`, `TRUST_PROXY` (defaults are the fix; no env
  change required).
- `backend/.env.staging`, `backend/.env.production` — `TRUST_PROXY=true` (both sit behind a reverse
  proxy); tuning vars documented. `.env.development` — commented docs only.
- `docs/reference/BACKEND.md` — rate-limiter section rewritten for the two-tier scheme.
- Requires a restart of staging/production to take effect.

## 2026-07-03 — Superadmin/Admin permission tightening + credential email routing
**Why:** Any admin could delete users and edit/reset passwords of co-admins. New rules: Delete User is
superadmin-only; an admin may edit details/passwords of **self** and of **recruiters/vendors** only (not
co-admins); a superadmin may reset passwords of admins/recruiters/vendors. Credential/password emails must
reach the affected user's own inbox even in staging (not the test-recipient redirect).

- `backend/src/config/roles.js` — new `outranks(requesterRole, targetRole)` helper (strict `ROLE_RANK`
  comparison; equal ranks do NOT outrank each other).
- `backend/src/controllers/admin.controller.js`:
  - `updateUser` (details + password reset) — target must be **self or a strictly lower role**; a
    superadmin may additionally edit a peer superadmin's **details** (but a superadmin password can only
    be changed by its owner); own role changes rejected; `is_active` ignored on self-edits (lockout
    prevention).
  - `deleteUser` — superadmin-only; self-deletion blocked server-side (was UI-only).
  - `toggleStatus` — self-toggle blocked server-side; target must be a strictly lower role (admins can no
    longer deactivate co-admins).
- `backend/src/config/emailRecipients.js` — `userCredentialUpdate` added to `NEVER_REDIRECT`: credential /
  password-change emails always resolve to the target user's own email in every environment; all other
  flows still redirect to the staging test inbox.
- `frontend/src/pages/AdminDashboard.jsx` — mirrors the rank rule: Edit enabled for self + lower roles,
  Toggle for lower roles only, Delete for superadmins only, with explanatory tooltips; Role and Account
  Status fields disabled when editing your own account. Deactivate confirmation restyled as a warning
  (⚠️ title, amber consequence box, danger-styled "Deactivate" button); activation keeps the positive style.
- `docs/reference/ADMIN_ACCESS_CONTROL.md` — rules, capability matrix, and endpoint table updated.
- `docs/reference/ROLE_RULES.md` (new) — per-role can/cannot reference (Super Admin / Company Admin / Recruiter /
  Vendor) incl. universal rules and a quick-reference matrix.

## 2026-06-30 — Candidate card enterprise refinement (pass 2)
**Why:** Score block read too big; user wanted more enterprise polish but to keep the SKILLS tags multicolor.

- `frontend/src/theme/index.css` — shrank `.cand-score*` (smaller value/stars/verdict, tighter box); added a
  left fit-accent rail (`.cand-card::before` driven by `--cand-accent`) and a `.cand-divider` hairline.
- `frontend/src/pages/CandidateScreening.jsx` — `scoreTierColor(stars)` helper sets `--cand-accent` per card
  (green/gold/amber/neutral by star tier); `renderStars(count, size)` now takes a size (11px in the scorecard);
  added the divider between the identity and skills/match bands. `SkillTags` (SKILLS row) left unchanged.

## 2026-06-30 — Screening UI premium refresh
**Why:** The Candidate Screening page looked cluttered/flat — every card repeated all mandatory + good-to-have
skills (incl. grey "missing" tags) with weak hierarchy. Refine the existing olive/gold brand into a calmer,
premium look. Display-only.

- `frontend/src/theme/index.css` — added scoped screening classes (light + dark): `.cand-card`, `.cand-name`,
  `.cand-company`, `.cand-avatar-ring`, `.cand-score*`, `.match-meter*`, `.skill-chip*`, `.cand-section-label`,
  `.cand-signal-hint`.
- `frontend/src/pages/CandidateScreening.jsx`:
  - `JdSkillMatch` now takes a `variant` prop. `variant="card"` = compact **match meter + present-only chips**
    (no "missing" spam); `variant="full"` (default, drawer) keeps the complete present/missing breakdown.
  - Candidate card restructured: gradient-ring avatar, `.cand-name`, qualification folded into the meta-pill row,
    a single "Skills" row, the compact match meter, and an elegant right-side `.cand-score` scorecard.
  - Summary bar decluttered: primary count + muted detail; star buckets stay as stat chips.
- `docs/reference/screening.md` — noted the card uses the compact meter; drawer keeps the full breakdown.

## 2026-06-30 — App-load roles preload + Refresh button
**Why:** Roles/candidates re-fetched on every page visit and were lost on navigation; no manual reload.

- `backend/src/services/screening.service.js` — `searchRoleCandidates(mrfId, force)` skips the Redis read when
  `force` is true (recompute + overwrite), so Refresh returns genuinely fresh candidates.
- `backend/src/controllers/screening.controller.js` — reads `?force=1` / body flag and passes it through.
- `frontend/src/services/screeningService.js` — `searchRoleCandidates(mrfId, { force })` → `?force=1`.
- `frontend/src/hooks/useScreeningData.js` (new) — React Query hooks `useApprovedRoles()` and
  `useRoleCandidates(roleId, enabled)` (`staleTime: Infinity`; cache persists across navigation).
- `frontend/src/App.jsx` — `AppShell` prefetches roles once at app load (gated on the `candidate_screening`
  module / admin).
- `frontend/src/pages/CandidateScreening.jsx` — roles + candidates sourced from the hooks; sync effect feeds the
  existing render state; `selectedRoleId` + `activeTab` persisted in `localStorage`; Refresh button (force-bypass
  cache) by the role selector and on the keyword tab; removed the cosmetic preloading bar.

## 2026-06-30 — Client-side pagination (both tabs)
**Why:** Result lists rendered all rows at once; hard to scan.

- `frontend/src/pages/CandidateScreening.jsx` — `currentPage`/`pageSize` state, sliced render, AntD `<Pagination>`
  (10/20/50), reset to page 1 on new search / tab switch. Select-All still spans the full result set.

## 2026-06-30 — Keyword-tab searched-skill signals
**Why:** Extend JD Skill Match to the Keyword Filtering tab so searched terms are cross-referenced too.

- `backend/src/services/screening.service.js` — `searchKeywordCandidates` attaches `jdSkillSignals`
  (searched keyword/designation as the matched skills) when a term is present.
- `frontend/src/pages/CandidateScreening.jsx` — `<JdSkillMatch>` gained a `label` prop; keyword mode shows
  "Searched Skills" / "Searched Skill Match".

## 2026-06-30 — JD Skill Match (JD Filtering tab)
**Why:** Cross-reference each JD skill against the candidate's resume signals + declared skills so recruiters see
which mandatory skills are actually evidenced. Display-only (scoring unchanged).

- `backend/src/services/screening.service.js` — `buildJdSkillSignals()` (+ helpers `splitSkillPhrases`,
  `parseDeclaredSkills`, `parseTechnicalTerms`, `skillMatchesTerm`); attaches `jdSkillSignals` per candidate in
  `searchRoleCandidates`.
- `frontend/src/pages/CandidateScreening.jsx` — `JD_SKILL_STATUS` map + `<JdSkillMatch>` component on card + drawer.
- `docs/reference/screening.md` (new, consolidated) — feature documentation.
