# Phase 3 — Functional Test Plan: Pipeline, Scheduling, Documents, Offer, Vendor

**Scope:** M1 (Stage Engine & Pipeline Tracker), M3a (Teams/Outlook interview scheduling +
scorecards), M4 (Document Collection), M5 (Offer Management & Closure), M6 (Placement Vendor
notifications & hardening).

**Companion document:** [`phase3-completed-items-test-plan.md`](phase3-completed-items-test-plan.md)
covers Outlook Integration, Candidate Communication Tracking, and Zeko/M2 — not repeated here.
Together the two documents are the full Phase 3 test plan; see [§0](#0-how-this-relates-to-the-rest-of-phase-3)
for how they fit and what a sign-off pass needs from each.

**Why this document exists:** [`PHASE3-MODULE-STATUS.md`](../phase3/PHASE3-MODULE-STATUS.md) §5
and the [code review](../phase3/PHASE3-CODE-REVIEW-2026-08-06.md) both name the same gap —
individual checks and 46 live runtime probes have passed, but M1/M3a/M4/M5/M6 have never had a
scripted, repeatable test pass executed and signed off. This plan is that script.

**Date:** 2026-08-17
**Environment:** Staging (`recruitmentautomationdb`, shared with dev — see deployment runbook §Environments)
**Automated coverage today:** unit tests only, no DB — `vendorNotification.test.js` (22),
`vendorIsolation.test.js` (15), `mrfClosure.test.js`, `pipelineAnalytics.test.js`. **No route,
controller, or integration test exists for any module in this document** — every test case below
is a manual/API-level pass against a live server.

---

## 0. How this relates to the rest of Phase 3

| Document | Covers | Status |
|---|---|---|
| [`phase3-completed-items-test-plan.md`](phase3-completed-items-test-plan.md) | Outlook Integration, Candidate Communication Tracking, Zeko/M2 | Written 2026-07-03; 2 items flagged as gaps, 2 partially testable |
| **This document** | M1 Pipeline, M3a Scheduling/Scorecards, M4 Documents, M5 Offer, M6 Vendor | New — closes the gap in §5 of module status |
| [`PHASE3-CODE-REVIEW-2026-08-06.md`](../phase3/PHASE3-CODE-REVIEW-2026-08-06.md) | 46 ad-hoc runtime probes, 22 defects (19 fixed) | Reference only — this plan turns the same surface into a repeatable script and adds cases the review didn't reach (M6 end-to-end, full document/offer walkthroughs, negative paths) |

A full Phase 3 sign-off pass = this document + the companion document, both executed and recorded.
§9 gives one traceability matrix mapping every "Still outstanding" line in `PHASE3-MODULE-STATUS.md`
§5 to a test case ID here.

---

## 1. Environment Setup & Prerequisites

### 1.1 Running the app

Same as the companion plan §1.1 — `npm run dev:staging` (backend, port 5000), `npm run dev`
(frontend, port 5173).

### 1.2 Required configuration

| Setting | Location | Purpose |
|---|---|---|
| `EMAIL_REDIRECT_TO_TEST=true` / `EMAIL_STAGING_RECIPIENTS` | `src/config/emailRecipients.js` | All candidate/panel/vendor email redirected to an internal inbox — **check that inbox, not the real address**, for every test below. A blank `EMAIL_STAGING_RECIPIENTS` throws rather than falling through (verified in code review §5.1) |
| `MS_ATTENDANCE_ENABLED` | `.env.staging` | If `true`, the occurrence sweep tries Teams attendance before falling back to a human nudge — confirm which mode is active before running M3a-08 |
| `interview_occurrence_enabled`, `interview_occurrence_interval_min`, `interview_occurrence_grace_min` | `rpa_settings` | Occurrence sweep cadence — defaults disabled/30min/15min; tighten for test cycles |
| `DOCUMENT_REMINDER_CRON`, `DOCUMENT_REMINDER_AFTER_DAYS`, `DOCUMENT_REMINDER_REPEAT_HOURS`, `DOCUMENT_REMINDER_MAX_COUNT` | `.env` / `config/index.js` | Defaults: daily 9am, 2 days, 24h, 3 max — tighten for test cycles |
| `OFFER_SWEEP_CRON`, `OFFER_AUTO_CLOSE_AFTER_DAYS` | `.env` / `config/index.js` | Defaults: daily 7am, 90 days |

### 1.3 Test data

1. **Test candidate(s):** ≥3 rows in `rpa_cv` with mailboxes the tester controls, at various
   points in a pipeline journey (one fresh, one mid-flow, one closed) — needed for isolation and
   race-condition cases.
2. **Test MRF:** an `rpa_mrf` row with `number_of_positions = 1` (to exercise auto-close on a
   single acceptance without needing multiple candidates) and a second with `number_of_positions
   = 2` (to exercise the "still open after one accept" path).
3. **Test vendor:** an `rpa_cv` row with `VendorEmail` set and `lockForNinetyDays` inside the
   90-day window, entered through the actual vendor upload path (`POST /api/vendor/upload`) so
   `rpa_candidate_pipeline.source = 'vendor'` gets set for real — **do not** hand-set `source` in
   SQL; that bypasses the exact code path M6 fixed (see M6-01).
4. **User accounts** at each role: `superadmin`/`admin`, `recruiter` (or `hr`), `vendor` — for the
   `requireStaff` and `enforceVendorScope` checks.
5. **DB access:** read-only SQL against staging PostgreSQL for verification queries.

---

## 2. Test Cases — M1 Stage Engine & Pipeline

Implementation: `backend/src/services/pipeline.service.js`, `backend/src/routes/pipeline.routes.js`,
`backend/src/controllers/pipeline.controller.js`, `backend/src/config/pipelineStages.js`.

### PIPE-01 — Happy-path stage advance (approve)
- **Steps:** `POST /api/pipeline/:id/outcome` with `{outcome_key: "approved"}` on a journey sitting
  on an active stage with an active next stage.
- **Expected:** 200; journey's `current_stage_key` moves to the next active stage in `sort_order`;
  a `rpa_pipeline_stage_events` row logged `'entered'`; outcome email sent (test inbox); legacy
  writeback fires (see PIPE-06).

### PIPE-02 — Reject/Hold require a reason
- **Steps:** `POST /:id/outcome` with `{outcome_key: "rejected"}` and no `reason_id`/`other_text`.
- **Expected:** 400 `"A reason is required for Reject/Hold outcomes."`
- **Steps (2):** Repeat with a `reason_id` whose `is_other=true` but no `other_text`.
- **Expected:** 400 (other-text mandatory when the reason is "Other").

### PIPE-03 — Concurrent approval race → one winner, one 409
- **Steps:** Fire two near-simultaneous `POST /:id/outcome` (or one outcome + one `/:id/advance`)
  against the same journey — script two requests with no delay, or use two browser tabs.
- **Expected:** One 200 (stage advances once, one email sent), one 409
  `"Someone else moved this candidate while you were deciding. Reopen the candidate to see where
  they are now."` Matches code review §5.2 "Two concurrent approvals → 200 + 409".
- **Verify:** Exactly one `rpa_pipeline_stage_events` row for the transition; exactly one outbound
  email logged in `rpa_email_log` for this action.

### PIPE-04 — Closed journey rejects further action → 409
- **Preconditions:** A journey with `final_outcome` set (close one via PIPE-09 first, or reuse a
  pre-closed test row).
- **Steps:** Try each of: `POST /:id/outcome`, `POST /:id/advance`, `POST /:id/closure` (again),
  `POST /:id/email`.
- **Expected:** 409 on every call — `assertJourneyOpen()` guard. Message names the action, e.g.
  *"...Reopen it before you close it."*

### PIPE-05 — Double-close race → one winner, one 409
- **Steps:** Fire two near-simultaneous `POST /:id/closure` against the same open journey (e.g.
  simulating a recruiter clicking Close at the same moment the offer sweep auto-closes it).
- **Expected:** One 200, one 409 `"This candidate's record has already been closed."` — this is
  the *second*, independent claim-then-act guard (distinct from PIPE-04's pre-check).

### PIPE-06 — Legacy writeback on outcome and closure
- **Steps:** After PIPE-01 (approve) and after a closure with `final_outcome_key: "joined"`.
- **Verify:**
  ```sql
  SELECT "FinalStatus" FROM rpa_cv WHERE id = <cv_id>;
  SELECT pipeline_status FROM rpa_shortlisted_candidates WHERE cv_id = <cv_id> ORDER BY id DESC LIMIT 1;
  ```
- **Expected:** `FinalStatus` matches `finalStatusLabelFor()` — e.g. approving at `zeko_hr` writes
  "Zeko HR Screening Approved"; closing `joined` writes "Joined". `pipeline_status` maps per
  `shortlistStatusFor()` (`approved→shortlisted`, `rejected→rejected`, `hold→on_hold`,
  `future_prospect→future_prospect`). Writeback is best-effort — confirm the main action still
  succeeds even if you temporarily break this (e.g. bad `cv_id`) by checking it's wrapped in
  try/catch, not required for a 200.

### PIPE-07 — Deactivating a stage with candidates on it → 409
- **Preconditions:** ≥1 open journey sitting on a given stage.
- **Steps:** `PUT /api/pipeline/stages/:key` with `{is_active: false}` (admin auth).
- **Expected:** 409, message names the count — *"N open candidate(s) are currently on this stage.
  Move them on before deactivating it..."*
- **Steps (2):** Move all candidates off that stage, retry.
- **Expected:** 200, stage deactivated.

### PIPE-08 — Stage/outcome/reason CRUD is admin-only
- **Steps:** As a `recruiter` user, call `POST /api/pipeline/stages`, `PUT /stages/:key`, `POST
  /stages/:key/outcomes`, `POST /reasons`.
- **Expected:** 403 on all four (`requireAdmin`). Retry as `admin`/`superadmin` → 200/201.
- **Note:** per the coverage audit, no UI screen calls these yet for stages/outcomes (only the
  Outcome Emails / Email Routing tabs shipped in M6) — this is an **API-level** test unless a
  config screen has since landed; check current frontend state before assuming API-only.

### PIPE-09 — Closure outcomes and MRF vacating
- **Steps:** Close journeys with each of the 8 final outcomes: `closure_approved`,
  `closure_rejected`, `closure_on_hold`, `candidate_withdrawn`, `joined`, `did_not_join`,
  `joined_and_left`, `backed_out`.
- **Expected:** All 8 accept and close the journey. For the 4 `VACATING_OUTCOMES`
  (`did_not_join`, `joined_and_left`, `candidate_withdrawn`, `backed_out`), `reopenMrfIfUnfilled`
  fires — verify an MRF that was filled by this candidate reopens (`rpa_mrf.filled_at` cleared) if
  now under `number_of_positions`.
- **Cross-ref:** which of these 8 actually send candidate email is governed by
  `SILENT_FINAL_OUTCOMES` and the "5 closure templates that deliberately never send" open decision
  in module status §3 #5 — confirm current behavior against whatever RT has decided since, don't
  assume "email sent" or "silent" without checking.

### PIPE-10 — JOINED freezes the vendor lock
- **Preconditions:** Test vendor candidate (§1.3.3) with an active `lockForNinetyDays`.
- **Steps:** Close their journey with `final_outcome_key: "joined"`.
- **Verify:** `SELECT "lockForNinetyDays" FROM rpa_cv WHERE id = <cv_id>;` → `'9999-12-31'`.
- **Expected:** Lock reads as still-active indefinitely (see M6-03 for the read-side check).

### PIPE-11 — Closure force-closes any open document link
- **Preconditions:** An open `rpa_document_requests` row (`token_status='active'`) on the journey.
- **Steps:** Close the journey (any final outcome).
- **Verify:** `SELECT token_status FROM rpa_document_requests WHERE pipeline_id = <id>;` → `'closed'`.
- **Expected:** Candidate can no longer upload via the old link (see DOC-08).

### PIPE-12 — Concurrent-MRF journeys for one candidate
- **Steps:** Shortlist the same candidate against two different MRFs (two `createPipelineJourney`
  calls with different `mrf_id`).
- **Expected:** Two independent `rpa_candidate_pipeline` rows, each starting fresh at `zeko_hr`,
  each with its own `rpa_shortlisted_candidates` row keyed `cv_id+mrf_id`.
- **Steps (2):** Re-shortlist the same candidate against the **same** MRF again.
- **Expected:** Idempotent — no duplicate row, the existing journey is returned.

### PIPE-13 — 6-month re-application cooling-off (blocking gate)
- **Preconditions:** A candidate with a `rpa_candidate_pipeline` row where
  `current_stage_status='rejected'` and `modified_at` within the last 6 months.
- **Steps:** Attempt to create a new journey for that candidate (shortlist again).
- **Expected:** 409 `"Candidate is in a 6-month re-application cooling-off period (rejected at
  '{stage}' on {date})."` — this is a hard block, distinct from the 90-day vendor lock (a
  search-visibility filter only, not a creation gate).

### PIPE-14 — GET /api/pipeline filters
- **Steps:** Exercise `?source=`, `?onHoldOnly=true`, `?mrfId=`, `?stuckDays=`, `?position=`,
  `?includeClosed=true` (default `false`).
- **Expected:** Default (`includeClosed` omitted) returns only `final_outcome: null` rows;
  `includeClosed=true` includes closed journeys; each filter narrows correctly and combinable.

### PIPE-15 — Approve auto-advance onto a since-deactivated stage
- **Preconditions:** A journey about to advance into a stage that gets deactivated between page
  load and submit (simulate: deactivate the next stage in `sort_order` right before approving).
- **Expected:** 409 `'Stage "..." is no longer active...'` rather than silently landing the
  candidate on a dead stage.

### PIPE-16 — skip_optional_next
- **Steps:** Approve with `{outcome_key: "approved", skip_optional_next: true}` where the
  immediate next stage is `is_optional: true`.
- **Expected:** Candidate lands 2 stages ahead; the bypassed stage gets a `'skip'` event (not
  `'entered'`) in `rpa_pipeline_stage_events`.

---

## 3. Test Cases — M3a Interview Scheduling & Scorecards

Implementation: `backend/src/services/interviewSchedule.service.js`,
`backend/src/services/interviewScorecard.service.js`, `backend/src/jobs/interviewOccurrence.js`,
`backend/src/jobs/interviewReminder.js`, `backend/src/routes/scorecard.routes.js`.

**The 6 rounds:** tech1, tech2, tech3, hr_round, ceo (all `autoInvite:true` — system emails +
Teams meeting) and **client** (`autoInvite:false` — no system email/calendar ever, HR coordinates
manually per Q14). Run every schedule/reschedule/cancel case against **both** an auto-invite round
and the client round to confirm the split.

### SCHED-01 — Schedule an interview (auto-invite round)
- **Steps:** `POST /:id/interview` on `tech1` with valid interviewer email(s), a future `start_at`.
- **Expected:** 201; `rpa_interview_schedule` row created `status='scheduled'`; Outlook calendar
  event + Teams meeting created; candidate + panel emails sent to the **test inbox** (never the
  real candidate address — confirm by reading the event back from Graph, per code review §5.1).

### SCHED-02 — Schedule on the Client round — no system send
- **Steps:** `POST /:id/interview` on `client` stage.
- **Expected:** 201, booking row created (`status='scheduled'`) — but **no** calendar event, **no**
  Teams meeting, **no** candidate/panel email. Confirm via `rpa_email_log` (no new row) and Graph
  (no new calendar event).

### SCHED-03 — Reject scheduling off-stage
- **Steps:** `POST /:id/interview` with `stage_key: "tech2"` while the journey's
  `current_stage_key` is actually `tech1`.
- **Expected:** 400 (stage mismatch).

### SCHED-04 — Reject invalid interviewer email / past date
- **Steps:** Schedule with a malformed interviewer email; separately, with `start_at` in the past.
- **Expected:** 400 on both — *"At least one interviewer's email is required..."* and *"The
  interview time is in the past."* (matches code review §5.2).

### SCHED-05 — Only one live booking per stage
- **Steps:** Schedule `tech1`, then schedule `tech1` again without cancelling the first.
- **Expected:** 409 *"This round already has a scheduled interview. Cancel it first to rebook."*

### SCHED-06 — Reschedule (cancel-old + create-new, one email)
- **Steps:** `POST /:id/interview/reschedule` on a live `tech1` booking with a new `start_at`.
- **Expected:** Old row → `status='cancelled'`; new row created; Graph event updated; **exactly
  one** "rescheduled" email per side showing `previous_when → interview_when` — not a separate
  cancel email plus a separate invite email.
- **Steps (2):** Attempt reschedule with no live booking present.
- **Expected:** 400 *"There is no scheduled interview to reschedule. Use Schedule Interview
  instead."*

### SCHED-07 — Cancel + alert email
- **Steps:** `POST /interview/:scheduleId/cancel` with `{cancel_reason}`.
- **Expected:** `status='cancelled'`; cancellation email sent (auto-invite rounds only — confirm
  client round sends nothing per SCHED-02's logic).

### SCHED-08 — Occurrence: Held → scorecard dispatched
- **Steps:** `POST /interview/:scheduleId/occurrence` with `{outcome: "held"}`.
- **Expected:** `status='completed'`; `dispatchScorecards()` fires — one scorecard email per
  interviewer to the test inbox, each with a unique `token`; `rpa_interview_schedule
  .scorecard_dispatched_at` set (single-fire — see SCHED-10).

### SCHED-09 — Occurrence: No-show → no scorecard, no auto-hold
- **Steps:** `POST /interview/:scheduleId/occurrence` with `{outcome: "no_show", party: "candidate"}`.
- **Expected:** `status='no_show'`; `no_show_party`/`no_show_reason` recorded; in-app
  `INTERVIEW_NO_SHOW` notification fires; **no scorecard email sent**; candidate's pipeline stage
  is **not** auto-rejected/held — a human must act (Q9 design decision, explicit in code comment).

### SCHED-10 — Occurrence is idempotent
- **Steps:** Repeat the same `occurrence` call (held or no_show) a second time.
- **Expected:** Returns the existing verdict unchanged (`alreadyResolved: true`), does not
  re-dispatch scorecards or re-fire notifications.

### SCHED-11 — Occurrence sweep (automated) — held via Teams / nudge fallback
- **Preconditions:** `interview_occurrence_enabled=true`, grace window tightened; a `scheduled`
  booking whose `scheduled_end_at` has passed with `occurrence_status IS NULL`.
- **Steps:** Wait one sweep tick.
- **Expected (if `MS_ATTENDANCE_ENABLED`):** Teams attendance checked first; on a decided verdict,
  occurrence set automatically (no human action). **On an undecided/unreadable Graph read:** falls
  back to a one-time-then-repeating nudge to the **internal recruitment mailbox only** — never the
  interviewer (per code comment). Nudge repeats every 24h, capped at 3, after which the row drops
  out of the sweep for manual resolution.
- **⚠️ Staging caution:** code review §2.3 found this previously auto-no-showed every staging
  interview because the calendar attendee is the substituted test inbox, not the real candidate —
  confirmed fixed (matches on the address actually on the invite), but re-verify this specifically
  since it's a "every booking, silently" class of bug if it regresses.

### SCHED-12 — Scorecard: happy path submit
- **Steps:** `GET /api/scorecard/:token` (public, no auth) → `POST /api/scorecard/:token/submit`
  with valid ratings (`communication`, `attitude`, `final_rating` each in 0–5, 0.5 steps) and
  `recommendation` in `{approve, hold, reject}`.
- **Expected:** 200; `status='submitted'`; `avg_score` computed as the mean of provided numeric
  fields; audit note + notification fire.

### SCHED-13 — Scorecard double-submit → claim-then-act 409
- **Steps:** Fire two near-simultaneous `POST /:token/submit` on the same token (simulating a
  double-click on the public page).
- **Expected:** One 200 + 409 *"This scorecard has already been submitted."* Exactly one skill-row
  write, one notification fan-out. This is the fix verified live in code review §2.1 — re-confirm
  it holds (`200 + 409`, one audit note) rather than trusting the prior report.

### SCHED-14 — Scorecard expiry (lazy transition)
- **Preconditions:** A card with `token_expires_at` in the past, never opened.
- **Steps:** `GET /api/scorecard/:token`.
- **Expected:** Status flips `pending → expired` **on this first open** (lazy — confirm a
  never-opened stale card reads as `pending` in the DB right up until someone loads the link).
- **Steps (2):** `POST /:token/submit` after expiry.
- **Expected:** 410 *"This scorecard link has expired."*

### SCHED-15 — Scorecard blocked on a no-show interview
- **Preconditions:** Interview marked `no_show` (SCHED-09).
- **Steps:** Attempt `POST /:token/submit` on that interview's scorecard (if a token exists).
- **Expected:** 409 *"This interview was marked as not held, so no scorecard can be submitted."*

### SCHED-16 — Out-of-range rating rejected
- **Steps:** Submit `final_rating: 6` or `communication: -1` or `2.3` (not a 0.5 step).
- **Expected:** 400.

### SCHED-17 — HR scorecard field truncation
- **Preconditions:** A scorecard on `hr_round` (`card_type='hr'`).
- **Steps:** Submit `notice_period` (or `current_ctc`/`expected_ctc`/`relocation`) longer than 100
  chars, and `timings` longer than 255.
- **Expected:** Silently truncated to the max length, not rejected — confirm actual stored value
  matches `HR_FIELD_MAX`, and decide with RT/QA whether silent truncation vs. a 400 is acceptable
  UX (flag if not already decided).

### SCHED-18 — Consolidated feedback report
- **Preconditions:** ≥2 submitted scorecards across different rounds for one candidate.
- **Steps:** `GET /api/pipeline/:id/scorecard-report`.
- **Expected:** Only `status='submitted'` cards included; grouped by round; `overall.average` =
  mean of each round's `avg_score`; concerns list surfaces skills rated ≤2. Cross-ref: this is the
  "consolidated feedback now rendered" fix from code review §2.5 — verify the **UI** (PipelineDrawer
  report modal) renders it, not just the API.

### SCHED-19 — Interview reminder job
- **Preconditions:** `interview_reminder_enabled=true`; an upcoming scheduled interview on an
  auto-invite round.
- **Steps:** Wait for the reminder window.
- **Expected:** Reminder email sent to candidate + panel (test inbox) before the round; **client
  round receives no reminder** (`stageSendsInvites()` gate, confirmed in `interviewReminder.js`).

---

## 4. Test Cases — M4 Document Collection

Implementation: `backend/src/services/documentCollection.service.js`,
`backend/src/routes/document.routes.js`, `backend/src/jobs/documentReminder.js`.

### DOC-01 — Request documents
- **Preconditions:** ≥1 active `rpa_document_checklist_items` row.
- **Steps:** `POST /:id/documents/request`.
- **Expected:** 201; `rpa_document_requests` row created (unique per `pipeline_id`), `token_status
  ='active'`; one `rpa_candidate_documents` row per active checklist item; candidate receives the
  upload link email (test inbox).
- **Negative:** With zero active checklist items configured → 400 *"No active document checklist
  items are configured..."*

### DOC-02 — Re-request reuses the same token
- **Steps:** Call `POST /:id/documents/request` a second time on the same journey.
- **Expected:** Same `token` as DOC-01 (not a new one); `reminder_count` reset to 0,
  `last_reminded_at=null`, `token_status='active'`; already-uploaded checklist items are
  untouched (`skipDuplicates`), not reset to pending.

### DOC-03 — Public upload — happy path
- **Steps:** `GET /api/documents/:token` (no auth) to fetch the checklist; `POST
  /api/documents/:token/upload` multipart with a valid PDF under 10MB and a valid
  `checklist_item_id`.
- **Expected:** 200; file lands in OneDrive under `Document Collection/{candidate name
  (cv-{id})}/`; `rpa_candidate_documents` row → `status='uploaded'`; local temp copy deleted
  regardless of outcome.

### DOC-04 — Client-side file validation gap (known finding — confirm current state)
- **Steps:** On the public upload page, attempt to select a file outside `.pdf/.docx/.doc/.jpg
  /.jpeg/.png` or over 10MB.
- **Expected per code review O3:** the page's `beforeUpload` returns `false` unconditionally with
  no actual type/size check — upload silently fails/no-ops rather than showing a clear message.
  **Re-verify this is still the case** (O3 was flagged, not necessarily fixed) — if still broken,
  confirm the **server-side** guard (multer `fileSize` + `ALLOWED_EXTS`) still rejects correctly
  via direct API call even if the UI doesn't warn first.

### DOC-05 — Server-side rejects disallowed type/oversized file
- **Steps:** `POST /api/documents/:token/upload` directly (bypass UI) with a `.exe` file, and
  separately a file >10MB.
- **Expected:** Multer rejects both — confirm actual HTTP status/error surfaced to a raw API call
  (no client validation to hide behind here).

### DOC-06 — Upload against an already-verified item → 409
- **Steps:** Upload to a `checklist_item_id` whose document is already `status='verified'`.
- **Expected:** 409 *"This document has already been verified and cannot be replaced."*

### DOC-07 — Verify → auto-close on last item
- **Steps:** `POST /pipeline/documents/:docId/verify` on every outstanding item for a request, one
  at a time.
- **Expected:** Each individual verify → 200, `status='verified'`. On the **last** one,
  `rpa_document_requests.token_status` flips to `'closed'` automatically and `DOCUMENT_ALL_VERIFIED`
  in-app notification fires.
- **Verify:** Attempting a further upload against the now-closed token → 410 (see DOC-08).

### DOC-08 — Closed link rejects further upload
- **Steps:** `POST /api/documents/:token/upload` against a `token_status='closed'` request.
- **Expected:** 410 *"This document upload link is closed..."*

### DOC-09 — Reject re-opens the link and doesn't burn reminder budget
- **Preconditions:** A request that just auto-closed (DOC-07).
- **Steps:** `POST /pipeline/documents/:docId/reject` with `{reason: "Blurry scan"}` on one of the
  now-verified... (use an `uploaded`, not yet verified, item instead — reject only works on
  `status='uploaded'`).
- **Expected:** 200; `status` → rejected state; `rpa_document_requests.token_status` reopens to
  `'active'` even if it had just closed; reminder-template email sent on the **same** link/token
  with `rejected_document`/`rejection_reason` tokens filled in; `last_reminded_at` stamped **but
  `reminder_count` is NOT incremented** — confirm this precisely, it's a deliberate exception.
- **Negative:** `POST .../reject` with no `reason` → 400.
- **Negative (2):** Reject an already-`verified` item → 400 (only `uploaded` items are rejectable).

### DOC-10 — Manual "Send reminder" vs cron share the same counter
- **Steps:** Trigger `POST /:id/documents/remind` manually once; separately, let the cron
  (`documentReminder.js`) fire once on the same request (tighten `DOCUMENT_REMINDER_AFTER_DAYS`
  for the test).
- **Expected:** Both increment the same `reminder_count` — total reflects both actions, not two
  independent counters.

### DOC-11 — Reminder sweep selection criteria
- **Preconditions:** Requests in various states: fresh (< `AFTER_DAYS` old), stale (>
  `AFTER_DAYS`, never reminded), recently reminded (< `REPEAT_HOURS` since last), at
  `MAX_COUNT` already, on a closed journey.
- **Steps:** Run the sweep (tighten cron for testing).
- **Expected:** Only rows matching `token_status='active' AND reminder_count < max AND
  pipeline.final_outcome IS NULL AND ≥1 non-verified document AND (never-reminded-and-stale OR
  due-for-repeat)` receive a reminder. Matches code review §5.2 "Reminder sweep: fresh / backdated
  / immediate repeat → 0 sent → 1 sent → 0 sent" — reproduce that exact 3-step sequence.

### DOC-12 — Documents module is vendor-silent
- **Preconditions:** A journey with `source='vendor'` and an active vendor lock reaching the
  Documents stage.
- **Steps:** Request, upload, verify, and reject documents on this journey.
- **Expected:** **No vendor email at any point** — confirm no `rpa_email_messages` row targets the
  vendor for any of these actions (`VENDOR_STAGE_POLICY.documents = 'never'`). Cross-ref M6-05.

### DOC-13 — No delete/expiry path exists
- **Steps:** Search the API surface and UI for any document-delete or auto-expire action.
- **Expected:** None exists — confirms the "documents are never deleted" rule is upheld in code,
  not just policy. (Informational case — pass if nothing found.)

---

## 5. Test Cases — M5 Offer Management & Closure

Implementation: `backend/src/services/offer.service.js`, `backend/src/services/mrfClosure.service.js`,
`backend/src/jobs/offerSweep.js`.

### OFFER-01 — Request approval
- **Steps:** `POST /:id/offer/request-approval`.
- **Expected:** 201/200; `rpa_offers` upserted, `approval_status='pending'`,
  `approval_requested_at` set.
- **Steps (2):** Repeat request-approval on an already-approved offer.
- **Expected:** 409 *"This offer has already been approved."*

### OFFER-02 — Approve without a prior request-approval call
- **Steps:** On a fresh offer row (no `request-approval` ever called), `POST :id/offer/approve`
  directly.
- **Expected:** 200 — approval doesn't require the request step first, by design ("the request
  step exists to chase someone, not to gate the approval itself").

### OFFER-03 — Re-request re-arms the daily nudge
- **Steps:** Approve, then request-approval again (edge case, or on a still-pending offer, request
  twice a day apart).
- **Expected:** `approval_nudged_at` clears on re-request, so the next sweep tick re-sends the nudge
  rather than staying silent because "already nudged today."

### OFFER-04 — Share is a soft gate (not blocked by missing approval)
- **Steps:** `POST /:id/offer/share` with `{joining_date, remarks}` on an offer that was **never**
  approved.
- **Expected:** 200 — succeeds anyway; the audit note records `skippedApproval: true` but nothing
  blocks. Confirms code review §5.2 "Re-sharing an offer after a decision → decision preserved"
  behavior family.
- **Verify:** `rpa_shortlisted_candidates.offer_sent_at` set to match `shared_at` (legacy
  writeback).
- **Negative:** Invalid `joining_date` (non-date string) → 400.

### OFFER-05 — Share doesn't wipe an existing decision
- **Preconditions:** An offer already `candidate_decision='accepted'`.
- **Steps:** `POST /:id/offer/share` again (re-share, e.g. updated remarks).
- **Expected:** `candidate_decision` stays `'accepted'` — only initialized to `'pending'` when
  absent, never overwritten by a re-share.

### OFFER-06 — Vendor gets a bare milestone at Share, nothing more
- **Preconditions:** Vendor-sourced journey (§1.3.3).
- **Steps:** Share the offer.
- **Expected:** Vendor receives a **separate, content-free** email: *"An offer has been
  extended."* — no CTC, no joining date, no remarks. Confirm via `rpa_email_messages` content, not
  just that a send happened. Cross-ref M6-02.

### OFFER-07 — Decision requires a prior share
- **Steps:** `POST :id/offer/decision` with `{decision: "accepted"}` on an offer where `shared_at`
  was never set.
- **Expected:** 400 *"Record the offer as shared before recording the candidate's decision."*

### OFFER-08 — Decision — accept closes the MRF if filled
- **Preconditions:** Test MRF with `number_of_positions=1` (§1.3.2); candidate's journey linked to
  it; offer shared.
- **Steps:** `POST :id/offer/decision` `{decision: "accepted"}`.
- **Expected:** 200; `closeMrfIfFilled` fires — `rpa_mrf.filled_at` set; `approval_status` on the
  MRF is **untouched** (deliberately — confirm it does NOT get set to `'closed'`); Redis key
  `screening:role:{mrfId}` cleared; `mrf:closed` socket event broadcast; `MRF_CLOSED` in-app
  notification fires.

### OFFER-09 — MRF with multiple openings stays open after one accept
- **Preconditions:** Test MRF with `number_of_positions=2` (§1.3.2); two candidates in the
  pipeline against it.
- **Steps:** Accept one candidate's offer.
- **Expected:** MRF stays open (`filled_at` still null) — `accepted(1) < openings(2)`.
- **Steps (2):** Accept the second candidate's offer.
- **Expected:** Now closes.

### OFFER-10 — Concurrent acceptances on the last opening → one winner
- **Steps:** With an MRF one-opening-away-from-filled and two candidates both mid-accept, fire both
  `decision: accepted` calls near-simultaneously.
- **Expected:** Both offer decisions record as accepted (both are real acceptances), but the MRF
  close claim (`updateMany` on `filled_at:null`) is atomic — only one triggers the actual close
  side-effects (`reason:'already_closed'` for the loser internally); confirm no double-fire of the
  `MRF_CLOSED` notification/socket event.

### OFFER-11 — amend flag guards a re-decision
- **Preconditions:** A decision already recorded (`accepted` or `rejected`).
- **Steps:** `POST :id/offer/decision` with a **different** decision and no `amend` flag (or
  `amend: "true"` as a string, not boolean `true`).
- **Expected:** 409 *"The candidate's decision is already recorded as '{prev}'. Amend it explicitly
  if it needs to change."* — confirm the strict-boolean check actually rejects a truthy string.
- **Steps (2):** Repeat with `amend: true` (real boolean).
- **Expected:** 200; audit note reads *"Offer decision amended: {prev} → {new}"*.

### OFFER-12 — Amend from accepted→rejected reopens the MRF
- **Preconditions:** OFFER-08's MRF now closed by this candidate's acceptance.
- **Steps:** Amend the decision to `rejected` (`amend: true`).
- **Expected:** `reopenMrfIfUnfilled` fires; if now under `number_of_positions`, `rpa_mrf.filled_at`
  clears; MRF reopens for other candidates.
- **Verify legacy writeback:** `rpa_shortlisted_candidates.offer_accepted_at` explicitly set back
  to `null` (not left stale from the prior accept — this was a named fix, confirm it holds).

### OFFER-13 — Amend only reopens MRFs this module closed
- **Steps:** Manually flag an MRF `approval_status='closed'` via legacy means (not via
  `closeMrfIfFilled`), then amend an unrelated accepted offer tied to it away from accepted.
- **Expected:** `reopenMrfIfUnfilled` does **not** touch this MRF's `filled_at`/status — the reopen
  path is conservative and only reverses closes it itself performed via `filled_at`.

### OFFER-14 — Approval nudge sweep
- **Preconditions:** An offer `approval_status='pending'` with `approval_requested_at` set, no
  nudge sent today.
- **Steps:** Run `runApprovalNudges()` (tighten cron or invoke directly for testing).
- **Expected:** One nudge email to the internal recruitment mailbox; running the sweep again the
  same day → 0 sent (once-per-calendar-day guard).

### OFFER-15 — 90-day post-joining auto-close
- **Preconditions:** An offer `candidate_decision='accepted'`, `joining_date` ≥90 days in the past,
  journey still open (`final_outcome IS NULL`).
- **Steps:** Run `runPostJoiningAutoClose()`.
- **Expected:** Journey auto-closes with `final_outcome_key: 'joined'`; `notifyCandidate: false` —
  **confirm the candidate receives no email** from this specific cron action (silent by design);
  one row's failure (e.g. bad pipeline state) doesn't block the rest of the batch — test with ≥2
  qualifying rows, one deliberately broken.

### OFFER-16 — Amend/decision endpoints reject a closed journey
- **Steps:** After OFFER-15 auto-closes a journey, attempt `POST :id/offer/decision` again on it.
- **Expected:** 409 via `assertJourneyOpen` (same guard as PIPE-04).

---

## 6. Test Cases — M6 Vendor Notifications & Hardening

Implementation: `backend/src/services/vendorNotification.service.js`, `backend/src/utils/vendorLock.js`,
`backend/src/utils/vendorScope.js`, `backend/src/middleware/auth.js` (`requireStaff`).

**Automated coverage already exists** (`vendorNotification.test.js` ×22, `vendorIsolation.test.js`
×15) for the pure logic below — these manual cases exercise the **wired, end-to-end** behavior the
unit tests can't reach (real HTTP, real DB, real email send).

### VEND-01 — Dual-send actually fires end-to-end (the headline regression)
- **Preconditions:** Vendor-sourced journey, created through the real upload path so
  `rpa_candidate_pipeline.source='vendor'` is genuinely set (§1.3.3 — not hand-set in SQL).
- **Steps:** Move the candidate through a standard-disclosure stage (e.g. approve at `tech1`).
- **Expected:** **Two separate emails** — one candidate outcome email, and one **separate**
  vendor status email (never a cc). Confirm both in `rpa_email_messages`/`rpa_email_log` as
  independent rows, and that the vendor's email contains **no candidate-authored content** (no
  free text from the outcome modal).
- **Why this matters:** M6's changelog documents this exact flow as "reported built-in since M1,
  never fired once" until M6. This is the single most important case in this document to actually
  execute, not assume.

### VEND-02 — Per-stage disclosure matrix
- **Steps:** Move the same vendor-sourced candidate through: a standard stage (e.g. `tech1`),
  `documents`, and `offer` (share).
- **Expected:**
  - Standard stage → full status line vendor email.
  - `documents` → **zero** vendor email at any point (cross-ref DOC-12).
  - `offer` share → **bare** milestone line only (*"An offer has been extended."*), no CTC/date/
    remarks (cross-ref OFFER-06).

### VEND-03 — Ad-hoc email no longer leaks free text to vendor
- **Steps:** `POST /:id/email` (ad-hoc candidate email) with custom `subject`/`body` on a
  vendor-sourced journey.
- **Expected:** Candidate receives the free text as written. Vendor receives **only** a generated
  status line — confirm the vendor's copy is not a cc of this email and contains none of the typed
  body. This is the specific hole M6 closed (`sendAdHocCandidateEmail` lost its `vendorEmail`/`cc`
  params).

### VEND-04 — vendorForJourney requires source='vendor', not just an email on file
- **Preconditions:** A candidate with `VendorEmail` set on `rpa_cv` but whose pipeline journey was
  created through the ordinary screening/shortlist path (`source='screening_shortlist'`), **not**
  the vendor upload path.
- **Steps:** Move this candidate through a standard stage.
- **Expected:** **No vendor email sent** — `vendorForJourney()` checks `pipeline.source==='vendor'`
  specifically; a `VendorEmail` column value alone must not trigger a send (this is the 2026-07-22
  leak the code comment references — reproduce the negative to confirm it's actually closed).

### VEND-05 — Snapshot-at-creation: a lapsing lock mid-journey doesn't cut the vendor off
- **Preconditions:** Vendor-sourced journey created while the lock was active.
- **Steps:** Let `lockForNinetyDays` expire (or backdate it in SQL) **after** the journey already
  exists, then advance the candidate a stage.
- **Expected:** Vendor **still** receives the notification — attribution was snapshotted onto the
  journey at creation and is never re-evaluated.

### VEND-06 — Snapshot-at-creation: a stale attribution doesn't leak onto an unrelated later journey
- **Preconditions:** A candidate whose vendor lock lapsed **before** a new, unrelated journey is
  created for them (e.g. re-shortlisted independently much later).
- **Steps:** Create the new journey; advance a stage.
- **Expected:** **No vendor email** on the new journey — the lapsed lock means `activeVendorFor()`
  returns null at this journey's creation time, so `source` is not `'vendor'` for it.

### VEND-07 — 90-day lock: inclusive boundary
- **Steps:** Set `lockForNinetyDays` to exactly today's date; check `isVendorLockActive()`
  (indirectly, via whether a vendor send fires).
- **Expected:** Still active **through and including** the expiry day itself (`today <= expiry`,
  confirmed inclusive in code). Set it to yesterday → inactive.

### VEND-08 — Malformed lock date fails closed
- **Steps:** Set `lockForNinetyDays` to a shape-valid but impossible date (e.g. `"2026-13-45"`).
- **Expected:** Treated as **not active** (fails closed) — this was a real defect M6 fixed
  (previously read as "never expires" because it's lexicographically above every real date).
  Confirm no vendor send occurs off a malformed lock.

### VEND-09 — Frozen lock (JOINED) reads as permanently active
- **Preconditions:** PIPE-10 executed (lock frozen to `'9999-12-31'`).
- **Steps:** Check that this candidate, if somehow re-entered into a new journey via the vendor
  path, is still attributed to the original vendor.
- **Expected:** Lexicographic comparison treats the sentinel as always-active — confirm the
  behavior without needing schema awareness of the sentinel concept elsewhere in the code.

### VEND-10 — 90-day lock enforced on merge (ownership can't be stolen via dedup)
- **Preconditions:** Two vendor submissions of the same candidate (same identifying info) from two
  **different** vendors, first one inside its 90-day window.
- **Steps:** Trigger the duplicate-merge path (`mergeDuplicates`).
- **Expected:** The **first** vendor's `VendorEmail`/`vendorName`/`lockForNinetyDays` are preserved
  — the incoming (second) vendor's values do **not** overwrite them, and the merge does **not**
  stamp a fresh 90-day window on top starting the second vendor's clock. This was a real defect
  (documented ownership rule not actually enforced) — confirm the fix holds.

### VEND-11 — requireStaff blocks vendor role on staff routes
- **Steps:** As a `vendor`-role user (with `checkModuleAccess('recruitment_pipeline')` switched ON
  for them, simulating the mis-click scenario the fix addresses), call any `/api/pipeline/*` route,
  and any `/api/hr-upload/*` route.
- **Expected:** 403 on all — `requireStaff` (rank floor: recruiter=20) blocks vendor (rank=10)
  regardless of the module toggle. This is the exact hole closed in M6 — confirm the module toggle
  alone can no longer expose these routes.
- **Steps (2):** Repeat as `recruiter`/`admin`/`superadmin`.
- **Expected:** 200 (subject to the route's own logic).

### VEND-12 — vendor.routes.js intentionally does NOT use requireStaff
- **Steps:** As a `vendor` user with `checkModuleAccess('vendor_upload')` on, call
  `/api/vendor/candidates`, `/api/vendor/upload`, `/api/vendor/batches`, `/api/vendor/jobs`.
- **Expected:** 200 — these routes are meant for vendors themselves (`restrictTo('vendor','admin',
  'superadmin','recruiter','hr')` + module toggle, not `requireStaff`). Confirms the split is
  correct, not an oversight — pair with VEND-11 to show the two route families are deliberately
  different.

### VEND-13 — enforceVendorScope overrides, never merges, the query filter
- **Steps:** As a `vendor` user, call the vendor candidate list/export with a query param
  attempting to view another vendor's data (e.g. `?vendorEmail=someone-else@otherco.com` or
  `?vendorOnly=false` trying to widen scope).
- **Expected:** Ignored — `enforceVendorScope` **overwrites** `filters.vendorEmail` to the caller's
  own `user.email` and forces `vendorOnly:false`→ effectively their own scope only, regardless of
  what was requested. Confirm results only ever contain this vendor's own candidates.
- **Steps (2):** As `admin`/`recruiter`, repeat with the same query params.
- **Expected:** Filters pass through untouched — staff may legitimately query across vendors.

### VEND-14 — Vendor dashboard reports real pipeline stages, not FinalStatus keyword-matching
- **Preconditions:** A vendor with candidates at various real pipeline stages, plus ≥1 candidate
  uploaded pre-M1 with no pipeline journey at all.
- **Steps:** `GET /api/vendor/dashboard` as that vendor (or as staff with `?vendorEmail=`).
- **Expected:** Stage breakdown counts come from `rpa_candidate_pipeline.current_stage_key`
  directly (open journeys bucketed by real stage; closed counted separately as `closed`);
  candidates with **no journey** appear under `untracked`, not silently dropped or mis-bucketed.
  Cross-check a candidate's true stage in the Pipeline Tracker UI against what the vendor dashboard
  reports for the same candidate.

### VEND-15 — Recent-candidates list stage_source flag
- **Steps:** On the same dashboard, inspect the recent-candidates list for a candidate with a real
  journey vs. one without.
- **Expected:** `stage_source: 'pipeline'` + populated `stage` object for the former;
  `stage_source: 'legacy'` + `stage: null` for the latter (frontend falls back to
  `classifyStatus(FinalStatus)` only for this legacy population).

### VEND-16 — 6-month cooling-off is advisory (not blocking) on vendor upload
- **Preconditions:** A candidate rejected within the last 6 months (would trip PIPE-13's hard
  block if re-shortlisted through the normal path).
- **Steps:** Re-submit the same candidate through `POST /api/vendor/upload`.
- **Expected:** Upload **succeeds** (queued for review) — but `rpa_upload_jobs.advisory` carries a
  note surfaced on the upload dashboard. This is deliberately different from PIPE-13: a vendor
  re-submitting isn't "doing anything wrong" and usually can't know. Confirm the advisory note
  appears and that it does **not** block the row from processing.

---

## 7. Cross-Module Integration Passes

These retrace the full candidate journey end to end — run at least one complete pass per pipeline
"shape" before sign-off.

### E2E-01 — Full journey: shortlist → all rounds → offer → joined (vendor-sourced)
Shortlist via vendor upload → Zeko HR → Assessment → Tech1/2/3 → HR → CEO → **Documents** →
**Offer** → Closure (`joined`). At each step, confirm: candidate email correct, vendor email
correct per the disclosure matrix (VEND-02), legacy writeback correct (PIPE-06), and — at the end
— the vendor lock freezes (PIPE-10) and the MRF closes if filled (OFFER-08).

### E2E-02 — Full journey: shortlist → rejected mid-flow (non-vendor)
Ordinary screening shortlist → reject at Tech2 with a reason. Confirm: candidate rejection email,
no vendor email (not vendor-sourced), `rpa_cv.FinalStatus` and `rpa_shortlisted_candidates
.pipeline_status` both correct, 6-month cooling-off now active for this candidate (PIPE-13 setup).

### E2E-03 — Full journey: offer accepted then amended to rejected
Complete through Offer → accept (MRF closes) → amend to rejected (MRF reopens, lock unfrozen if it
had been frozen — confirm it does **not** unfreeze prematurely if `joined` was never actually set;
only an accept **before** `joined` closure should be reversible this way).

### E2E-04 — Two candidates racing the last MRF opening
Two candidates both reach Offer on a one-opening MRF; both get shared offers; accept both within
seconds of each other. Confirm one clean close, no duplicate `MRF_CLOSED` notifications, no lost
acceptance record for the "losing" candidate (their offer decision still recorded correctly, only
the MRF-close side-effect is deduped).

### E2E-05 — Client round (manual) doesn't break the automated chain around it
Journey reaches `client` stage (no system email fires — SCHED-02) → HR manually records the
outcome (approve) → stage advances into `documents` normally, with all automated M4 behavior
(request/upload/verify/reminder) working exactly as it would after any other round.

---

## 8. Negative / Resilience Checks (carried forward from code review, re-verify don't assume)

| # | Check | Expected |
|---|---|---|
| N1 | `final_outcome_key: "totally_made_up"` on closure | 400 |
| N2 | Unauthenticated `GET /api/pipeline` | 401 |
| N3 | `POST /api/email/templates` as recruiter / admin / duplicate name / missing fields | 403 / 201 / 409 / 400 |
| N4 | Blank `EMAIL_STAGING_RECIPIENTS` in non-prod | Throws — fails closed, never silently sends live |
| N5 | Server error message propagation (14 sites fixed in code review §2.4) | Spot-check ≥3 of: PipelineDrawer, PipelineConfigPanel, Settings, AnalyticsLegacy, CandidateDetail — a 409 with a specific server message must render that message, not a generic fallback |

---

## 9. Traceability — outstanding items from PHASE3-MODULE-STATUS.md §5 and the coverage audit

| Source | Item | Test case(s) here |
|---|---|---|
| Module status §5 | "Formal end-to-end passes... not executed as a signed-off suite" | This entire document + companion plan, once run and recorded |
| Module status §5 | Teams round-trip checklist | SCHED-01, 06, 07 |
| Module status §5 | Document walkthrough | DOC-01 through DOC-11, E2E-05 |
| Module status §5 | Offer walkthrough | OFFER-01 through OFFER-16 |
| Coverage audit §2.4 | Outcome-email round trip | PIPE-01, PIPE-09 |
| Coverage audit §2.4 | Vendor dual-send unit test → now "genuinely dead until M6" | VEND-01 (the critical re-verification) |
| Coverage audit §2.4 | Legacy regression | PIPE-06 |
| Coverage audit §2.4 | Concurrent-MRF + cooling-off scenario | PIPE-12, PIPE-13 |
| Coverage audit §2.4 | Future Prospect scenario | Extend PIPE-01 with `outcome_key: future_prospect`; confirm `pipeline_status='future_prospect'` writeback |
| M6 changelog | "Staging end-to-end pass... not run" | VEND-01 through VEND-16, E2E-01 |
| M6 changelog | Vendor isolation (route guards) | VEND-11, VEND-12, VEND-13 |
| Code review O3 | Client-side file validation | DOC-04 |
| Code review O4 | Scorecard API allows submit without `occurrence_status='held'` | Extend SCHED-15: attempt submit while `occurrence_status IS NULL` (never resolved) via direct API, confirm current behavior — only `!== 'no_show'` is checked per the finding, so this may currently **succeed** when it perhaps shouldn't; record actual result |
| Code review O7 | `daysLeft` null-guard on `invite.deadline_at` | UI check — open a candidate whose assessment invite has no deadline set, confirm no nonsense day count renders |
| Code review W1/W2/W3 | API-only capabilities with no UI | Re-check current frontend state before treating these as still open — confirm PIPE-08's admin CRUD, OFFER-11's amend flag, and the outcome-email mapping screen against what's actually shipped now |

---

## 10. Sign-off checklist

- [ ] All M1 cases (§2) executed, results recorded
- [ ] All M3a cases (§3) executed on both an auto-invite round and the Client round
- [ ] All M4 cases (§4) executed
- [ ] All M5 cases (§5) executed
- [ ] All M6 cases (§6) executed — **VEND-01 is the single highest-priority case in this document**
- [ ] All 5 E2E passes (§7) executed
- [ ] Negative/resilience checks (§8) re-verified, not assumed from the code review
- [ ] Companion plan ([`phase3-completed-items-test-plan.md`](phase3-completed-items-test-plan.md))
      executed or its results confirmed still current
- [ ] Known gaps (Email open tracking, Threaded reply, synthetic conversation IDs) still tracked,
      not silently dropped because they're "someone else's document"
- [ ] Defect list from any failing case triaged against the 3 material + 6 minor open findings in
      the code review — new vs. recurrence noted explicitly
