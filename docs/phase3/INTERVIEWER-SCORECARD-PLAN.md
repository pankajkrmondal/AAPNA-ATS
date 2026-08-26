# Interviewer Scorecard + Interview-Occurrence Gate — Architecture & Plan

**Status:** Design only — no application code is changed by this document.
**Date:** 2026-07-25
**Module:** Phase 3 — Module 3 (interview scorecards), building on Module 2
(interview scheduling, `rpa_interview_schedule`).

---

## 1. Context — why we are building this

Today the "Interviewer scorecard — Interview Evaluation Format" seen in the
prototype exists **only as a client-side mockup** in
[frontend/src/pages/CandidatePipelinePrototype.jsx](../../frontend/src/pages/CandidatePipelinePrototype.jsx)
(route `/candidate-pipeline-prototype`). Its `submitScorecard()` handler
(~line 1396) only mutates local React state — nothing is persisted. The real
pipeline drawer
([frontend/src/components/pipeline/PipelineDrawer.jsx](../../frontend/src/components/pipeline/PipelineDrawer.jsx))
deliberately shows *"Not available yet — needs Module 2/3 (scheduling/scorecards)"*.
There is **no scorecard/feedback table** in the schema — the analytics service even
hard-codes `awaitingFeedback = 0` with a TODO referencing a future
`rpa_interview_feedback` table
([backend/src/services/pipeline.service.js](../../backend/src/services/pipeline.service.js) ~line 774).

### Goals

1. **Persist** every scorecard given from **Tech Round 1 → CEO/Final** (designed to
   extend to Tech2, Tech3, Client) so it can be reported per candidate later.
2. **Report** per candidate — pull the sum/average of all round scores and show it
   on the UI from anywhere.
3. **Auto-deliver a no-login, tokenized scorecard link** to the
   Interviewer / HR / CEO **after the interview ends**, per candidate + round. The
   link needs **no authentication**, is **single-use** (expires after one submit),
   and records **who submitted and when**.
4. **CRITICAL safeguard:** never send a scorecard for an interview that did not
   actually happen (candidate no-show, panel busy, or network failure). The
   scorecard is released **only** once the interview is confirmed to have occurred.

### The occurrence problem (goal 4)

An interview can fail to happen for reasons the system cannot see:

1. Candidate forgets / doesn't join.
2. Interviewer / HR / CEO is pulled into another task and never joins.
3. Network / internet failure prevents the call.

In all three, the booking stays `status = 'scheduled'` (nobody cancelled it) and
`scheduled_end_at` still passes on the clock — so a naive "send after end time"
sweep would email a scorecard for an interview that never occurred, asking an
interviewer to score a candidate they never met. **A time-based auto-send is
therefore unsafe on its own.** The scorecard must be gated on a positive
"the interview happened" signal.

### What the system can and cannot know today (verified against the code)

- **`rpa_interview_schedule.status`** only ever holds `scheduled` or `cancelled`.
  Nothing sets `completed`/`no_show`/`attended`. It is a free-text `VARCHAR(30)`
  (no enum / CHECK), so new states need **no migration** — code only.
- **No attendance detection of any kind exists.** No Graph attendance call, no
  "mark held", no post-interview UI. The drawer offers only Schedule / Reschedule /
  Cancel; the scheduled segment is the static line *"Awaiting the interview &
  feedback"* ([PipelineDrawer.jsx:442](../../frontend/src/components/pipeline/PipelineDrawer.jsx#L442)).
- **Email open/reply signals are too weak** to prove attendance (a candidate can
  reply "see you there" and still no-show) — and interview invite mail isn't even
  tracked today. Not usable as a gate.
- **Microsoft Graph Teams attendance IS the strong signal.** The tenant admin has
  granted `Calendars.ReadWrite` and `OnlineMeetings.Read.All`; §5 lists the exact
  remaining requirements (one more permission + a policy + a small code gap).
- **Interviewers are free-text emails, not ATS users** — confirmed in the header of
  [interviewSchedule.service.js](../../backend/src/services/interviewSchedule.service.js) —
  which is exactly why a tokenized no-login link is required.

### Decisions confirmed with the requester

| Topic | Decision |
|---|---|
| **Occurrence gate** | Scorecard link is sent **ONLY** after the interview is confirmed to have occurred (`status='completed'`). No confirmation ⇒ no scorecard, ever. |
| **Who confirms** | **Either** the recruiter/HR (in the ATS) **or** the interviewer (via the no-login link) — whoever acts first sets the occurrence state. |
| **No-show** | No scorecard. Record which side missed + reason as an audit event, then prompt **Reschedule** or **Reject/withdraw**. |
| **Graph attendance** | Use it as the automatic occurrence signal (tenant granted the calendar/meeting permissions); human confirmation is the always-available fallback. |
| **Dispatch idempotency** | Manual button **and** the sweep converge on one status transition; the scorecard link is dispatched **exactly once** (`scorecard_dispatched_at` guard). |
| **Token** | DB-stored one-time token per recipient (UUID + `expires_at` + `used_at` + submitter tracking), mirroring `rpa_email_tracking.tracking_token`. |
| **Round coverage** | Architect for all rounds (tech1–3, hr_round, ceo, client). Works now for `tech1`/`tech2` (the only currently-schedulable stages); others activate as scheduling is extended. |
| **Skills** | Flexible skill rows — one scorecard → many skill-rating rows. UI renders **one** skill now; schema grows to N with zero migration. |

---

## 2. How this maps onto the existing DB

The candidate→round→interview chain already exists:

```
rpa_shortlisted_candidates (candidate in a process)
  └─< rpa_candidate_pipeline (id = the "journey")   ← current_stage_key → rpa_pipeline_stages.stage_key
        └─< rpa_interview_schedule (id = a booked interview for one round)
              scheduled_start_at / scheduled_end_at  ← the planned window
              interviewer_email (comma-separated panel), interviewer_name (free text)
```

**Anchor:** each scorecard hangs off **`rpa_interview_schedule.id`** and
additionally denormalizes `pipeline_id` + `stage_key`, so per-candidate report
queries never join through the schedule. Round keys come from `STAGE_KEYS` in
[backend/src/config/pipelineStages.js](../../backend/src/config/pipelineStages.js)
(`tech1`, `tech2`, `tech3`, `hr_round`, `ceo`, `client`, …).

---

## 3. The occurrence gate — three converging signals, one gate

An interview leaves `scheduled` for a terminal occurrence state via any of three
paths. Whichever fires first wins; the `rpa_interview_schedule.status` transition
is the single idempotency gate that both releases the scorecard and blocks
duplicate work.

```
                    ┌───────────────────── status transition (the gate) ─────────────────┐
                    │                                                                     │
 [A] Graph attendance sweep  ─┐                                                           ▼
     (auto, strong signal)    │                                              status = 'completed'  → dispatch scorecard (once)
 [B] Human confirm "Held"    ─┼──► markInterviewOccurrence(scheduleId, …) ──► status = 'no_show'   → NO scorecard; prompt reschedule/reject
     (recruiter OR interviewer)│                                             (stays 'scheduled'     → nudge only, keep waiting)
 [C] Time sweep after end     ─┘                                              if still unconfirmed)
     (nudge-to-confirm, NEVER auto-sends a scorecard)
```

- **Scorecard dispatch keys off `status='completed'` ONLY.** `no_show` and
  `scheduled` never release a link.
- **The time-based sweep never auto-sends a scorecard** — with Graph enabled it
  pulls the attendance report to decide; otherwise it emails a *confirmation nudge*.

### [A] Graph Teams attendance — the automatic occurrence signal

**Already granted:** `Calendars.ReadWrite`, `OnlineMeetings.Read.All`.
**Still required for attendance reports** (verified against Microsoft Graph docs):

1. **`OnlineMeetingArtifact.Read.All`** (application) — the specific permission the
   attendance-report API needs; `OnlineMeetings.Read.All` alone is not enough.
2. **An application access policy** (`New-CsApplicationAccessPolicy` /
   `Grant-CsApplicationAccessPolicy`) authorizing the app to read meetings on
   behalf of the organizer mailbox (`config.microsoft.calendarMailbox`). App-only
   attendance reads are per-user via this policy or they 403.
3. **Capture the `onlineMeeting.id` at booking.** Today
   [graphCalendar.service.js:78](../../backend/src/services/graphCalendar.service.js#L78)
   reads `created.onlineMeeting?.joinUrl` but **discards `created.onlineMeeting?.id`**,
   which is the id the attendance endpoint's path needs.
4. **`MS_CALENDAR_ENABLED=true`** so events/meetings are actually created.

**Endpoints (v1.0, app permission):**
- Resolve the meeting id when not captured at booking:
  `GET /users/{organizerId}/onlineMeetings?$filter=JoinWebUrl eq '{teams_join_url}'`
- Read attendance after the meeting ends:
  `GET /users/{organizerId}/onlineMeetings/{onlineMeetingId}/attendanceReports`
  → each report has `totalParticipantCount`, `meetingStartDateTime/EndDateTime`;
  drill into `.../attendanceReports/{id}` for `attendanceRecords[]`
  (`emailAddress`, `totalAttendanceInSeconds`, join/leave times).

**Occurrence decision:** the interview *occurred* when a report exists **and** both
the candidate side and at least one interviewer/panel side have a record with
meaningful duration (`≥ MS_ATTENDANCE_MIN_SECONDS`, to ignore an accidental
10-second join). Otherwise `no_show`. This distinguishes candidate-absent
(no candidate record), panel-absent (no interviewer record), and network-failure
(no/very-short overlap). Reports exist only after the meeting ends and only to the
organizer — the recruitment mailbox that created the event — so the app (via the
access policy) can read them.

### [B] Human confirmation — always-available fallback (either side)

- **Recruiter/HR (ATS):** drawer control next to Reschedule/Cancel once
  `scheduled_end_at` has passed — **"Mark as Held"** / **"Mark No-show"**.
- **Interviewer (no-login link):** the tokenized page opens on a **gate question**
  first — *"Did the interview with {candidate} take place?"* → **Yes, we met**
  reveals the scorecard form; **No / didn't happen** records a no-show and closes
  the link without a scorecard.

Whichever acts first calls the same service function; the other path then shows the
already-resolved state.

### [C] Time-based sweep — nudge only, never auto-send

Inverts the reminder-sweep window: rows where `scheduled_end_at < now − graceMin`
**and** `status='scheduled'` **and** `occurrence_nudge_at IS NULL`. For each:
- **Graph enabled:** try path [A] to resolve automatically; stamp
  `attendance_checked_at`.
- **Else / report not ready:** send a **confirmation nudge** to the recruiter +
  interviewer ("Please confirm whether this interview happened") linking to the
  drawer / interviewer gate link. It **does not** send a scorecard. Stamp
  `occurrence_nudge_at` (idempotency).

---

## 4. Data model changes (additive, non-destructive)

Follow the repo workflow: **hand-write DDL, never edit `schema.prisma`**, then
`cd backend && npx prisma db pull && npx prisma generate` (per the header of
[backend/prisma/ddl/2026-07-23-interview-scheduling.sql](../../backend/prisma/ddl/2026-07-23-interview-scheduling.sql)).

### 4.1 Occurrence columns on `rpa_interview_schedule`

New file `backend/prisma/ddl/2026-07-25-interview-occurrence.sql`:

```sql
ALTER TABLE rpa_interview_schedule
  ADD COLUMN IF NOT EXISTS online_meeting_id        VARCHAR(512),   -- captured at booking (attendance path key)
  ADD COLUMN IF NOT EXISTS occurrence_status        VARCHAR(20),    -- NULL | 'held' | 'no_show'  (NULL = unresolved)
  ADD COLUMN IF NOT EXISTS occurrence_source        VARCHAR(20),    -- 'graph' | 'recruiter' | 'interviewer'
  ADD COLUMN IF NOT EXISTS occurrence_confirmed_by  VARCHAR(255),   -- ATS username or interviewer email
  ADD COLUMN IF NOT EXISTS occurrence_confirmed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_show_party            VARCHAR(20),    -- 'candidate' | 'panel' | 'both' | 'technical'
  ADD COLUMN IF NOT EXISTS no_show_reason           TEXT,
  ADD COLUMN IF NOT EXISTS occurrence_nudge_at      TIMESTAMPTZ,    -- sweep nudge idempotency
  ADD COLUMN IF NOT EXISTS attendance_checked_at    TIMESTAMPTZ,    -- last Graph attendance poll (idempotency)
  ADD COLUMN IF NOT EXISTS scorecard_dispatched_at  TIMESTAMPTZ;    -- scorecard links sent once
```

`status` values (no migration — free-text VarChar): `scheduled` (existing) →
`completed` (held; scorecard released) **or** `no_show` (blocked). `cancelled`
unchanged. `occurrence_status='held'` ⇒ `status='completed'`;
`occurrence_status='no_show'` ⇒ `status='no_show'`.

### 4.2 Scorecard tables

New file `backend/prisma/ddl/2026-07-25-interviewer-scorecard.sql`.

**`rpa_interview_scorecard`** — one row per (interview × recipient token):

```sql
CREATE TABLE IF NOT EXISTS rpa_interview_scorecard (
  id                 BIGSERIAL PRIMARY KEY,
  schedule_id        BIGINT NOT NULL REFERENCES rpa_interview_schedule (id) ON DELETE CASCADE,
  pipeline_id        BIGINT NOT NULL REFERENCES rpa_candidate_pipeline (id) ON DELETE CASCADE,  -- denormalized for reports
  stage_key          VARCHAR(50) NOT NULL REFERENCES rpa_pipeline_stages (stage_key),           -- denormalized for reports
  card_type          VARCHAR(20) NOT NULL DEFAULT 'technical',  -- 'technical' | 'hr' (HR round has its own card, Q18)

  -- Recipient identity (free-text; NOT an ATS user)
  recipient_email    VARCHAR(255) NOT NULL,
  recipient_name     VARCHAR(150),
  recipient_role     VARCHAR(20) NOT NULL DEFAULT 'interviewer',  -- 'interviewer' | 'hr' | 'ceo'

  -- Tokenized no-login link (single-use)
  token              UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  token_expires_at   TIMESTAMPTZ NOT NULL,   -- e.g. now()+7d at dispatch
  sent_at            TIMESTAMPTZ,
  opened_at          TIMESTAMPTZ,

  -- Shared card ratings (0.0–5.0, half-steps)
  communication      NUMERIC(2,1),
  attitude           NUMERIC(2,1),
  final_rating       NUMERIC(2,1),
  recommendation     VARCHAR(20),            -- 'approve' | 'hold' | 'reject' (advisory; RT still decides)
  comments           TEXT,
  recording_url      TEXT,

  -- HR-card-only fields (used when card_type='hr')
  hr_notice_period   VARCHAR(100),
  hr_current_ctc     VARCHAR(100),
  hr_expected_ctc    VARCHAR(100),
  hr_relocation      VARCHAR(100),
  hr_strengths       TEXT,

  -- Submission tracking (the "who + when" requirement)
  status             VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending' | 'submitted' | 'expired'
  submitted_at       TIMESTAMPTZ,
  submitted_ip       VARCHAR(64),
  avg_score          NUMERIC(3,2),           -- computed on submit

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scorecard_schedule ON rpa_interview_scorecard (schedule_id);
CREATE INDEX IF NOT EXISTS idx_scorecard_pipeline ON rpa_interview_scorecard (pipeline_id);
CREATE INDEX IF NOT EXISTS idx_scorecard_pipeline_stage ON rpa_interview_scorecard (pipeline_id, stage_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scorecard_live_recipient
  ON rpa_interview_scorecard (schedule_id, recipient_email) WHERE status <> 'expired';
```

**`rpa_interview_scorecard_skill`** — flexible skill rows (renders one today,
Skill 4/5 later with no migration):

```sql
CREATE TABLE IF NOT EXISTS rpa_interview_scorecard_skill (
  id            BIGSERIAL PRIMARY KEY,
  scorecard_id  BIGINT NOT NULL REFERENCES rpa_interview_scorecard (id) ON DELETE CASCADE,
  skill_label   VARCHAR(150) NOT NULL,   -- e.g. "Selenium with Java" (from MRF mandatory_skills, or free text)
  rating        NUMERIC(2,1),            -- 0.0–5.0 half-steps
  remark        VARCHAR(255),
  sort_order    INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_scorecard_skill_card ON rpa_interview_scorecard_skill (scorecard_id);
```

> After the DDL runs, `prisma db pull` regenerates the models + columns +
> relations (`rpa_interview_schedule.rpa_interview_scorecard[]`, etc.) automatically.

---

## 5. Backend implementation

### 5.1 Extend `interviewSchedule.service.js`

- **Capture `onlineMeeting.id`:** have `createInterviewEvent`
  ([graphCalendar.service.js:76-81](../../backend/src/services/graphCalendar.service.js#L76-L81))
  also return `created.onlineMeeting?.id`; persist to
  `rpa_interview_schedule.online_meeting_id` in `scheduleInterviewRound` /
  `rescheduleInterviewRound`. No behavior change when calendar is off (stays null).
- **`markInterviewOccurrence(scheduleId, { outcome, source, actedBy, party, reason })`**
  — the convergence point for paths [A]/[B]/[C]. Idempotent (returns unchanged if
  `occurrence_status` already set). On `held`: set `status='completed'` +
  occurrence fields, write an `rpa_pipeline_stage_events` note, then call scorecard
  dispatch (guarded by `scorecard_dispatched_at`). On `no_show`: set
  `status='no_show'`, record `no_show_party`/`no_show_reason`, audit note, **no
  scorecard**, surface reschedule/reject to the caller. Reuse the existing
  stage-event audit pattern in this service.

### 5.2 New scorecard service — `backend/src/services/interviewScorecard.service.js`

- **`dispatchScorecards(scheduleId, { actedBy, trigger })`** — idempotent send.
  Guard on `scorecard_dispatched_at`. Parse `interviewer_email` via the existing
  **`parseInterviewerEmails()`**
  ([interviewSchedule.service.js:105](../../backend/src/services/interviewSchedule.service.js#L105)).
  Determine `card_type`/`recipient_role` from `stage_key` (`hr_round`→hr,
  `ceo`→ceo). Pre-seed one skill row from `mrf.mandatory_skills` (or a single blank
  "Overall skill"). Create one `rpa_interview_scorecard` per recipient (fresh UUID,
  `token_expires_at=now()+7d`, `sent_at=now()`). Stamp `scorecard_dispatched_at`.
  Email each recipient the link (see §5.5). Write a stage-event note.
- **`getScorecardByToken(token)`** — public read. Validate UUID (reuse the
  `UUID_RE` idea from
  [tracking.controller.js:11](../../backend/src/controllers/tracking.controller.js#L11));
  load candidate/position/round/interviewer context (read-only, pre-filled); reject
  when `status='submitted'` (used) or expired (→ set `status='expired'`); stamp
  `opened_at`. Also returns the interview's occurrence state so the page can show
  the **gate question** when unresolved.
- **`submitScorecardByToken(token, payload, { ip })`** — public write. Re-check
  not-used/not-expired (single-use), validate ratings 0–5 half-steps and
  `recommendation ∈ {approve,hold,reject}`; upsert skill rows, write fields, compute
  `avg_score`, set `status='submitted'`, `submitted_at`, `submitted_ip`. Token dies.
- **`getCandidateScorecardReport(pipelineId)`** — per-round submitted scorecards +
  overall `sum`/`average` across Tech1→CEO. Single query for the report UI + future
  analytics.

### 5.3 New Graph attendance service — `backend/src/services/graphAttendance.service.js`

Mirrors `graphCalendar.service.js` (best-effort, never throws, shared
`getAccessToken()`, gated on `calendarEnabled` + new `attendanceEnabled`):
- **`resolveOnlineMeetingId(joinUrl)`** — `$filter=JoinWebUrl eq …` for legacy rows.
- **`getAttendanceOutcome(scheduleRow)`** — pulls reports, applies the
  min-duration / both-sides rule, matches `attendanceRecords[].emailAddress` against
  the candidate email + `interviewer_email` list, returns `{ occurred, records }`.
- New config in [config/index.js](../../backend/src/config/index.js) microsoft
  block: `MS_ATTENDANCE_ENABLED`, `MS_ATTENDANCE_MIN_SECONDS`, with a doc-comment
  noting the required `OnlineMeetingArtifact.Read.All` + application access policy.

### 5.4 New sweep job — `backend/src/jobs/interviewOccurrence.js`

Modeled on [interviewReminder.js](../../backend/src/jobs/interviewReminder.js)
(same `node-cron` + `rpa_settings` interval + start/stop/restart, registered from
`server.js`). Per tick: rows with `scheduled_end_at < now − graceMin`,
`status='scheduled'`, `occurrence_nudge_at IS NULL`:
1. Attendance enabled → `getAttendanceOutcome` → `markInterviewOccurrence`
   (`source:'graph'`) when decisive; stamp `attendance_checked_at`.
2. Else / indecisive → send the **confirmation nudge**, stamp
   `occurrence_nudge_at`. **Never sends a scorecard.**
Settings keys `interview_occurrence_enabled` / `_interval_min` / `_grace_min`
surfaced via the
[settings.controller.js](../../backend/src/controllers/settings.controller.js) +
[settings.routes.js](../../backend/src/routes/settings.routes.js) pattern.

### 5.5 Routes / controllers / emails

- **Private** (existing auth in
  [pipeline.routes.js](../../backend/src/routes/pipeline.routes.js), registered
  before `/:id` like `/interview/:scheduleId/cancel`):
  - `POST /api/pipeline/interview/:scheduleId/occurrence` — `{ outcome:'held'|'no_show', party?, reason? }`, `source:'recruiter'`.
  - `POST /api/pipeline/interview/:scheduleId/send-scorecard` — manual dispatch (only meaningful once `completed`).
  - `GET  /api/pipeline/:id/scorecard-report` — the report aggregation.
- **Public** (NO auth, new `backend/src/routes/scorecard.routes.js` mounted next to
  `/track` in [routes/index.js](../../backend/src/routes/index.js), mirroring
  [tracking.routes.js](../../backend/src/routes/tracking.routes.js) /
  [mrf.routes.js](../../backend/src/routes/mrf.routes.js)):
  - `GET  /api/scorecard/:token` — form data + gate state (no login).
  - `POST /api/scorecard/:token/occurrence` — interviewer confirms held/no-show (`source:'interviewer'`).
  - `POST /api/scorecard/:token/submit` — one-time submit (only after `held`). Optionally gate with Turnstile (`config.turnstile.secretKey`, empty = disabled).
- **Emails** — add to
  [seed-email-templates.js](../../backend/prisma/seed-email-templates.js)
  (`category:'interview'`, idempotent upserts): **`Scorecard Invitation —
  Interviewer`**, **`Scorecard Invitation — HR/CEO`**, and **`Interview — Please
  Confirm It Happened`**. Link = `${config.cors.frontendUrl}/scorecard/${token}`.
  Send via existing **`sendGraphEmail`** + **`compileTemplate`**
  ([emailNotification.service.js:29](../../backend/src/services/emailNotification.service.js#L29)) —
  a near-copy of the existing panel-email flow. Add recipient keys
  **`scorecardInvite`** and **`occurrenceNudge`** (both `dynamic:true`) to
  [emailRecipients.js](../../backend/src/config/emailRecipients.js) — required, or
  `resolveRecipients` warns + redirects.

---

## 6. Frontend implementation

### 6.1 Drawer occurrence + scorecard controls — `PipelineDrawer.jsx`

At the scheduled segment
([PipelineDrawer.jsx:442](../../frontend/src/components/pipeline/PipelineDrawer.jsx#L442))
and the action row next to Reschedule/Cancel
([PipelineDrawer.jsx:1013-1027](../../frontend/src/components/pipeline/PipelineDrawer.jsx#L1013-L1027)),
once `scheduled_end_at` is past and `occurrence_status` is unresolved:
- **"Mark as Held"** → `POST …/occurrence {outcome:'held'}` (releases scorecard; a
  "Scorecard link sent" state then shows and won't re-send).
- **"Mark No-show"** → modal picks `party` + reason → `{outcome:'no_show'}`; on
  success offer **Reschedule** (existing modal) or **Reject** (existing outcome
  modal). No scorecard.
- Segment text reflects state (*Awaiting confirmation* → *Held — scorecard sent* /
  *No-show ({party}) — reschedule or reject*).
- **Scorecard report panel** → `GET /api/pipeline/:id/scorecard-report`, showing
  per-round scores + overall average/sum (goal 2). New methods in
  [frontend/src/services/pipeline.js](../../frontend/src/services/pipeline.js).

### 6.2 Public tokenized page — `frontend/src/pages/InterviewScorecard.jsx`

Route `/scorecard/:token` in
[frontend/src/App.jsx](../../frontend/src/App.jsx), **public** and wrapped in
`<ForceLight>` (the exact pattern already used for `/mrf/:id/approve`). It **opens
on the gate question** — *"Did the interview take place?"*:
- **Yes, we met** → reveals the scorecard card: **one** Skill row (star rating +
  remark, array-shaped for future N), Communication / Attitude / Final rating /
  Status (Approve·Hold·Reject) / comments / recording link (lifted from the
  prototype modal
  [CandidatePipelinePrototype.jsx ~2115](../../frontend/src/pages/CandidatePipelinePrototype.jsx#L2115)).
  When `card_type='hr'`, render the HR variant (notice/CTC/relocation/strengths).
  Submit once → "thank you, this link is now closed". Re-opening an already-used /
  expired token shows a friendly closed message (no form).
- **No / didn't happen** → posts a no-show and shows "recorded — recruiter will
  follow up". A scorecard can never be submitted through a link whose interview was
  marked no-show.

> The `/candidate-pipeline-prototype` mockup can remain as reference; real behavior
> now lives in the drawer + the public page.

---

## 7. End-to-end flow

1. Book Tech1/Tech2 (existing) → row `scheduled`; if calendar on, store
   `online_meeting_id`.
2. Interview time passes. Occurrence resolved by the **first** of: Graph attendance
   sweep (auto), recruiter "Mark as Held/No-show", or interviewer gate answer.
3. **Held** → `status='completed'` → scorecard link dispatched **once** per
   panelist; interviewer confirms → fills one skill + comms/attitude/final + status
   → persisted, `avg_score` computed, token dies. **No-show** → `status='no_show'`,
   audit recorded, **no scorecard**, recruiter prompted to reschedule or reject.
4. Report: `getCandidateScorecardReport(pipelineId)` aggregates every `completed`
   round Tech1→CEO into per-round rows + overall sum/average, shown in the drawer
   and available to future analytics (which already reserves `awaitingFeedback` /
   `rpa_interview_feedback`).

---

## 8. Critical files

**New**
- `backend/prisma/ddl/2026-07-25-interview-occurrence.sql`
- `backend/prisma/ddl/2026-07-25-interviewer-scorecard.sql`
- `backend/src/services/graphAttendance.service.js`
- `backend/src/services/interviewScorecard.service.js`
- `backend/src/controllers/scorecard.controller.js`
- `backend/src/routes/scorecard.routes.js` (public)
- `backend/src/jobs/interviewOccurrence.js`
- `frontend/src/pages/InterviewScorecard.jsx`

**Modified**
- `backend/src/services/graphCalendar.service.js` (return + capture `onlineMeeting.id`)
- `backend/src/services/interviewSchedule.service.js` (`markInterviewOccurrence`, store meeting id)
- `backend/src/config/index.js` (`MS_ATTENDANCE_ENABLED`, min-seconds) + `config/emailRecipients.js` (`scorecardInvite`, `occurrenceNudge`)
- `backend/src/routes/pipeline.routes.js` + `controllers/pipeline.controller.js` (occurrence, send-scorecard, report)
- `backend/src/routes/index.js` (mount `/scorecard`), `server.js` (start occurrence job), `settings.routes.js`/controller (occurrence settings)
- `backend/prisma/seed-email-templates.js` (scorecard + confirmation-nudge templates)
- `frontend/src/components/pipeline/PipelineDrawer.jsx` + `frontend/src/services/pipeline.js`
- `frontend/src/App.jsx` (public `/scorecard/:token` route)
- `backend/prisma/schema.prisma` (via `db pull` — never hand-edited)

---

## 9. Admin / ops prerequisites for the Graph attendance path

1. Tenant admin grants **`OnlineMeetingArtifact.Read.All`** (application) on the app
   registration, alongside the already-granted `Calendars.ReadWrite` +
   `OnlineMeetings.Read.All`, and admin-consents.
2. Create + assign an **application access policy** (Teams PowerShell
   `New-CsApplicationAccessPolicy` / `Grant-CsApplicationAccessPolicy`) for the
   app's client id, granted to the recruitment organizer mailbox
   (`MS_CALENDAR_MAILBOX`).
3. Set `MS_CALENDAR_ENABLED=true` and `MS_ATTENDANCE_ENABLED=true`.

> If any of these is missing, the system silently falls back to the
> human-confirmation gate — no scorecard is ever sent on a no-show either way.

---

## 10. Verification (end to end)

1. **DDL + generate:** run both DDL files, `cd backend && npx prisma db pull &&
   npx prisma generate`; confirm the new columns + scorecard models appear.
2. **Seed templates:** `node backend/prisma/seed-email-templates.js`; confirm the
   Scorecard Invitation + confirmation-nudge rows exist.
3. **Meeting-id capture:** with calendar on, book an interview; confirm
   `online_meeting_id` is stored.
4. **No-show blocks scorecard (core requirement):** book an interview, let
   `scheduled_end_at` pass with **nobody** joining. Run the occurrence sweep → with
   attendance on it resolves `no_show` from the empty report; with attendance off it
   sends a nudge and status stays `scheduled`. **Assert NO `rpa_interview_scorecard`
   row and NO scorecard email.** Then mark No-show in the drawer → status
   `no_show`, reschedule/reject offered, still no scorecard.
5. **Held releases scorecard exactly once:** mark "Held" (or feed a Graph report
   with both sides attended) → `status='completed'`, `scorecard_dispatched_at` set,
   one link email per interviewer. Repeat the action / re-run the sweep → no
   duplicate (idempotent).
6. **Either-side confirmation:** confirm via the interviewer gate link and,
   separately, via the recruiter button — both resolve the same status; the second
   path shows the already-resolved state.
7. **Public form single-use:** open `/scorecard/:token` logged-out → gate question
   first; "No" records no-show + closes; "Yes" reveals the card; submit once →
   `status='submitted'`, `submitted_at`, `avg_score`; re-open → "already submitted /
   closed"; force expiry → "expired".
8. **Report:** `GET /api/pipeline/:id/scorecard-report` returns per-round scores +
   overall average/sum; the drawer panel renders them.
9. **Frontend verify:** use the `frontend:verify` skill to build/launch and drive
   the drawer controls + the public gate page.

---

## Sources (Microsoft Graph attendance requirements)

- [List meetingAttendanceReports — Microsoft Graph v1.0](https://learn.microsoft.com/en-us/graph/api/meetingattendancereport-list?view=graph-rest-1.0)
- [Get meetingAttendanceReport — Microsoft Graph v1.0](https://learn.microsoft.com/en-us/graph/api/meetingattendancereport-get?view=graph-rest-1.0)
- [Online meeting artifacts and permissions](https://learn.microsoft.com/en-us/graph/cloud-communications-online-meeting-artifacts)
- [Allow applications to access online meetings on behalf of a user (application access policy)](https://learn.microsoft.com/en-us/graph/cloud-communication-online-meeting-application-access-policy)
