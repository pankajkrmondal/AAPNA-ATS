# Interview Recordings (Microsoft Teams) — Implementation Plan

**Status:** plan agreed — decisions locked in §0, no code written yet.
**Date:** 2026-09-01
**Owner:** Pankaj
**Related:** `docs/phase3/INTERVIEWER-SCORECARD-PLAN.md`, `docs/phase3/MS-GRAPH-SETUP-FOR-IT.md`

---

## 0. Decisions taken (2026-09-01)

| # | Decision | Consequence |
|---|---|---|
| 1 | **`allowedPresenters: 'organization'`** | Candidate joins as an attendee and **cannot stop the recording** or share their screen unless promoted in-meeting. Interviewers stay presenters — they *can* stop it, so §3.4 detection + alerting is mandatory, not optional. |
| 2 | **Record 5 rounds:** `tech1`, `tech2`, `tech3`, `hr_round`, `ceo` | The 6th schedulable stage, `client`, is excluded — consistent with its existing `autoInvite: false` (we never create its Teams meeting). Implement as an explicit `RECORDED_STAGES` set, not "all schedulable stages". |
| 3 | **Links first, archive right behind** | Phase 2 delivers a working link within minutes of the interview; Phase 5 makes it survive Teams' own expiry. |
| 4 | **Blanket access for recruiter-tier** (`recruiter`, legacy `hr`, `admin`, `superadmin`) | Simpler than a per-user module toggle. `vendor` is excluded outright, and interviewers are structurally excluded because they are not app users (§6.2). Trade-off accepted: *every* recruiter can watch *every* recording, so §6.3 audit logging carries more weight — it becomes the only record of who watched what. A module toggle can be layered on later without reworking anything. |
| 5 | **Retention: MP4 deleted 12 months after the journey closes; transcript kept** | Needs a retention job (Phase 6) and a stated period in the candidate notice (§10). |

**Licensing confirmed:** the tenant is on **Microsoft 365 Business Basic**, which does include Teams
cloud recording and transcription (both organizer and recording initiator need a qualifying
licence, and the meeting policy must allow recording). It does **not** include **Teams Premium**,
so the "who can record and transcribe" option that would have let us restrict recording control
without demoting the interviewer (old Option C) is unavailable. Option A above is therefore the
only route, and §3.4 detection is the compensating control.

---

## 1. What is being asked

From the requirements meeting (item 8, "Interview Recordings — Microsoft Teams") plus the
three follow-up points:

1. **Capture the Teams recording per round** — extend the existing manual
   `rpa_interview_scorecard.recording_url` and auto-populate it where Graph permits.
2. **Role-gate recording visibility** to recruiter / HR Head / CEO — hidden from interviewers.
3. **Surface Technical 1 / Technical 2 recordings** in the PipelineDrawer round panels and in
   the candidate scorecard report ("dossier").
4. **Every scheduled or rescheduled Teams interview must be recorded automatically** —
   recording ON by default, no human has to press Record.
5. **Nobody in the meeting should be able to stop the recording** (neither interviewer nor
   candidate).
6. **Store the recording** on our drive, or at minimum store a durable link, so a recruiter can
   share it with Sanghamitra / Abhijit before the final round.

Points 1–4 and 6 are fully achievable. **Point 5 is only partly achievable** — see §3.3; that
is the single hard constraint in this whole plan and it needs a decision from you.

---

## 2. Where we are today (verified in code, 2026-09-01)

| Piece | State |
|---|---|
| Outlook event + Teams meeting created on booking | ✅ `graphCalendar.service.js` → `createInterviewEvent()` |
| Reschedule PATCHes the same event, Teams meeting survives | ✅ `updateInterviewEventTime()` |
| `online_meeting_id`, `teams_join_url`, `teams_meeting_id`, `teams_passcode` persisted per booking | ✅ `rpa_interview_schedule` (schema.prisma:811–832) |
| Attendance report read after the meeting → held / no-show | ✅ `graphAttendance.service.js` + `jobs/interviewOccurrence.js` |
| Recording link | ⚠️ **manual only** — a free-text field the interviewer optionally pastes into the scorecard form (`InterviewScorecard.jsx:282` → `recording_url`) |
| Recording is ON by default in the meeting | ❌ not set at all — Teams default is OFF |
| Anything stored on our drive | ❌ nothing |
| Role gating on `recording_url` | ❌ none — it is returned by `getCandidateScorecardReport()` (`interviewScorecard.service.js:661`) to anyone who can read the pipeline |

Granted Graph permissions today (per `MS-GRAPH-SETUP-FOR-IT.md` + verified 2026-07-27):
`Mail.Send`, `Mail.ReadWrite`, `Calendars.ReadWrite`, `OnlineMeetings.**Read**.All`,
`OnlineMeetingArtifact.Read.All`, `User.Read.All`, plus the **application access policy**
(`Grant-CsApplicationAccessPolicy`) scoped to `MS_CALENDAR_MAILBOX` = `pkmondal@aapnainfotech.com`.

---

## 3. How Microsoft actually behaves (the constraints we must design around)

All of the following was re-verified against Microsoft Learn on 2026-09-01; sources at the end.

### 3.1 Turning recording on automatically — supported

`onlineMeeting.recordAutomatically = true` is a real, updatable v1.0 property. It is the exact
setting behind the "Record and transcribe automatically" toggle in the screenshot from the
meeting-options dialog.

**But it cannot be set on the calendar event.** Our meeting is created through
`POST /users/{mailbox}/events` with `isOnlineMeeting: true`, and the event payload has no place
for meeting options. So the flow becomes:

```
1. POST /users/{mailbox}/events                 → event + joinUrl        (already done today)
2. GET  /users/{guid}/onlineMeetings?$filter=JoinWebUrl eq '...'  → onlineMeetingId (already done today)
3. PATCH /users/{guid}/onlineMeetings/{id}      → { recordAutomatically: true, ... }   ← NEW
```

Step 3 needs `OnlineMeetings.**ReadWrite**.All` (application). We only have `Read.All` — **this
is a new grant IT must add.** The application access policy already in place covers it; no new
policy is needed.

`recordAutomatically` is listed as *not* applying to an in-progress meeting, which is fine — we
patch it at booking time, minutes-to-days before the call.

### 3.2 Reschedule keeps the setting

Because `rescheduleInterviewRound()` PATCHes the existing event and the Teams meeting survives,
`recordAutomatically` survives with it. The plan still re-asserts the patch on every reschedule
(idempotent, and it heals bookings made before this feature existed, and covers the
cancel-and-recreate fallback path at `interviewSchedule.service.js:1185`).

### 3.3 ⚠️ "Nobody can stop the recording" — the hard constraint

**Teams has no setting that locks a recording on.** Whoever is allowed to start a recording is
allowed to stop it. What we *can* control is **who has that right**, via
`onlineMeeting.allowedPresenters`:

| `allowedPresenters` | Candidate (external/guest) | Interviewer (internal) | Interviewer can screen-share? |
|---|---|---|---|
| `everyone` *(Teams default — what we have today)* | presenter → **can stop the recording** | presenter → can stop | yes |
| **`organization`** *(recommended)* | attendee → **cannot stop, cannot share** | presenter → can stop | yes |
| `organizer` *(strictest)* | attendee → cannot stop | attendee → **cannot stop** | **no** |

So there are three honest options:

- **Option A (recommended): `organization`.** Closes the real risk — a candidate killing the
  recording — while keeping the interviewer able to share their screen, run a whiteboard, and
  admit people from the lobby. An interviewer stopping the recording is then an *internal
  policy* matter, and we detect it (§3.4) rather than prevent it.
- **Option B: `organizer`.** Literally satisfies "no one can stop it", but the interviewer
  becomes an attendee: **no screen sharing, no whiteboard, no lobby admit**. For a technical
  round that is usually unacceptable.
- ~~**Option C: Teams Premium.**~~ **Ruled out 2026-09-01** — the tenant is on Microsoft 365
  Business Basic. Premium's separate "who can record and transcribe" control is not available to
  us at any price short of buying add-on licences.

**DECIDED: Option A.** Consequences to carry into the build:

- The candidate is an attendee, so if a coding round needs the *candidate* to share their screen,
  the interviewer must promote them in-meeting (two clicks). **This must be stated in the
  interviewer invite email**, or the first technical round will stall while someone works out why
  the candidate can't share.
- An interviewer *can* still stop the recording. §3.4 detection is therefore load-bearing, not a
  nice-to-have — it is the only thing standing between "policy" and "hope".

### 3.4 Detection instead of prevention

Since prevention is imperfect, the plan makes a missing recording **loud**:

- After the occurrence sweep marks a round `held`, a second sweep looks for the recording.
- If no recording exists ~30 minutes after a `held` round, stamp
  `recording_status = 'missing'` and email the recruiter: *"Tech 2 for <candidate> was held but
  produced no recording."*
- If a recording exists but is far shorter than the attendance duration, it was stopped early —
  same alert, different reason. (Cheap to compute: `callRecording.endDateTime -
  createdDateTime` vs the attendance report we already fetch.)

This turns an unenforceable rule into an auditable one, which is what management actually needs.

### 3.5 Tenant prerequisites that will silently break auto-recording

> **✅ VERIFIED 2026-09-01** in Teams admin center → Meetings → Meeting policies → Global
> (Org-wide default) → Recording & transcription. Pankaj's account uses this Global policy with
> Default assignment, so this is the effective policy:
>
> | Setting | Value | Verdict |
> |---|---|---|
> | Meeting recording | **On** | ✅ recording can happen |
> | Require participant agreement for recording, transcription, and Copilot | **Off** | ✅ auto-record starts silently, no consent click |
> | Transcription | **On** | ✅ transcripts available |
> | Recordings and transcriptions automatically expire | **Off** | ✅ Teams never deletes them — see §3.6 |
> | Store recordings outside your country/region | Off | ✅ stays in-region |
>
> **All tenant-side prerequisites for auto-recording are met.** Nothing to change here.

These are Teams **policy** settings, not Graph, and all four can make `recordAutomatically: true`
do nothing:

1. `Set-CsTeamsMeetingPolicy -AllowCloudRecording $true` must apply to **the organizer mailbox**
   *and* to the interviewers (both organizer and recording initiator need the right).
2. `-ExplicitRecordingConsent` must be **Disabled** for the organizer's policy. If enabled,
   participants must consent before recording begins — automatic recording stops being automatic.
3. **Copilot**: per Microsoft, when an organizer turns Copilot off for a meeting, recording and
   transcription are turned off with it. Do not disable Copilot on these meetings.
4. The organizer mailbox must be a **licensed user with a OneDrive** (see §3.6).

### 3.6 Where the recording physically lands — and why the organizer mailbox matters

For a scheduled private meeting, **the recording is saved to the organizer's OneDrive, in the
`Recordings` folder** — regardless of who started it. Our organizer is `MS_CALENDAR_MAILBOX`.

> **Do not move `MS_CALENDAR_MAILBOX` to a shared mailbox** (e.g. `recruitment@…`) without a
> OneDrive licence. Microsoft's documented fallback chain is: organizer's OneDrive → first
> co-organizer's OneDrive → recording initiator's OneDrive → *async media storage, deleted after
> 21 days*. `MS-GRAPH-SETUP-FOR-IT.md` §1 currently suggests `recruitment@aapnainfotech.com` as
> the mailbox — that guidance must be amended: it has to be a **licensed user account with
> OneDrive**, or recordings become unreliable.

Other storage facts that shape the design:

- Size ≈ **400 MB per recording-hour** (Microsoft's own figure; the export docs say ~350 MB for
  30–60 min). Six schedulable rounds × active pipelines adds up fast — this is a real OneDrive
  quota conversation with IT.
- ~~Recordings auto-expire after ~120 days~~ — **not on this tenant.** "Recordings and
  transcriptions automatically expire" is **Off** (verified 2026-09-01), so Teams never deletes
  them. Two consequences, one good and one bad:
  - Good: the Teams link stays valid indefinitely, so **link-first genuinely carries the feature**
    and archiving stops being time-critical. See the revised §4.1.
  - Bad: **nothing ever reclaims that storage.** Every recorded interview accumulates in one
    person's OneDrive forever, so the quota question in §8 goes from routine to important, and our
    12-month retention job (§10) becomes the *only* deletion mechanism in the whole system.
- The per-meeting recordings API works **only while the meeting resource has not expired** —
  online meetings expire 60 days after the meeting. Another argument for archiving early.
- Only invitees inside our org get automatic view permission; external people get none. So a
  recruiter forwarding a raw OneDrive link to an external panel member will produce an
  access-denied — the ATS should serve playback itself (§6.4).

### 3.7 Reading the recording back — API surface and permissions

Two Graph routes, both application-only, both usable:

```
# A. Per meeting (we know the onlineMeetingId already)
GET /users/{organizerGuid}/onlineMeetings/{onlineMeetingId}/recordings
GET .../recordings/{recordingId}/content        → MP4 stream

# B. By organizer, with delta — one call covers every meeting
GET /users/{organizerGuid}/onlineMeetings/getAllRecordings(
      meetingOrganizerUserId='{organizerGuid}', startDateTime=…, endDateTime=…)
```

- Permission: **`OnlineMeetingRecording.Read.All`** (application) — **new grant needed.**
- Route A additionally requires the **application access policy** (already in place).
- Route B is a Teams Export API: it requires an active Teams licence on the organizer, supports
  `delta` for incremental sync, and results are *guaranteed to appear only once the recording is
  actually available* — i.e. no polling for readiness. It has a documented known issue where a
  pagination-token reset can return duplicates, so the recording id must be a unique key on our
  side.
- Route A explicitly does **not** support meetings created via the create-onlineMeeting API that
  aren't attached to a calendar event. Ours *are* calendar events, so we're fine.

**Transcripts are a cheap bonus.** `OnlineMeetingTranscript.Read.All` + `/transcripts/{id}/content`
returns VTT (or DOCX with the right `Accept` header) at ~**300 KB** per hour vs 400 MB for video.
A transcript is searchable, quotable in the dossier, and survives storage pressure. Strongly
recommend including it.

---

## 4. Recommended architecture

```
BOOKING TIME  (interviewSchedule.service.js)
  create/patch event ──► resolve onlineMeetingId ──► PATCH onlineMeeting
                                                     { recordAutomatically: true,
                                                       allowedPresenters: 'organization',
                                                       allowTranscription: true }
                                                     └─► stamp recording_policy_applied_at

AFTER THE MEETING  (new jobs/interviewRecordings.js, every ~15 min)
  Pass 1 DISCOVER : getAllRecordings(delta)  ──► upsert rpa_interview_recording
                    fallback per-meeting list for rounds still missing
  Pass 2 ARCHIVE  : stream /recordings/{id}/content ──► upload session ──► ATS OneDrive
                    "Interview Recordings/<Candidate> (pipeline-<id>)/<Round> - <date>.mp4"
                    + /transcripts/{id}/content ──► .vtt alongside
  Pass 3 ALERT    : held round + no recording after grace ──► recruiter email, status='missing'

READ  (role-gated)
  GET  /api/pipeline/:id/recordings            → list, gated
  GET  /api/pipeline/:id/recordings/:rid/stream → backend-proxied playback, gated, audited
  PipelineDrawer round panel + scorecard report show it; interviewer scorecard page never does
```

### 4.1 Link-only vs archive — decision

> **Re-assessed 2026-09-01.** Recording auto-expiry is **Off** on this tenant, which removes the
> original headline argument for archiving ("Teams will delete them"). Archiving is still worth
> doing, but the reasons have changed and it is **no longer urgent** — see the revised table.

| | Link-only | Archive to our drive |
|---|---|---|
| Effort | ~1 day | ~3–4 days (needs a resumable upload path) |
| ~~Survives Teams auto-expiry~~ | *moot — expiry is Off* | *moot* |
| Survives the **60-day onlineMeeting expiry** (the Graph read API stops working) | ❌ for backfill; fine in practice since we discover within minutes | ✅ |
| **Survives the organizer leaving the company** — recordings live in `pkmondal@…`'s *personal* OneDrive, which standard offboarding deletes | ❌ **every interview recording disappears with the account** | ✅ |
| Shareable with an external panel member | ❌ | ✅ via our proxy |
| Under our own retention policy / audit | ❌ | ✅ |
| Storage cost | none extra | ~400 MB/round-hour, **a second copy that also never auto-expires** |

The strongest remaining argument for archiving is the offboarding one: today every interview
recording in the company would live in one employee's personal OneDrive. That is a real
single-point-of-failure, but it is a *months* problem, not a *days* problem — which is why the
phasing keeps archiving at Phase 5, after the feature is delivering value.

**DECIDED: do both** — persist the Teams/OneDrive link immediately at discovery (usable
within minutes), then archive in the background. If the archive fails the link still works; if
the link expires the archive still plays. Make archiving flag-controlled
(`MS_RECORDING_ARCHIVE_ENABLED`) so it can be switched off if quota becomes a problem, and add a
retention job later (e.g. delete archived MP4s for closed journeys older than N months, keeping
the transcript forever).

> **Implementation note:** `uploadFileToOneDrive()` (`onedrive.service.js:173`) does
> `fs.readFileSync` into memory and a single `PUT …/content` with a 90-second timeout. That is
> fine for a CV and completely unsuitable for a 400 MB MP4. Archiving needs a **new**
> `uploadStreamToOneDrive()` built on `createUploadSession` + chunked `PUT` with `Content-Range`,
> streaming Graph→Graph without buffering the whole file. This is the single biggest piece of new
> code in the plan.

---

## 5. Data model

### 5.1 New table `rpa_interview_recording`

One row per recording artifact. A table rather than columns on `rpa_interview_schedule` because
one meeting can produce several recording segments (stop/start mid-interview), and a reschedule
reuses one `online_meeting_id` across bookings.

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `schedule_id` | bigint FK → `rpa_interview_schedule` | cascade delete |
| `pipeline_id` | bigint FK → `rpa_candidate_pipeline` | denormalised for the dossier query |
| `stage_key` | varchar(50) FK → `rpa_pipeline_stages` | tech1 / tech2 / … |
| `graph_recording_id` | varchar(512) **UNIQUE** | dedupes the delta known-issue duplicates |
| `online_meeting_id` | varchar(512) | joins back to the meeting |
| `kind` | varchar(20) | `recording` \| `transcript` |
| `recorded_start_at` / `recorded_end_at` | timestamptz | from `callRecording.createdDateTime` / `endDateTime` |
| `graph_content_url` | text | `recordingContentUrl` (Graph-authenticated, never given to a browser) |
| `teams_web_url` | text | OneDrive/SharePoint web URL for org users, when resolvable |
| `archive_status` | varchar(20) | `pending` \| `copied` \| `failed` \| `skipped` |
| `archive_item_id` / `archive_web_url` | text | our OneDrive copy |
| `archive_bytes` | bigint | |
| `archive_error` | text | last failure, for the retry loop |
| `discovered_at`, `archived_at` | timestamptz | |
| `created_at`, `modified_at` | timestamptz | |

Indexes: `(pipeline_id)`, `(schedule_id)`, `(pipeline_id, stage_key)`, `(archive_status)`.

### 5.2 New columns on `rpa_interview_schedule`

| Column | Type | Purpose |
|---|---|---|
| `record_auto_applied_at` | timestamptz | when the meeting-options PATCH succeeded (null ⇒ the round is *not* guaranteed to be recorded — show a warning in the drawer) |
| `record_policy_error` | text | last PATCH failure reason, for diagnosis |
| `recording_status` | varchar(20) | `expected` \| `available` \| `missing` \| `not_applicable` |
| `recording_checked_at` | timestamptz | sweep idempotency, mirrors `attendance_checked_at` |

### 5.3 What happens to `rpa_interview_scorecard.recording_url`

Kept, unchanged, as the **manual override / fallback** — the interviewer-pasted link for rounds
where automatic capture didn't happen (calendar off, external tool, Graph failure). The read
layer resolves in this order: **ATS archive → Teams link → manual `recording_url`.**
No migration needed and nothing existing breaks.

Following the DDL convention in `backend/prisma/ddl/`, this ships as
`2026-09-XX-interview-recordings.sql` plus the matching `schema.prisma` edit.

---

## 6. Access control (requirement 2)

### 6.1 The role gap

Requirement says "recruiter / HR Head / CEO". The app's actual roles (`config/roles.js`) are
`superadmin` > `admin` > `recruiter` / `vendor`, with legacy `hr` at recruiter tier. There is no
"HR Head" or "CEO" role, and recruiter-tier is broad — every recruiter would see every recording,
which is *more* than "not required for every user".

**DECIDED: blanket recruiter-tier access.** Enforced with the existing middleware:

```js
restrictTo('superadmin', 'admin', 'recruiter', 'hr')   // 'vendor' excluded outright
```

That covers Sanghamitra and Abhijit (admin-tier) and every recruiter. Two things follow from
choosing breadth over granularity:

- **The audit trail (§6.3) is now the only control on who watches what.** With a per-user toggle
  it would have been a secondary record; here it is the primary one. Build it in Phase 3, not
  later.
- A per-user `interview_recordings` module key can be layered on afterwards without reworking the
  endpoints — the `MODULES` map plus `checkModuleAccess` already exist, so it is an additive
  change if access ever needs narrowing.

### 6.2 Interviewers must never see recordings

Interviewers are **not application users** — they interact only through the tokenised scorecard
page (`/scorecard/:token`). So the rule is enforced structurally: the scorecard token payload and
`InterviewScorecard.jsx` are never given recording fields. Additionally:

- Recording links must **not** appear in any email template (invite, reminder, scorecard).
- `getCandidateScorecardReport()` (the dossier) must strip `recording_url` and the new recording
  block unless the caller passes the module check — today it returns `recording_url`
  unconditionally, which is a live leak the moment recordings become interesting.

### 6.3 Audit

Playing back a recording of a person is not a neutral read. Every stream/open writes an audit row
(reuse `rpa_pipeline_stage_events` with a distinct `event_type`, or a small dedicated table):
who, which recording, when. Cheap now, invaluable later.

### 6.4 Playback

`GET /api/pipeline/:pipelineId/recordings/:rid/stream` — authenticates, checks the module, logs
the view, then **proxies** the bytes from Graph (with `Range` header pass-through so the browser
can seek). The Graph URL and the app token never reach the client. For "share with my superior",
the recruiter shares the ATS page, not a OneDrive link — which keeps the audit trail intact and
avoids the external-access problem in §3.6.

---

## 7. Frontend surfaces (requirement 3)

1. **PipelineDrawer round panel** (`PipelineDrawer.jsx` — the panel that already renders
   `teams_join_url` at :1943 / :3360): add a **Recording** row under the Teams row.
   States: *Processing…* (held, none yet) / *Play* + duration (available) / *No recording*
   (missing, with the reason) / *Not recorded* (`record_auto_applied_at` null).
2. **Candidate scorecard report / dossier** (`getCandidateScorecardReport`): each submitted round
   gains `recording: { available, duration, url }`, gated. This is the surface Sanghamitra and
   Abhijit actually use before the final round — it is the point of the whole feature.
3. **Transcript**: a small "Transcript" link next to Play where one exists.
4. Everything above renders only when the module check passes; otherwise the rows are absent
   (not disabled — absent).

---

## 8. What IT must provision (delta from what we already have)

> **Updated 2026-09-01** after reviewing the live `HR_RPA` app registration. Its 11 granted
> Microsoft Graph permissions are: `Calendars.ReadWrite`, `Files.Read.All` *(delegated)*,
> `Mail.Read`, `Mail.ReadWrite`, `Mail.Send` *(both)*, `OnlineMeetingArtifact.Read.All`,
> **`OnlineMeetings.ReadWrite.All`**, `Sites.Selected`, `User.Read` *(delegated)*,
> `User.Read.All`. So the meeting-options PATCH needs **nothing new** — only the recording
> read permission is genuinely missing.

| Item | Type | Status | Needed for |
|---|---|---|---|
| `OnlineMeetings.ReadWrite.All` | Graph **application** permission + admin consent | ✅ **already granted** (verified in the portal 2026-09-01) | PATCHing `recordAutomatically` / `allowedPresenters` |
| `OnlineMeetingRecording.Read.All` | Graph **application** permission + admin consent | ❗ **NEW — the only blocking grant** | Listing and downloading recordings. Note `OnlineMeetingArtifact.Read.All`, which we hold, covers **attendance reports** only — the recordings API names this permission specifically. |
| `OnlineMeetingTranscript.Read.All` | Graph **application** permission + admin consent | ➕ recommended | Transcripts (~300 KB vs 400 MB) |
| Write access to the ATS OneDrive folder | `Sites.Selected` (granted per-site with write) | ✅ already working — CV/document uploads use this path today; no `Files.ReadWrite.All` application permission exists on the app | Writing the archive into the ATS OneDrive folder. Confirm the site grant includes **write** if the archive ever targets a different site. |
| Application access policy on `MS_CALENDAR_MAILBOX` | Teams PowerShell | ✅ already granted 2026-07-27 | Covers the new permissions too — no new policy, but re-verify after the grants land |
| `AllowCloudRecording` / `AllowTranscription` on the Global meeting policy | Teams policy | ✅ **both On — verified 2026-09-01** | Recording and transcription can happen |
| `ExplicitRecordingConsent` | Teams policy | ✅ **Off — verified 2026-09-01** | Auto-record starts without a consent prompt |
| Teams cloud recording + transcription licensing | Licensing | ✅ **Microsoft 365 Business Basic covers both** (confirmed 2026-09-01). Teams Premium **not** held — see §3.3. | Recording and transcript capture |
| `MS_CALENDAR_MAILBOX` is a **licensed user with OneDrive** | Licensing | ✅ both candidate mailboxes have OneDrive — but see the note below on **which one** and the access policy | Recordings have somewhere to land |
| **Application access policy covers the mailbox actually used** | Teams PowerShell | ⚠️ granted for `pkmondal@aapnainfotech.com` **only** | Every onlineMeeting call, including the recording read |
| OneDrive quota headroom (~400 MB per recorded hour, doubled once we archive) | Licensing | ❓ verify | Both the Teams copy and our archive |
| Teams meeting recording auto-expiry | Teams admin center | ✅ **Off — verified 2026-09-01.** Teams never deletes recordings, so storage only ever grows | Makes the quota row above important, and our retention job the only deletion mechanism |
| Privacy/recording-notice URL (`-LegalURL`) | Teams policy | ➕ recommended | Candidate consent (§10) |

### 8.1 ⚠️ Which mailbox organizes the meetings — open item

Two mailboxes were offered, both with OneDrive: `pkmondal@aapnainfotech.**com**` and
`recruitment@aapnainfotech.**in**`. Note the **different top-level domain**. Three consequences:

1. The application access policy granted in July is scoped to `pkmondal@aapnainfotech.com`
   **only**. If we switch the organizer to `recruitment@aapnainfotech.in`, IT must run
   `Grant-CsApplicationAccessPolicy -PolicyName "ATS-Interview-Attendance" -Identity
   recruitment@aapnainfotech.in`, or **every** onlineMeeting call — the options PATCH, the
   attendance read that works today, and the recording read — starts returning 403.
2. `aapnainfotech.in` must be a **verified domain in the same Entra tenant**. If it belongs to a
   separate tenant, app-only access to it is impossible with these credentials and the mailbox is
   simply not usable as the organizer.
3. Recordings land in **whichever mailbox organizes**, and history does not migrate: rounds booked
   before a switch keep their recordings in the old mailbox's OneDrive.

**Recommendation:** stay on `pkmondal@aapnainfotech.com` for now — it is already proven end to end
(attendance verified working 2026-07-27) and needs no new grants. Moving to a dedicated
recruitment mailbox is worth doing eventually (it survives an individual leaving the company), but
it is a deliberate migration with its own checklist, not a config tweak.

A patch to `MS-GRAPH-SETUP-FOR-IT.md` covering all of the above is part of the work.

---

## 9. Configuration (new env flags, all default-off)

```env
MS_MEETING_RECORD_AUTO=false          # PATCH recordAutomatically:true on every booking
MS_MEETING_PRESENTERS=organization    # DECIDED §0.1 — kept configurable for a fast rollback
MS_RECORDED_STAGES=tech1,tech2,tech3,hr_round,ceo   # DECIDED §0.2 — 'client' deliberately absent
MS_MEETING_TRANSCRIBE=true            # allowTranscription on the meeting
MS_RECORDING_FETCH_ENABLED=false      # discovery sweep on/off
MS_RECORDING_ARCHIVE_ENABLED=false    # copy into ATS OneDrive on/off
MS_RECORDING_ARCHIVE_FOLDER=Interview Recordings
MS_RECORDING_GRACE_MIN=30             # wait after a held round before alerting "missing"
MS_RECORDING_RETAIN_MONTHS=12         # DECIDED §0.5 — MP4 only; transcripts are never purged
```

Sweep cadence/enable goes in `rpa_settings` alongside the occurrence sweep
(`interview_recording_enabled`, `_interval_min`), matching the pattern in
`jobs/interviewOccurrence.js` — so it is switchable without a deploy. Note the lesson from
2026-07-27: an absent `rpa_settings` row means the job silently never schedules. Seed the rows in
the DDL.

Everything stays off in production until §8 is confirmed, exactly like `MS_CALENDAR_ENABLED` and
`MS_ATTENDANCE_ENABLED` before it.

---

## 10. Consent and compliance — not optional

Recording a person requires telling them. Concretely:

- Add an explicit line to the **candidate invite + reschedule email templates**: this interview
  will be recorded, why, who sees it, how long it is kept.
- Same line, shorter, in the **interviewer** invite so the panel knows it is automatic and that
  they should not stop it.
- Set the Teams **privacy/security URL** (`Set-CsTeamsMeetingConfiguration -LegalURL`) so the
  in-meeting recording banner points at our own policy rather than Microsoft's default.
- **Retention (decided): the MP4 is deleted 12 months after the journey closes; the transcript is
  kept.** This must be stated in the candidate notice, and implemented as a retention job in
  Phase 6 — an undeleted "12 month" policy is worse than no policy, because we would be
  advertising a deletion that never happens. Under India's DPDP Act an interview recording is
  personal data under purpose limitation.
- Non-production safety: staging already redirects candidate email
  (`nonProdSafeCandidateEmail`). The recording pipeline must not create real recordings of real
  candidates from staging — gate discovery/archive on the same environment checks, and keep
  `MS_MEETING_RECORD_AUTO=false` in staging unless deliberately testing.

---

## 11. Phasing

| Phase | Deliverable | Depends on | Est. |
|---|---|---|---|
| **0** | IT grants `OnlineMeetingRecording.Read.All` (+ transcript); verify Teams policies; confirm quota | IT | — |
| **1** | ✅ **BUILT 2026-09-01** — `applyMeetingOptions()` in `graphCalendar.service.js`; `applyRecordingOptions()` wired into schedule + reschedule; `record_auto_applied_at` / `record_policy_error` columns + DDL; drawer shows "Recording: ON". DDL applied; **proven in a live call** (§11.1a) | — | done |
| **2** | ✅ **BUILT 2026-09-01** — DDL + Prisma for `rpa_interview_recording`; `graphRecording.service.js`; `jobs/interviewRecordings.js` discovery sweep; link persisted. DDL applied; sweep live and **linked the real recording** | Phase 1 | done |
| **3** | ✅ **BUILT 2026-09-01** — `interviewRecording.service.js`, gated list endpoint, **audited streaming proxy**, 10 unit tests. See §11.3 | Phase 2 | done |
| **4** | ✅ **BUILT 2026-09-01** — drawer round panel + scorecard-report surfaces, in-app player. See §11.4 | Phase 3 | done |
| **5** | ✅ **BUILT + VERIFIED 2026-09-01** — `uploadStreamToOneDrive()` (resumable session), archive pass, retry/give-up, playback prefers the copy. See §11.5 | Phase 2 | done |
| **6** | ✅ **BUILT 2026-09-01** — consent notice, missing-recording alerts, 12-month retention job, IT doc updated, 10 more tests. See §11.6 | Phase 5 | done |

### 11.1a Phase 1 — verified against the live tenant (2026-09-01)

Run against `NODE_ENV=staging` with `MS_MEETING_RECORD_AUTO=true`, using a throwaway Graph
onlineMeeting (no calendar event, no attendees, no invitations) that was deleted afterwards:

| Check | Result |
|---|---|
| Teams' own default for a new meeting | `recordAutomatically = false` — confirming the PATCH is what does the work |
| `applyMeetingOptions()` | `{applied: true, error: null}` |
| Read back: `recordAutomatically` | ✅ **true** |
| Read back: `allowedPresenters` | ✅ **organization** |
| Read back: `allowTranscription` | ✅ **true** |
| `GET …/recordings` (new grant) | ✅ **HTTP 200** — authorized, empty list as expected |
| `GET …/transcripts` (new grant) | ❌ **HTTP 403 — tenant switch, not permissions.** See §13 item 1b |

**✅ PROVEN IN A REAL CALL, 2026-09-01 19:31 IST** — booking SCHED04c (Tech 1, meeting id
49931407296831), interviewer in the Teams desktop client and candidate joining as an external
guest in a browser:

- recording started **with nobody pressing Record**; the red banner appeared in both clients
- the candidate's **Share button was greyed out**, confirming `allowedPresenters: 'organization'`
  took effect — the same attendee role that denies them the Stop-recording control
- the drawer's green **Recording: ON** tag matched the live meeting

Phase 1 is therefore complete and verified against reality, not just against Graph.

One behaviour to keep in mind: auto-record begins when the first participant *entitled to record*
joins — the interviewer. A candidate sitting alone in the lobby does not start it.

⚠️ **The false start that produced this test** is worth remembering: the first attempt did not
record because `MS_MEETING_RECORD_AUTO=true` had been set in `.env.staging`, while the local
server runs `npm run dev`, which sets no `NODE_ENV` and therefore loads **`.env.development`**.
The booking row showed `record_auto_applied_at = NULL` with `record_policy_error = none` — the
signature of "feature off", as distinct from "Graph refused".

### 11.1 Phase 1 — what shipped, and how to switch it on

Files: `config/index.js` (4 new settings), `graphCalendar.service.js` (`applyMeetingOptions`,
`isMeetingRecordAuto`), `interviewSchedule.service.js` (`stageIsRecorded`,
`applyRecordingOptions`, both call sites), `schema.prisma`,
`prisma/ddl/2026-09-01-interview-recording-options.sql`, `PipelineDrawer.jsx` (`TeamsDetails`).

Deploy order matters — **the DDL must be applied before the flag is flipped**, or the Prisma
write will fail on unknown columns and take the booking down with it:

```bash
# 1. apply the DDL (manual, per this repo's convention)
psql "$DATABASE_URL" -f backend/prisma/ddl/2026-09-01-interview-recording-options.sql
# 2. resync the client
cd backend && npx prisma db pull && npx prisma generate
# 3. only now, in .env:
#      MS_MEETING_RECORD_AUTO=true
# 4. restart the backend
```

Leaving `MS_MEETING_RECORD_AUTO=false` after the DDL is safe and is the recommended first step:
the columns simply stay null and nothing changes behaviour.

### 11.2 Phase 2 — what shipped, and how to switch it on

Files: `graphRecording.service.js` (new), `jobs/interviewRecordings.js` (new), `server.js`
(start/stop), `config/index.js` (`MS_RECORDING_FETCH_ENABLED`), `schema.prisma`
(`rpa_interview_recording` + `recording_status` / `recording_checked_at`),
`prisma/ddl/2026-09-01-interview-recordings.sql`.

**Deviation from §4, stated openly:** discovery uses the **per-meeting** endpoint
(`/onlineMeetings/{id}/recordings`) rather than `getAllRecordings(delta)`. We already store
`online_meeting_id` on every booking, so per-meeting maps an artifact to its schedule row
deterministically — no delta token to keep in sync, and no exposure to Microsoft's documented
duplicate-on-token-reset issue. The organizer-wide export API is the right tool at a volume we do
not have; it stays the scale path if interview volume ever makes N calls per tick expensive.

Two switches must both be on, deliberately: `MS_RECORDING_FETCH_ENABLED` says *the permission
exists in this environment*, and the `interview_recording_enabled` row in `rpa_settings` says
*sweep on this schedule*. The settings rows are seeded by the DDL — the occurrence sweep's rows
were once simply absent, which read as "disabled" and meant no cron ran at all for weeks.

```bash
# 1. apply the DDL
psql "$DATABASE_URL" -f backend/prisma/ddl/2026-09-01-interview-recordings.sql
# 2. regenerate the client — REQUIRED, and the step that broke bookings last time
cd backend && npx prisma generate
# 3. restart the backend (a running server holds a lock on the query engine, so
#    generate must happen while it is stopped)
# 4. turn the sweep on:
#    UPDATE rpa_settings SET value='true' WHERE key='interview_recording_enabled';
#    then restart again, or call the settings endpoint that restarts the job
```

**✅ VERIFIED against the live tenant, 2026-09-01 20:23 IST** — one manual sweep pass:

```
[Recording Sweep] 15 booking(s) past end without a linked recording.
[Recording Sweep] schedule 290 (tech1, pipeline 1396) → 1 recording(s), 0 transcript(s) linked.
[Recording Sweep] linked=1 pending=14 unreadable=0.
→ rpa_interview_recording id=1, kind=recording, 5 min
→ rpa_interview_schedule 290: recording_status='available'
```

Schedule 290 is the round recorded in the Phase 1 live test, so recording → discovery → link is
proven end to end. The 14 `pending` rows are older bookings that were never recorded; they poll
harmlessly until Phase 6 rules on them. Transcripts logged the tenant block once, as designed,
and did not prevent the recording being linked.

> ⚠️ **Env-file precedence depends on module import order — a trap worth knowing.**
> `config/index.js` loads `.env.<NODE_ENV>` first and plain `.env` second, and dotenv never
> overwrites an already-set variable, so `.env.development` is meant to win. But **`@prisma/client`
> loads plain `.env` the moment it is imported**. Any script that imports `config/database.js`
> before `config/index.js` therefore gets `.env`'s values, while `server.js` — which reaches
> config first — gets `.env.development`'s. The first Phase 2 sweep appeared to select nothing for
> exactly this reason, while the same flag was correctly `true` inside the running server.
> Mitigations applied: the two dev files now hold identical values for these flags, and the
> reasoning is commented in `.env`. When writing a script, **import `config/index.js` first**.

### 11.2a Settings card (added 2026-09-01, ahead of Phase 3)

**Interview Recording Capture** now sits in Settings under *Interview Completion Check*, following
the same save-on-change contract as the two cards above it: on/off, grace minutes, and the poll
interval, applied live via `restartInterviewRecordingJob()`. Before this, changing
`interview_recording_interval_min` by hand did nothing until the backend was restarted.

Files: `settings.controller.js` (`get`/`saveInterviewRecordingConfig`), `settings.routes.js`,
`settingsService.js`, `Settings.jsx`.

Two things the card does deliberately:

- It reports **`MS_RECORDING_FETCH_ENABLED`** as read-only state and *disables the toggle* when it
  is off — mirroring how the occurrence card surfaces `attendance_enabled`. A toggle that saves
  happily and then does nothing is worse than no toggle.
- It spells out the cost of switching it off (recordings keep happening, the ATS just stops
  linking them; re-enabling backfills 45 days; past ~60 days Microsoft stops serving the meeting's
  recording at all). That consequence is delayed and silent, which is exactly the kind that has to
  be written down where the switch is.

Interval guidance in the card: **10–15 minutes**. Anything under 5 mostly asks a question Teams
cannot answer yet, since Teams controls when a recording becomes available.

**Transcript call short-circuit (same change):** the tenant block is now *latched* —
`transcriptsTenantBlocked` skips the call entirely for the rest of the process rather than only
quietening the log. Previously every due booking still spent a 403 on every tick (~1,400 wasted
Graph calls/day at 15 pending bookings). Not persisted on purpose: an admin who turns the tenant
switch on gets transcripts back on the next backend restart rather than waiting out a cache.

Phase 2 links artifacts and stops. It does **not** copy anything to our own drive (Phase 5) and
does **not** decide a round is missing its recording (Phase 6) — an empty result is left
unresolved so a late Teams upload is still picked up on a later tick.

### 11.3 Phase 3 — what shipped

Files: `interviewRecording.service.js` (new), `pipeline.controller.js`
(`getPipelineRecordings`, `streamPipelineRecording`), `pipeline.routes.js`,
`src/tests/unit/recordingAccess.test.js` (new, 10 tests).

**Scope adjustment, stated openly:** the playback proxy was planned for Phase 4 but built here.
Auditing is the control the broad-access decision (§0.4) rests on, and an audit trail is
meaningless without the thing being audited — a list endpoint alone records nothing. Phase 4 is
therefore now purely frontend.

Three decisions worth keeping:

- **The role gate is rank-based, not a role list.** `/api/pipeline` already runs `requireStaff`
  (`rank >= recruiter`), written that way so a future low-privilege role is denied by default.
  `canViewRecordings()` uses the same comparison rather than re-listing role names, which would
  reintroduce exactly the failure mode that middleware exists to prevent. The controller asserts it
  a second time: this is the one endpoint whose subject is footage of a person.
- **`serializeRecording()` is a whitelist.** A column added to `rpa_interview_recording` is
  invisible to the API until someone consciously exposes it, so `graph_content_url` can never
  escape by accident. A test asserts no `graph.microsoft.com` URL appears anywhere in the payload.
- **Playback is proxied, never redirected.** The Graph URL only works with the application's own
  token, so a redirect would either leak that token or 401. Proxying also keeps the permission
  check on every byte and makes the audit real — a redirect would record that someone was handed a
  link, not that they watched. `Range` headers pass through both ways so seeking works without
  pulling 400 MB first.

The audit row lands on the journey's own stage timeline against the round the recording belongs to
("Interview recording opened by …"), so it reads in context rather than in a log nobody opens. It
is written **before** the bytes go out: someone who closes the tab mid-stream has still watched.

**Interviewers remain structurally excluded** — verified, not assumed. `getScorecardByToken()`
builds its response from a fixed set of named `context` fields and has never carried recording
data, so there is no filter anyone has to remember to apply.

### 11.4 Phase 4 — what shipped

Files: `services/pipeline.js` (`getRecordings`, `recordingStreamUrl`), `PipelineDrawer.jsx`
(`RecordingPlayerModal`, `RoundRecordings`, `fmtDuration`, plus the query and two placements).

**Verified against the real recording:** a `Range: bytes=0-2047` request to the stored content URL
returned `HTTP 206`, `content-type: video/mp4`, `content-range: bytes 0-2047/1501627`, and the
bytes begin with an MP4 `ftyp` box. Seeking works; the player will not have to download 1.5 MB —
or, for a full-length round, several hundred — before playing.

Decisions worth keeping:

- **The JWT rides in the query string** for the `<video>` src. A media element cannot send an
  `Authorization` header, and `authenticate` already accepts `?token=` for exactly this kind of
  link. The alternative — pulling the file through axios into a blob — would download the entire
  recording before the first frame and would kill seeking, since a blob URL cannot serve ranges.
  The response is `Cache-Control: private, no-store`.
- **`destroyOnClose` on the player.** Left mounted, a closed modal keeps streaming a 400 MB file
  in the background after the reviewer has moved on.
- **Two surfaces, one query.** The drawer round panel and the scorecard report share the
  `['pipeline-recordings', pipelineId]` key, so opening the report after browsing rounds costs
  nothing. `retry: false` because a 403 is a legitimate answer (not recruiter-tier), not a
  transient failure worth retrying.
- **The recording row renders nothing when a round has none.** Most rounds in a live journey were
  never recorded (booked before this feature, or held outside Teams); a permanent "no recording"
  line on every panel would be noise.
- **`recording_url` (the interviewer's pasted link) is now the fallback**, shown only when no
  captured recording exists for that round, so the two never compete for the same eye.

**Requirement 3 is met at the surface that matters:** the recordings appear inside the candidate
scorecard report, which is what whoever takes the final decision actually opens.

### 11.5 Phase 5 — what shipped

Files: `onedrive.service.js` (`ensureDriveFolderPathFromRoot`, `uploadStreamToOneDrive`),
`graphRecording.service.js` (`openRecordingContent`), `jobs/interviewRecordings.js`
(`archiveRecordings`), `interviewRecording.service.js` (`resolveStreamSource`),
`pipeline.controller.js`, config + all four env files.

**Verified end to end against the real recording, 2026-09-01 21:38:**

```
[Recording Archive] 1 recording(s) to copy.
OneDrive: archived "Technical Round 1 - 2026-09-01.mp4" (1501627 bytes).
[Recording Archive] archived=1 failed=0.
→ archive_status='copied', bytes match the source exactly
→ webUrl: …/personal/pkmondal_aapnainfotech_com/Documents/Recordings_ATS/…

Playback source: ARCHIVE
Range bytes=1000-3047 → HTTP 206, video/mp4, bytes 1000-3047/1501627
```

Layout: `Recordings_ATS / <Candidate> (pipeline-<id>) / <Round> - <date>.mp4`. Grouped by
candidate because the question people ask is always "the recordings for this person", never
"everything from March". The pipeline id is in the folder name so two candidates of the same name
never merge.

Decisions worth keeping:

- **Chunked resumable upload, not a buffered PUT.** `uploadFileToOneDrive()` does `readFileSync`
  into memory with a 90-second budget — fine for a CV, hopeless for ~400 MB/hour of video. The new
  path streams Graph → OneDrive in 8 MiB chunks, so peak memory is one chunk regardless of file
  size, and each chunk carries its own timeout. A failed transfer `DELETE`s its session so a
  half-written placeholder never squats on the filename.
- **Size comes from a one-byte range probe**, not `Content-Length`: Graph's streaming responses do
  not reliably carry one, and every chunk's `Content-Range` needs the exact total, so guessing is
  not an option.
- **`ensureDriveFolderPathFromRoot()` is anchored at the drive root**, not `MS_ONEDRIVE_PARENT_ID`
  — `Recordings_ATS` is a sibling of the resume folder, and reusing the existing helper would have
  buried recordings inside the CV tree.
- **Playback now prefers OUR copy** (`resolveStreamSource`). That ordering is the whole point: the
  Teams original sits in one employee's personal OneDrive and stops being readable through Graph
  ~60 days after the meeting, so preferring the original would keep working right up until the day
  it silently didn't. Preferring the copy exercises the archive on every view, rather than leaving
  it an untested backup.
- **Batch of 3 per tick, 5 attempts then `failed`.** Each copy is potentially hundreds of MB in and
  out; an unbounded pass could run for an hour and collide with the next tick. Nothing here has a
  deadline — only a backlog that drains. Attempts are counted in `archive_error` rather than a new
  column.

### 11.6 Phase 6 — what shipped

Files: `interviewSchedule.service.js` (`buildRecordingNotice`, `ensureRecordingNotice`, wired into
both send paths), `jobs/interviewRecordings.js` (`flagMissingRecordings`,
`purgeExpiredRecordings`, daily retention cron), `onedrive.service.js` (`deleteDriveItem`),
`config/index.js` (`MS_RECORDING_RETAIN_MONTHS`), all four env files,
`src/tests/unit/recordingNotice.test.js` (new, 10 tests), `MS-GRAPH-SETUP-FOR-IT.md` §3a.

**The consent notice is applied at SEND time, not in the template.** Same reasoning as
`ensureTeamsBlock`: the modal compiles a preview before the meeting exists, and the recruiter-edited
copy that comes back would otherwise carry no notice. Applying it at send means a recruiter cannot
delete the consent line by editing the body — accidentally or otherwise. It is gated on the
booking's OWN `record_auto_applied_at`, so an email never warns about a recording that is not
actually going to happen, and never stays silent about one that is.

Two audiences, two texts. The candidate gets purpose, audience and retention ("deleted within 12
months of your application closing") plus a way to object before the interview. The panel gets the
operational half: recording is automatic, **do not stop it**, and — because the candidate is an
attendee and therefore cannot share their screen — how to promote them mid-call.

**Missing-recording detection** only considers rounds we actually configured to record
(`record_auto_applied_at` set), that we have actually looked for (`recording_checked_at` set), and
that a human confirmed happened (`occurrence_status = 'held'`), 6 hours after the end. Each of
those three conditions removes a class of false alarm: rounds predating the feature, a Graph
outage being reported as interviewers failing to record, and no-shows being chased for footage of
a meeting nobody attended. `recording_status='missing'` is both the verdict and the
once-only guard.

**Retention** is keyed on `rpa_candidate_pipeline.closed_at`, so an open journey's recordings are
never touched however old — a candidate still in play is still being decided on. The row survives
as `archive_status='purged'`: deleting it would erase the evidence that a recording existed and
was disposed of on schedule, which is the part an auditor asks about. `graph_content_url` is
cleared at the same time, since the Teams original is long gone by then and leaving it would offer
a Play button that could only fail.

It is scheduled **before** the discovery gates in `startInterviewRecordingJob()`, deliberately: the
deletion promised in the invite email does not lapse because capture was switched off. An
environment that has stopped capturing is the one most likely to be sitting on old video nobody
watches.

The notice wording and `MS_RECORDING_RETAIN_MONTHS` are pinned together by a test — the invite
quotes 12 months and the purge enforces it, and those two numbers must not drift apart.

Phases 1–4 deliver the business ask (recording happens, link is visible to the right people).
Phase 5 is what makes it durable. **~8–9 working days** after the grants land.

### 11.7 Share link — "Copy link" next to Watch (2026-09-02)

Requirement 6's second half ("so a recruiter can share it with Sanghamitra / Abhijit") had no
button: the drawer and the scorecard report could *play* a recording but offered nothing to paste
into an email. Every recording row now carries **Watch** and **Copy link** as one joined control,
on every recorded round — `tech1`, `tech2`, `tech3`, `hr_round`, `ceo` — in both surfaces.

Files: `PipelineDrawer.jsx` (`recordingShareLink`, `copyToClipboard`, `stageKeyLabel`,
`RoundRecordings`, drawer-level `RecordingPlayerModal` + `focusRecordingId`), `Pipeline.jsx`
(`?recording=` param), `theme/index.css` (`.cp-recording-copy`).

**What gets copied is deliberately NOT the stream URL.**
`pipelineService.recordingStreamUrl()` puts the viewer's own JWT in the query string, because a
`<video>` element cannot send an `Authorization` header (§11.4). Mailing that URL would hand the
recipient the sender's entire session, let anyone it is forwarded to watch without signing in, and
record every one of those views against the wrong person. Access was left broad (§0.4) *on the
understanding that viewing is audited* — a shareable stream URL would quietly cancel the one
control that decision rests on.

The button copies a deep link into the app instead — `/pipeline?candidate=<id>&recording=<id>` —
which is exactly what §6.4 called for ("the recruiter shares the ATS page, not a OneDrive link").
The recipient signs in as themselves, the recruiter-tier gate applies to them, and the audit row
names whoever actually pressed play. It also sidesteps §3.6's external-access problem: a forwarded
OneDrive link would simply 403 for anyone outside the tenant.

Three details worth keeping:

- **The drawer validates the id against the recordings list before opening the player.** A
  recording id in a forwarded URL is not trustworthy, and the list is already scoped to the
  journey — the same reason `getRecordingForStream()` scopes by `pipeline_id` as well as `id`.
- **A recipient below recruiter tier gets no player at all.** The list query 403s, so nothing
  opens — the same silent answer the round panels give them, rather than a modal that could only
  fail to play.
- **`copyToClipboard()` falls back to the legacy `execCommand` path.** `navigator.clipboard` is
  undefined on a plain-http origin, and the older helper in `TeamsDetails` silently does nothing
  there — a copy button that appears to work and doesn't is worse than none.

Also fixed alongside: the report's "Interview recordings" card (rounds with no scorecard at all)
labelled itself with the raw stage key, so a recruiter read "hr_round". `stageKeyLabel()` maps the
keys to the names in `seed-pipeline-stages.js`.

---

## 12. Verification plan

1. **Meeting options**: book a round with `MS_MEETING_RECORD_AUTO=true`; open the event in
   Outlook → Meeting options → confirm "Record and transcribe automatically" is on and
   "Who can present" = People in my organization. Then `GET` the onlineMeeting and assert
   `recordAutomatically: true`.
2. **Reschedule**: move the round; re-`GET`; assert the flag survived and the join URL did not
   change.
3. **Live run**: two people join for >60s; confirm recording starts with no human action, and
   that a non-org participant has no Stop control.
4. **Discovery**: within ~15 min of the meeting ending, `rpa_interview_recording` has a row and
   the drawer shows Play.
5. **Archive**: MP4 lands in `Interview Recordings/<candidate>/`, byte size matches, playback
   from the ATS proxy seeks correctly.
6. **Gating**: a user without the module gets 403 on the list/stream endpoints; the dossier
   response for that user contains no recording fields; the tokenised scorecard page contains
   none either.
7. **Missing path**: hold a round with recording disabled → alert fires exactly once,
   `recording_status='missing'`.
8. **Idempotency**: run the sweep twice → no duplicate rows (unique `graph_recording_id`), no
   duplicate alerts.

---

## 13. Open items

All five design decisions are settled (§0). What remains is external:

| # | Item | Owner | Status | Blocks |
|---|---|---|---|---|
| 1 | `OnlineMeetingRecording.Read.All` | IT | ✅ **granted and VERIFIED WORKING 2026-09-01** — a live `GET /onlineMeetings/{id}/recordings` returned HTTP 200. Phase 2 is unblocked. | — |
| 1b | `OnlineMeetingTranscript.Read.All` | IT | ⚠️ **granted, but still 403: "Graph API access to transcripts is disabled for this tenant."** This is NOT a permissions problem — it is a *separate tenant switch* Microsoft began enforcing on 31 Jul 2026, **off by default**. Fix: Teams admin center → **Meetings → Meeting settings → Transcript API access → Microsoft Graph access = On**, or `Set-CsTeamsMeetingConfiguration -Identity Global -EnableGraphTranscriptAccess $true -EnableAttributedTranscripts $true`. There is no code-side workaround. | Transcript capture only — recording is unaffected |
| 2 | Teams meeting-policy values | IT | ✅ **done 2026-09-01** (§3.5) | — |
| 3 | Confirm which mailbox organizes (§8.1); if not `pkmondal@aapnainfotech.com`, extend the application access policy to it | Pankaj + IT | ⏳ assumed unchanged | Phase 1 |
| 4 | OneDrive quota headroom on the organizer mailbox — **now more important**: with expiry Off, nothing is ever reclaimed | IT | ⏳ | Phase 5 |
| 5 | Sign-off on the candidate recording notice, incl. the 12-month retention statement | Pankaj / HR | ⏳ | Phase 6 |
| 6 | Decide whether the archive is worth it *given* expiry is Off | Pankaj | ✅ **yes — built and verified**; `Recordings_ATS` chosen as the folder | — |

### 13.1 Built but never exercised

Honest separation, because "the code exists" and "we have seen it work" are different
claims and only the second is worth relying on.

| Path | State |
|---|---|
| Auto-record on booking | ✅ **proven** — live call, both clients showed the recording banner |
| Discovery sweep | ✅ **proven** — linked the real recording, `recording_status='available'` |
| Archive to `Recordings_ATS` | ✅ **proven** — 1,501,627 bytes, matches source exactly |
| Playback from the archive | ✅ **proven at the Graph layer** — HTTP 206, `video/mp4`, seeking works |
| Playback **through the ATS player in a browser** | ⚠️ **never confirmed.** The upstream is proven and the buttons render, but nobody has reported the video actually playing. The `?token=` query-string auth path in particular has not been exercised end to end. |
| Role gate (403 for a vendor) | ⚠️ unit-tested only; no vendor account has hit the endpoint |
| Audit row on view | ⚠️ never written — no one has played a recording through the app yet |
| Consent notice in a real email | ⚠️ unit-tested only; **no sent invitation has yet carried it** (the notice was added after the last booking) |
| `flagMissingRecordings` | ⚠️ never fired — needs a held round, 6h old, with no recording |
| `purgeExpiredRecordings` | ⚠️ never run — needs a journey closed 12+ months ago |
| Settings card | ⚠️ built; not yet confirmed visible by anyone |

None of these are known-broken. They are simply untested paths, and the first three are the
ones worth deliberately exercising before this is relied on in production.

**Phase 1 is unblocked.** `OnlineMeetings.ReadWrite.All` is granted, the meeting policy is
correct, and the application access policy covers the current mailbox — auto-recording can be
built and tested today.

---

## Sources (Microsoft Learn, checked 2026-09-01)

- onlineMeeting resource (`recordAutomatically`, `allowedPresenters`, `allowRecording`, `allowTranscription`) — https://learn.microsoft.com/en-us/graph/api/resources/onlinemeeting?view=graph-rest-1.0
- Update onlineMeeting (app permission `OnlineMeetings.ReadWrite.All`, application access policy) — https://learn.microsoft.com/en-us/graph/api/onlinemeeting-update?view=graph-rest-1.0
- callRecording resource — https://learn.microsoft.com/en-us/graph/api/resources/callrecording?view=graph-rest-1.0
- List recordings (`OnlineMeetingRecording.Read.All`, meeting-expiry limitation) — https://learn.microsoft.com/en-us/graph/api/onlinemeeting-list-recordings?view=graph-rest-1.0
- getAllRecordings by organizer + delta — https://learn.microsoft.com/en-us/graph/api/onlinemeeting-getallrecordings?view=graph-rest-1.0
- Teams export APIs (licensing, sizes, MP4/VTT formats, availability guarantees) — https://learn.microsoft.com/en-us/microsoftteams/export-teams-content
- Recording storage & permissions in OneDrive/SharePoint (organizer's OneDrive, fallback chain, 21-day async storage, ~400 MB/hour) — https://learn.microsoft.com/en-us/microsoftteams/tmr-meeting-recording-change
- Manage Teams recording policies (`AllowCloudRecording`, `ExplicitRecordingConsent`, Copilot interaction, external participants cannot record) — https://learn.microsoft.com/en-us/microsoftteams/meeting-recording
