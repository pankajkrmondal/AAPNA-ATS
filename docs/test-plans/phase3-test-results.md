# Phase 3 — Test Pass Results

**Environment:** Staging (`recruitmentautomationdb` @ 20.244.34.176, PostgreSQL 18.1)
**Started:** 2026-08-19
**Executed by:** Claude, via automated harness against the live service layer
**Pre-pass snapshot:** `.test-snapshots/staging-pre-testpass-20260819-200434.dump` (verified restorable)

Recording format follows `phase3-test-execution-plan-for-developer.md` §4 — Pass / Fail / Blocked,
with observed behaviour quoted where it matters.

---

## Bottom line for the client demo

**65 of 122 cases executed, all passing. Three real defects found and fixed.**

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
| C — M4 Documents (DOC) | 13 | 9 | 9 | 0 | 0 | 4 (manual) |
| D — M5 Offer (OFFER) | 16 | 12 | 12 | 0 | 0 | 4 |
| E — M6 Vendor (VEND) | 16 | 9 | 9 | 0 | 0 | 7 |
| F — Cross-module (E2E) | 5 | 5 | 5 | 0 | 0 | 0 |
| N — Negative/resilience | 5 | 1 | 1 | 0 | 0 | 4 |
| G — Companion plan | 32 | 0 | — | — | — | 32 |
| **Total** | **122** | **65** | **65** | **0** | **0** | **57** |

Block C rose by one on 2026-08-20: **DOC-03** run manually against a live journey (details in Block C).

## 🔴 Product defects found: 3 — two fixed, one open

| # | Severity | Where | Effect | State |
|---|---|---|---|---|
| **D1** | 🔴 **High** | `mrfClosure.service.js` `countAcceptedHires()` | **No requisition could ever auto-close on acceptance.** Double-hiring risk. | ✅ Fixed |
| **D2** | 🟡 Medium | `offer.service.js` `recordCandidateDecision()` | A truthy *string* passed the `amend` guard, so a recorded acceptance could be silently overwritten. | ✅ Fixed |
| **D3** | 🔴 **High** | `pipeline.service.js` `setStageOutcome()` + `pipeline.controller.js` | **A stale browser tab can advance a candidate a second time**, skipping a stage entirely and sending two outcome emails. The concurrency guard only catches simultaneous requests, not stale ones. | ✅ Fixed |

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
| **DOC-11** (reminder sweep selection) | Needs four request states aged across days. Achievable by backdating `requested_at`, but not attempted this session |
| **OFFER-14/15** (nudge + 90-day auto-close) | Callable directly via `runApprovalNudges()` / `runPostJoiningAutoClose()`; not attempted this session |

### ⚠️ PIPE-08 and VEND-11 need a specific setup or they prove nothing

Both assert a **403**, and both can pass for the wrong reason:

- **PIPE-08** expects a recruiter to be refused by `requireAdmin`. But if that recruiter lacked the
  `recruitment_pipeline` module they would get 403 from `checkModuleAccess` instead — same status,
  different guard, box ticked having proven nothing. `biswajit.sur351` now **has** the module
  (granted 2026-08-19), so the 403 will genuinely come from `requireAdmin`. Good.
- **VEND-11** expects a vendor to be refused by `requireStaff` **even with** the pipeline module
  switched on — that is the whole point of the M6 fix. `sahil.dubey673` currently has
  `recruitment_pipeline: true` precisely so this case is meaningful. **Remove that toggle once
  VEND-11 and VEND-13 have been run** — it is a deliberate, temporary over-privilege.

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
