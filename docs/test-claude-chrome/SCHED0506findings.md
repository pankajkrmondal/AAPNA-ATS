# SCHED-05 / SCHED-06 — Test Run Findings

**Environment:** staging, `http://localhost:5173/` (AAPNA ATS)
**Date:** 20 Aug 2026, IST
**Operator:** Pankaj Kumar Mondal (`pkmondal@aapnainfotech.com`)
**Interviewer address used:** `n8npankajmondal@gmail.com` (OPERATOR_ADDRESSED, not redirected)

---

## Runs performed

| # | Journey | Candidate | Candidate email on journey | Action | Row | Result |
|---|---------|-----------|---------------------------|--------|-----|--------|
| 1 | 36 | HARISH MP | `harishmp1345@example.com` | Schedule 20 Aug 14:00 IST | 94 | booked, then cancelled |
| 2 | 36 | HARISH MP | `harishmp1345@example.com` | Re-schedule 20 Aug 14:00 IST | 94* | **still live** |
| 3 | 40 | Phase3 Midflow Candidate | `claudepankajmondal@gmail.com` | Schedule 20 Aug 16:00 IST | 95 | superseded |
| 4 | 40 | Phase3 Midflow Candidate | `claudepankajmondal@gmail.com` | Reschedule to 20 Aug 15:00 IST | 96 | **live** |

Current live booking (SCHED-06 target): **pipeline 40, row 96, `2026-08-20T09:30:00.000Z` = 15:00 IST**, 60 min.
Teams meeting `471591962995564`, passcode `3mi22z8C`.

---

## BUG 1 — Calendar event attendee is the interviewer under the candidate's name

**Severity: high**

The Graph calendar event carries exactly **one** attendee, and on the reschedule path that attendee is
sent with the **candidate's display name paired to the interviewer's email address**.

Verified on event `AAkALgAAAAAAHYQDEapmEc2byACqAC/EWg0AQTF6XqvdJ0a4ED1su4+QbQAFVhBbvgAA`
(the live 15:00 booking): Tracking pane lists one Required attendee rendered as
**"Phase3 Midflow Candidate"** — but its contact card resolves to

```
Email: n8npankajmondal@gmail.com
```

which is the **interviewer's** mailbox, not the candidate's (`claudepankajmondal@gmail.com`).

Consequences:
- The candidate is never added to the calendar event at all. They receive only the HTML invite
  email with a pasted join link — no calendar item, no reminder, no RSVP.
- The invite misrepresents who is attending. Anyone reading the event sees the candidate's name
  against an address that belongs to someone else.
- Explains the apparent "flip-flopping" attendee name across renders: the SMTP address is constant
  (`n8npankajmondal@gmail.com`); Outlook alternates between the organiser's cached contact name for
  that address (`SAURABH KUMAR`) and the display name the ATS supplied on the last write
  (`Phase3 Midflow Candidate`). There was never a second attendee.

**Expected:** the event's `attendees` array should contain both parties, each with its own matching
`emailAddress.name` / `emailAddress.address` pair.

**Where to look:** wherever the scheduling service builds the Graph `attendees` payload — the name
and address are being sourced from different objects.

---

## BUG 2 — Reschedule creates a new Teams meeting instead of updating the existing one

**Severity: medium**

Rescheduling pipeline 40 from 16:00 to 15:00 minted a brand-new online meeting rather than
patching the existing event:

| | Meeting ID | Passcode |
|---|---|---|
| before | `468843751163904` | `Hp79cg77` |
| after  | `471591962995564` | `3mi22z8C` |

Consequences: anyone holding the original invite has a **dead join link**, and stale calendar
entries pointing at the retired meeting are left behind on any party not re-invited.

**Expected:** `PATCH` the existing event / preserve `onlineMeeting`, so the join link survives a
time change.

---

## BUG 3 — `candidate_email` does not propagate from the candidate record to a live journey

**Severity: medium**

Editing a candidate's email via **Search Candidate → Edit** saves successfully
(toast: "Candidate details updated successfully", list reflects the new value) but has **no effect
on an in-flight pipeline journey**.

Repro:
1. Journey 36 (HARISH MP) holds `candidate_email = harishmp1345@example.com`.
2. Edit the candidate record to `aiautomationn8nuser@gmail.com` → saves.
3. Full page reload, re-open the journey.
4. `GET /api/pipeline/36` still returns `candidate_email = harishmp1345@example.com`.

The journey keeps a denormalised copy taken at shortlist time. Neither the **Schedule interview**
nor the **Reschedule interview** modal exposes a candidate "To" override, so there is **no path
through the UI** to correct a wrong candidate address on a live journey. Invites continue going to
the stale address.

**Expected:** either resolve the candidate address at send time, or propagate record edits to open
journeys, or expose an editable recipient on the send form.

---

## BUG 4 — Scheduling endpoints return 200, not 201

**Severity: low (spec confirmation needed)**

```
POST /api/pipeline/40/interview             -> 200 OK
POST /api/pipeline/40/interview/reschedule  -> 200 OK
POST /api/pipeline/36/interview             -> 200 OK
```

SCHED-05 expects **201 Created** for the create path. Both endpoints return 200 consistently.
Either the endpoints should return 201 on resource creation, or the test doc should be corrected.

---

## Passing behaviour (for the record)

- `rpa_interview_schedule` row is written correctly with `status = "scheduled"`,
  correct `scheduled_start_at` / `scheduled_end_at`, `cancelled_at = null`,
  `graph_event_id` and `online_meeting_id` populated, `invite_sent_at` set.
- The Graph calendar event is created in MS_CALENDAR_MAILBOX and appears on the operator's
  calendar at the correct IST time.
- Reschedule correctly replaces the old calendar slot (16:00 entry removed, 15:00 entry present).
- Cancellation removes the booking and returns the stage to "Not scheduled yet".
- Panel email reaches the interviewer address as expected (OPERATOR_ADDRESSED, not redirected).

## Still unverified

- Candidate email delivery to `claudepankajmondal@gmail.com` (invite 13:30 IST,
  reschedule notice 14:14 IST) — needs a look in that inbox.
- Whether response requests are intentionally disabled; every event shows
  *"You haven't requested responses for this event."*

## Housekeeping

Journey **36 (HARISH MP)** still holds a live 14:00 IST booking (row 94) with a real Teams meeting.
Cancel it if the board should not be carrying a second open tech1 interview.

## Minor note (not a bug)

The Outlook **event editor** window renders times in UTC (`9:30 AM` for a 15:00 IST booking) while
the calendar grid and reading pane render IST correctly. Display-only; stored data is correct.
