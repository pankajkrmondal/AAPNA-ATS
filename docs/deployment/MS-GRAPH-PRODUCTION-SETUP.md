# Microsoft Graph — Production Setup (`HR_RPA_PROD`)

**Audience:** IT / Microsoft 365 tenant administrators, plus the deploying developer.
**Purpose:** everything the **production** ATS needs on the Microsoft side, what is already
in place, and the one thing that is genuinely missing.
**Date:** 2026-09-11 · verified against the `HR_RPA_PROD` API-permissions blade and
`backend/.env.production`.

**Companion:** [MS-GRAPH-SETUP-FOR-IT.md](../phase3/MS-GRAPH-SETUP-FOR-IT.md) (the original,
staging-oriented guide) · [Migration plan](../phase3/STAGING-TO-PRODUCTION-DB-AND-ONEDRIVE-PLAN.md)

---

## TL;DR — one action for IT

**Every Graph API permission production needs is already granted.** The only missing piece is
the Teams **application access policy**, which must be created separately for production
because it is bound to a *different app id* and a *different mailbox* than staging's.

```powershell
# Teams PowerShell — run once, as a Teams administrator.
# Install-Module MicrosoftTeams -Scope CurrentUser     # if not already installed
Connect-MicrosoftTeams

# 1) New policy for the PRODUCTION app registration (HR_RPA_PROD)
New-CsApplicationAccessPolicy `
  -Identity "ATS-Interview-Attendance-Prod" `
  -AppIds "13970867-284c-4a4b-8908-04ce0c595f65" `
  -Description "ATS PRODUCTION reads interview meeting details, attendance and recordings on behalf of the production recruitment mailbox"

# 2) Grant it to the PRODUCTION recruitment mailbox
Grant-CsApplicationAccessPolicy `
  -PolicyName "ATS-Interview-Attendance-Prod" `
  -Identity "recruitment@aapnainfotech.in"
```

⚠ **Three things that are easy to get wrong — see [§3](#3-the-application-access-policy):**

1. The policy **name must be new**. `ATS-Interview-Attendance` already exists for staging and
   `New-CsApplicationAccessPolicy` will fail on a duplicate name.
2. The app id is **`13970867-…`** (HR_RPA_PROD), *not* staging's `6dc40383-…`.
3. The mailbox is **`recruitment@aapnainfotech.in`** — `.in`, not `.com`. §4 of the older
   staging guide shows `recruitment@aapnainfotech.com`, which is **wrong for production**.

Propagation takes up to ~30 minutes. Nothing changes in the product until the developer flips
the feature flags in [§6](#6-what-the-developer-changes-in-envproduction) — they are all `false`
today, so this policy can be applied safely and well ahead of the deploy.

---

## 1. Production identity values

All taken from `backend/.env.production` on `project-staging`.

| Value | Production | Staging (for contrast) |
|---|---|---|
| App registration | **`HR_RPA_PROD`** | `HR_RPA` |
| `MS_CLIENT_ID` | **`13970867-284c-4a4b-8908-04ce0c595f65`** | `6dc40383-30fc-42e5-8fb1-748e45f81c25` |
| `MS_TENANT_ID` | `96875b81-ae26-4741-b919-67a6739aa8bc` | **same tenant** |
| `MS_DEFAULT_SENDER_EMAIL` | **`recruitment@aapnainfotech.in`** | `pkmondal@aapnainfotech.com` |
| `MS_CALENDAR_MAILBOX` | **not set** → falls back to `MS_DEFAULT_SENDER_EMAIL` | `pkmondal@aapnainfotech.com` |
| `MS_ONEDRIVE_PARENT_ID` | `01G5FTREQK6XGR6VF3RVGJ2IJTJZNYXJ6P` | `015VOMPCPMTPAM74ASCVEYVZXTXXEZYOMJ` |

**The tenant is the same for both.** That matters more than it looks: every *tenant-wide*
setting already switched on for staging is therefore **already switched on for production**
(see [§5](#5-tenant-wide-settings--already-done-shared-with-staging)). Only the *per-app* and
*per-mailbox* items need doing again.

> **`MS_CALENDAR_MAILBOX` being unset is why the mailbox is `recruitment@aapnainfotech.in`.**
> The code falls back to `MS_DEFAULT_SENDER_EMAIL`
> ([config/index.js:112](../../backend/src/config/index.js#L112)). The application access policy
> must be granted to **whatever that resolves to**, so set the variable explicitly
> ([§6](#6-what-the-developer-changes-in-envproduction)) rather than leaving it to a fallback —
> if someone later changes the sender address, the policy silently stops matching and attendance
> detection starts returning 403.

---

## 2. Graph API permissions — ✅ already complete, nothing to grant

Verified from the `HR_RPA_PROD` → **API permissions** blade. All 13 rows show
*Granted for AAPNA Info…*:

| Permission | Type | Status | Used by |
|---|---|---|---|
| `Calendars.ReadWrite` | Application | ✅ Granted | Outlook event create/cancel for interviews |
| `Mail.Read` | Application | ✅ Granted | Inbound mailbox polling, resume intake |
| `Mail.ReadWrite` | Application | ✅ Granted | Draft→send, reply threading, tracking |
| `Mail.Send` | Application | ✅ Granted | All candidate / interviewer email |
| `OnlineMeetingArtifact.Read.All` | Application | ✅ Granted | Teams **attendance reports** |
| `OnlineMeetingRecording.Read.All` | Application | ✅ Granted | Interview **recordings** |
| `OnlineMeetings.ReadWrite.All` | Application | ✅ Granted | Teams meeting create + `recordAutomatically` |
| `OnlineMeetingTranscript.Read.All` | Application | ✅ Granted | Interview transcripts (see §5) |
| `Sites.Selected` | Application | ✅ Granted | OneDrive file read/write — **but see §4** |
| `User.Read.All` | Application | ✅ Granted | UPN → object GUID for the onlineMeetings URL |
| `Files.Read.All` | *Delegated* | Granted | **unused** — no signed-in user |
| `Mail.Send` | *Delegated* | Granted | **unused** |
| `User.Read` | *Delegated* | Granted | **unused** |

**Production and staging carry identical *granted application* permissions** — 10 each. The
only difference in the two blades is that staging additionally lists an **Application**
`Files.Read.All` row marked *Not granted*; IT declined that on 2026-09-02 as too broad
(tenant-wide read across every SharePoint site and employee OneDrive). Production simply never
had the row added. **That is correct — do not add it.** The ATS uses the `Sites.Selected` route
instead.

> ### Correction to an earlier document
> [§B.4 of the migration plan](../phase3/STAGING-TO-PRODUCTION-DB-AND-ONEDRIVE-PLAN.md) stated
> that the production app registration "almost certainly lacks the Graph grants" and listed them
> as work to request from IT. **That was wrong** — it was written before the `HR_RPA_PROD`
> permissions blade had been seen. The grants are in place. This document supersedes that
> section. The *application access policy* (§3) genuinely is still outstanding, and that part of
> the plan stands.

---

## 3. The application access policy

### Why it is needed at all

App-only reads of a user's **online meetings** are refused by default, *even with*
`OnlineMeetings.ReadWrite.All`, `OnlineMeetingArtifact.Read.All` and
`OnlineMeetingRecording.Read.All` consented. Teams requires a second, explicit authorization
saying "this app may act on behalf of this specific mailbox". Without it the call fails with:

```
403  No application access policy found for this app 13970867-284c-4a4b-8908-04ce0c595f65 on the user
```

### Why staging's policy does not cover production

A policy authorizes **a list of app ids**, and is then **granted to a mailbox**. Staging's
policy names only `6dc40383-…` and is granted to `pkmondal@aapnainfotech.com`. Neither half
matches production, so production needs its own.

### What exactly needs the policy

These are the only calls gated by it — all resolved against `MS_CALENDAR_MAILBOX`:

| Call | Source | Feature |
|---|---|---|
| `GET /users/{id}/onlineMeetings?$filter=JoinWebUrl eq …` | [graphCalendar.service.js:208](../../backend/src/services/graphCalendar.service.js#L208), [graphAttendance.service.js:58](../../backend/src/services/graphAttendance.service.js#L58) | Meeting ID + Passcode in invites |
| `PATCH /users/{id}/onlineMeetings/{mid}` | [graphCalendar.service.js:301](../../backend/src/services/graphCalendar.service.js#L301) | `recordAutomatically` — the interview records itself |
| `GET …/onlineMeetings/{mid}/attendanceReports` | [graphAttendance.service.js:95](../../backend/src/services/graphAttendance.service.js#L95) | Automatic held / no-show detection |
| `GET …/onlineMeetings/{mid}/recordings` · `/transcripts` | [graphRecording.service.js:88](../../backend/src/services/graphRecording.service.js#L88) | Recording + transcript archive |

Calendar events (`Calendars.ReadWrite`), email (`Mail.*`) and OneDrive uploads are **not**
gated by this policy — they already work in production today.

### The commands

```powershell
Connect-MicrosoftTeams

New-CsApplicationAccessPolicy `
  -Identity "ATS-Interview-Attendance-Prod" `
  -AppIds "13970867-284c-4a4b-8908-04ce0c595f65" `
  -Description "ATS PRODUCTION reads interview meeting details, attendance and recordings on behalf of the production recruitment mailbox"

Grant-CsApplicationAccessPolicy `
  -PolicyName "ATS-Interview-Attendance-Prod" `
  -Identity "recruitment@aapnainfotech.in"
```

### Notes

- **`-Identity` on `New-CsApplicationAccessPolicy` is the policy's NAME**, not a user. The
  user only appears in the `Grant-` command. This trips people up because the same parameter
  name means two different things across the two cmdlets.
- **A mailbox carries one policy assignment.** If `recruitment@aapnainfotech.in` ever needs a
  second app to act on it, add that app's id to *this* policy
  (`Set-CsApplicationAccessPolicy -Identity "ATS-Interview-Attendance-Prod" -Add @{...}`)
  rather than creating a second policy for the same mailbox.
- **Do not put both app ids in one shared policy.** Keeping them separate is what stops the
  staging app from being able to read production interview recordings.
- Only the **organizer** mailbox needs the grant — it owns the events and their attendance
  reports. Interviewers and candidates need nothing.
- Allow **~30 minutes** for propagation before testing.

### Verify it applied

```powershell
Get-CsApplicationAccessPolicy -Identity "ATS-Interview-Attendance-Prod"
Get-CsOnlineUser -Identity "recruitment@aapnainfotech.in" |
  Select-Object UserPrincipalName, ApplicationAccessPolicy
```

The second should report `ATS-Interview-Attendance-Prod`.

---

## 4. `Sites.Selected` — confirm the per-site grant exists for the `.in` mailbox

`Sites.Selected` **grants access to no sites on its own.** It is a capability; someone with
`Sites.FullControl.All` must additionally grant the app a role on each *specific* site
(`POST /sites/{site-id}/permissions`, or PnP `Grant-PnPAzureADAppSitePermission`). It does work
for a user's OneDrive, which is backed by a SharePoint personal site.

Per IT (2026-09-02, recorded in the staging guide) this was configured for **both** the
`pkmondal@` and `recruitment@` OneDrive accounts on **both** app registrations. **Worth
re-confirming for production before go-live**, because every one of these depends on it and
they fail as a silent `403` at the moment a real candidate is waiting on an upload page:

- resume / CV uploads (vendor, HR manual, candidate),
- MRF job descriptions and test papers,
- assessment report imports,
- the candidate **Document Collection** folder,
- the **`Recordings_ATS`** interview-recording archive.

A quick read-only check that the drive is reachable app-only:

```bash
# with an app-only token for HR_RPA_PROD
curl -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/users/recruitment@aapnainfotech.in/drive?\$select=id,name,webUrl"
```

`404` means the OneDrive is not provisioned; `403` means `Sites.Selected` has no grant on that
site. Either way, stop and fix before deploying. See
[§B.5 of the migration plan](../phase3/STAGING-TO-PRODUCTION-DB-AND-ONEDRIVE-PLAN.md).

> **Also confirm `recruitment@aapnainfotech.in` is a licensed user with a provisioned OneDrive**,
> not an unlicensed shared mailbox. Teams saves each recording to the *organizer's* OneDrive, and
> the ATS keeps its own second copy there. Microsoft's fallback for an organizer with no OneDrive
> is temporary storage that is **deleted after 21 days**.

---

## 5. Tenant-wide settings — already done, shared with staging

Production and staging are in the **same tenant** (`96875b81-…`), so these are already in the
state staging verified. **No action.**

| Setting | Where | Value | Status |
|---|---|---|---|
| Meeting recording | Meeting policies → Global → Recording & transcription | On | ✅ verified 2026-09-01 |
| Require participant agreement | same | Off | ✅ — if turned On, auto-recording stops starting |
| Transcription | same | On | ✅ |
| Recordings automatically expire | same | Off | ✅ Teams never deletes them |
| Licensing | Microsoft 365 Business Basic | covers cloud recording + transcription | ✅ Teams Premium not required |

**⚠ One tenant-wide item is still outstanding** — and because the tenant is shared, fixing it
fixes both environments at once:

> **Teams admin center → Meetings → Meeting settings → Transcript API access →
> Microsoft Graph access = On**
>
> ```powershell
> Set-CsTeamsMeetingConfiguration -Identity Global `
>   -EnableGraphTranscriptAccess $true -EnableAttributedTranscripts $true
> ```

This is **not** a permissions problem — `OnlineMeetingTranscript.Read.All` is granted on both
apps. Microsoft added a separate tenant control for transcript API access, enforced from
31 July 2026 and **off by default**. Until it is on, transcript requests return
`403 Graph API access to transcripts is disabled for this tenant`. **Recordings are unaffected
and work without it** — the code detects this specific 403, logs it once and carries on
([graphRecording.service.js:96-102](../../backend/src/services/graphRecording.service.js#L96-L102)).

---

## 6. What the developer changes in `.env.production`

Production currently has **every Microsoft feature flag off**, which is the correct starting
state. Eight `MS_*` keys that staging sets are also absent; each falls back to a code default,
but `MS_CALENDAR_MAILBOX` must be set deliberately.

### Set these first (not feature flags — configuration)

```ini
# MUST match the mailbox the application access policy was granted to (§3).
MS_CALENDAR_MAILBOX=recruitment@aapnainfotech.in

MS_RECORDING_ARCHIVE_FOLDER=Recordings_ATS
MS_ATTENDANCE_MIN_SECONDS=60
MS_ATTENDANCE_GUEST_CANDIDATE=true
MS_RECORDED_STAGES=tech1,tech2,tech3,hr_round,ceo
MS_MEETING_PRESENTERS=organization
MS_MEETING_TRANSCRIBE=true
MS_RECORDING_RETAIN_MONTHS=12          # ⚠ confirm the retention policy — see below
```

> **`MS_RECORDING_RETAIN_MONTHS` is a data-protection decision, not a technical default.**
> Interview recordings of real candidates are personal data with a real retention obligation.
> 12 months is staging's value; confirm it is the agreed production policy before recordings
> start accumulating.

### Then turn the flags on, one at a time

Do **not** flip these all at once. Each is independently gated on purpose, and each one that
misbehaves is easier to attribute when it was the only thing that changed.

| Order | Flag | Now | Set to | Depends on |
|---|---|---|---|---|
| 1 | `MS_CALENDAR_ENABLED` | `false` | `true` | `Calendars.ReadWrite` ✅ (no policy needed) |
| 2 | `MS_ATTENDANCE_ENABLED` | `false` | `true` | **the §3 policy** + `OnlineMeetingArtifact.Read.All` |
| 3 | `MS_MEETING_RECORD_AUTO` | `false` | `true` | **the §3 policy** + `OnlineMeetings.ReadWrite.All` |
| 4 | `MS_RECORDING_FETCH_ENABLED` | `false` | `true` | **the §3 policy** + `OnlineMeetingRecording.Read.All` |
| 5 | `MS_RECORDING_ARCHIVE_ENABLED` | `false` | `true` | §4 OneDrive write access |

Flags 2–5 will all return `403` until the §3 policy has propagated. No code deploy is needed to
change any of them — a `pm2 reload` is enough.

> Separately, and **last of everything**: `EMAIL_REDIRECT_TO_TEST` is still `true` in
> production, which means production emails nobody but the internal test inbox — including the
> candidate's address on Teams calendar invites. That is the real point of no return, and it
> belongs after every check in this document has passed.

---

## 7. Verification, in order

Run after the policy has propagated (~30 min), with flags 1–4 on.

1. **Policy is assigned** — `Get-CsOnlineUser … | Select ApplicationAccessPolicy` reports
   `ATS-Interview-Attendance-Prod` (§3).
2. **Mailbox resolves** — the backend log shows no *"could not resolve the calendar mailbox to
   an object id"*. That line means `User.Read.All` or the UPN is wrong, not the policy.
3. **Book a test interview** on a recorded stage (`tech1`). Expect: Outlook event created, a
   Teams **Join link** in both emails, and **Meeting ID + Passcode populated** — that last part
   is the direct proof the policy works, because it needs the gated `onlineMeetings` read.
4. **Join the meeting** with two people for >60s, then let the occurrence sweep run. Expect the
   round to be marked **held** and the interviewer scorecard released. A no-show must release
   **no** scorecard.
5. **Recording archive** — after the meeting, expect an `.mp4` under
   `Recordings_ATS/<Candidate Name> (pipeline-N)/` in `recruitment@aapnainfotech.in`'s OneDrive.
6. **Transcripts** will 403 until §5's tenant switch is on. Expected, and harmless.

---

## 8. Checklist

**IT:**

- [ ] Create + grant the production application access policy (§3) — **the one required action**
- [ ] Confirm `Sites.Selected` has a per-site grant for `recruitment@aapnainfotech.in`'s OneDrive (§4)
- [ ] Confirm `recruitment@aapnainfotech.in` is licensed with a provisioned OneDrive (§4)
- [ ] Turn on **Transcript API access → Microsoft Graph access** (§5) — optional; recordings work without it
- [ ] Confirm OneDrive headroom (~800 MB per recorded interview-hour, across Teams' copy and the ATS copy)
- [x] ~~Grant Graph API permissions~~ — **already complete on `HR_RPA_PROD` (§2), nothing to do**
- [x] ~~Tenant-wide Teams meeting settings~~ — **already done, shared tenant (§5)**

**Developer:**

- [ ] Set `MS_CALENDAR_MAILBOX` and the seven other keys in `.env.production` (§6)
- [ ] Confirm the retention decision for `MS_RECORDING_RETAIN_MONTHS` (§6)
- [ ] Flip flags 1→5 in order, `pm2 reload` between each (§6)
- [ ] Work through the §7 verification
- [ ] Leave `EMAIL_REDIRECT_TO_TEST=true` until everything else has passed

---

## 9. Staging → production, at a glance

| | Staging (`HR_RPA`) | Production (`HR_RPA_PROD`) |
|---|---|---|
| App id | `6dc40383-30fc-42e5-8fb1-748e45f81c25` | `13970867-284c-4a4b-8908-04ce0c595f65` |
| Tenant | `96875b81-…` | **same** |
| Mailbox / drive owner | `pkmondal@aapnainfotech.com` | `recruitment@aapnainfotech.in` |
| Granted Application permissions | 10 | **10 — identical** |
| Access policy name | `ATS-Interview-Attendance` | **`ATS-Interview-Attendance-Prod`** ← to create |
| Policy granted to | `pkmondal@aapnainfotech.com` | **`recruitment@aapnainfotech.in`** |
| Tenant-wide Teams settings | done | **same tenant — already done** |
| Feature flags | all on | all `false` → turn on in order (§6) |

---

## Sources (Microsoft Learn)

- Application access policy — https://learn.microsoft.com/en-us/graph/cloud-communication-online-meeting-application-access-policy
- `New-CsApplicationAccessPolicy` — https://learn.microsoft.com/en-us/powershell/module/teams/new-csapplicationaccesspolicy
- `Grant-CsApplicationAccessPolicy` — https://learn.microsoft.com/en-us/powershell/module/teams/grant-csapplicationaccesspolicy
- Online meeting artifacts & permissions — https://learn.microsoft.com/en-us/graph/cloud-communications-online-meeting-artifacts
- `Sites.Selected` site-level permissions — https://learn.microsoft.com/en-us/graph/permissions-reference#sitesselected
