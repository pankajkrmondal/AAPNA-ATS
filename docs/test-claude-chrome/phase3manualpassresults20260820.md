# Phase 3 — Manual Pass Results, 2026-08-20 evening session

**Ran against:** local dev (`http://localhost:5173`, backend `E:\Recruitment Process Automation\ATS-Migration-Local\backend`),
which carries the D6/D7/D9 fixes in the working tree. Not staging.

**Scope:** the five items still open on
[phase3manualpasschecklist.md](phase3manualpasschecklist.md) — Group 1's mailbox/calendar half,
PIPE-08, VEND-11/13, the DOC-05 re-run, and the D9 re-test.

**Result: five for five. No new defects. Two statements in the checklist were stale — see
*Corrections* at the end.**

---

## 1. DOC-05 re-run — ✅ PASS

Public endpoint `POST /api/documents/{token}/upload`, journey 27 (SAHIL SARMA, cv 31), live token,
checklist item 2 (`permanent_address`, still `pending`). Three payloads, unauthenticated, exactly as
a candidate would hit it.

| Payload | Expected | Observed |
|---|---|---|
| `phase3-doc05-payload.exe` — real MZ/PE bytes | 400 | **400** · `File type .exe is not allowed. Accepted: .pdf, .docx, .doc, .jpg, .jpeg, .png.` |
| `phase3-doc05-renamed.pdf` — **MZ/PE bytes, `.pdf` name, `application/pdf` MIME** | 400 | **400** · `That file is not a valid PDF. Please upload the document in the format its name suggests.` |
| `phase3-doc05-realpdf.exe` — genuine `%PDF-1.4` bytes, `.exe` name | 400 | **400** · extension message (extension gate fires first) |

**D7 is dead.** The renamed executable that uploaded successfully with a 200 on the previous run is
now refused by `fileSignature.js`, and the message is candidate-readable rather than a stack trace.

**D6 is dead, both halves.** The status is 400 rather than 500, *and* no alert mail fires. Measured
as a differential, not asserted:

```
before: backend_error_alert sent/failed = 30/0, summary.sent = 68
POST a rejected .exe -> 400
after (4s):  backend_error_alert sent/failed = 30/0, summary.sent = 68
```

**No side effects.** `rpa_candidate_documents` id 8 still `status='pending'`, `original_name` still
null, `token_status` still `active`, nothing written to OneDrive. Only doc id 7 (DOC-03's genuine
PDF) is `uploaded`.

---

## 2. PIPE-08 — ✅ PASS

Session: `biswajit.sur351` (user 7, `recruiter`). Precondition confirmed live in the session payload —
`permissions` includes `recruitment_pipeline`.

**Reads pass, so the module gate is satisfied:**

| Call | Status |
|---|---|
| `GET /api/pipeline/stages` | 200 · *Stages retrieved successfully* |
| `GET /api/pipeline/reasons` | 200 · *Outcome reasons retrieved successfully* |

**Every config write is refused — and it is `requireAdmin` doing it:**

| Call | Status | Message | Frame |
|---|---|---|---|
| `POST /api/pipeline/stages` | 403 | `Admin access required to change this configuration.` | `middleware/auth.js:169:11` |
| `PUT /api/pipeline/stages/tech1` | 403 | same | `auth.js:169:11` |
| `POST /api/pipeline/stages/tech1/outcomes` | 403 | same | `auth.js:169:11` |
| `POST /api/pipeline/reasons` | 403 | same | `auth.js:169:11` |
| `PUT /api/pipeline/stage-templates` | 403 | same | `auth.js:169:11` |

Nothing was created — all five were refused before reaching a handler.

**Why this is not the module check.** Three separate gates were observed in this session, at three
distinct lines with two distinct messages:

- `auth.js:169` — *"Admin access required to change this configuration."* ← the one that fired here
- `auth.js:105` — *"You do not have permission to perform this action."* (seen on
  `GET /api/email/monitoring/export` as the recruiter)
- `auth.js:200` — `requireStaff`, named outright in the stack (see VEND-11 below)

A module refusal would not carry the admin sentence, and the recruiter's reads on the same router
returned 200.

---

## 3. VEND-11 / VEND-13 — ✅ PASS

Session: `sahil.dubey673` (user 9, `vendor`). **Precondition was already correct** — the DB shows
`recruitment_pipeline: is_enabled = true`, `updated_at = 2026-08-20T14:03:17Z` (19:33 IST), and the
live session payload lists `recruitment_pipeline` among the vendor's permissions. No toggle flip was
needed. (See *Corrections*.)

**The guard names itself in the stack:**

```
Error: You do not have permission to perform this action.
    at requireStaff (backend/src/middleware/auth.js:200:17)
    at Layer.handleRequest (...)
    ...
    at backend/src/middleware/auth.js:83:3        <- earlier middleware called next(): it passed
```

**Every pipeline route, read and write alike:**

| Call | Status | Refused at |
|---|---|---|
| `GET /api/pipeline` | 403 | `requireStaff` @ auth.js:200 |
| `GET /api/pipeline/40` | 403 | `requireStaff` |
| `GET /api/pipeline/stages` | 403 | `requireStaff` |
| `GET /api/pipeline/analytics` | 403 | `requireStaff` |
| `POST /api/pipeline/40/advance` | 403 | `requireStaff` |
| `POST /api/pipeline/40/outcome` | 403 | `requireStaff` |
| `POST /api/pipeline/40/interview` | 403 | `requireStaff` |
| `POST /api/pipeline/stages` | 403 | `requireStaff` — stops here, never reaches `requireAdmin` |

**The same session is otherwise healthy**, which rules out a blanket refusal:

`GET /api/vendor/dashboard` 200 · `GET /api/vendor/candidates` 200 · `GET /api/mrf` 200 ·
`GET /api/candidates` 200 · `GET /api/dashboard/stats` 200 · `GET /api/email/templates` 200 ·
`GET /api/dashboard/recruiter-breakdown` 200

This is exactly what M6 was meant to prove: pipeline module **on**, vendor still refused, and the
refusal comes from the staff gate rather than the module gate.

`hr-upload` and `screening` also refuse at `requireStaff` for this vendor — same gate, wider
application than just the pipeline.

⏳ **Step 3 (revoke the toggle again) is not done** — it is a settings change on a live account and
is left for you.

---

## 4. D9 re-test — ✅ FIXED, confirmed end to end

Fresh booking on journey 40, cancelled through the real drawer.

**The modal carries the box.** `Cancel reason (optional)`, with helper text: *"Recorded on the
candidate's timeline, and used in the Outlook cancellation notice. Type it before the emails are
generated if you want it to appear in them."*

**It is on its own state.** `PipelineDrawer.jsx` holds `cancelReason` (line 546, the Zeko modal) and
`interviewCancelReason` (line 555, the interview modal) separately; line 901 sends
`cancel_reason: interviewCancelReason.trim() || undefined`. No collision with the Zeko modal that
shares its title.

**The audit line, verbatim** (`rpa_pipeline_events` id 2538, `2026-08-20T15:04:14.631Z`):

```
Technical Round 1 interview cancelled: D9 re-test - interviewer unavailable
```

**And it reaches the mail.** The Exchange cancellation notice delivered to the candidate at 8:34 PM
opens with the reason text verbatim — so the helper text's promise holds.

After cancelling, the round returned to *"Not scheduled yet"* and is rebookable.

---

## 5. Group 1 — the mailbox and calendar half — ✅ COMPLETE

Judged on a **fresh booking** (journey 40, Fri 21 Aug 2026 16:00–17:00 IST, interviewer
`pkmondal@aapnainfotech.com`, booked 20:14, cancelled 20:34), because SCHED-07 had already destroyed
the 18:20 event. Reschedule counts are carried over from the 18:20 run, which is still in both
mailboxes.

| Check | Expected | Observed |
|---|---|---|
| Calendar event has **two distinct attendees** | candidate → staging inbox, interviewer → `pkmondal@` | ✅ Two chips on the event: **Phase3 Midflow Candidate** (resolves to `n8npankajmondal@gmail.com`) and **Pankaj Kumar Mondal**. Tracking pane: organiser Pankaj Kumar Mondal, attendee Phase3 Midflow Candidate (Required). No collapse |
| Candidate invite in the test inbox | 1 | ✅ **1** — *"Technical Round 1 scheduled — Phase3 Test Role (1 opening)"*, 20:14 |
| Panel invite at `pkmondal@` | 1 | ✅ **1** — *"Interview panel — Technical Round 1: Phase3 Midflow Candidate"*, 20:14, **Inbox** |
| Reschedule notices | 1 per side | ✅ **1 per side** — panel *"Interview rescheduled…"* 18:28; candidate *"Technical Round 1 rescheduled — Phase3 Test Role (1 opening)"* 18:28 |
| Cancellation mails | 1 per side | ✅ **1 per side** — panel *"Interview cancelled — Technical Round 1…"* 20:34 Inbox; candidate *"Technical Round 1 cancelled"* 20:34 |
| **Any extra "Meeting cancelled" notice from Outlook?** | the open question | 🔴 **YES — see below** |

### The open D4 question, answered

**Exchange sends its own cancellation notice, and it goes to the candidate.**

| When | Subject | Body opens with |
|---|---|---|
| 18:28 (the **reschedule**) | `Canceled: Technical Round 1 — Phase3 Midflow Candidate (Phase3 Test Role (1 opening))` | *"This interview has been rescheduled."* |
| 18:31 (the cancel) | `Canceled: Technical Round 1 (rescheduled) — Phase3 Midflow Candidate (…)` | *"This interview has been cancelled."* |
| 20:34 (this run's cancel) | `Canceled: Technical Round 1 — Phase3 Midflow Candidate (…)` | *"D9 re-test - interviewer unavailable"* |

Three consequences worth writing down:

1. **A reschedule sends the candidate three things, not one:** the app's *"Technical Round 1
   rescheduled"* mail, a fresh Exchange invite for the new event, and a `Canceled:` notice for the
   destroyed one. The third is invisible to our email logs and to `email/monitoring`. It compounds
   D4 — the candidate is told the meeting is cancelled at the same moment they are told it moved.
2. **The panel side never receives one.** Every `Canceled:` message in `pkmondal@` sits in **Sent
   Items**, not the Inbox, because that mailbox is the organiser. ⚠️ This holds only while the
   interviewer *is* `MS_CALENDAR_MAILBOX`. A different interviewer address would be a real attendee
   and would receive both the Exchange invite and the `Canceled:` notice — worth a separate check
   before anyone books a colleague.
3. **The reason text does reach it**, so the cancel-with-reason path produces a coherent candidate
   experience. The reschedule path does not have a reason to give, which is why its notice reads
   *"This interview has been rescheduled"* while the subject says `Canceled:`.

### One thing that looked wrong and is not

The OWA event editor renders the booking as *"Fri 8/21/2026 10:30 AM – 11:30 AM"* — that is UTC.
The calendar grid shows **4:00 PM**, and the invite as delivered to the candidate's Gmail shows
**"Tomorrow • 4:00 PM – 5:00 PM"**. Correct everywhere the candidate can see. Not a defect.

---

## Corrections to the checklist

1. **VEND-11's precondition warning is stale.** The checklist's red STOP block says
   `sahil.dubey673` has `recruitment_pipeline` disabled as of 19:09. It was re-enabled at
   **2026-08-20 19:33 IST** (`updated_at 14:03:17Z`) and was on for this run. The "re-enable first"
   step was not needed; only the revoke afterwards is still owed.
2. **The CLEANUP row is stale for the same reason.** It records the toggle as revoked and verified
   off. It is currently **on**.

## Still open after this session

- ☐ Revoke `recruitment_pipeline` for `sahil.dubey673` before the demo (Group 3, step 3).
- ☐ D4 and D10 decisions — untouched, and D4 is now worse than documented by one more email.
- ☐ D5, D8, the four unfixed upload routes, the three plan-vs-code decisions.
- ⚠️ Nothing is committed. Everything verified here lives in the working tree only.
