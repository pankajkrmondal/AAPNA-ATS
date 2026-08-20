# Phase 3 — Manual Pass Checklist

**For:** the part of Phase 3 that cannot be automated — anything needing a real browser, a real
mailbox, or a real Teams/OneDrive round trip.

**Why these and not others:** every case here touches a surface outside the service layer. The
automated pass ([phase3-test-results.md](phase3-test-results.md)) now covers 68 cases against the
live database; these are what is left that a machine cannot reach.

Tick the boxes and fill the **Observed** column as you go. Anything that fails, write down the
*exact* string or status code — this pass found **three** real defects precisely because observed
behaviour was quoted rather than summarised.

---

## Status at a glance — updated 2026-08-20

| | Case | State |
|---|---|---|
| ✅ | **DOC-03** — public upload | PASS, evidenced |
| ✅ | **N5** — 409 message | PASS (after finding and fixing defect D3) |
| ☐ | **SCHED-01** — book a tech1 interview | Needs a re-run — see the interviewer-address warning |
| ☐ | **SCHED-06** — reschedule | App-email half **settled ✅**; one mailbox question left |
| ☐ | **SCHED-07** — cancel | Not yet run |
| ✅ | **Group 2** — browser-only checks | 3 of 5 done; O7 and SCHED-18 not runnable here (moved to blocked) |
| ☐ | Group 3 — the 403 pair + cleanup | Blocks the demo if the cleanup is missed |

**Found by this manual pass so far — six defects:** D3 (stale-tab double-advance, **fixed**),
D4 (reschedule kills the Teams join link, **open**), D5 (candidate email edits never reach a live
journey, **open**), D6 (rejected upload returned 500 and emailed the team, **fixed**),
🔴 **D7 (file validation was extension-only — an executable renamed `.pdf` uploaded to OneDrive
through the public endpoint, fixed)**, D8 (upload page discards the server's reason, **open**).

⚠️ **Everything is uncommitted.** D1, D2, D3, both UX fixes and the new test files are in the working
tree only. Staging must be restarted to reflect any of them.

## Before you start

| Check | How |
|---|---|
| Fixture is still seeded | `node src/tests/helpers/fixture.js status` — expect 3 CVs, 2 MRFs, 3 journeys. ⚠️ These are **fixture-tagged rows only**, found by `FIXTURE_TAG`. They are not database totals: a populated dev DB holds ~198 CVs and ~124 MRFs, which is normal. Do not compare against `/api/candidates` or `/api/mrf` pagination totals |
| Or use a real journey instead | The fixture is a convenience, not a requirement. Any live journey sitting on the right stage is **better** evidence — it exercises real data. Note which journey you used |
| You know which inbox to watch | Candidate mail → the **staging test inbox** (`n8npankajmondal@gmail.com`, `hmopuri@`, `saukumar@`). Never the candidate's real address |
| You are using **your own** address as interviewer | `interviewScheduledPanel` and `scorecardInvite` are `OPERATOR_ADDRESSED` — they are **not** redirected. Whatever address you type receives real mail. Do not type a colleague's. ⚠️ And **not** `n8npankajmondal@gmail.com` — see the warning in Group 1 |

⚠️ **Restart staging before this session.** It was last restarted at ~12:00 on 2026-08-20, which
picked up the D3 fix but **not** the 409 UX fix (drawer auto-close + background dim) that landed
afterwards. Note which build you tested against if you skip the restart.

---

## Group 1 — Teams / Outlook round trip (demo-critical)

These three are one continuous sequence on a single booking. Do them in order.

### ⚠️ Before you book — pick the interviewer address carefully

**Do NOT use `n8npankajmondal@gmail.com`.** It is the first entry in `EMAIL_STAGING_RECIPIENTS`, and
the non-prod guard rewrites every *candidate* address to that same inbox before handing the event to
Outlook. Use it as the interviewer and both attendees collapse into one — which is exactly what
invalidated the first SCHED-05/06 run on 2026-08-20.

**Use `pkmondal@aapnainfotech.com`** (or any address not in `EMAIL_STAGING_RECIPIENTS`).

### ☐ SCHED-01 — Book a tech1 interview

**Do:** Pipeline drawer → a journey sitting on `tech1` → Schedule Interview. Your own address as
interviewer (see the warning above), a future `start_at`.

**Expect:**
- **200** (not 201 — the plan says 201, but every write endpoint in this API returns 200; the plan
  is wrong, confirmed 2026-08-20)
- `rpa_interview_schedule` row `status='scheduled'`
- Teams meeting + calendar event on `MS_CALENDAR_MAILBOX` (`pkmondal@aapnainfotech.com`)
- **TWO distinct attendees on the calendar event** — candidate's name → the staging test inbox,
  interviewer → your address. One attendee means you used a clashing interviewer address; see the
  warning above
- Candidate email in the **test inbox** — not the candidate's address
- Panel email at **your** address (not redirected — this is expected, not a bug)

**Observed:**

---

### ☐ SCHED-06 — Reschedule it — **mostly settled; one mailbox question left**

**Do:** Reschedule the booking from SCHED-01 to a new time.

**Expect:**
- Old row → `status='cancelled'` with `cancel_reason='Rescheduled'`, one new row live
- **Exactly ONE "rescheduled" email per side**, showing `previous → new`
- ⚠️ The Graph event **is** deleted and recreated, not patched — that is **defect D4**, already known
  and accepted as Medium. The Teams join link and passcode will change. Do not re-report it

✅ **The app-email half is already settled — verified by instrumented run, 2026-08-20.** Exactly
**one email per side**, both titled *"Interview Rescheduled"*, neither a cancellation. The Graph
`/cancel` call removes the calendar event and sends no mail of ours. Audit line shows
`previous → new`. See SCHED-06 in [phase3-test-results.md](phase3-test-results.md).

**So what is left for you is the mailbox half only:**

| What to check | |
|---|---|
| Total mails in the test inbox from one reschedule (expect **1** candidate-side) | |
| Mail at `pkmondal@` (expect **1**, "Interview Rescheduled — Panel") | |
| ⚠️ **Any EXTRA "Meeting cancelled" notice from Outlook?** Exchange sends this itself when the event is cancelled — invisible to our logs. This is the open question | |
| Is the old Teams join link now dead? (expect yes — defect D4) | |

**Observed:**

---

### ☐ SCHED-07 — Cancel it with a reason

**Do:** Cancel the rescheduled booking, supplying a `cancel_reason`.

**Expect:** `status='cancelled'`; **one** cancellation email per side; the calendar event disappears
from the mailbox.

ℹ️ **The cancel path was exercised once already**, on 2026-08-20, clearing the leftover journey-36
booking (row 94). It behaved correctly: Graph event cancelled, row stamped with `cancelled_at` and
the reason, and **two** emails sent — one candidate-side (`interviewCancelled`, redirected to the
test inbox) and one panel-side (`interviewCancelledPanel`). That was a cleanup, not a scored run —
this case still needs doing properly as the third step of the SCHED-01 → 06 → 07 sequence.

**Observed:**

---

### ☑ DOC-03 — Public upload, real PDF — ✅ **PASS** (20 Aug 2026, 09:15 IST)

**Do:** Take the upload link from a journey at the `documents` stage, open it in a browser
(no login), upload a genuine PDF under 10 MB against a valid checklist item.

**Expect:**
- 200
- File in OneDrive under `Document Collection/{candidate name (cv-{id})}/`
- `rpa_candidate_documents` row → `status='uploaded'`
- Local temp copy deleted

**Observed:** All four met. Evidence: [documentuploade2eevidence.html](../test-claude-chrome/documentuploade2eevidence.html)

Run against a **real journey**, not the fixture — pipeline 27, SAHIL SARMA (cv 31), Dot Net /
mrf 63, 7 days in `documents` with 3 reminders already sent.

| Expectation | Result |
|---|---|
| Unauthenticated access | ✅ Auth keys cleared, fresh tab — portal rendered name, position and 3-item checklist, no login prompt, no redirect |
| HTTP 200 | ✅ `{"status":"success","message":"Document uploaded","data":{"id":7,"status":"uploaded",…}}` |
| OneDrive landing | ✅ `Resume_Test/Document Collection/SAHIL SARMA (cv-31)/payslips_last_3_months_1787197525.pdf`, 800 bytes byte-identical, written by the SharePoint service principal |
| DB row `uploaded` | ✅ Verified by direct query — doc id 7 `status='uploaded'`, `uploaded_at=2026-08-20T03:45:25.807Z` (matches the OneDrive timestamp to under a second), `original_name` preserved |
| Temp copy deleted | ✅ By construction — `documentCollection.service.js:381-384` unlinks in a `finally`, so it happens whether the Graph upload succeeds or fails |

**`token_status` correctly stayed `active`.** Only 1 of 3 checklist items was uploaded (items 2 and 3
remain `pending`); DOC-07's auto-close fires on the **last** item. Not a miss.

**Two observations, neither a defect:**

1. **Files sit under a `Resume_Test/` root**, not the drive root. This is configured, not drift —
   `MS_ONEDRIVE_PARENT_ID` is deliberately left empty in `config/index.js:94` (*"OneDrive parent
   folder differs per environment and must be set explicitly"*), and documents nest inside the same
   parent resumes already use. Correct for this environment; confirm the production value separately.
2. **The candidate's filename is discarded** on disk, replaced with `{item_key}_{unix_ts}.pdf`. The
   original survives in `rpa_candidate_documents.original_name`, so nothing is lost — worth knowing
   if anyone goes looking in OneDrive by the name the candidate used.

---

### ☑ N5 — A 409 shows the *server's* message — ✅ **PASS** (20 Aug 2026, 12:03)

**The highest-value case in this checklist.** Scoped as a copy check; found a High-severity defect a
182-test green suite could not see.

**First run — blocked.** No 409 could be produced from the UI at all, so there was nothing to
spot-check. Evidence: [409conflictspotcheck.html](../test-claude-chrome/409conflictspotcheck.html).
The two-tab test instead found **defect D3**: a stale tab's approval was *accepted* (200) and
advanced the candidate a **second time**, skipping a stage and sending two outcome emails.

The backend guard was real all along (`pipeline.service.js:635`, and PIPE-03 proved it fires) — but
it only caught *simultaneous* requests, not *stale* ones, because the stage it compared was read
from the database rather than sent by the client. PIPE-03 fires both approvals at once, so it could
only ever exercise the concurrent window.

**Second run — PASS.** D3 fixed the same day, staging restarted.

| Screen | Message rendered? |
|---|---|
| **PipelineDrawer** | ✅ Exact server sentence: *"Someone else moved this candidate while you were deciding. Reopen the candidate to see where they are now."* — not a generic fallback |
| **Candidate state** | ✅ Senthamil Selvi advanced to Functional Screening (Zeko) **once**. No double-advance — D3 confirmed fixed at the browser surface |
| CandidateDetail | (not re-checked — propagation path verified in code via `api.js`) |

**UX issue found during this run, now fixed.** The drawer and the decision modal stayed open behind
the error, contradicting the message's own instruction to "reopen the candidate" and leaving Approve
/ Hold / Reject live on a stage the candidate had already left. A `"Pipeline updated."` success toast
also appeared next to the error. Both fixed: on a 409 the drawer now closes and the board refreshes
without the success toast.

⚠️ **Needs another staging restart** to see the UX fix — it landed after the run above.

**Note:** `AnalyticsLegacy` was in the original screen list **and does not exist** — that was my
error copying from the test plan. Use `EmailManagement` instead.

---

## Group 2 — Browser-only checks — ✅ **RUN 2026-08-20**

Evidence: [group2manualpassresults.md](../test-claude-chrome/group2manualpassresults.md).
Ran against the **local dev server**, not staging.

| | Case | Verdict | Observed |
|---|---|---|---|
| ☑ | **DOC-05** | ⚠️ **FAIL → fixed** | `.exe` rejected but with **500** (D6). And the killer: `malware.pdf` — **MZ executable bytes with a `.pdf` name — uploaded successfully, 200** (D7). Both now fixed |
| ☑ | **DOC-04** | ⚠️ **PARTIAL** | O3 confirmed — the hidden input has `accept=""`, nothing enforces the stated formats until submit. **Not silent**: toast reads *"1 of 1 could not be sent. Please try those again."* But the server's real reason is discarded (**D8**) |
| ☑ | **VEND-14/15** | ✅ **PASS** | `2 + 1 + 0 + 14 = 17` = `stats.total`. Reconciles exactly; `untracked` bucket present (UI calls it *"Not in pipeline"*) |
| ⊘ | **O7** | Moved to blocked | No assessment invite exists to open. **Defect confirmed in code** — `null` renders `-20685`, and `daysLeft` is used in *both* ternary branches, so it does not need `isOverdue` to be wrong |
| ⊘ | **SCHED-18 (UI)** | Moved to blocked | No submitted scorecard exists anywhere to render |

⚠️ **DOC-04 and DOC-05 were run before the D6/D7 fixes and against dev, not staging.** Re-run DOC-05
on staging after a restart if the build matters for sign-off — the expected result is now **400** for
a `.exe` and **400** for a renamed executable.

---

## Group 3 — The 403 pair, and the cleanup that follows

These two prove nothing unless the setup is right — both assert a 403, and both can pass for the
wrong reason.

### ☐ PIPE-08 — recruiter refused by `requireAdmin`

**Do:** As `biswajit.sur351` (a recruiter), attempt stage/outcome CRUD.

**Expect:** 403 — and it must come from `requireAdmin`, not `checkModuleAccess`. That user was
granted the `recruitment_pipeline` module on 2026-08-19 specifically so the module check passes and
the admin check is what refuses. Good as-is.

**Observed:**

---

### ☐ VEND-11 / VEND-13 — vendor refused by `requireStaff`

**Do:** As `sahil.dubey673` (a vendor), attempt the pipeline routes.

**Expect:** 403 from `requireStaff` **even though** that account currently has
`recruitment_pipeline: true`. That toggle is deliberate — it is the entire point of the M6 fix.

**Observed:**

---

### ☐ ⚠️ CLEANUP — remove the vendor's pipeline toggle

**Once VEND-11 and VEND-13 have been run**, revoke `recruitment_pipeline` from `sahil.dubey673`.

It is a deliberate, temporary over-privilege that exists only to make VEND-11 meaningful. It must
not outlive this test pass, and it must not be live during the client demo.

**Done:** ☐

---

## Open defects and follow-ups — decisions needed, not testing

Both found on 2026-08-20 and written up in [phase3-test-results.md](phase3-test-results.md). Neither
is fixed, and neither should be fixed without a decision first.

### D4 — reschedule kills the Teams join link

Rescheduling cancels the Graph event and creates a new one, so the join link and passcode change.
Anyone holding the original invite has a dead link.

The fix is to `PATCH` the existing event instead. The database row still needs replacing (the unique
"one live booking per round" index requires it) — so the change is to **decouple the calendar event
from the booking row**, which is a small design decision rather than a one-liner.

☐ **Decide:** fix before the demo, or accept and document?

### D5 — a candidate's email edit never reaches a live journey

`rpa_candidate_pipeline` holds a denormalised `candidate_email` copied at shortlist time. Editing the
candidate record does not update it, and no UI path can correct it, so invites keep going to the
stale address.

Three possible fixes, and they are not equivalent: resolve the address at send time; propagate record
edits to open journeys; or expose an editable recipient on the send form.

☐ **Decide which**, since other consumers read the denormalised copy.

### D8 — the public upload page throws away the server's error message

The server says *"File type .exe is not allowed. Accepted: .pdf, .docx, …"*. The candidate sees
*"1 of 1 could not be sent. Please try those again."* — advice that cannot work.

This is **N5's defect on the candidate-facing surface**. The authenticated screens all pass N5
because they read the server's message through the shared `api.js` client; the public upload page
sits outside that app and does not.

☐ **Worth fixing alongside DOC-04's O3 gap** (the page also has `accept=""` and validates nothing
client-side) rather than patching each separately.

### ⚠️ D7 follow-up — four upload routes still unfixed

`document.routes.js` is fixed. The same extension-only pattern remains in `hrUpload.routes.js`,
`candidate.routes.js`, `assessmentImport.routes.js` and `vendor.routes.js`.

All four are **authenticated**, so the exposure is far lower than the public document endpoint. The
shared helper (`utils/fileSignature.js`) already exists — wiring each up is a few lines.

☐ **Decide:** now, or as post-demo hardening?

---

## Cannot be run at all — not your problem today

Listed so nothing looks forgotten:

| Case | Blocker |
|---|---|
| SCHED-11 (Teams attendance sweep) | Graph `OnlineMeetingArtifact.Read.All` grant still pending with IT. ⚠️ When it lands, specifically check the "auto-no-showed every staging interview" regression — silent, every-row failure class |
| ZEK-05 … ZEK-12 | `ZEKO_API_URL` blank in all four env files; no published Zeko job to test against |
| **SCHED-18 (UI)** | No submitted scorecard exists on any journey. An interviewer has to actually submit one first — not a quick UI check, and not a UI bug |
| **O7** | No assessment invite exists to open (0 candidates at `assessment`). ☐ **Five-minute alternative:** check what `assessment_deadline_days` is set to, send one invite, confirm `deadline_at` lands non-null. Worth doing before the demo — if that setting is ever absent, every invite row renders *"deadline in -20685 day(s)"* |

---

## Three decisions someone needs to make (not bugs)

Recorded rather than judged. None blocks the demo, but each is a place where the plan and the code
disagree:

1. **Scorecard ratings round instead of rejecting.** `2.3` becomes `2.5`. The plan expected a 400.
   Rounding every off-step rating upward is a small systematic bias in interviewers' scores.
2. **HR fields truncate silently.** 400 characters capped to 100/255 with no warning. The plan asks
   whether that or a 400 is the right UX.
3. **The test plan expects 201 from the scheduling endpoints; they return 200.** The plan is wrong —
   every write endpoint in this API returns 200 through the shared `success()` helper, and there is
   no 201 anywhere in the codebase. **Correct the plan, not the code**: changing these two endpoints
   would make them inconsistent with every other write endpoint and break any client checking
   `=== 200`.

---

## What has already been automated — do NOT re-test by hand

Recorded so nobody spends browser time on something now covered by a test:

| Case | Where |
|---|---|
| DOC-11 — reminder sweep selection (5 cases) | `sweepJobs.test.js` |
| OFFER-14 — approval nudge, incl. once-per-day (3 cases) | `sweepJobs.test.js` |
| OFFER-15 — post-joining auto-close, incl. "recruiter's closure wins" (4 cases) | `sweepJobs.test.js` |
| D3 — stale-tab double-advance (4 cases) | `pipelineStageEngine.test.js` |
| SCHED-06 — booking rows + audit line + D4's meeting replacement | `rescheduleEmails.test.js` |

These were all reachable without cron or a browser: the sweeps are pure DB polling, so backdating
the timestamps they select on is enough to drive them through their real exported functions.
