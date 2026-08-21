# Phase 3 — Test Pass Results

**Environment:** Staging (`recruitmentautomationdb` @ 20.244.34.176, PostgreSQL 18.1)
**Started:** 2026-08-19
**Executed by:** Claude, via automated harness against the live service layer
**Pre-pass snapshot:** `.test-snapshots/staging-pre-testpass-20260819-200434.dump` (verified restorable)

Recording format follows `phase3-test-execution-plan-for-developer.md` §4 — Pass / Fail / Blocked,
with observed behaviour quoted where it matters.

---

## Bottom line for the client demo

**79 of 122 cases executed. Ten real defects found — nine fixed, one unresolved (D10, not
reproducible).**

🔴 **The one to read is D7.** File-upload validation checked the filename extension and nothing else,
so an executable renamed to `.pdf` uploaded successfully into the OneDrive tenant — through the
**public, unauthenticated** candidate endpoint, where the only credential is a token sent by email.
Fixed on the document route; the other four upload routes share the pattern and are authenticated.

**D4, D5, D8 and O3 were fixed on 2026-08-21.** The reschedule now patches the Graph event instead of
destroying it, so the Teams link survives and Exchange stops sending the contradictory `Canceled:`
notice; candidate emails resolve from the CV rather than the stale denormalised copy; and the public
upload page shows the server's actual reason instead of telling candidates to retry the one thing
that cannot work.

**One item remains unresolved: D10** — the drawer showing a stale Teams link after a reschedule. Four
structural causes were ruled out and it did not reproduce on re-test, with no code change in between.
Left open pending sign-off rather than closed, since two clean runs do not disprove an intermittent
render race.

⚠️ **Two manual checks are owed on the fixes**, both needing a staging restart: confirm the
`Canceled:` notice has stopped arriving on a reschedule (D4), and that the upload page now shows the
server's message (D8).

**Every defect after D2 was found by manual testing, not by the automated suite** — and the suite was
green throughout. D1 hid behind a unit test that asserted a constant instead of running the query;
D3 needed two tabs minutes apart, which `Promise.allSettled` cannot simulate; D7 needed someone to
rename a file rather than follow the written step.

**D3, found 2026-08-20 during the manual pass, is the one worth reading.** A stale browser tab could
advance a candidate a *second* time — skipping a stage nobody chose to skip, sending two outcome
emails, and writing an audit trail that recorded a decision at one stage advancing past another. It
was found by two tabs clicking minutes apart, which is something the automated suite could not do:
PIPE-03 fires both approvals at once and so only ever tested the concurrent window. Both defects the
manual pass found were invisible to a green suite, for the same underlying reason D1 was.

The parts of Phase 3 a client is most likely to see or ask about are now verified end to end
against a live database, not inferred from reading code:

- ✅ **The vendor dual-notification (VEND-01) genuinely fires.** It was documented as built since M1
  and had *never run once* — zero vendor-sourced journeys existed on this database before today.
- ✅ **The two privacy rules hold.** A vendor receives nothing during document collection, and none
  of a recruiter's free text ever reaches them (proved by planting a marker string and confirming
  its absence).
- ✅ **All four concurrency guards hold**, verified by firing genuinely simultaneous requests and
  checking the loser rolled back — not merely that a 409 came back.
- ✅ **MRF close/reopen arithmetic is now correct.** It was silently broken (defect D1).
- ✅ **Five full end-to-end journeys pass**, including vendor → offer → JOINED with lock freeze.

**What is honestly not covered yet:** ~21 cases need a human at a browser or mailbox (Teams round
trips, OneDrive uploads, UI rendering), and 12 are blocked on the pending Graph grant and the
unconfigured Zeko URL. All are listed individually below with what to do — none are silently
skipped. **Roughly 30–45 minutes** of manual work covers the demo-critical ones, tracked in
[phase3-manual-pass-checklist.md](phase3-manual-pass-checklist.md).

**Manual pass progress:** DOC-03 ✅ done (2026-08-20). Still open: SCHED-01/06/07 (the Teams round
trip) and N5 (409 message propagation) — those three remain the demo-critical set.

**The most important finding is D1.** A requisition could never auto-close on acceptance, which is
the double-hiring risk the execution plan ranks third in priority. It sat behind a green 182-test
suite because the existing unit test asserted a *constant* rather than running the *query*. That is
precisely the gap this pass existed to close, and it would not have been found by any amount of
further code reading.

---

## Progress

| Block | Cases | Executed | Pass | Fail | Blocked | Remaining |
|---|---|---|---|---|---|---|
| A — M1 Pipeline (PIPE) | 16 | 14 | 14 | 0 | 0 | 2 (manual/UI) |
| B — M3a Scheduling (SCHED) | 19 | 15 | 15 | 0 | 0 | 4 (manual/Graph) |
| C — M4 Documents (DOC) | 13 | 10 | 10 | 0 | 0 | 3 (manual) |
| D — M5 Offer (OFFER) | 16 | 14 | 14 | 0 | 0 | 2 |
| E — M6 Vendor (VEND) | 16 | 9 | 9 | 0 | 0 | 7 |
| F — Cross-module (E2E) | 5 | 5 | 5 | 0 | 0 | 0 |
| N — Negative/resilience | 5 | 1 | 1 | 0 | 0 | 4 |
| G — Companion plan | 32 | 0 | — | — | — | 32 |
| **Total** | **122** | **68** | **68** | **0** | **0** | **54** |

**2026-08-20 additions:** DOC-03 (manual, live journey), N5 (manual — found defect D3), and DOC-11 /
OFFER-14 / OFFER-15 automated via direct job calls (Block G below, 12 new assertions).

## 🔴 Product defects found: 3 — two fixed, one open

| # | Severity | Where | Effect | State |
|---|---|---|---|---|
| **D1** | 🔴 **High** | `mrfClosure.service.js` `countAcceptedHires()` | **No requisition could ever auto-close on acceptance.** Double-hiring risk. | ✅ Fixed |
| **D2** | 🟡 Medium | `offer.service.js` `recordCandidateDecision()` | A truthy *string* passed the `amend` guard, so a recorded acceptance could be silently overwritten. | ✅ Fixed |
| **D3** | 🔴 **High** | `pipeline.service.js` `setStageOutcome()` + `pipeline.controller.js` | **A stale browser tab can advance a candidate a second time**, skipping a stage entirely and sending two outcome emails. The concurrency guard only catches simultaneous requests, not stale ones. | ✅ Fixed |
| **D4** | 🟠 **High** | `interviewSchedule.service.js` `rescheduleInterviewRound()` + `graphCalendar.service.js` | **Rescheduling destroyed the Teams meeting instead of patching it.** The join link died, and Exchange sent the candidate its own `Canceled:` notice — telling them the interview was cancelled at the same moment they were told it moved. | ✅ Fixed |
| **D5** | 🟡 Medium | `interviewSchedule.service.js` — denormalised `candidate_email` | **Editing a candidate's email did not reach a live journey** — invites kept going to the stale address. | ✅ Fixed |
| **D6** | 🟠 High | `document.routes.js` `fileFilter` | A rejected upload answered **500 instead of 400**, lost its explanatory message in production, and **emailed a "Backend Error Alert" to the team** — remotely triggerable on a public endpoint. | ✅ Fixed |
| **D7** | 🔴 **High** | every upload route — `document`, `hrUpload`, `candidate`, `assessmentImport`, `vendor` | **File validation was extension-only.** An executable renamed `.pdf` uploaded successfully into the OneDrive tenant through the **public, unauthenticated** endpoint. | ✅ Fixed (document route) |
| **D8** | 🟡 Medium | `DocumentUpload.jsx` | The page **discarded the server's precise reason** and told the candidate *"Please try those again"* — advice that cannot work. Fixed together with **O3**, the client-side validation gap on the same page. | ✅ Fixed |
| **D9** | 🟡 Medium | `PipelineDrawer.jsx` `interviewCancelMutation` | **A cancellation reason cannot be supplied from the UI at all** — the modal has no reason field, so every recruiter cancellation records *that* a round was cancelled, never *why*. | ✅ Fixed |
| **D10** | 🟡 Downgraded | `PipelineDrawer.jsx` — schedule / reschedule view refresh | Drawer appeared to keep the **old time, meeting ID and passcode** after a reschedule. **Not reproducible on re-test** (twice, no reopen, values matched the DB exactly) — and no code changed in between. Most likely an observation timing artifact in the original run. | ⚠️ Not reproducible |

### D1 — MRF never auto-closed (the significant one)

**Symptom:** OFFER-08 — accepting an offer on a 1-opening requisition left `filled_at` null.
Re-probed on a brand-new isolated MRF to rule out test contamination: `accepted hires after accept: 0`
for an offer whose `candidate_decision` was demonstrably `'accepted'`.

**Root cause — SQL three-valued logic.** The query filtered:
```js
NOT: { final_outcome: { in: [...VACATING_OUTCOMES] } }
```
For an **open** journey `final_outcome IS NULL`. In SQL, `NULL IN (…)` evaluates to `NULL`, and
`NOT NULL` is `NULL` — not `TRUE`. The row is therefore excluded. Every in-flight journey has a null
`final_outcome`, so **`countAcceptedHires` returned 0 in exactly the case that matters**, `accepted <
openings` always held, and no requisition ever closed.

Isolated by narrowing the filter one clause at a time:
| Query | Count |
|---|---|
| decision only | 1 |
| + relation `mrf_id` | 1 |
| + `NOT { in: [...] }` | **0** ← |
| + null-safe `OR` | 1 |

**Fix:** an explicit NULL branch —
`OR: [{ final_outcome: null }, { final_outcome: { notIn: [...VACATING_OUTCOMES] } }]`.

**Verified after fix:** `accepted hires: 1`, `filled_at` stamped, log reads
*"MRF 141 marked filled — 1/1 opening(s) filled"*. OFFER-08/09/10 now pass.

**Why the existing suite never caught it.** `mrfClosure.test.js` asserts only the
`VACATING_OUTCOMES` *constant* — its membership, uniqueness and frozenness. It never executes the
query. No pure unit test could catch this; it needs a real database and a real null. This is
precisely the gap the plan says the pass exists to close, and it lived behind a green 182-test suite.

`countAcceptedHires` also feeds `reopenMrfIfUnfilled`, so the reopen path was reading the same
wrong number. Grepped the codebase for the same `NOT { in: … }` shape elsewhere — **no other
occurrence**, so the defect is contained to this one query.

### D2 — `amend` accepted a truthy string

**Symptom:** OFFER-11 — `recordCandidateDecision(id, { decision: 'rejected', amend: 'true' })`
succeeded, overwriting a recorded acceptance. The test plan explicitly asks whether the
strict-boolean check rejects a truthy string; it did not.

**Root cause:** `if (alreadyDecided && !amend)` is a truthiness test, so any non-empty string passes.

**Scope — narrower than it first looks.** `pipeline.controller.js:438` already narrows the HTTP body
with `amend: amend === true`, so **the REST API was never exposed**. The looseness only affects
direct service callers — jobs, scripts, future code. Fixed as defence in depth (`amend !== true`),
since this is the one flag whose entire purpose is "the caller has to mean it".

**Regression check after both fixes: `npm run test:unit` → 182 tests, 182 pass, 0 fail.**

### D3 — a stale tab can double-advance a candidate (found 2026-08-20, OPEN)

**Found by:** the N5 manual spot-check, doing something the automated pass structurally could not —
two tabs clicking *minutes apart* rather than two promises firing at once.
Evidence: `docs/test-claude-chrome/409conflictspotcheck.html`.

**Symptom.** Journey 40 at `zeko_hr`, open in two tabs. Tab A approves → 200, advances to
`assessment`. Tab B — stale UI still showing HR Screening — approves → **also 200**, advances to
`zeko_fn`.

| | State |
|---|---|
| Before | `zeko_hr` (HR Screening) |
| Tab A approve | 200 → `assessment` (IQ / Tech Assessment) |
| Tab B approve (stale) | 200 → `zeko_fn` (Functional Screening) |
| **Net** | **`assessment` skipped entirely; two outcome emails to the candidate; a stage-history row recording an HR-Screening decision that advanced past a stage the candidate never entered** |

**Root cause — the guard is read-then-claim inside ONE request.** `setStageOutcome` claims
conditionally on `current_stage_key` (`pipeline.service.js:629`), but that value is read from the
database *at the top of the same request*. It is **not supplied by the client** — the controller
(`pipeline.controller.js:146`) accepts `outcome_key`, `reason_id`, `other_text`, `notes`,
`email_subject`, `email_body`, `skip_optional_next`, and no stage at all.

So the guard compares the database against *itself*. It is a genuine protection against two requests
interleaving inside the transaction window — which is exactly what PIPE-03 fired and passed. It is
**no protection at all** against a tab whose user is looking at a stale screen: by the time Tab B
arrives, it reads the already-advanced state, computes the next stage from *that*, and its claim
matches cleanly.

Note the contrast with `scheduleInterview` directly below it in the same controller, which **does**
take a `stage_key` from the client and validates it (that is what SCHED-03 exercises).

**Why PIPE-03 passing is not in conflict with this.** PIPE-03 remains correct and its result stands
— simultaneous approvals really do yield one 200 and one 409 with the loser rolled back. The two
findings describe different windows. PIPE-03 covers *concurrent*; D3 covers *stale*. Only the first
was ever tested, and only the first is defended.

**Scope.** The same last-write-wins hole was confirmed on `PipelineConfigPanel` (stage edit) and
`CandidateDetail` (candidate edit), where a stale save silently clobbers the fresher one. Those lose
an edit; the pipeline case corrupts workflow state and emails the candidate, which is why D3 is
scored High on the pipeline path specifically.

**✅ FIXED 2026-08-20.** Four changes:

| Where | Change |
|---|---|
| `pipeline.service.js:545` | `setStageOutcome` takes an optional `expectedStageKey` and 409s when it disagrees with `current_stage_key`, before any work is done |
| `pipeline.controller.js:149` | Reads `expected_stage_key` off the body and passes it through |
| `PipelineDrawer.jsx` (submit) | Sends `expected_stage_key: pipeline?.current_stage_key` — the stage the drawer is **rendering**, deliberately not a fresh read, which would defeat the purpose |
| `PipelineDrawer.jsx` (onError) | On a 409: dismiss the decision modal, **close the drawer**, and refresh the board. The message says "reopen the candidate to see where they are now" — so the UI does exactly that |
| `Pipeline.jsx` | New `onStaleConflict` prop — refreshes the board **without** the "Pipeline updated." success toast that `onChanged` carries |

**UX follow-up, same day (found by the recruiter running N5).** The first version left the drawer and
the decision modal open behind the error. Two problems with that:

1. It **contradicted its own message.** The toast says "reopen the candidate", and the candidate was
   still sitting there open, with Approve / Hold / Reject buttons inviting the identical click.
2. Every control on screen had been computed from a stage the candidate had **already left** — the
   stage strip, the "Record outcome — current stage" panel, the whole right-hand pane.

Worse, the first version called `onChanged()` to refresh the board — but that callback also fires a
`"Pipeline updated."` **success** toast, so a failed action rendered a success message directly
beside the error saying the opposite. Hence the separate `onStaleConflict` prop: same board refresh,
no success toast.

**Second UX pass, same day (also from the recruiter running N5).** With the drawer closing correctly,
the board behind it was still fully legible and interactive while the error was up — and it visibly
re-sorted as the refresh landed, so a card jumping columns behind a toast read as *another* event
rather than as the correction to the one just refused.

The board is now **dimmed and blurred for exactly as long as the message is up**, then returns to
normal:

| Piece | Detail |
|---|---|
| Treatment | `var(--overlay-scrim)` + `blur(4px)` — **the same tokens `LoadingOverlay` already uses**, so a blocked board looks identical across the app, and both values are theme-aware (light and dark are defined separately in `index.css`) |
| Where it lives | `Pipeline.jsx`, not the drawer — the drawer unmounts itself on conflict and an unmounted component cannot hold anything on screen |
| Layering | `zIndex: 1500`, deliberately **below** antd's message layer (2010), so the toast stays crisp on top of the blur rather than being blurred with everything else |
| Timing | Scrim lifetime and toast duration are both `5s` and documented as one interaction — the error is two sentences and asks the recruiter to act, so the 3s default was too short |
| Input | `pointer-events` blocked — the board underneath is precisely the state the recruiter was wrong about |

**Frontend build after both changes: `npm run build` → exit 0, 4101 modules transformed.**

**The existing conditional claim was NOT touched.** It is still correct and still needed — D3 added a
second guard, it did not replace the first. The two cover different windows, which the new tests
assert explicitly.

**Deliberately optional.** Omitting `expectedStageKey` keeps the old behaviour, so jobs, scripts and
the pre-existing tests are unaffected. Only a caller with a *screen* has a meaningful answer to
"what were you looking at", so only the HTTP path sends it.

**Tests added** — `pipelineStageEngine.test.js`, `describe('D3 …')`, 4 cases, all passing:

| Case | Asserts |
|---|---|
| Stale decision refused | First approval completes (**awaited, not concurrent**), second names the old stage → 409, exact message, **candidate still at `assessment` not `zeko_fn`**, and no orphan outcome event |
| Current stage succeeds | The ordinary path still works |
| Omitted stage succeeds | Backwards compatibility for direct service callers |
| **PIPE-03 holds with the stage supplied** | Two *simultaneous* approvals both sending the correct stage: the stale check passes for both, and the **claim** is still what separates them. This is the case the new guard cannot catch, and it proves the old one survives |

**Regression run:** `node --test src/tests/integration/pipelineStageEngine.test.js` → **11 tests,
11 pass, 0 fail**, including all 4 new D3 cases. **PIPE-03 still green**, which is the check that
matters most here — it proves the original guard was added to, not replaced.

⚠️ A full `npm run test:unit` was also started but **did not finish**: the documented
end-of-run hang (shared Redis keeping the event loop alive) stopped it partway, after the E2E block.
Everything it did reach passed, 0 failures. The targeted run above is the authoritative evidence for
this fix; a clean full-suite pass should be re-confirmed before sign-off.

**No `N5` re-run needed to prove the message renders** — `api.js:55-63` normalises
`response.data.message` onto `.message`, and `PipelineDrawer.jsx:872` reads `err?.message`, so the
server's sentence surfaces. See the corrected N5 note below.

---

### D4 — reschedule mints a new Teams meeting (found 2026-08-20, OPEN)

**Found by:** the SCHED-05/06 manual run.
Evidence: `docs/test-claude-chrome/SCHED0506findings.md`.

Rescheduling pipeline 40 from 16:00 to 15:00 IST replaced the online meeting outright:

| | Meeting ID | Passcode |
|---|---|---|
| before | `468843751163904` | `Hp79cg77` |
| after | `471591962995564` | `3mi22z8C` |

**Root cause — confirmed in code.** `rescheduleInterviewRound()` (`interviewSchedule.service.js:897`)
deliberately cancels the old Graph event and creates a fresh one:

```js
await cancelInterviewEvent(oldRow.graph_event_id, 'This interview has been rescheduled.');
// … then a brand-new createInterviewEvent() at :928
```

The stated reason is to free the unique "one live booking per round" index. That justifies replacing
the **database row** — it does not require replacing the **calendar event**. The two can be
decoupled: keep the Graph event and `PATCH` its time, while still cancelling and re-creating the row.

**Consequence:** anyone holding the original invite has a dead join link, and stale calendar entries
point at a retired meeting for any party not re-invited.

✅ **SCHED-06 is NOT affected — resolved 2026-08-20, D4 stays Medium.** The worry was that a
cancel-then-create on the Graph event would produce a cancellation email plus a fresh invite, which
is the pattern the case forbids. It does not. Verified by instrumented run
(`rescheduleEmails.test.js`), counting every `sendGraphEmail` call:

```
SEND -> <candidate, redirected to test inbox>      ┐ booking:    2
SEND -> pkmondal@aapnainfotech.com                 ┘
CALENDAR CANCEL                                      ← Graph event only, NO email
SEND -> <candidate>  subject "Interview Rescheduled — Candidate"  ┐ reschedule: 2
SEND -> pkmondal@   subject "Interview Rescheduled — Panel"       ┘
```

**Exactly 2 emails per operation, both titled "Interview Rescheduled", neither a cancellation.**
`cancelInterviewEvent()` POSTs to Graph's `/cancel` endpoint — it removes the calendar event and
sends no mail of ours. The audit line reads `22 August 2026 at 03:21 pm IST → …`, one entry, exactly
the `previous → new` form the plan asks for.

🔴 **ANSWERED 2026-08-20 evening — Exchange DOES send its own notice, and it reaches the candidate.**
Confirmed by reading both mailboxes. Evidence:
`docs/test-claude-chrome/phase3manualpassresults20260820.md`.

| When | Subject | Body opens with |
|---|---|---|
| the **reschedule** | `Canceled: Technical Round 1 — Phase3 Midflow Candidate (…)` | *"This interview has been rescheduled."* |
| a cancel | `Canceled: Technical Round 1 (rescheduled) — …` | *"This interview has been cancelled."* |
| a cancel with a reason | `Canceled: Technical Round 1 — …` | *"D9 re-test - interviewer unavailable"* — the reason, verbatim |

**So a reschedule sends the candidate THREE messages, not one:** the app's *"Technical Round 1
rescheduled"* mail, a fresh Exchange invite for the new event, and a `Canceled:` notice for the
destroyed one. The candidate is told the interview is cancelled at the same moment they are told it
moved. The third message is invisible to `rpa_email_messages` and to `email/monitoring`, which is
why only a mailbox check could find it.

⚠️ **The panel escaped it only by accident.** Every `Canceled:` message in `pkmondal@` sits in **Sent
Items**, not the Inbox — because that mailbox is `MS_CALENDAR_MAILBOX`, the organiser. Book a
*different* interviewer and they become a real attendee, receiving both the Exchange invite and the
`Canceled:` notice. **Worth checking before anyone books a colleague.**

This is the strongest argument yet for fixing D4 by patching the event rather than replacing it: the
duplicate-and-contradictory candidate mail disappears entirely if the event is never cancelled.

### D4 re-confirmed 2026-08-20 21:33 — and D10's non-reproduction makes it worse

Two consecutive reschedules, every identifier changing each time:

| | Row | Meeting ID | Passcode |
|---|---|---|---|
| book | 107 | `471138124881060` | `oM9s7Bi2` |
| reschedule #1 | 108 | `450766067167142` | `sQ3Mi7nY` |
| reschedule #2 | 109 | `482011056442070` | `Bd2wd9NL` |

`graph_event_id`, `teams_join_url`, `online_meeting_id`, `teams_meeting_id` and `teams_passcode` all
differ between consecutive rows. Delete-and-recreate, confirmed a third time.

**The link-free emails were captured pre-send**, from the modal's own HTML tab — the exact payload
dispatched. Both bodies carry previous time, new time and duration; **neither contains a join URL, a
meeting ID or a passcode.** Not the new one, and not even the old one. So the app's own mail cannot
repair the link it just broke.

**The reschedule modal now discloses the behaviour** to the recruiter:

> *"Picking a new time below cancels this slot and books the new one — both parties are emailed the
> change."*

Honest, but it is disclosure to the operator, not a fix, and **the candidate never sees it**.

⚠️ **The sharpest point in the re-test.** With D10 not reproducing, the recruiter now sees a correct,
live Join button immediately after rescheduling — while the candidate holds a dead one and receives
no replacement link in either app email. **D10 was the recruiter's only visual cue that something had
changed underneath them.** Without it, the failure is entirely silent on the operator's side.

### ✅ D4 FIXED 2026-08-21 — the event is patched, not replaced

| Where | Change |
|---|---|
| `graphCalendar.service.js` | New `updateInterviewEventTime()` — `PATCH`es start/end on the existing event. Leaves `onlineMeeting` untouched, so the join URL, meeting id and passcode all survive and Outlook sends attendees a normal *"Updated:"* notice instead of a cancellation |
| `interviewSchedule.service.js` | `rescheduleInterviewRound()` patches first and carries the event forward onto the new row. `createInterviewEvent()` is now the **fallback**, not the default |
| `interviewSchedule.service.js` | `previewRescheduleEmails()` no longer hardcodes `joinUrl: null` |

**The booking row is still replaced.** The unique "one live booking per round" index requires the old
row to go `cancelled` before a new one is inserted — that was never the problem. The bug was that the
*calendar event* had been needlessly coupled to that row lifecycle. The two are now decoupled: rows
churn, the event persists.

**It falls back rather than failing.** If the patch cannot happen — calendar disabled, no prior
event, or Graph refuses — the service reverts to the old cancel-and-recreate path. A Graph outage
costs the join link, not the recruiter's reschedule.

**On the "neither email carries a link" half — the original finding was half right.** The *sent*
mail always appended the Teams block via `ensureTeamsBlock()` (`interviewSchedule.service.js:949`).
What lacked the link was the **preview**, which passed `joinUrl: null` — and the preview is exactly
what the manual run captured from the modal's HTML tab, and exactly what the recruiter reads and
edits before sending. So it was a real defect on the surface that matters, but the diagnosis
("neither email carries a link") was wrong about the delivered mail. The preview now shows the live
booking's Teams details, which after this fix are the same ones the candidate keeps.

**Verified:** `rescheduleEmails.test.js` → 2 tests, both passing, with the assertion inverted from
*"the meeting IS replaced"* to *"the meeting SURVIVES"*. The Graph call log across two reschedules
reads `created event → patched event → created event → patched event` — **no `cancelled event` at
all**, which is the destroy step being gone.

⚠️ **Still needs one manual check.** The tests prove the meeting id survives. Only a mailbox can
confirm the `Canceled:` notice has actually stopped arriving, and that attendees now get *"Updated:"*
instead. Ten minutes, after a staging restart.

**Harness note worth keeping.** The first version of this test counted rows in
`rpa_email_messages` — the table the vendor tests use — and found **zero**, failing on its own
precondition while the logs showed mail going out fine. That table is written by the stage-outcome
path; interview scheduling calls `sendGraphEmail()` directly and records nothing there. A spy was
tried next and abandoned: `interviewSchedule.service.js:26` uses a named import, and ES module
bindings are immutable. Anyone re-testing email counts on the scheduling path should read the run
log, not the table.

### D5 — a candidate's email edit never reaches a live journey (found 2026-08-20, OPEN)

`rpa_candidate_pipeline` holds a **denormalised copy** of `candidate_email`, taken at shortlist time.

Repro from the manual run:
1. Journey 36 (HARISH MP) holds `candidate_email = harishmp1345@example.com`
2. Search Candidate → Edit → change to `aiautomationn8nuser@gmail.com` → saves, toast confirms
3. Full reload, re-open the journey
4. `GET /api/pipeline/36` **still returns the old address**

Neither the Schedule nor the Reschedule modal exposes a candidate "To" override, so **there is no
path through the UI** to correct a wrong candidate address on an in-flight journey. Invites keep
going to the stale address.

**Three possible fixes, and the choice is a design decision:** resolve the candidate address at send
time; propagate record edits to open journeys; or expose an editable recipient on the send form.
Not fixed here — picking one affects other consumers of the denormalised copy.

**Re-confirmed 2026-08-20 21:33, and one of the three options is now ruled out.**
`PATCH /api/candidates/292` → 200. Read back in the same second:

| Read | Value |
|---|---|
| Candidate record | `…+d5probe@gmail.com` ✅ updated |
| Shortlist row `candidate_email` | old address 🔴 |
| Pipeline board card | old address 🔴 |
| **Interview panel email preview — the `Candidate email:` line the interviewer reads** | old address 🔴 |

That last row is decisive: **the send path resolves the denormalised copy**, so "it already resolves
at send time" is disproved rather than merely unimplemented. Two options remain — propagate edits to
open journeys, or expose an editable recipient on the send form.

Probe reverted; CV 292 and its shortlist row both verified back at `claudepankajmondal@gmail.com`.

Also noted: the only candidate-update route on this build is `PATCH /api/candidates/:id`, and the
Search Candidate modal is read-only — so the edit surface is effectively API-only today, which
narrows who can hit this in practice.

### ✅ D5 FIXED 2026-08-21 — resolve from the CV at read time

Of the three candidate fixes, the re-test ruled out "it already resolves at send time" and left two.
**Chosen: resolve from the CV**, which is the record of truth, rather than back-filling the
denormalised copies. Back-filling would need a migration plus a write path on every candidate edit,
and would still leave any row that missed the sweep wrong.

New `liveCandidateEmail(candidate)` in `interviewSchedule.service.js` prefers `cv.EmailID` and falls
back to the shortlist copy. Applied at all four send sites — the calendar attendee list (schedule and
reschedule), the `interviewScheduled` recipient, the `interviewCancelled` recipient, and the
`candidate_email` **token in the panel email**, which is the line the interviewer reads and replies
to and was the clearest symptom.

Two deliberate choices:

- **Fall back, never blank.** A shortlist can exist without a `cv_id` (keyword shortlists), and an
  empty CV address must not wipe out an address we do have.
- **The denormalised column is left in place.** Other consumers read it, and removing it is a wider
  change than this defect justifies. It is now bypassed on the paths that email people.

All six shortlist queries in the file now include `cv: { select: { EmailID: true } }`. Without that
include the helper silently falls back to the old behaviour, which is worth knowing if a new query is
added.

### D7 — file validation was extension-only (found 2026-08-20, FIXED)

**The most serious finding of the pass.** Found by going beyond the script: DOC-05 asked only whether
a `.exe` is rejected — it is. The tester then **renamed the executable to `.pdf`** and it uploaded
successfully.

| Payload | Before | After |
|---|---|---|
| `totally_safe.exe`, MZ header | 500 (rejected, wrong code — D6) | **400**, rejected |
| `huge.pdf`, 11 MB | 413, `isOperational` ✅ | unchanged |
| **`malware.pdf` — MZ executable bytes, `.pdf` name** | **200 `Document uploaded`** 🔴 | **400**, rejected |

`multer`'s `fileFilter` read `path.extname(file.originalname)` and nothing else — no MIME check, no
magic bytes. **Renaming was the entire attack.** The row was written and the binary pushed to
OneDrive under the candidate's folder.

**Worse than first reported: all FIVE upload routes share the pattern** — `document.routes.js`,
`hrUpload.routes.js`, `candidate.routes.js`, `assessmentImport.routes.js`, `vendor.routes.js`. The
document route is the critical one because it is the only **public, unauthenticated** upload: the
sole credential is a token emailed to a candidate.

**Fix.** New `utils/fileSignature.js` verifies the bytes on disk against the claimed extension, wired
into `document.controller.js` before the file reaches OneDrive.

Two design points worth keeping:
- **It runs in the controller, not `fileFilter`.** `fileFilter` fires before any bytes are written —
  `file.path` exists but the file is empty, so there is nothing to sniff.
- **Unverifiable formats pass.** `.csv` is plain text with no signature; absence of a signature is
  not disproof, and the caller's extension allowlist remains the control there.

**Known limit, accepted:** `.docx`/`.xlsx`/`.zip` are all zip containers, so `PK\x03\x04` is the
honest signature for each. This stops an executable renamed to `.docx`; it does not inspect the
archive. It is **not** a virus scanner — a malicious PDF still passes, and real malware scanning is a
separate control.

**Tests:** `src/tests/unit/fileSignature.test.js` — **12 cases, all passing**, including the exact
bypass payload, a truncated file (an off-by-one would wave a 2-byte file through as a PNG), and an
empty file.

⚠️ **The other four routes are NOT yet fixed.** They are authenticated, so the risk is far lower, but
the helper is shared and wiring them up is a small follow-up.

### D6 — a rejected upload emailed the team (found 2026-08-20, FIXED)

`fileFilter` rejected with a **plain `Error`**, which carries no `statusCode` and no `isOperational`
flag. The global handler therefore treated a candidate picking the wrong file type as a server fault:

| | Before | After |
|---|---|---|
| Status | **500** | **400** |
| Message in production | **discarded** — `sendProdError` only forwards messages for operational errors, so the candidate would get a generic error with no hint | preserved |
| Team alert | **"Backend Error Alert" email fired** (`errorHandler.js:153` alerts on any 5xx) | none — 4xx never alerts |

Contrast the size limit, which was already modelled correctly: 413, operational, no alert.

**Fix:** `cb(new AppError(…, 400))` instead of `cb(new Error(…))`.

**One correction to the field report.** It stated *"my five probes generated five alerts"*. There is
a **5-minute cooldown** keyed on `code/name + route` (`emailNotification.service.js:1624`). A plain
`Error` has no `code`, so the signature was constant per route — but the URL contains the token, so
a *different* candidate's token is a different signature. Repeated probes on one token would have
been throttled to one alert per 5 minutes. This softens "page the team on demand" but changes
nothing about the wrong status code or the lost production message.

### D8 — the upload page discards the server's reason (found 2026-08-20, OPEN)

The server says exactly what is wrong and how to fix it:

> `File type .exe is not allowed. Accepted: .pdf, .docx, .doc, .jpg, .jpeg, .png.`

The candidate is told:

> `1 of 1 could not be sent. Please try those again.`

The advice is actively wrong — retrying is the one thing that cannot work, and each retry previously
fired another alert email (D6).

**This is N5's defect on the candidate-facing surface.** N5 was scoped as "does the UI render the
*server's* message"; it passed on PipelineDrawer and the authenticated screens, all of which read
`err.response?.data?.message` (or `err.message`, normalised by `api.js`). The **public upload page
does not** — it is outside the authenticated app and does not use that shared client. N5's screen
list should include it.

Not fixed here: it is a frontend change on a page with its own error-handling shape, and worth doing
alongside the O3 client-side validation gap (DOC-04) rather than piecemeal.

**Re-confirmed 2026-08-20 21:33** with a 600-byte real-MZ `d8probe.exe` against journey 27's public
portal:

| | Result |
|---|---|
| Client-side filter | 🔴 still none — all three `input[type=file]` carry `accept=""`, the `.exe` was accepted and the item flipped to *"Ready to submit"*. **O3 unchanged** |
| Server verdict | ✅ **400** — the D6/D7 fixes hold on the public endpoint |
| What the candidate sees | 🔴 `1 of 1 could not be sent. Please try those again.` — byte-identical to before |

**Verified no residue:** `rpa_candidate_documents` for request 3 still reads item 1 `uploaded`
(DOC-03's genuine PDF) and items 2 and 3 `pending`, with null `file_url`. The rejected executable
wrote nothing and reached no OneDrive folder — the 400 path is clean.

This pairs the two halves neatly: **the server is now right and the page is still wrong.** A
candidate is told to retry the one thing that cannot succeed, which is why D8 and O3 belong in the
same change.

### ✅ D8 + O3 FIXED 2026-08-21 — in one change, as the re-test recommended

**D8 — the message.** `submitAll()` in `DocumentUpload.jsx` had a bare `catch {}` that discarded the
error object entirely, so the server's sentence was gone before the toast was written. It now
collects each failure's `response.data.message`, de-duplicates (three `.exe` files produced the same
sentence three times), and leads with it:

> *"1 of 1 could not be sent. File type .exe is not allowed. Accepted: .pdf, .docx, .doc, .jpg,
> .jpeg, .png."*

*"Please try those again"* survives only as the fallback when there is genuinely nothing to explain —
a network drop, which is the one case where retrying **is** the right advice. Duration raised to 8s,
since the message now carries an instruction rather than just a count.

**O3 — the client-side gap.** `beforeUpload` returned `false` unconditionally with no checks, and all
three inputs carried `accept=""`. Now: a real `accept` attribute so the OS picker filters, plus
extension and 10 MB checks returning `Upload.LIST_IGNORE` with a plain-language reason. The
constants mirror the server's `ALLOWED_EXTS` and `fileSize` limit.

**The server remains the real gate** — including the magic-byte check from D7. This only spares the
candidate a pointless round trip and a confusing error; it is not a security boundary, and a renamed
executable is still caught server-side.

**Frontend build: exit 0, 4101 modules.**

---

## Harness

`backend/src/tests/helpers/fixture.js` — seed / status / teardown, CLI.
`backend/src/tests/integration/pipelineStageEngine.test.js` — Block A.

Run: `node --test src/tests/integration/pipelineStageEngine.test.js`

**Fixture (seeded 2026-08-19 20:27):**

| What | Id | Notes |
|---|---|---|
| CV — fresh | 291 | `claudepankajmondal@gmail.com` |
| CV — midflow | 292 | same mailbox |
| CV — vendor | 293 | `VendorEmail` set, `lockForNinetyDays = 2026-10-03` (live) |
| MRF — 1 opening | 137 | OFFER-08 |
| MRF — 2 openings | 138 | OFFER-09 |
| Journeys | 39, 40, 41 | all at `zeko_hr` |

**Journey 41 derived `source='vendor'` on its own.** `createPipelineJourney()` →
`vendorAttributionFor()` → `activeVendorFor()` read the live lock off the CV and set it. Nothing was
hand-written in SQL, which is precisely what both plans require for VEND-01 to mean anything. The
fixture asserts this and throws if it ever comes out otherwise.

Safety on shared staging: every row is tagged `PHASE3-TESTPASS-FIXTURE` in a free-text column and
torn down by **explicit id**, never a time window (`prisma/cleanup-test-data.js` is deliberately not
used here — it would match colleagues' rows). Teardown verified clean after the Block A run.

---

## Block A — M1 Stage Engine

Run 2026-08-19 20:34. **8 assertions across 6 test cases, all passed.**

### PIPE-01 — Happy-path stage advance ✅ PASS
Approve at `zeko_hr` → advanced to `assessment` (next active stage by `sort_order`;
`shortlist` at 10 is inactive and correctly skipped). One `outcome` event, one `entered` event for
the new stage. Outcome email sent, `status_label` = `"Zeko HR Screening Approved"`.

### PIPE-02 — Reject/Hold require a reason ✅ PASS (3 assertions)
- No reason, no other-text → **400** `"A reason is required for Reject/Hold outcomes."` — exact
  string match. Candidate did **not** move.
- `is_other` reason (id 9, "Other reasons") with no other-text → **400**
  `"Free-text reason is required when \"Other reasons\" is selected."`
- Valid reason + other-text → 200, `current_stage_status='rejected'`, free text stored verbatim in
  `reason_text`.

### PIPE-03 — Concurrent approval race ✅ PASS — **highest-value case in the block**
Two `setStageOutcome` calls fired via `Promise.allSettled` with no delay:
- Exactly **one 200**, exactly **one 409**
- 409 message exact: `"Someone else moved this candidate while you were deciding. Reopen the
  candidate to see where they are now."`
- **The loser rolled back properly** — only 1 `outcome` event exists, and the candidate advanced
  exactly one stage (`zeko_hr → assessment`), not two.

That last check is the one that matters. A guard that returns 409 but leaves a half-written event
row would still pass a status-code-only assertion. The claim-then-act guard at
`pipeline.service.js:629` holds.

⚠️ **Scope of this pass, added 2026-08-20.** PIPE-03 proves the guard against **simultaneous**
requests, which is what it was written for and what this test fires. It does **not** cover a
**stale** tab arriving seconds or minutes later — that path is unprotected, and is defect **D3**
above. This result is correct as far as it goes; the gap is in what was tested, not in this finding.

### PIPE-06 — Legacy write-back ✅ PASS
After approve: `rpa_cv.FinalStatus` = `"Zeko HR Screening Approved"`;
`rpa_shortlisted_candidates.pipeline_status` = `shortlisted` (per `shortlistStatusFor()`).

### PIPE-13 — 6-month cooling-off ✅ PASS
Rejected a candidate, then attempted a new journey **against a different MRF** (so the idempotent
same-MRF return path could not mask it) → **409**, message matched
`/6-month re-application cooling-off period/`. Hard block confirmed.

### PIPE-16 — skip_optional_next ✅ PASS
Walked `zeko_hr → assessment → zeko_fn → tech1 → tech2` (each hop verified), confirmed `tech3` is
`is_optional`, then approved with `skipOptionalNext: true` → landed on `hr_round`, bypassing
`tech3`. Exactly one `skip` event logged.

⚠️ **One thing to note on the skip event.** The `skip` event is written with
`stage_key = 'hr_round'` — the stage landed on — while its `notes` read *"Skipped optional stage
tech3"*. The test plan's wording ("the bypassed stage gets a `'skip'` event") suggests
`stage_key='tech3'` might have been intended. Behaviour is self-consistent and the audit trail is
complete either way, so this is **not scored as a defect** — but it is worth a glance from whoever
wrote the spec, since a report grouping skip events by `stage_key` would attribute the skip to the
wrong stage. Raised as a question, not a bug.

---

## Block A part 2 — closure, guards, filters

Run 2026-08-19 21:00. **8 case groups, all passed** after three test-harness bugs were fixed.

| Case | Result | Note |
|---|---|---|
| PIPE-04 closed journey refuses all actions | ✅ PASS | outcome / advance / closure / email all 409 |
| PIPE-05 double-close race | ✅ PASS | one 200, one 409 `"This candidate's record has already been closed."`, loser's event rolled back |
| PIPE-09 all 8 closure outcomes | ✅ PASS | every `FINAL_OUTCOMES` value closes and stamps `closed_at` |
| PIPE-09 vacating reopens MRF | ✅ PASS | `backed_out` cleared `filled_at`; log confirms *"MRF 138 re-opened — 0/2 opening(s) filled"* |
| PIPE-10 JOINED freezes lock | ✅ PASS | `lockForNinetyDays` → `9999-12-31`; **and a non-joined closure correctly leaves it ticking** |
| PIPE-11 closure closes document link | ✅ PASS | `token_status` → `closed` |
| PIPE-12 concurrent-MRF + idempotency | ✅ PASS | two MRFs → two journeys; same MRF → existing journey returned, no duplicate |
| PIPE-14 board filters | ✅ PASS | closed hidden by default, `includeClosed` surfaces them, `source=vendor` narrows correctly |
| PIPE-15 deactivated stage | ✅ PASS | 409 *"is no longer active"*; stage re-activated in a `finally` so global config is left intact |
| N1 invalid closure key | ✅ PASS | 400, and `final_outcome` stayed null |

**Confirmed silent-by-design:** the log shows *"Stage-outcome email suppressed by policy:
outcome=backed_out"* and the same for `joined` — matching `SILENT_FINAL_OUTCOMES`. This is the
behaviour behind RT open question #5, observed live rather than inferred.

### N5 — 409 message propagation — ⚠️ NOT SCORED (blocked by D3)

Run manually 2026-08-20 against fixture journey 40.
Evidence: `docs/test-claude-chrome/409conflictspotcheck.html`.

**No 409 could be produced from the UI**, so the thing N5 asks about was never rendered. That is not
a pass and not a fail — it is defect **D3** above. The check is blocked on a code change.

What *was* established, which is worth keeping:

| Finding | Detail |
|---|---|
| The propagation pattern is correct where it exists | `CandidateDetail.jsx:187` reads `err.response?.data?.message` **first**, falling back to a generic string only if the server sent none. `EmailManagement`, `HRUpload` (3 sites) follow the same shape. So N5's actual requirement is satisfied by construction on those screens |
| `PipelineDrawer` reads `err?.message` — and that is **correct** | It looked like the odd one out, but `api.js:55-63` is a response interceptor that normalises `response.data.message` onto `.message` for **every** call through the shared client. So `err?.message` *is* the server's sentence. Verified while fixing D3 — no change needed |
| No screen has a 409-specific branch | True, and mostly fine — a generic error path that prefers the server's message needs no per-status branch. Only screens wanting bespoke recovery UI (e.g. a "reload the candidate" button) need one |
| `AnalyticsLegacy` does not exist | ✅ Confirmed — no such file. `/src/pages/AnalyticsLegacy.jsx` returns 200 only via Vite's `index.html` fallback, byte-identical to a nonsense path. **This was an error in the test plan's screen list, now corrected.** Substitute `EmailManagement` |

**Correction to the evidence document.** It reports the string *"Someone else moved this
candidate…"* as having **"0 occurrences anywhere"**. That is accurate for the frontend but misleading
as written — the string is in the backend at `pipeline.service.js:635` and is genuinely thrown, as
PIPE-03 proved. The real finding is that no *stale-tab* path reaches it.

**To finish N5:** D3 is now fixed, so the two-tab test **will** produce a 409. Re-run it and confirm
the sentence renders on PipelineDrawer (expected to pass — the propagation path is verified in code,
but this is the one case worth seeing on screen), then spot-check two of CandidateDetail /
PipelineConfigPanel / Settings / EmailManagement.

⚠️ **Requires a staging restart** — the fix is in the working tree, not deployed.

---

## Block E — M6 Vendor notifications

Run 2026-08-19 21:15. **9 cases, all passed** after two test-harness bugs were fixed.

### VEND-01 ✅ PASS — the headline M6 regression, confirmed working

A vendor-sourced journey produced **two separate `rpa_email_messages` rows** on one stage outcome:
one candidate email, one vendor email, different ids. Log line:
`Vendor notification sent: pipeline=117 vendor=genaiuserpankajmondal@gmail.com event=stage_outcome policy=standard`

The dual-send that the M6 changelog records as *"reported built-in since M1, never fired once"* now
genuinely fires. Given zero vendor-sourced journeys existed on this database before today, this is
the first time it has ever been exercised here.

| Case | Result | Note |
|---|---|---|
| VEND-02 documents → silent | ✅ PASS | `skipped: 'stage "documents" never notifies vendors'` |
| VEND-02 offer → bare only | ✅ PASS | *"An offer has been extended."*, no CTC/salary/joining date/LPA in visible text |
| VEND-02 standard stage | ✅ PASS | `vendorPolicyForStage(tech1) === 'standard'` |
| **VEND-03 ad-hoc free text** | ✅ PASS | planted `CONFIDENTIAL-SALARY-DISCUSSION-DO-NOT-LEAK-42` in the candidate body; **absent from the vendor copy's body and subject**, while confirming the vendor *was* notified |
| VEND-04 source not address | ✅ PASS | lapsed lock → journey not vendor-sourced → no send |
| VEND-05 lock lapses mid-journey | ✅ PASS | snapshot honoured, vendor still notified |
| VEND-06 stale lock, new journey | ✅ PASS | no leak onto the later journey |
| VEND-07 inclusive boundary | ✅ PASS | today active, yesterday not |
| VEND-08 malformed date | ✅ PASS | `2026-13-45` fails **closed**; no attribution |
| VEND-09 frozen sentinel | ✅ PASS | `9999-12-31` reads permanently active |

DOC-12 (documents vendor-silent) is covered by the VEND-02 documents case.

---

## Blocks C + D — Documents and Offer

Run 2026-08-19 22:10, after the two fixes above. **All 20 case groups pass.**

### Block C — M4 Documents

| Case | Result | Note |
|---|---|---|
| DOC-01 request | ✅ PASS | one row per active checklist item (3), all `pending`, token issued |
| DOC-02 re-request | ✅ PASS | **same token reused**; `reminder_count`→0, `last_reminded_at`→null |
| DOC-06 re-verify refused | ✅ PASS | 400 *"Only an uploaded document can be verified"* |
| DOC-07 verify auto-close | ✅ PASS | link stays `active` until the **last** item, then flips `closed` |
| DOC-09 reject reopens link | ✅ PASS | `closed`→`active`, **`reminder_count` NOT incremented** (the deliberate exception), `last_reminded_at` still stamped |
| DOC-09 reject needs a reason | ✅ PASS | 400 on blank/whitespace |
| DOC-10 shared counter | ✅ PASS | manual reminder increments the same counter the sweep reads |
| DOC-13 no delete path | ✅ PASS | no exported delete/remove/purge/expire function |

**DOC-03 — public upload, added 2026-08-20 (manual).** The one Block C case needing a real browser
and a real OneDrive round trip. Run against a live journey rather than the fixture — pipeline 27,
SAHIL SARMA (cv 31), 7 days in `documents`.

| Expectation | Result |
|---|---|
| No-login access on the tokenized link | ✅ checklist rendered, no prompt, no redirect |
| Upload returns 200 | ✅ doc id 7, `status: uploaded` |
| Lands in OneDrive under the candidate folder | ✅ `Resume_Test/Document Collection/SAHIL SARMA (cv-31)/payslips_last_3_months_1787197525.pdf`, 800 bytes byte-identical |
| Row flips to `uploaded` | ✅ verified by direct DB query, `uploaded_at` within a second of the OneDrive timestamp |
| Local temp copy deleted | ✅ `documentCollection.service.js:381` unlinks in a `finally` — happens on failure too |

`token_status` correctly stayed `active`: 1 of 3 items uploaded, and DOC-07's auto-close fires only
on the last. Evidence: `docs/test-claude-chrome/documentuploade2eevidence.html`.

Two things recorded, neither a defect: files nest under a `Resume_Test/` root (configured via the
deliberately-empty `MS_ONEDRIVE_PARENT_ID` default — **confirm the production value separately**),
and the candidate's filename is replaced with `{item_key}_{unix_ts}.pdf` on disk, surviving only in
`original_name`.

### Block D — M5 Offer

| Case | Result | Note |
|---|---|---|
| OFFER-01 request approval | ✅ PASS | `pending` + timestamp; re-request on an approved offer → 409 *"This offer has already been approved."* |
| OFFER-02 approve without request | ✅ PASS | allowed by design |
| OFFER-04 share is a soft gate | ✅ PASS | succeeds with no approval; `offer_sent_at` written back; bad date → 400 |
| OFFER-05 re-share preserves decision | ✅ PASS | `accepted` survives a re-share |
| OFFER-07 decision needs a share | ✅ PASS | 400 *"Record the offer as shared before…"* |
| **OFFER-08 1-opening closes** | ✅ PASS | **after D1 fix**; `approval_status` correctly left untouched |
| **OFFER-09 2-opening arithmetic** | ✅ PASS | **after D1 fix**; stays open at 1/2, closes at 2/2 |
| **OFFER-10 concurrent accepts** | ✅ PASS | **after D1 fix**; both decisions recorded, requisition closes exactly once |
| **OFFER-11 amend guard** | ✅ PASS | **after D2 fix**; no flag → 409, string `"true"` → 409, real `true` → succeeds |
| OFFER-12 amend reopens MRF | ✅ PASS | `filled_at` cleared; `offer_accepted_at` explicitly nulled, not left stale |
| OFFER-16 closed journey | ✅ PASS | 409 via `assertJourneyOpen` |

---

## Block B — M3a Scheduling and Scorecards

Run 2026-08-19 22:45. **All 9 case groups pass (15 cases).**

⚠️ These tests deliberately book most rounds as **`client`**, because that round sends no email —
which keeps the test inbox clean. `interviewScheduledPanel` and `scorecardInvite` are in
`OPERATOR_ADDRESSED` and are **not** redirected, so any interviewer address used here receives real
mail. The supplied test mailbox was used throughout; no colleague address was ever entered.

| Case | Result | Note |
|---|---|---|
| Six-round invite policy | ✅ PASS | tech1/2/3, hr_round, ceo auto-invite; **`client` does not** (Q14). `documents`/`offer` are not schedulable |
| SCHED-02 Client round silent | ✅ PASS | booking row created `scheduled`, **no calendar event, no Teams meeting, no email** — verified against the stored row and an email count delta of 0 |
| SCHED-03 off-stage booking | ✅ PASS | 400 *"not currently on…"* |
| SCHED-04 validation | ✅ PASS | malformed address → 400 *"Not a valid email address"*; empty → 400 *"At least one interviewer's email is required"*; past date → 400 *"in the past"* |
| SCHED-05 one live booking | ✅ PASS | 409 *"This round already has a scheduled interview. Cancel it first to rebook."* |
| SCHED-08 held → scorecard | ✅ PASS | `occurrence_status='held'`, card dispatched with a unique token, `scorecard_dispatched_at` stamped |
| **SCHED-09 no-show** | ✅ PASS | `no_show` + party recorded, **zero scorecards**, and the candidate's stage/status **unchanged** — no auto-reject or auto-hold (Q9) |
| SCHED-10 idempotent occurrence | ✅ PASS | second call returns `alreadyResolved: true`, no second dispatch |
| SCHED-12 submit | ✅ PASS | `avg_score` = 4.5 from (4, 5, 4.5) |
| **SCHED-13 double-submit race** | ✅ PASS | one 200 + one 409 *"This scorecard has already been submitted."*, single card row |
| SCHED-14 lazy expiry | ✅ PASS | stays `pending` in the DB until first open, flips to `expired` **on that open**, then submit → 410 |
| SCHED-15 no-show gate | ✅ PASS | 409 *"This interview was marked as not held…"* |
| SCHED-16 rating range | ✅ PASS | 6 and −1 → 400; **see note below on 2.3** |
| SCHED-17 HR truncation | ✅ PASS | 400-char input capped to 100 / 255 silently |
| SCHED-18 consolidated report | ✅ PASS | overall average computed, rounds grouped |

### Two behaviours recorded rather than judged

**SCHED-16 — a non-0.5 step is ROUNDED, not rejected.** The plan lists `2.3` alongside `6` and `−1`
as something to reject. In fact `normalizeRating()` throws 400 only for out-of-range values; `2.3`
is silently rounded to `2.5`. Confirmed by direct submit. Not scored as a defect — it is a coherent
design — but the plan's expectation and the code disagree, so **someone should decide which is
right**. Rounding an interviewer's 2.3 up to 2.5 is a small upward bias on every off-step rating.

**SCHED-17 — silent truncation confirmed.** The plan explicitly asks whether silent truncation or a
400 is the right UX. It truncates. Still an open UX decision, now with the behaviour verified.

---

## Block F — Cross-module end-to-end

Run 2026-08-19 23:15. **All 5 journeys pass.** Each uses its own single-use MRF so the closure
arithmetic cannot depend on test order.

These matter more than their count suggests: every module had already passed in isolation, so a
failure here would have been specifically an *integration* failure. There were none.

### E2E-01 — vendor journey, shortlist → rounds → documents → offer → JOINED ✅ PASS
One journey exercising every module at once:
- `source='vendor'` derived from the live lock at creation
- walked through the rounds to `documents`
- document request seeded checklist rows — **and the vendor received nothing** (privacy assertion:
  vendor message count unchanged across the whole documents stage)
- offer shared and accepted → **MRF closed** (`filled_at` stamped)
- closed as `joined` → **vendor lock frozen to `9999-12-31`**, `FinalStatus` = "Joined",
  and the still-open document upload link **force-closed** to `token_status='closed'`

### E2E-02 — non-vendor journey rejected at Tech 2 ✅ PASS
`FinalStatus` → Rejected, `pipeline_status` → `rejected`, **zero vendor messages** (correct — not
vendor-sourced), and the 6-month cooling-off gate confirmed armed by attempting a fresh journey on a
different MRF → 409.

### E2E-03 — accepted then amended to rejected ✅ PASS
MRF closed on accept, **reopened** on the amend. And the lock correctly did **not** freeze — the
sentinel is reserved for a genuine `joined` closure, so an acceptance alone must not trigger it.

### E2E-04 — two candidates racing the last opening ✅ PASS
Both acceptances recorded (neither lost), requisition closed, and **`MRF_CLOSED` did not
double-fire**.

### E2E-05 — the manual Client round in the middle of an automated chain ✅ PASS
Client booking sent nothing, approving it advanced the journey into `documents`, and M4 then behaved
exactly as after any automated round — a live upload token issued normally.

---

## Block G — the scheduled sweeps (DOC-11, OFFER-14, OFFER-15)

Run 2026-08-20. **12 cases, all passed on the first run.**
`backend/src/tests/integration/sweepJobs.test.js`

These three were recorded as "cannot run / not attempted" because they are cron jobs. **They did not
need cron.** All three are pure DB polling, so backdating the timestamps the sweep selects on puts a
row into the state it is looking for, and the exported `run*()` functions can be called directly.
The real job function runs, against real rows, with nothing stubbed or mocked.

**Why the selection query is the whole test.** DOC-10 already proved reminders send. What was never
verified is whether the sweep picks the *right* rows — and a sweep that reminds everybody, or
nobody, would still pass a "did it send" assertion. Each case below is asserted on its own request's
counter, so unrelated rows on shared staging cannot influence the result.

### DOC-11 — reminder sweep selection ✅ 5/5

| Case | Result |
|---|---|
| Aged past `DOCUMENT_REMINDER_AFTER_DAYS`, never reminded | ✅ reminded once, `last_reminded_at` stamped |
| Requested just now | ✅ **not** chased — inside the quiet window |
| Already at `DOCUMENT_REMINDER_MAX_COUNT` | ✅ **not** chased — the sweep gives up and leaves it to a human |
| Every document `verified` | ✅ **not** chased — nothing left to ask for |
| Journey closed underneath an open request | ✅ **not** chased — the specific case the `final_outcome: null` guard exists for |

### OFFER-14 — approval nudge ✅ 3/3

| Case | Result |
|---|---|
| Pending approval, never nudged | ✅ nudged, `approval_nudged_at` stamped |
| **Second run the same day** | ✅ **not** re-nudged — the timestamp is identical to the first run. Daily, not per-run |
| Nudged yesterday | ✅ nudged again today |
| Already `approved` | ✅ never nudged |

The same-day case is the one worth having: the cron is daily *now*, but the cadence is configurable
(`OFFER_SWEEP_CRON`). Someone tightening it to hourly would spam the approver every hour if the
`startOfToday()` clause were ever dropped.

### OFFER-15 — post-joining auto-close ✅ 4/4

| Case | Result |
|---|---|
| Joined longer ago than `OFFER_AUTO_CLOSE_AFTER_DAYS` (90) | ✅ closed as `joined`, `closed_at` stamped |
| Joined recently | ✅ stays open |
| **Already closed by a recruiter as `joined_and_left`** | ✅ **left alone** — the sweep does not relabel a human's closure as `joined` |
| Accepted, but no `joining_date` | ✅ never closes — the clock never started |

That third case is the one that matters. Overwriting a recruiter's `joined_and_left` with `joined`
would quietly turn an attrition record into a successful hire, corrupting the conversion analytics
that `HIRE_OUTCOMES` feeds.

⚠️ **These tests send real email** — redirected to the staging test inbox like every other
integration file. Expect a handful of reminder and approval-nudge mails per run.

**Staging verified clean afterwards:** 0 leaked sweep MRFs, base fixture intact (3 CVs / 2 MRFs),
0 fixture MRFs left filled, 23 journeys — the documented baseline.

---

## Group 1 — SCHED-01 / 06 / 07, the Teams round trip

Run 2026-08-20 ~18:20 IST through the **real Pipeline drawer**, journey 40, interviewer
`pkmondal@aapnainfotech.com` — deliberately not in `EMAIL_STAGING_RECIPIENTS`, so the attendee-collapse
artifact that invalidated the earlier run could not recur. Local dev server against the shared
staging database. Evidence: `docs/test-claude-chrome/sched010607results.md`.

| Case | Verdict |
|---|---|
| **SCHED-01** | ✅ **PASS** on every machine-checkable assertion |
| **SCHED-06** | ✅ **PASS** — one audit line, `previous → new`; D4 reproduced |
| **SCHED-07** | ⚠️ **PASS with defect D9** — cancels correctly, but no reason can be supplied |

**SCHED-01 detail.** `POST /api/pipeline/40/interview` → **200** (confirming the plan's 201 is wrong,
third independent observation). Row 104, `status='scheduled'`, times stored correctly
(`2026-08-21T05:30:00Z` = 11:00 IST), Teams meeting `473448322235179` minted, `invite_sent_at`
stamped, audit line written.

**SCHED-06 detail.** Row 105 live, exactly **one** audit line reading
*"Technical Round 1 rescheduled: 21 August 2026 at 11:00 am IST → 21 August 2026 at 03:00 pm IST"*.
Both emails composed as reschedule notices, neither a cancellation — consistent with the instrumented
run.

### 🔴 D4 is worse than its original write-up: neither reschedule email carries a join link

Read from the modal previews before sending. The candidate email contains previous time, new time and
duration. The panel email contains previous time, new time and the candidate's address. **Neither
contains a Teams link.**

So after a reschedule the only join link either party holds is the one from the original invite — and
D4 has just killed it. The new link exists *only inside the app*. That moves D4 from "stale calendar
entries left behind" to **"both parties are actively holding a dead link and were never sent the live
one"**, which is a materially worse failure and raises the case for fixing it before the demo.

### Correction to this document's own earlier wording

The instrumented-run entry above describes both mails as titled *"Interview Rescheduled — Candidate"*
and *"— Panel"*. **Those were the test's own labels, not the real subjects.** What actually sends is:

- candidate — `Technical Round 1 rescheduled — Phase3 Test Role (1 opening)`
- panel — `Interview rescheduled — Technical Round 1: Phase3 Midflow Candidate`

The count and the "neither is a cancellation" conclusion are unaffected.

### D9 — a cancellation reason cannot be supplied from the UI (OPEN)

`rpa_interview_schedule.cancel_reason` is null for **every** cancellation a recruiter performs. The
audit trail records that a round was cancelled but never why.

**Confirmed in code.** `cancel_reason` appears exactly **once** in `PipelineDrawer.jsx` — line 1021,
on the *Zeko* cancel path. `interviewCancelMutation` (line 1087) sends only the four email fields:

```js
pipelineService.cancelInterview(interviewSchedule.id, {
  candidate_subject, candidate_body, panel_subject, panel_body,   // no cancel_reason
})
```

**Why it was missed until now — two modals share one title.** Both are titled *"Confirm Cancel
Interview"*: the Zeko one (`open: cancelOpen`) **has** a reason `TextArea`; the scheduled-interview
one (`open: interviewCancelOpen`) does not. Searching for a reason field finds one and stops.

The endpoint honours `cancel_reason` — proved during this run's cleanup call, which wrote
*"Technical Round 1 interview cancelled: CLEANUP-SCHED-PREP: …"* into the audit trail. Two
cancellations minutes apart on the same journey, one with a reason (API) and one without (UI), is the
cleanest possible demonstration.

**✅ FIXED 2026-08-20.** A `Cancel reason (optional)` `TextArea` on the `interviewCancelOpen` modal,
backed by its **own** `interviewCancelReason` state — deliberately not `cancelReason`, which belongs
to the Zeko modal that shares this one's title; reusing it would leak a reason typed in one dialog
into the other. `cancel_reason` now goes in the mutation payload and the state is cleared on success.

**One thing I got wrong while fixing it, corrected before shipping.** The helper text first read
*"Not included in the emails below."* That is false: the service passes `reason` into
`buildInterviewEmails('cancel', …)` (`interviewSchedule.service.js:724`) **and** into the Graph
`/cancel` comment (line 701), so it can reach both the cancellation emails and the Outlook notice.
The label now says so, and notes that the reason must be typed *before* the email previews are
generated if it is to appear in them.

**Frontend build after the change: exit 0, 4101 modules.**

### D10 — the drawer shows a dead Teams link after a reschedule (OPEN)

| | Drawer after the success toast | Actual row |
|---|---|---|
| Time | 21 Aug, 11:00 am | 21 Aug, **03:00 pm** |
| Meeting ID | `473448322235179` | `482189874798031` |
| Passcode | `tg3k3Eg7` | `vo2Jo6e5` |

Closing and reopening the drawer shows the correct values, so the write is fine and the view is
stale. **Compounds D4:** the meeting on screen has just been destroyed, and the recruiter is looking
at a Join button, meeting ID and passcode that no longer work — on a screen that just said the
reschedule succeeded. Copying any of it hands over a dead link.

⚠️ **The field report's proposed cause is wrong, and the fix it suggests would not work.** It says the
cancel mutation refreshes correctly and the schedule mutation should copy its invalidation. But
`interviewMutation.onSuccess` (line 1071) **already** invalidates `['pipeline-detail', pipelineId]`,
identically to `interviewCancelMutation` (line 1094). The query has no `staleTime`, and
`interviewSchedule` is read straight off that query's data. So the invalidation is present and
correct, and the stale render has some other cause — most likely the modal-close and state-reset
sequence in the same `onSuccess`, or a race between the refetch and the re-render.

**Do not "fix" this by adding an invalidation that is already there.** The symptom is real (observed
twice, with the concrete values above); the mechanism needs a debugger session, not a code read.

**Investigated 2026-08-20, not fixed — the mechanism is still unproven.** What was ruled out:

| Hypothesis | Verdict |
|---|---|
| Missing `invalidateQueries` on the schedule path | ❌ ruled out — line 1071 invalidates `['pipeline-detail', pipelineId]`, identical to the cancel path at 1094 |
| A `staleTime` holding the cached row | ❌ ruled out — the `pipeline-detail` query sets none |
| `interviewMode` left as `'reschedule'` and poisoning a query key | ❌ ruled out — both `openInterviewModal` and `openRescheduleModal` set it explicitly on open |
| `enabled: open` suppressing the refetch | ❌ ruled out — `open = !!pipelineId`, true throughout |

The most likely remaining explanation is the **state cascade inside the same `onSuccess`**: it closes
the modal and clears `interviewAt`, `interviewerEmail`, `interviewerName` and `schedEmail` in the
same tick as the invalidation. Those four are all in the `schedule-preview` query key, so clearing
them fires a *different* query while the detail refetch is still in flight. The cancel path clears
far less, which fits it not showing the bug.

That is a hypothesis, not a diagnosis. **Fixing it blind risks papering over the symptom** — for
example by forcing a `refetch()` that hides a re-render ordering problem rather than resolving it.
It needs React Query devtools on a live reschedule to confirm which query settles last.

**Interim mitigation if the demo includes a reschedule:** close and reopen the drawer afterwards. The
data is correct on reopen — only the immediate post-action render is stale.

### ⚠️ D10 RE-TEST 2026-08-20 21:33 — not reproducible, and NOT because it was fixed

Evidence: `docs/test-claude-chrome/d4d5d8d10retest20260820.md`. Two consecutive reschedules on
journey 40, deliberately without reopening the drawer:

| | Drawer after, no reopen | DB row |
|---|---|---|
| Reschedule #1 | 25 Aug 09:00 · `450766067167142` · `sQ3Mi7nY` | row 108 — matches |
| Reschedule #2 | 26 Aug 09:00 · `482011056442070` · `Bd2wd9NL` | row 109 — matches |

Compared programmatically against `/api/pipeline/40` — `drawerMatchesDb: true`. The second was
captured ~4 s after the modal closed and was already correct.

🔴 **The report scores this "✅ FIXED". It is not fixed — nothing was fixed.** `git log` confirms no
code changed between the original observation and this re-test: the last commit touching
`PipelineDrawer.jsx` is `d47b0ad` (the D9 reason field), which does not touch the schedule or
reschedule mutations. **The same build produced both results.**

That distinction matters, because "fixed" and "not reproducible" call for opposite actions. It
supports the conclusion already reached above — that the four structural causes were correctly ruled
out and the original symptom was most likely an **observation timing artifact**: a screenshot or DOM
read taken in the window between the mutation resolving and React committing the re-render.

**Downgraded to "not reproducible" rather than closed.** Two clean runs do not disprove an
intermittent render race, and the original observation was specific and twice-repeated with concrete
values. If it never recurs it can be closed at sign-off; it should not be closed on this evidence
alone.

**Do not "re-fix" it.** There is nothing to revert and nothing was applied.

### Four smaller observations from the same run — not scored, worth knowing

1. **`interview-preview` fires once per keystroke — 42 calls to fill one form.** 13 while typing the
   interviewer's name, 26 while typing their address. Each call compiles two HTML email templates
   server-side. No debounce. The name and address also travel in the **query string**, so they land
   in access logs. Not a defect, but it is the kind of thing that looks bad in a network tab during a
   demo, and it is a real server cost per keystroke.
2. **The time picker rejects `03:00 PM` but accepts `3:00 PM`.** A zero-padded hour yields "No data"
   and the field silently stays empty — easy to mistake for the form being broken.
3. **"Emails in this round" shows only the live booking's mail.** After a reschedule the original
   invite line disappears rather than the reschedule notice being appended, so the round's email
   history is replaced, not accumulated.
4. **A past booking has no UI cancel path.** Once the start time passes the drawer offers only Mark
   as Held / Mark No-show / Reschedule. A recruiter with a stale past booking has to reschedule it
   into the future before they can cancel it. This is why the run's own preparation step needed a
   direct API call.

---

## Group 2 — browser-only checks

Run 2026-08-20 ~16:50 IST against the **local dev server** (current working tree, so including the
D3 and 409 UX fixes) — *not* staging. Journey 27, SAHIL SARMA. Evidence:
`docs/test-claude-chrome/group2manualpassresults.md`.

| Case | Verdict | Note |
|---|---|---|
| **DOC-05** | ⚠️ **FAIL → now fixed** | `.exe` rejected but with 500 (**D6**); extension check bypassed by rename (**D7**). Both fixed |
| **DOC-04** | ⚠️ **PARTIAL** | O3 confirmed: the hidden input carries `accept=""`, nothing enforces the stated formats until submit. **It does not fail silently** — the toast reads *"1 of 1 could not be sent. Please try those again."* But the server's precise reason is discarded (**D8**) |
| **VEND-14/15** | ✅ **PASS** | `byStage` reconciles exactly: 2 + 1 + closed 0 + untracked 14 = **17** = `stats.total`. Candidates with no journey land in `untracked` rather than vanishing. UI labels that bucket *"Not in pipeline"* — wording differs from the plan, same thing |
| **O7** | ⊘ **Not reproducible — but confirmed in code** | See below |
| **SCHED-18 (UI)** | ⊘ **Not runnable** | No submitted scorecard exists anywhere. Moved to the blocked list |

### O7 — the null-deadline day count is real, and worse than the finding says

Not observable in this database: **0 candidates at `assessment`**, and `invited` is false across all
23 journeys, so the code path never executes. But it was verified by simulation at
`PipelineDrawer.jsx:425`:

| `deadline_at` | rendered `daysLeft` |
|---|---|
| `null` | **-20685** |
| `undefined` | **NaN** |
| `''` | **NaN** |

**The important part the original finding missed:** `daysLeft` is used in **both** branches of the
ternary, not only the overdue one. So this does not depend on `isOverdue` being wrongly true — the
ordinary path renders *"deadline in -20685 day(s)"*.

**How a null could arise is a configuration question, not an exotic one.** The live
`AssessmentInviteModal` has no date picker and never sends `deadline_at`; the server computes it from
the `assessment_deadline_days` setting. If that setting is ever absent, every invite gets a null
deadline. Note the modal's own email body degrades gracefully (`deadlineDays || 2`) while the drawer
does not — that asymmetry is the bug in miniature.

**To close O7:** check `assessment_deadline_days`, send one invite, confirm `deadline_at` lands
non-null. Five minutes, worth doing before the demo.

---

## Group 3 and the re-tests — evening session 2026-08-20

Evidence: `docs/test-claude-chrome/phase3manualpassresults20260820.md`. Five items, all passing.

### PIPE-08 — recruiter refused by `requireAdmin` ✅ PASS

`biswajit.sur351` (recruiter). Five config writes refused — `POST /stages`, `PUT /stages/tech1`,
`POST /stages/tech1/outcomes`, `POST /reasons`, `PUT /stage-templates` — all 403
*"Admin access required to change this configuration."* from `auth.js:169`.

**Proved it is the admin gate, not the module gate**, three ways: reads on the same router return
200, so the module check passes; the message is the admin sentence, not the generic permission one;
and the frame is `auth.js:169`, distinct from `auth.js:105` (module) and `auth.js:200`
(`requireStaff`). This is exactly the "passes for the wrong reason" trap the plan warned about, and
it was avoided.

### VEND-11 / VEND-13 — vendor refused by `requireStaff` ✅ PASS

`sahil.dubey673` (vendor), **with `recruitment_pipeline` enabled** — the precondition that makes the
case meaningful. Eight pipeline routes refused, reads and writes alike, every one naming the guard:

```
at requireStaff (backend/src/middleware/auth.js:200:17)
```

`POST /api/pipeline/stages` stops at `requireStaff` and never reaches `requireAdmin` — correct
ordering. Not a blanket refusal: the same session returns 200 on the vendor dashboard, vendor
candidates, MRF, candidates, dashboard stats and email templates.

This is precisely what the M6 fix was for: module on, vendor still out.

✅ **Cleanup done.** The toggle was revoked at 21:03 IST on 2026-08-20 and verified
`is_enabled = false` against the database. The account keeps `vendor_upload` and `vendor_dashboard`,
so the revoke did not overshoot. **No vendor over-privilege remains ahead of the demo.**

⚠️ **One process note.** That flag changed four times in a day, including once *mid-pass* at 13:38 by
someone outside this test run — which silently broke VEND-11's precondition and would have made the
case pass for the wrong reason (refused by the module gate, never reaching `requireStaff`). It was
caught only because the flag was re-checked against the database rather than trusted from a note
written hours earlier. Any re-run of VEND-11 should begin with that check.

### DOC-05 re-run — ✅ PASS, both D6 and D7 confirmed dead

| Payload | Result |
|---|---|
| real `.exe` | **400** — *"File type .exe is not allowed…"* |
| **MZ bytes renamed `.pdf`, `application/pdf` MIME** | **400** — *"That file is not a valid PDF…"* ← the D7 bypass, now closed |
| real PDF bytes named `.exe` | **400** — extension gate fires first |

**D6's alert-email half was measured as a differential, not assumed:** `backend_error_alert`
sent/failed was `30/0` before a rejected upload and `30/0` four seconds after. No alert fired.

No side effects — the checklist row stayed `pending`, nothing written to OneDrive.

### D9 re-test — ✅ FIXED, end to end

Audit line, verbatim: `Technical Round 1 interview cancelled: D9 re-test - interviewer unavailable`.
The reason also appears at the top of the Exchange cancellation notice delivered to the candidate,
confirming the helper text's promise. State separation verified — `cancelReason` and
`interviewCancelReason` are distinct, no collision with the Zeko modal.

### Group 1 mailbox/calendar half — ✅ COMPLETE

| Check | Result |
|---|---|
| Two distinct attendees on the event | ✅ **Phase3 Midflow Candidate** (→ staging inbox) and **Pankaj Kumar Mondal**. No collapse — the interviewer-address precondition worked |
| Candidate invite | ✅ 1 |
| Panel invite | ✅ 1 |
| Reschedule notices | ✅ 1 per side |
| Cancellation mails | ✅ 1 per side |
| Extra Outlook `Canceled:` notice | 🔴 **Yes** — see D4 above |

**Not a defect:** the OWA event editor renders times in UTC while the calendar grid and the
candidate's Gmail both show IST correctly. Display-only, and correct everywhere a candidate looks.

---

## Two SCHED findings that are NOT defects — recorded so they are not re-investigated

Both came out of the 2026-08-20 SCHED-05/06 run (`docs/test-claude-chrome/SCHED0506findings.md`) and
were reported as bugs. Neither is. Each is written up because the reasoning is not obvious and
somebody will otherwise find them again.

### "One calendar attendee, candidate's name on the interviewer's address" — a STAGING ARTIFACT

**Reported as High.** The Graph event carried exactly one attendee, displayed as *"Phase3 Midflow
Candidate"* but resolving to `n8npankajmondal@gmail.com` — the interviewer's mailbox.

**The attendee-building code is correct.** `interviewSchedule.service.js:534` pairs
`candidate.candidate_email` with `candidate.candidate_name`, and maps panel addresses separately.
Name and address are *not* sourced from different objects.

**What actually happened.** `calendarCandidateEmail()` → `nonProdSafeCandidateEmail()`
(`config/emailRecipients.js:301`) **replaces every candidate address with the first entry in
`EMAIL_STAGING_RECIPIENTS`** outside production. That first entry is `n8npankajmondal@gmail.com` —
**the same address the tester used as the interviewer**. So both attendees resolved to one mailbox,
Outlook collapsed them into a single entry, and kept the candidate's display name.

That guard exists precisely because **Outlook, not this app, sends calendar invites**, so they
bypass every mail protection we own. Without it a real candidate would receive a genuine interview
invite from staging. It is working exactly as designed.

⚠️ **The real lesson is about test method.** Using an interviewer address that is also the first
staging recipient makes the two-attendee behaviour **unobservable on staging** — the guard collapses
it every time. **Re-test with an interviewer address that is NOT in `EMAIL_STAGING_RECIPIENTS`**
(e.g. `pkmondal@aapnainfotech.com`) and confirm two distinct attendees appear. Until then, SCHED-01's
attendee assertion is untested, not passed.

### "Scheduling endpoints return 200, not 201" — the TEST PLAN is wrong

`POST /interview` and `POST /interview/reschedule` both return **200**. The plan expects 201.

Both controllers end in the shared `success(res, result, …)` helper, which returns 200 for every
endpoint in the API. There is no 201 anywhere in this codebase. The plan's expectation was written
against an assumption the code never adopted.

**Correct the plan, not the code.** Changing these two endpoints to 201 would make them inconsistent
with every other write endpoint in the app, and any client checking `=== 200` would break.

---

## Test-harness bugs found and fixed (not product defects)

Recorded deliberately — each looked like a failure and was investigated against the source before
being dismissed. The last one would have reported a false defect on the suite's most critical case.

| # | Symptom | Cause | Fix |
|---|---|---|---|
| H1 | `"undefined" is not a valid closure outcome` | I used `FINAL_OUTCOMES.CLOSURE_REJECTED`; the real keys are `REJECTED`/`APPROVED` (`pipelineStages.js:133`) | corrected constants |
| H2 | `Cannot read properties of undefined (reading 'final_outcome')` | `setFinalOutcome` returns the row itself, not `{ pipeline }` (unlike `setStageOutcome`) | assert on the row |
| H3 | `expected at least one vendor message, found 0 of 2` | filtered on `to_emails` containing the vendor address — but staging **redirects every recipient** to the test inbox, so the real address never appears on the row | filter on `candidate_id` + vendor-template footer |
| H4 | `no figures may reach a vendor` | regex `/LPA/i` matched inside `cellPAdding` / `cellsPAcing` HTML attributes | strip tags first, then match on `\b` word boundaries |
| H5 | `expected a candidate message, found 0 of 1` | candidate subjects are `"Update on Your Application — {{position}}"` and carry no candidate name, so a name-based filter only ever saw the vendor copy | key on `candidate_id` |

**H3 is the one worth remembering.** A test asserting on `to_emails` in a redirect-enabled
environment will always report the vendor dual-send as broken. Anyone re-running VEND-01 by hand
should read `rpa_email_messages` content, not the recipient column.

**`candidate_id` linkage verified by direct probe**, not assumed: one approve on a fresh journey
produced `id=5806 candidate_id=381 shortlist_id=276 mrf_id=137`. Older rows in the table showing
`candidate_id=null` predate this path and are not evidence of a defect.

---

## Cases that CANNOT be automated — manual steps required

These are not skipped, and not passed. They need a human with a browser and a mailbox, and are
listed here with what to do so the pass can be finished properly.

**Roughly 30–45 minutes of manual work for the first group.**

### Requires a real Teams / Outlook / OneDrive round trip

| Case | What to do | What to look for |
|---|---|---|
| **SCHED-01** | Book a **tech1** interview from the Pipeline drawer with your own address as interviewer | A Teams meeting appears on `MS_CALENDAR_MAILBOX` (`pkmondal@aapnainfotech.com`); candidate mail lands in the **test inbox**, not the candidate's address |
| **SCHED-06** | Reschedule that booking | **Exactly one** "rescheduled" email per side showing `previous → new`. Not a cancel + a fresh invite |
| **SCHED-07** | Cancel it with a reason | One cancellation email; the calendar event disappears |
| ~~**DOC-03**~~ | ✅ **DONE 2026-08-20** — passed against live journey 27. See Block C | — |
| **DOC-05** | POST a `.exe`, and a >10 MB file, straight to `/api/documents/:token/upload` | Multer rejects both — record the actual status code |

### Requires a browser (UI rendering)

| Case | What to check |
|---|---|
| **DOC-04** | The known finding **O3** — `beforeUpload` returns false unconditionally with no type/size check. Confirm whether it still fails silently. Server-side guard is DOC-05 |
| **SCHED-18 (UI)** | The API is verified ✅; confirm the PipelineDrawer report **modal renders it** |
| **N5** | ⚠️ **RUN 2026-08-20 — see below. Not scored: the test could not produce a 409 to spot-check, which is defect D3.** The message-propagation pattern itself is present in every screen checked |
| **O7** | Open a candidate whose assessment invite has no `deadline_at` — confirm no nonsense day count |
| **PIPE-08 (UI)** | Stage/outcome CRUD as a recruiter → 403. ⚠️ See the note below — this needs care to be meaningful |
| **VEND-14/15** | Vendor dashboard stage counts come from `current_stage_key`; no-journey candidates appear as `untracked`, not dropped |

### Blocked — cannot run at all

| Case | Blocker |
|---|---|
| **SCHED-11** (occurrence sweep, Teams attendance) | Graph `OnlineMeetingArtifact.Read.All` + Teams policy still pending with IT (readiness §2.4). The **nudge fallback** half is testable; the automatic-attendance half is not. ⚠️ Verify the "auto-no-showed every staging interview" regression specifically when the grant lands — it is a silent, every-row class of failure |
| **ZEK-05 … ZEK-12** | `ZEKO_API_URL` is blank in all four env files (readiness §2.3). No published Zeko job with a `primary_interview_id` exists to test against |
| ~~**DOC-11**~~ | ✅ **DONE 2026-08-20** — automated, 5 cases. See Block G below |
| ~~**OFFER-14/15**~~ | ✅ **DONE 2026-08-20** — automated, 7 cases. See Block G below |

### ⚠️ PIPE-08 and VEND-11 need a specific setup or they prove nothing

Both assert a **403**, and both can pass for the wrong reason:

- **PIPE-08** expects a recruiter to be refused by `requireAdmin`. But if that recruiter lacked the
  `recruitment_pipeline` module they would get 403 from `checkModuleAccess` instead — same status,
  different guard, box ticked having proven nothing. `biswajit.sur351` now **has** the module
  (granted 2026-08-19), so the 403 will genuinely come from `requireAdmin`. Good.
- **VEND-11** expects a vendor to be refused by `requireStaff` **even with** the pipeline module
  switched on — that is the whole point of the M6 fix.

  ✅ **RESOLVED 2026-08-20.** VEND-11/13 ran with the module **enabled** and passed — refused at
  `requireStaff` (`auth.js:200`), which is the case's whole point. The toggle was then revoked at
  21:03 IST and verified `is_enabled = false`. See *Group 3 and the re-tests* below.

  ⚠️ **It was nearly tested wrong.** The flag was revoked mid-pass at 13:38 by someone outside this
  run, which would have made the vendor fail at the module gate and never reach `requireStaff` — a
  403 from the wrong guard, box ticked, nothing proved. Exactly the trap this section warns about.
  Caught only by re-checking the database instead of trusting a note.

  **`biswajit.sur351` (PIPE-08) was checked alongside and is correct** — `recruitment_pipeline`
  enabled, so its 403 genuinely comes from `requireAdmin`.

---

## Final suite run and staging hygiene

**Combined suite — unit + integration, run together 2026-08-19 23:05:**

```
assertions passing : 118
assertions failing : 0
```

The 6 new integration files run alongside the 11 pre-existing unit files with no config change —
`npm run test:unit`'s glob (`src/tests/**/*.test.js`) already picks them up.

**Staging left clean.** Verified after the final run:

| Check | Result |
|---|---|
| Fixture CVs | 3 — exactly the base fixture |
| Fixture MRFs | 2 — no single-use MRF leaked |
| MRFs left `filled_at` | **0** — nothing left closed |
| Pipeline stage config | **intact** — only `shortlist` inactive, exactly as at baseline |
| Stray test-mailbox CVs outside the fixture | **0** |
| Journeys | 23 (baseline 20 + the 3 fixture journeys) |
| MRFs | 43 (baseline 41 + the 2 fixture MRFs) |

The stage-config check matters: PIPE-07 and PIPE-15 deactivate a **global** stage. Both restore it
in a `finally`, and the count confirms it held.

The base fixture is deliberately **left in place** for the manual cases below. To remove it:
`node src/tests/helpers/fixture.js teardown` (deletes by explicit id, never a time window).

---

## Observations carried forward

**Emails are really sending, correctly redirected.** Every outcome email in this block went to
`n8npankajmondal@gmail.com, hmopuri@aapnainfotech.com, saukumar@aapnainfotech.com` — the staging
test inbox — never to the candidate address on the row. The redirect works. Anyone watching that
inbox will see ~8 mails from this run.

**`resolveRecipients` warns on every send:** `"resolveRecipients(\"stageOutcome\") called before
rpa_settings were loaded; using defaults."` Harmless in a test process that never boots the server
(`loadEmailRecipients()` runs at startup), but it means these tests exercise the **in-code
DEFAULTS**, not any `rpa_settings` overrides an admin may have set. Worth calling
`loadEmailRecipients()` in the harness before asserting on recipients specifically.

**`rpa_stage_email_templates` is still empty (0 rows)** — every outcome email in this block resolved
through the generic fallback. The stage→template mapping path remains untested; a mapping will be
seeded before sign-off so both paths are covered.

**Test processes hang on exit.** The shared Redis connection keeps the event loop alive after
`node --test` finishes. Results are complete and correct; the process just needs killing. The
fixture CLI closes Redis explicitly; the test file does too in `after()`, but `node --test` still
lingers. Cosmetic — noted so nobody reads a hung process as a failure.
