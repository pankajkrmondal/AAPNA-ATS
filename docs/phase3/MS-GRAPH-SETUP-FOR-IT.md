# Microsoft Graph — What IT Must Provision for the Pipeline Tracker

**Audience:** IT / Microsoft 365 tenant administrators.
**Purpose:** enable the interview-scheduling + interviewer-scorecard features of the
ATS Pipeline Tracker to run **fully** (Outlook calendar events, Teams meetings,
and automatic "did the interview happen?" attendance detection).

The app uses **application (app-only) permissions** via the client-credentials
flow — there is no signed-in user. All permissions below are **Application**
permissions on the app registration and require **admin consent**.

---

## 0. What already works today (no action needed)

Email send/receive already runs on **`Mail.Send`** + **`Mail.ReadWrite`**
(already granted). Without anything below, the ATS still:
- sends all candidate/interviewer emails,
- lets recruiters book interviews (saved + emailed),
- lets interviewers submit scorecards via the emailed link,
- and confirms "did the interview happen?" **manually** in the ATS.

The steps below add the **automatic** Outlook/Teams pieces on top.

---

## 1. App registration details to confirm

Give the developer these three values (already in the app registration) so they
can be set in the backend `.env`:

| Value | Env var |
|---|---|
| Application (client) ID | `MS_CLIENT_ID` |
| Directory (tenant) ID | `MS_TENANT_ID` |
| A client secret | `MS_CLIENT_SECRET` |
| The recruitment mailbox that owns interview calendar events (e.g. `recruitment@aapnainfotech.com`) | `MS_CALENDAR_MAILBOX` |

---

## 2. Graph API permissions to grant (Application type) + admin consent

On the app registration → **API permissions** → add these **Application**
permissions, then click **Grant admin consent**:

| Permission | Why it is needed | Feature it unlocks |
|---|---|---|
| `Mail.Send` | Send emails app-only | *(already granted)* candidate/interviewer emails |
| `Mail.ReadWrite` | Draft→send + read for threading | *(already granted)* email tracking/replies |
| **`Calendars.ReadWrite`** | Create/cancel Outlook calendar events on the recruitment mailbox | Interview appears in Outlook calendars + **Teams Join link in emails** |
| **`OnlineMeetings.ReadWrite.All`** (or `.ReadWrite`) | Attach a Teams meeting to the event AND read it back (Meeting ID + Passcode). `ReadWrite.All` already includes read — no separate `OnlineMeetings.Read.All` needed. | "Join Teams meeting" button **+** Meeting ID / Passcode in invites |
| **`User.Read.All`** *(or skip — see note)* | Resolve the recruitment mailbox UPN → its Entra object GUID | Needed only because the onlineMeetings API wants the GUID in the URL, not the email |
| **`OnlineMeetingArtifact.Read.All`** | Read the **attendance report** after a meeting ends | **Automatic no-show detection** (see below) |

> **`OnlineMeetings.Read.All` is NOT separately required** if
> `OnlineMeetings.ReadWrite.All` is already granted — the ReadWrite scope is the
> superset (per Microsoft's permission table).
>
> **Avoiding `User.Read.All`:** instead of granting a directory-read permission,
> IT can simply give the developer the recruitment mailbox's **object GUID**
> (Entra admin center → Users → the mailbox → Object ID) to set as
> `MS_CALENDAR_MAILBOX`. The app uses a GUID as-is and skips the UPN→GUID lookup,
> so `User.Read.All` is then unnecessary.
>
> Observed in testing (2026-07-24): with only calendar access the **Join link
> works**, but `GET /users/{upn}` returned **403** (no `User.Read.All`) so the
> meeting lookup was blocked and **Meeting ID / Passcode came back empty**. Fix
> it with EITHER `User.Read.All` OR a GUID `MS_CALENDAR_MAILBOX`, plus the
> application access policy (§3).

> The user has indicated `Calendars.ReadWrite` and `OnlineMeetings.Read.All` are
> already granted. Please **also add `OnlineMeetingArtifact.Read.All`** — it is a
> **separate** permission and is the one the attendance-report API specifically
> requires. (`OnlineMeetings.Read.All` alone does **not** grant attendance.)

---

## 3. Application Access Policy (required for attendance — Teams PowerShell)

App-only calls to read a user's online meetings / attendance are **denied by
default** even with the permission above. The tenant admin must create an
**application access policy** authorizing this app to act on behalf of the
recruitment mailbox. Run once in **Teams PowerShell** (`Microsoft.Teams`
module), replacing the two placeholders:

```powershell
# 1) Connect
Connect-MicrosoftTeams

# 2) Create a policy that references the ATS app's client id
#    (this app's client id, confirmed from the 403 error during testing:)
New-CsApplicationAccessPolicy `
  -Identity "ATS-Interview-Attendance" `
  -AppIds "6dc40383-30fc-42e5-8fb1-748e45f81c25" `
  -Description "ATS reads interview meeting details/attendance on behalf of the recruitment mailbox"

# 3) Grant it to the recruitment mailbox that organizes the interviews
Grant-CsApplicationAccessPolicy `
  -PolicyName "ATS-Interview-Attendance" `
  -Identity "pkmondal@aapnainfotech.com"
```

> **This is the ONE remaining step.** Verified 2026-07-24: event create/cancel,
> the Teams **Join link**, and UPN→GUID resolution (`User.Read.All`) all work.
> The only thing still returning 403 is the onlineMeeting read, with the exact
> message *"No application access policy found for this app
> 6dc40383-30fc-42e5-8fb1-748e45f81c25 on the user"* — which this policy fixes.
> Meeting ID + Passcode populate automatically once it propagates (~30 min).

Notes:
- Only the **organizer mailbox** (the one in `MS_CALENDAR_MAILBOX`) needs the
  grant — that is who owns the interview events and their attendance reports.
- Policy propagation can take up to ~30 minutes.

---

## 4. Backend feature flags (developer sets these in `.env`)

Once IT confirms the grants + policy are in place, the developer flips:

```
MS_CALENDAR_ENABLED=true      # create Outlook events + Teams meetings on booking
MS_ATTENDANCE_ENABLED=true    # auto-detect "did it happen?" from Teams attendance
MS_ATTENDANCE_MIN_SECONDS=60  # min presence to count as attended (default 60s)
MS_CALENDAR_MAILBOX=recruitment@aapnainfotech.com
```

These are **off by default**, so nothing changes in production until the tenant
side is ready. No code deploy is needed to flip them — just a restart.

---

## 5. What each capability turns on (plain English)

| If IT provides… | The ATS gains… |
|---|---|
| Nothing (today) | Booking + emails + **manual** "Mark as Held / No-show" in the ATS. Scorecard is sent only after a human confirms the interview happened. |
| `Calendars.ReadWrite` + `MS_CALENDAR_ENABLED` | Interviews auto-appear in Outlook calendars. |
| `OnlineMeetings.ReadWrite` | Each interview gets a **Teams meeting Join link**. |
| `OnlineMeetingArtifact.Read.All` + the **access policy** + `MS_ATTENDANCE_ENABLED` | **Automatic** occurrence detection: after each interview the ATS reads the Teams attendance report and decides held vs no-show on its own — no manual step. |

**Important guarantee:** even with attendance auto-detection, the ATS **never**
sends an interviewer scorecard for an interview that did not happen. If the
report shows the candidate or the panel did not attend, it is recorded as a
no-show and **no scorecard goes out** — the recruiter is prompted to reschedule
or reject instead.

---

## 6. How the ATS uses the attendance API (for IT's reference)

App-only, on the organizer mailbox:

```
# Find the meeting (if only the join URL is known)
GET /users/{organizerId}/onlineMeetings?$filter=JoinWebUrl eq '{teamsJoinUrl}'

# Read attendance after the meeting ends
GET /users/{organizerId}/onlineMeetings/{onlineMeetingId}/attendanceReports
GET /users/{organizerId}/onlineMeetings/{onlineMeetingId}/attendanceReports/{id}?$expand=attendanceRecords
```

The ATS matches `attendanceRecords[].emailAddress` against the candidate and
interviewer emails and checks `totalAttendanceInSeconds ≥ MS_ATTENDANCE_MIN_SECONDS`.

---

## 7. Quick checklist for IT

- [ ] Confirm `MS_CLIENT_ID`, `MS_TENANT_ID`, a valid `MS_CLIENT_SECRET`.
- [ ] Grant **Application** permissions: `Calendars.ReadWrite`,
      `OnlineMeetings.ReadWrite.All`, **`OnlineMeetingArtifact.Read.All`**, and
      either `User.Read.All` **or** provide the mailbox GUID (see below) →
      **Grant admin consent**. (`OnlineMeetings.Read.All` is NOT needed separately —
      `ReadWrite.All` covers it.)
- [ ] Create + assign the **application access policy** to the recruitment mailbox
      (`New-CsApplicationAccessPolicy` / `Grant-CsApplicationAccessPolicy`).
- [ ] Give the developer the recruitment mailbox for `MS_CALENDAR_MAILBOX` —
      preferably its **object GUID** (lets you skip `User.Read.All`), or the UPN.
- [ ] Developer flips `MS_CALENDAR_ENABLED=true`, `MS_ATTENDANCE_ENABLED=true` and restarts.

---

## Sources (Microsoft Learn)

- List meetingAttendanceReports — https://learn.microsoft.com/en-us/graph/api/meetingattendancereport-list?view=graph-rest-1.0
- Online meeting artifacts & permissions — https://learn.microsoft.com/en-us/graph/cloud-communications-online-meeting-artifacts
- Application access policy — https://learn.microsoft.com/en-us/graph/cloud-communication-online-meeting-application-access-policy
