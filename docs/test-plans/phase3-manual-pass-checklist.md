# Phase 3 — Manual Pass Checklist

**For:** the ~30–45 minutes of Phase 3 that cannot be automated — anything needing a real browser,
a real mailbox, or a real Teams/OneDrive round trip.

**Why these and not others:** every case here touches a surface outside the service layer. The
automated pass ([phase3-test-results.md](phase3-test-results.md)) covered 64 cases against the live
database; these are what is left that a machine cannot reach.

Tick the boxes and fill the **Observed** column as you go. Anything that fails, write down the
*exact* string or status code — the automated pass found two real defects precisely because
observed behaviour was quoted rather than summarised.

---

## Before you start

| Check | How |
|---|---|
| Fixture is still seeded | `node src/tests/helpers/fixture.js status` — expect 3 CVs, 2 MRFs, 3 journeys. ⚠️ These are **fixture-tagged rows only**, found by `FIXTURE_TAG`. They are not database totals: a populated dev DB holds ~198 CVs and ~124 MRFs, which is normal. Do not compare against `/api/candidates` or `/api/mrf` pagination totals |
| Or use a real journey instead | The fixture is a convenience, not a requirement. Any live journey sitting on the right stage is **better** evidence — it exercises real data. Note which journey you used |
| You know which inbox to watch | Candidate mail → the **staging test inbox** (`n8npankajmondal@gmail.com`, `hmopuri@`, `saukumar@`). Never the candidate's real address |
| You are using **your own** address as interviewer | `interviewScheduledPanel` and `scorecardInvite` are `OPERATOR_ADDRESSED` — they are **not** redirected. Whatever address you type receives real mail. Do not type a colleague's |

⚠️ **Staging is running the old code.** The D1 and D2 fixes are in the working tree, uncommitted and
not deployed. If you want SCHED/DOC results to reflect the fixed build, restart staging first —
otherwise note which build you tested against.

---

## Group 1 — Teams / Outlook round trip (demo-critical)

These three are one continuous sequence on a single booking. Do them in order.

### ☐ SCHED-01 — Book a tech1 interview

**Do:** Pipeline drawer → a journey sitting on `tech1` → Schedule Interview. Your own address as
interviewer, a future `start_at`.

**Expect:**
- 201, `rpa_interview_schedule` row `status='scheduled'`
- Teams meeting + calendar event on `MS_CALENDAR_MAILBOX` (`pkmondal@aapnainfotech.com`)
- Candidate email in the **test inbox** — not the candidate's address
- Panel email at **your** address (not redirected — this is expected, not a bug)

**Observed:**

---

### ☐ SCHED-06 — Reschedule it — **the one most likely to fail**

**Do:** Reschedule the booking from SCHED-01 to a new time.

**Expect:**
- Old row → `status='cancelled'`, new row created
- Graph event **updated**, not deleted-and-recreated
- **Exactly ONE "rescheduled" email per side**, showing `previous → new`

**Watch for:** a cancellation email *plus* a separate fresh invite. That is the failure mode. Two
emails per side = fail, even though the booking itself ends up correct. Count the mails in the
inbox before deciding.

**Observed:**

---

### ☐ SCHED-07 — Cancel it with a reason

**Do:** Cancel the rescheduled booking, supplying a `cancel_reason`.

**Expect:** `status='cancelled'`; **one** cancellation email; the calendar event disappears from the
mailbox.

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

### ☑ N5 — A 409 shows the *server's* message — ⚠️ **NOT SCORED — blocked by defect D3**

**Run 2026-08-20.** Evidence: [409conflictspotcheck.html](../test-claude-chrome/409conflictspotcheck.html)

**Outcome: no 409 could be produced from the UI at all**, so there was nothing to spot-check. The
two-tab test found something more important instead — **defect D3**: a stale tab's approval is
*accepted* (200) and advances the candidate a **second time**, skipping a stage and sending two
outcome emails.

The backend guard is real (`pipeline.service.js:635` throws the expected sentence, and PIPE-03
proved it fires) — but it only catches *simultaneous* requests, not *stale* ones, because the stage
it checks is read from the DB rather than sent by the client. Full write-up: D3 in
[phase3-test-results.md](phase3-test-results.md).

### ☑ N5 — re-run after the D3 fix — ✅ **PASS** (20 Aug 2026, 12:03)

D3 was fixed the same day and staging restarted. The two-tab test now behaves correctly.

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

## Group 2 — Browser-only checks (quick, do if time allows)

| ☐ | Case | What to check | Observed |
|---|---|---|---|
| ☐ | **DOC-04** | Finding **O3** — `beforeUpload` returns false unconditionally, no type/size check. Pick a `.exe` on the upload page: does it fail *silently*? | |
| ☐ | **SCHED-18 (UI)** | API is verified ✅ — confirm the PipelineDrawer report **modal actually renders** it | |
| ☐ | **O7** | Open a candidate whose assessment invite has no `deadline_at` — confirm no nonsense day count ("NaN days", "-19710 days") | |
| ☐ | **VEND-14/15** | Vendor dashboard stage counts come from `current_stage_key`; candidates with no journey show as `untracked`, not dropped | |
| ☐ | **DOC-05** | POST a `.exe` and a >10 MB file straight to `/api/documents/:token/upload`. Multer must reject both — **record the actual status code** | |

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

## Cannot be run at all — not your problem today

Listed so nothing looks forgotten:

| Case | Blocker |
|---|---|
| SCHED-11 (Teams attendance sweep) | Graph `OnlineMeetingArtifact.Read.All` grant still pending with IT. ⚠️ When it lands, specifically check the "auto-no-showed every staging interview" regression — silent, every-row failure class |
| ZEK-05 … ZEK-12 | `ZEKO_API_URL` blank in all four env files; no published Zeko job to test against |

---

## Two decisions someone needs to make (not bugs)

Both were recorded rather than judged during the automated pass. Neither blocks the demo, but both
are places where the plan and the code disagree:

1. **Scorecard ratings round instead of rejecting.** `2.3` becomes `2.5`. The plan expected a 400.
   Rounding every off-step rating upward is a small systematic bias in interviewers' scores.
2. **HR fields truncate silently.** 400 characters capped to 100/255 with no warning. The plan asks
   whether that or a 400 is the right UX.
