# Client Round and Offer trimmed to "mark only"

**Date:** 2026-08-25 · **Modules:** M3 (Client Interview), M5 (Offer)

## Why

RT's instruction: **both modules are handled entirely offline, outside the ATS.
The app is used to mark the rounds. Nothing more.**

That is not new in itself — Q14 already said *"the system must not generate
anything for the client"* and Q3 already scoped the offer to record-only. What
was new is how much the app still did *around* the marking. An audit of both
stages found seven things beyond it, including one outright contradiction of
Q14.

## The defect this started from

**Marking a Client Interview "held" emailed a scorecard link to whatever address
was typed as the interviewer** — and that field was *required* on a round that
otherwise sends nothing. `dispatchScorecards()` had no client-stage exclusion,
unlike `interviewReminder.js`, which has gated on the same switch since M3. If a
recruiter entered the client's own contact — the obvious thing to type on a
client round — the ATS emailed the client a no-login form. Exactly what Q14
forbids.

A second, smaller defect: `SCHEDULABLE_STAGES.client.ownerField` pointed at
`rpa_mrf.client_round`, which is a **Yes/No select** on the MRF form. The
interviewer's name is in `client_round_coordinator` on the next line. `cleanHint()`
filters `"No"` but `"Yes"` passes the human-name check, so the booking modal
displayed **"Interviewer: Yes"**. `client_round_coordinator` and `client_details`
were never read by the pipeline at all.

## Nothing is deleted

Every removal here is **commented out with a dated reason**, not cut. Both halves
reverse decisions RT previously gave in writing, and this codebase has already
seen one reversal (Client Interview shipped with automated Teams invites in M3,
then rolled back days later). Restoring either feature should be an uncomment.

The `rpa_offers.approval_*` columns and existing `client` rows in
`rpa_interview_schedule` are left in place and simply stop being written, so
history stays readable and a restore needs no DDL.

## What changed — Client Round

The round keeps its board column, its Approve/Reject/Hold bar with the mandatory
reason, the optional-skip control, the candidate outcome email and the vendor
outcome line. Everything else goes.

- **`client` is no longer schedulable.** Its entry in `SCHEDULABLE_STAGES` is
  commented out, and `'client'` is out of the drawer's `SCHEDULABLE_STAGE_KEYS`.
  That one change removes the booking modal, the Schedule/Reschedule/Cancel
  buttons, the held/no-show occurrence controls, the Teams card, the
  "Send scorecard link" action and the double-booking refusal, because all of
  them were already keyed off it.
- **`stageSendsInvites()` no longer derives from that entry.** It now reads a
  dedicated `MANUALLY_COORDINATED_STAGES` list. This matters: the old
  implementation was `SCHEDULABLE_STAGES[k]?.autoInvite !== false`, which with
  the entry commented out returns `undefined !== false` → **`true`** — silently
  re-enabling outward mail on the one round that must never send any, and
  disarming the new scorecard guard. Keeping the rule in its own list also means
  it still holds for bookings made before this change.
- **`dispatchScorecards()` returns early** for a manually-coordinated round.
- **The occurrence sweep skips them** in both places it touches a row: the
  per-row loop (no "please confirm it happened" nudges) and the write-off
  `updateMany` (no stamping `unconfirmed`, which would be a verdict the ATS has
  no basis for — it never saw the meeting).
- **The round panel** now reads *Stage Entry → Arranged Offline → Client Feedback
  → Approve / Reject*, telling the recruiter to put the client's transcribed
  verdict in the outcome notes. An existing booking is still shown read-only so
  that history does not vanish.
- **MRF hint fixed** to `client_round_coordinator`.

Vendor schedule/reschedule/cancel notices for this round disappear as a
consequence — those `notifyVendor()` calls live inside the booking functions,
which are no longer reachable for `client`. `VENDOR_STAGE_POLICY` is unchanged,
so the vendor still gets the outcome line.

## What changed — Offer

The stage was already record-only: no letter, no PDF library in the project, no
e-signature, no CTC or salary fields, no version history, and no candidate-facing
offer email. What went is the internal approval and its chase.

- **`requestApproval()` / `approveOffer()`** commented out as one chain — service,
  controller, the two routes, the frontend service calls, the `offerMutation`
  branches, and the two buttons plus their status lines in `OfferActions`.
- **`runApprovalNudges()`** commented out, along with its call in
  `runOfferSweep()`, the `'Offer Approval Reminder'` seed template, the
  `offerApprovalNudge` recipient key, and `NOTIFICATION_TYPES.OFFER_APPROVAL_REQUESTED`.
  **This was the only outbound email the Offer stage generated.** What remains is
  three bare one-line vendor notices and internal bell notifications.
- **`recordOfferShared()`** no longer computes `skippedApproval` or appends
  *"(internal approval was not recorded)"* — there is no longer an approval to
  skip. The soft gate it implemented is moot.
- **The first progress segment** was rebuilt. It keyed off `approval_status`, so
  leaving it would have parked every offer on *"Internal approval not requested
  yet"* forever; it now keys off the journey arriving on the stage. Segment 2's
  label changed from "Offer Sent" to "Offer Shared", since the ATS does not send
  it.

Kept, deliberately: the joining date and remarks on "Record offer shared", the
90-day post-joining auto-close (Q12), the MRF close/re-open coupling, the
decision bell notification, and the bare vendor lines.

The live flow is now **Record offer shared → Mark accepted / rejected → Close
candidate record**.

## Tests

`SCHED-02` now asserts the client round is **refused** (400) rather than booked
silently, and a new case proves a *legacy* client booking marked held dispatches
no scorecard and sends no email — the regression guard for the defect above.
`E2E-05` was updated the same way.

⚠ **`SCHED-05/08/09/10` and the scorecard cases moved from the Client round to
the CEO round.** They used `client` precisely *because* it sent nothing, so these
cases now send real panel mail to the test mailbox on every run where they
previously sent none. The file header records this.

`OFFER-01/02` and the whole `OFFER-14` nudge block are commented out with their
imports.

## Files

**Backend:** `services/interviewSchedule.service.js`,
`services/interviewScorecard.service.js`, `services/offer.service.js`,
`services/notification.service.js`, `jobs/interviewOccurrence.js`,
`jobs/offerSweep.js`, `controllers/pipeline.controller.js`,
`routes/pipeline.routes.js`, `config/emailRecipients.js`,
`prisma/seed-email-templates.js`

**Frontend:** `components/pipeline/PipelineDrawer.jsx`, `services/pipeline.js`

**Tests:** `integration/schedulingAndScorecard.test.js`,
`integration/crossModuleE2E.test.js`, `integration/documentsAndOffer.test.js`,
`integration/sweepJobs.test.js`

**No schema change.**

## Verification

1. Boot the backend and open `/pipeline` — commenting out across layers fails at
   import time, not call time, so this is the first check.
2. Advance a journey to Client Interview: no "Schedule Interview" button; the
   panel offers marking only; Approve/Reject/Hold still works and still emails
   the candidate.
3. Create a `client` row in `rpa_interview_schedule` by hand, mark it held, and
   confirm **zero** rows in `rpa_interview_scorecard` and `rpa_email_messages`.
4. Advance to Offer: the bar starts at "Record offer shared"; the progress strip
   does not sit stuck on segment 1.
5. `runOfferSweep()` directly: no approval email attempted;
   `runPostJoiningAutoClose()` still closes a back-dated joined record as
   `joined` and still leaves a recruiter-set `joined_and_left` alone.
6. Legacy write-backs still land — `rpa_cv.FinalStatus`,
   `rpa_shortlisted_candidates.pipeline_status` / `offer_sent_at` /
   `offer_accepted_at` — the vendor dashboard and analytics read them directly.

## Follow-up: marking the Client Round, and three defects the trim introduced

Manual testing showed the trimmed Client Interview panel was not actually usable. The Client Feedback
row said *"put their feedback in the outcome notes"* while pointing at nothing clickable. RT's
requirement is that **each item in the round is individually markable, with the data behind it** —
so the round gained two real steps.

**New: `backend/src/services/clientRound.service.js`** — `recordClientRoundArranged()` (when the
meeting happened, optional client-side contact) and `recordClientRoundFeedback()` (the transcribed
verdict). Both write directly to `rpa_interview_schedule`; **no DDL**. That table already models a
round, when it happened, whether it was held and free-text notes, so a dedicated table would have
duplicated all four for two fields' worth of new information. What it deliberately does *not* reuse
is `interviewSchedule.service.js`'s booking flow, which exists to invite people — there is no code
path from this module to an outbound message. Two new routes under `/api/pipeline/:id/client-round/*`.

Then three defects, all introduced by the trim itself, all in the Client Round:

**1. The client buttons read the wrong schedule — the feedback button never rendered.**
The segment JSX resolves `interviewSchedule` to the component-level `data?.interviewSchedule`, while
the *segments* are built from a per-stage expression passed inline. `getPipelineDetail` only
populates the singular field when `isSchedulableStage(current_stage_key)` — and commenting `client`
out of `SCHEDULABLE_STAGES` made that false. So the segment text was right (from
`interviewSchedules.client`) while the button was computed from `null`: "Mark as held" never became
"Edit date", never prefilled, and because the feedback button is gated on that same value it
**never rendered at all**. Fixed by hoisting `stageSchedule` in `renderStagePanel()` and using it in
both places.

**2. `liveRow()` would 500 on a legacy record.** It filtered `status: 'scheduled'`, but
`uq_interview_schedule_live` is UNIQUE `(pipeline_id, stage_key) WHERE status <> 'cancelled'`, and a
client round marked held under the old flow sits at `status: 'completed'`. On such a row the lookup
missed, `recordClientRoundArranged()` took its create branch and hit the unique index, and
`recordClientRoundFeedback()` claimed the round had never been arranged. Now `status: { not:
'cancelled' }`, matching the index and `getSchedulesByStage()`.

**3. Arranged rounds leaked back into "unresolved interviews".** A round marked arranged but not yet
fed back is `status: 'scheduled'` with a past end date and no `occurrence_status` — it matched every
clause of `listUnresolvedInterviews()` and reappeared in the confirm-it-happened queue this change
set removed, labelled with the raw key `client` (its label lookup no longer resolves).
`MANUALLY_COORDINATED_STAGES` is now excluded from that query.

**Copy.** The second row was labelled "Arranged Offline" before anything had been arranged. Labels
are fixed for the life of a row, so it became **"Client Meeting"** — true in both states — and the
sentence underneath carries the state: *"Arrange this with the client, then mark it here once it has
happened"* → *"Arranged offline — held 24 Aug, 04:44 pm with R. Fernandes"*. Client Feedback reads
*"Available once the meeting is marked as held"* → *"Not recorded yet — add what the client said"* →
the quoted transcription. Buttons are primary while the step is outstanding, secondary once done.

**Also found, deliberately not fixed** (a technical round, outside this pass's scope): the Teams card
at `PipelineDrawer.jsx` is gated on `isSchedulableStageKey(stage.stage_key)` but not on `isCurrent`,
so viewing a past round shows the *current* round's join link and interviewer inside it. The same
`stageSchedule` hoist would close it.

## Follow-up: the Offer round's fourth segment, and landing after closure

**The Offer round's "Accepted / Declined" row showed interview copy.** The offer branch of
`buildPipelineSegments()` set segments 1–3 and never touched `s4`, so it fell through to the generic
tail written for interview rounds — *"Awaiting your decision once results are in"*. An offer has no
results, and the decision is the **candidate's**, not the recruiter's. Worse, the actual decision was
being rendered into "Awaiting Response" while the row labelled for it sat empty.

Segments 3 and 4 now mean what their labels say — 3 is the wait, 4 is the answer:

| Row | Before it goes out | Awaiting reply | Answered |
|---|---|---|---|
| Awaiting Response | Awaiting the offer to be shared | Awaiting the candidate's reply | Candidate replied · {date} |
| Accepted / Declined | Not yet — the offer has not gone out | Mark their answer below once they reply | Accepted · joining {date} / Declined by the candidate |

The offer stage now explicitly opts out of the generic tail, placed **after** the `outcomeEvent`
branch so a closed journey still shows its final status rather than offer wording. The "Offer Shared"
sentence also now names the control that exists (*"use 'Record offer shared' below"*) instead of the
dead-end *"Record the offer here"* — the same failure mode as the client round's original copy,
milder only because the button was at least present.

**Closure now returns the recruiter to the board.** `closureMutation` refreshed the board but left
the drawer open on a journey whose card had just been removed, with every action bar disabled. It now
calls `onClose()` after `onChanged()`. That also clears the `?candidate=` URL param, so a refresh or
a shared link cannot reopen a closed journey into a dead drawer.

## Still open

**O1/O2 reverse RT's written answer to Q3** (*"internal approval = yes, with a
reminder nudge"*) **and the in-house Q26 decision.** That reversal is owed a
written confirmation from RT the same way the original answer was given, and
should be recorded in `docs/phase3/04-QUESTIONS.md`.
`01-PROCESS-UNDERSTANDING.md:3` carries an explicit warning about a prior
instance of a paraphrase being mistaken for a sign-off.
