# SCHED-01 / SCHED-06 / SCHED-07 — manual pass results

**Run:** 2026-08-20, ~18:20–18:32 IST
**Journey:** 40 — Phase3 Midflow Candidate (cv 292, mrf 137), stage `tech1`, `PHASE3-TESTPASS-FIXTURE`
**Interviewer used:** `pkmondal@aapnainfotech.com` — deliberately **not** in `EMAIL_STAGING_RECIPIENTS`,
so the attendee-collapse artifact that invalidated the 2026-08-20 SCHED-05/06 run cannot recur
**Driven through:** the real Pipeline drawer UI (not the service layer), except where noted

**Build under test:** local dev server `localhost:5173` → backend `localhost:5000`, working tree at
`E:\Recruitment Process Automation\ATS-Migration-Local`, pointed at the **shared staging database**.
`GET /api/health` → `"environment": "development"`, uptime 3108 s at start. This is the current
working tree (D3 fix + both 409 UX fixes present), **not** the deployed staging build.

**Email safety confirmed before any write:** `environment=development`, so
`nonProdSafeCandidateEmail()` rewrites every candidate address to the first
`EMAIL_STAGING_RECIPIENTS` entry. No real candidate was mailed.

---

## Verdicts

| Case | Verdict | What is still owed |
|---|---|---|
| **SCHED-01** | ✅ **PASS** on every machine-checkable assertion | attendee count on the calendar event; the two mailboxes |
| **SCHED-06** | ✅ **PASS**, and **D4 reproduced cleanly** | mailbox count + the Exchange "Meeting cancelled" question |
| **SCHED-07** | ⚠️ **PASS with a new defect (D9)** — cancels correctly, but the reason never reaches the row | one cancellation email per side |

**Two new defects found, both in the drawer:** 🔴 **D9** — a cancellation reason cannot be supplied
from the UI at all. 🟠 **D10** — the drawer keeps showing the *old* time and the *old, now-dead*
Teams link after a successful schedule or reschedule.

---

## Preparation — the stale booking on journey 40

Journey 40 still carried row **96** from the invalidated SCHED-05/06 run (interviewer
`n8npankajmondal@gmail.com`, 20 Aug 15:00 IST). It had to go before SCHED-01 could book, because of
the one-live-booking-per-round index.

It could **not** be cancelled from the UI: the interview was in the past, and the drawer only renders
**Cancel Interview** on the *upcoming* branch. A past booking offers **Mark as Held / Mark No-show /
Reschedule** and nothing else. So a stale past booking has no UI cancel path — a recruiter would have
to reschedule it into the future first.

Cleared instead with a direct call, and this doubles as the control for D9 below:

```
POST /api/pipeline/interview/96/cancel
  { "cancel_reason": "CLEANUP-SCHED-PREP: stale booking from the invalidated 05/06 run …" }
→ 200  "Interview cancelled successfully"
```

Audit line written: `Technical Round 1 interview cancelled: CLEANUP-SCHED-PREP: stale booking …`
— **the endpoint does honour `cancel_reason` and does write it into the audit trail.** Hold that
thought for SCHED-07.

---

## ☑ SCHED-01 — Book a tech1 interview — ✅ PASS

Pipeline drawer → journey 40 → **Schedule Interview**; Fri 21 Aug 2026, 11:00 AM IST, 1 hour,
Pankaj Mondal / `pkmondal@aapnainfotech.com`.

| Expectation | Result |
|---|---|
| **200**, not 201 | ✅ `POST /api/pipeline/40/interview` → **200**, observed in the network log. The plan's 201 stays wrong |
| `rpa_interview_schedule` row `status='scheduled'` | ✅ row **104**, `status='scheduled'`, `stage_key='tech1'` |
| Times stored correctly | ✅ `2026-08-21T05:30:00Z → 06:30:00Z` = 11:00–12:00 IST |
| Teams meeting + calendar event | ✅ `graph_event_id` present, `teams_meeting_id=473448322235179`, `teams_passcode=tg3k3Eg7`, join URL minted |
| Interviewer recorded | ✅ `pkmondal@aapnainfotech.com`, name `Pankaj Mondal` |
| Invite dispatched | ✅ `invite_sent_at = 2026-08-20T12:52:19.032Z` (18:22 IST) |
| Audit line | ✅ `Technical Round 1 scheduled for 21 August 2026 at 11:00 am IST with Pankaj Mondal (Teams)` |
| Candidate mail redirected | ✅ by construction — `environment=development`, guard active |
| Drawer renders the booking | ✅ after reopening — see **D10**, it does **not** render on the spot |

**The attendee precondition is now satisfied**, which is the thing the previous run could not
establish: the candidate side resolves to `n8npankajmondal@gmail.com` (the redirect target) and the
interviewer to `pkmondal@aapnainfotech.com`. Those are two different mailboxes, so Outlook has no
reason to collapse them.

> ☐ **Owed by a human:** open the event on `pkmondal@aapnainfotech.com` and confirm **two distinct
> attendees**. Confirm the candidate invite landed in the staging test inbox and the panel mail at
> `pkmondal@`.

---

## ☑ SCHED-06 — Reschedule it — ✅ PASS

Rescheduled 11:00 → 15:00 IST on the same day, same interviewer.

| Expectation | Result |
|---|---|
| One new live row | ✅ row **105**, `status='scheduled'`, `2026-08-21T09:30:00Z → 10:30:00Z` = 15:00–16:00 IST |
| Old row retired | ✅ row 104 no longer resolves as the live booking |
| Audit shows `previous → new`, **once** | ✅ exactly one line: `Technical Round 1 rescheduled: 21 August 2026 at 11:00 am IST → 21 August 2026 at 03:00 pm IST with Pankaj Mondal` |
| One "rescheduled" email per side, neither a cancellation | ✅ two composed, both reschedule notices; verified from the previews before sending (below) |
| ⚠️ Teams meeting replaced, not patched (**D4**) | ✅ **reproduced** — see below |

**D4 reproduced, third data point:**

| | Meeting ID | Passcode |
|---|---|---|
| before | `473448322235179` | `tg3k3Eg7` |
| after | `482189874798031` | `vo2Jo6e5` |

`teams_join_url` changed too. Same behaviour as the 2026-08-20 run — nothing new to report, D4 stays
as written.

### 🔴 One thing that makes D4 worse than its write-up says

**Neither reschedule email carries a join link.** Read straight out of the modal previews before
sending:

*Candidate* — subject `Technical Round 1 rescheduled — Phase3 Test Role (1 opening)`
> Previous time: 21 August 2026 at 11:00 am IST
> New time: 21 August 2026 at 03:00 pm IST
> Duration: 60 minutes

*Panel* — subject `Interview rescheduled — Technical Round 1: Phase3 Midflow Candidate`
> Previous time: 21 August 2026 at 11:00 am IST
> New time: 21 August 2026 at 03:00 pm IST
> Candidate email: claudepankajmondal@gmail.com

So after a reschedule the **only** join link either party holds is the one from the original invite —
and D4 has just killed it. The new link exists solely inside the app. That raises D4 from "stale
calendar entries" to "both parties are actively holding a dead link and were not sent the live one".

### Two corrections to the checklist's own wording

1. The checklist says both mails are titled **"Interview Rescheduled"**. They are not — the real
   subjects are the two quoted above. The `— Candidate` / `— Panel` titles in
   `phase3-test-results.md` were the instrumented test's own labels, not what lands in a mailbox.
2. `rpa_interview_schedule` row 104's `cancel_reason='Rescheduled'` **could not be re-verified here**.
   There is no read endpoint for historical bookings — `GET /api/pipeline/:id` returns only the live
   one, and `/pipeline/interview/:id`, `/pipeline/:id/interviews` and `/interview/history` are all
   404. That assertion rests on `rescheduleEmails.test.js`, which is fine, but it is automation
   evidence, not manual evidence.

> ☐ **Owed by a human:** count the mails — expect **1** candidate-side in the test inbox and **1** at
> `pkmondal@` — and answer the open question: does Exchange add its own **"Meeting cancelled"**
> notice alongside them?

---

## ☑ SCHED-07 — Cancel it with a reason — ⚠️ PASS, with defect D9

| Expectation | Result |
|---|---|
| Cancel succeeds | ✅ `POST /api/pipeline/interview/105/cancel` → **200** |
| `status='cancelled'` | ✅ live booking now `null`; the round is free to rebook |
| Candidate not moved | ✅ still `tech1` / `in_progress` — cancelling does not touch the stage |
| Calendar event removed | ✅ Graph `/cancel` issued (drawer returned to "Not scheduled yet") |
| One cancellation email per side | ✅ two composed and sent — candidate subject `Technical Round 1 cancelled`, plus the interviewer copy |
| **`cancel_reason` stamped** | 🔴 **NO — see D9** |

Audit line written: `Technical Round 1 interview cancelled` — full stop, no reason.

Compare the two cancellations on **this same journey's audit trail**, minutes apart:

```
Technical Round 1 interview cancelled: CLEANUP-SCHED-PREP: stale booking …   ← API, reason supplied
Technical Round 1 interview cancelled                                        ← UI, reason impossible
```

---

## 🔴 D9 (new, Medium) — a cancellation reason cannot be supplied from the UI

**Where:** `PipelineDrawer.jsx` — the `interviewCancelMutation` payload, and the modal at
`open: interviewCancelOpen`.

**Symptom.** The **Confirm Cancel Interview** modal for a scheduled interview shows the candidate,
the scheduled time, and two editable emails. There is **no reason field**. Verified in the live DOM,
not just by reading source: the modal contains **zero `textarea` elements** and the string "reason"
does not appear anywhere in it. So `rpa_interview_schedule.cancel_reason` is null for every
cancellation a recruiter performs, and the audit trail records *that* a round was cancelled but never
*why*.

**Root cause — two different modals share one title.** There are two `title: "Confirm Cancel
Interview"` modals in this file:

| Modal | Gate | Reason box? | Sends |
|---|---|---|---|
| Zeko interview cancel | `open: cancelOpen` | ✅ "Cancel reason (optional)" `TextArea` bound to `cancelReason` | `screeningService.cancelZekoInterview({ pipeline_id, cancel_reason })` |
| **Scheduled-interview cancel** | `open: interviewCancelOpen` | ❌ none | `pipelineService.cancelInterview(id, { candidate_subject, candidate_body, panel_subject, panel_body })` |

`cancel_reason` occurs exactly **once** in the whole of `PipelineDrawer.jsx`, and it is in the Zeko
line. The scheduled-interview mutation never reads `cancelReason`, even though
`pipelineService.cancelInterview`'s own JSDoc lists `cancel_reason` as the first payload key and the
endpoint honours it (proved by the cleanup call above).

**Why it is easy to miss.** Two modals with the same title, one of which *does* have a reason box.
Anyone checking "is there a reason field on the cancel modal?" by search finds one and stops.

**Fix is small:** add a reason `TextArea` to the `interviewCancelOpen` modal with its own state (do
**not** reuse `cancelReason` — it belongs to the Zeko path) and pass `cancel_reason` in the payload.

☐ **Decide:** fix before the demo, or accept that recruiter cancellations carry no reason?

---

## 🟠 D10 (new, Medium) — the drawer shows a dead Teams link after a reschedule

**Symptom.** After **Create invite** and again after **Reschedule & notify**, the success toast fires
(*"Interview rescheduled — both parties emailed."*) but the drawer keeps rendering the **pre-action**
state: the old time, the old meeting ID and the old passcode. Closing and reopening the drawer shows
the correct new values, so the write is fine — the view is stale.

Observed on the reschedule specifically:

| | Drawer after the success toast | Actual row |
|---|---|---|
| Time | `21 Aug, 11:00 am` | 21 Aug, 03:00 pm |
| Meeting ID | `473448322235179` | `482189874798031` |
| Passcode | `tg3k3Eg7` | `vo2Jo6e5` |

**Why this is more than cosmetic.** Because of D4 the displayed meeting has *just been destroyed*.
The recruiter is looking at a Join button, a meeting ID and a passcode that no longer work, on a
screen that has just told them the reschedule succeeded. Copying any of it to a candidate hands over
a dead link.

**The cancel path does not have this problem** — it refreshes correctly and returns to "Not scheduled
yet". So the fix is the query invalidation the cancel mutation already does, applied to the schedule
and reschedule mutations.

---

## Smaller observations (not scored)

- **`interview-preview` fires once per keystroke.** Filling the schedule form produced **42** `GET
  /api/pipeline/40/interview-preview` calls — 13 while typing "Pankaj Mondal", 26 while typing the
  interviewer address, one per character. Each one compiles two HTML email templates server-side. No
  debounce. Also worth noting the interviewer's name and address travel in the **query string**.
- **The time picker rejects `03:00 PM` but accepts `3:00 PM`** — typing a zero-padded hour yields
  "No data" and the field silently stays empty.
- **"Emails in this round" only reflects the live row.** After the reschedule the panel showed a
  single `Interview invite → candidate + interviewer · 20 Aug, 06:28 pm` line — the original invite
  entry was gone and no separate reschedule-notice entry appeared, so the round's email history is
  replaced rather than appended.
- **No UI cancel path for a past booking** (see Preparation). Only Mark as Held / Mark No-show /
  Reschedule are offered once the start time has passed.

---

## End state

Journey 40 is at `tech1`, `in_progress`, with **no live booking** — the round is clean and rebookable.
Nothing else on the fixture was touched. Rows 96, 104 and 105 are all retired; the board card reads
`scheduled=false` and the stage-event trail is 13 entries. Row 105 carries no reason in its audit
line (D9) — the row's `cancel_reason` column itself could not be read back, since no endpoint exposes
a historical booking.

## Still owed — the mailbox / calendar half

| Check | Expected |
|---|---|
| ☐ Calendar event on `pkmondal@` had **two distinct attendees** | candidate → staging test inbox, interviewer → `pkmondal@` |
| ☐ Candidate invite in the staging test inbox | 1 |
| ☐ Panel invite at `pkmondal@` | 1 (not redirected — expected) |
| ☐ Reschedule notices | 1 per side |
| ☐ **Any extra "Meeting cancelled" notice from Outlook?** | the open D4 question |
| ☐ Cancellation mails | 1 per side |
| ☐ Old Teams join link dead after reschedule | yes — D4 |
