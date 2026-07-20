# Phase 3 — Development Plan (Module by Module)

**Document 3 of 4** · Status: **⚠️ CORRECTION (2026-07-14 meeting): the "signed off" claim below was wrong** — a provisional discussion was mistakenly recorded as a formal go-ahead; see [01-PROCESS-UNDERSTANDING.md](01-PROCESS-UNDERSTANDING.md) header and [MEETING-NOTES-2026-07-14.md](MEETING-NOTES-2026-07-14.md) Gap #2. **M1 reverts to gated pending a real written sign-off** (all its policy inputs are still answered — see the table below — only the sign-off itself is missing). RT answers applied 2026-07-13 and substantially refined on the 2026-07-14 call; **🚨 top schedule risk: the Zeko API's actual capabilities (score, cheat probability, full report, recording) are unvalidated and no one is currently assigned to verify them** — see M3.
Companion docs: [01-PROCESS-UNDERSTANDING.md](01-PROCESS-UNDERSTANDING.md) · [02-BUSINESS-DESIGN.md](02-BUSINESS-DESIGN.md) · [04-QUESTIONS.md](04-QUESTIONS.md)

Delivery model: **one module at a time**, each independently shippable and verified on staging before the next begins.

---

## 0. Module Roadmap & Dependencies

| # | Module | External blocker (fire off during M1) | **Gate status after the 2026-07-14 meeting** |
|---|--------|----------------------------------------|------------------------------------------------|
| M0 | **Phase 2.1 completion pass** — Zeko + email engine go-live | RT UAT slot + must-haves (**Q17**) | ✅ **COMPLETE — Phase 2.1 is live (confirmed 2026-07-14)**; Q17 closed, no UAT gate needed |
| M1 | Stage engine + Pipeline Tracker UI + outcome emails (vendor dual-send built in) | — | **All policy inputs answered — gated only on a real written sign-off** (the 2026-07-14 sign-off claim was retracted; a written request is now an action item — see [04-QUESTIONS.md](04-QUESTIONS.md) §E) |
| M2 | Evalground CSV import — **now two mechanisms: bulk CSV + single-result via Outlook** | Sample CSV from RT (**Q1**) | **✅ Unblocked 2026-07-15** — format verified and section→skill mapping decided, see [07-EVALGROUND-IMPORT-PLAN.md](07-EVALGROUND-IMPORT-PLAN.md); build plan ready, starts 2026-07-31 per [05-TASK-LIST-ETA.md](05-TASK-LIST-ETA.md) |
| M3 | Teams/Outlook scheduling + reminders + interviewer scorecards | Graph `Calendars.ReadWrite` grant (**Q16**) + scheduling-mode answer (**Q6**) | Q6 answered (both modes + free/busy) — **gated on Q16 (IT) only** for the scheduling/reminder/scorecard build; scorecard template received 2026-07-14. **🚨 But the Zeko auto-advance/cheat-probability/full-report design is a SEPARATE, unvalidated dependency — nobody has confirmed the Zeko API actually exposes this data, and no one is assigned to check** |
| M4 | Document collection | Document checklist (**Q8**) | Q8 retention answered 2026-07-14 (never delete; archive threshold TBD) — **build can start**; go-live needs the checklist template + the archive threshold + storage-capacity confirmation (may force a resumes-only fallback) |
| M5 | Offer management + closure | Offer-scope answer (**Q3**) | **Unblocked, and simplified further 2026-07-14** — letters confirmed to stay fully outside the ATS (status/stage only, no file) |
| M6 | Vendor completion + hardening | — | After M5, unchanged |

*(Career Page integration: no module needed — the candidate-intake side is already live; a separate JD-push ask is parked. See "Integration asks — disposition" below.)*

```
M0 (Phase 2.1 completion — can run before or parallel to M1)
M1 ──┬── M2 (independent)
     ├── M3 (independent; needs Graph grant)
     ├── M4 (independent)
     └── M5 ── M6 (audit pass over everything)
```

---

## Integration asks — disposition (RT "Integration Requirements" PDF, 2026-07-13)

Each ask is placed where it fits in the process; only heavy-external-setup items are handled as exception plans (the way `docs/reference/c2c_vendor_plan.md` handles C2C).

| Ask | Disposition |
|---|---|
| Outlook email + templates + tracking | **Covered** — Phase 2.1 engine, go-live in M0 |
| Zeko AI (interviews, scores, reports) | **Covered** — M0 go-live; Stages 1 & 3 in the Tracker |
| Evalground (links, scores, status) | **Covered** — CSV import, M2 (API not used — Q2 closed) |
| MS Teams (invites, availability, multi-round, reschedule) | **Covered** — M3 |
| Email templates (pre-built, editable, placeholders) | **Covered** — M1 makes them per-stage × outcome and creatable from the UI |
| Notifications (bell icon) | **Minimal version in M1** — reuse the existing header bell (`frontend/src/components/common/NotificationBell.jsx`) + Socket.io `review:new` pattern; new `pipeline:*` events are cheap. A persistent, DB-backed notification center is a later enhancement |
| WhatsApp integration | **Confirmed wanted 2026-07-14** (profile-received ack + mobile profile-completion link; interview-scheduled reminders; no overlap with Zeko's own messaging). Needs a paid plan (Twilio / WhatsApp Business API). **RT now owns producing the requirements doc** (Naveen + Chhaya + Sahil/sales — tool, plan, cost, templates, volume); our `docs/whatsapp-integration-plan.md` (modeled on `c2c_vendor_plan.md`) gets written once that lands |
| MS Access integration | **Elevated priority 2026-07-14 — not a nice-to-have.** It's legacy/backup data (not a live DB); the real ask is **two-directional**: one-time import of the historic Access/Excel data, plus an **ongoing export/backup** of ATS data back to Excel/Access. Driver: a prior ATS ("Dokri RMS") lost its backup — this file is the sponsor's insurance policy against a repeat. Schema mismatch flagged (ATS has far more columns than the Excel format) — feasibility assessment owed by Harish; Access table format owed by Chhaya; manual RT top-up is an acceptable fallback if a straight export isn't feasible. **Cheap interim win: a scheduled CSV/Excel export of core tables**, shippable before full schema reconciliation. Stated end-goal (out of Phase 3 scope): candidate-pool recommendation, e.g. "30,000 Java profiles exist → send an outreach mail." |
| Career Page integration | **Mostly closed 2026-07-14.** (a) Candidate-submission-form → ATS: **already live**, confirmed by Harish, accepted by RT — no work needed, covered by the existing email-intake/resume-parsing pipeline. (b) Pushing JD from MRF → the AAPNA website: a **new, separate ask**, parked for a later phase (different domain, unknown backend) |

---

## M1 — Stage Engine + Pipeline Tracker + Outcome Communications

### Data model (manual DDL in Postgres → `prisma db pull` → `prisma generate`, per repo workflow)
New tables:
- **`rpa_pipeline_stages`** — stage config: `stage_key` (unique), `label`, `sort_order`, `is_optional`, `is_active`, `stage_type` (`manual|zeko|scheduled_interview|document|offer`). Seeded with the 12 stages (Tech 3 and Client Interview optional). *(Per-outcome email template mapping moved to `rpa_stage_email_templates` below, since outcomes are now dynamic.)*
- **`rpa_stage_outcomes`** *(new — RT ask 2026-07-13: outcomes must be admin-customizable)* — `stage_key`, `outcome_key`, `label`, `is_advance`, `is_final`, `sort_order`, `is_active`. Seeds: the default Approve/Reject/Hold per stage, **Future Prospect on Stage 0**, and the 8 closure values. `rpa_pipeline_stage_events.outcome` references this table's keys.
- **`rpa_stage_email_templates`** *(new — RT ask 2026-07-13: templates per stage × outcome)* — `stage_key`, `outcome_key`, `template_id` (FK → `rpa_email_templates`). Resolution chain: stage×outcome mapping → generic outcome fallback template.
- **`rpa_candidate_pipeline`** — **one row per candidate-per-MRF journey** (Q13: two concurrent journeys allowed): `cv_id` (+ nullable `mrf_id`, `shortlist_id`), `current_stage_key`, `current_stage_status` (`in_progress|approved|rejected|hold`), `final_outcome` (8 closure values, nullable), `source` (`recruiter|bulk_excel|vendor|screening_shortlist|email_intake`), `vendor_email` (copied from `rpa_cv.VendorEmail` at creation), timestamps. Unique on `(cv_id, mrf_id)` — **note:** Postgres treats NULLs as distinct, so add a **partial unique index** (`WHERE mrf_id IS NULL`) or a `COALESCE` expression index so a candidate cannot get duplicate no-MRF journeys. **Cooling-off guard (Q11/Q23):** journey *creation* checks for a prior journey rejected at Stage 1+ within the configured window (default 6 months) and warns/blocks; **active concurrent journeys are never stopped** by a rejection elsewhere.
- **`rpa_pipeline_stage_events`** — append-only audit: `pipeline_id`, `stage_key`, `event_type` (`entered|outcome|note|skip`), `outcome` (references `rpa_stage_outcomes` keys), `reason_id`, `status_label` (exact legacy text written back), `notes`, `email_sent`, `email_error`, `acted_by`, `created_at`.
- **`rpa_outcome_reasons`** — stage-scoped reason taxonomy (extends the Stage 0 sub-reasons: High Salary, High Notice, Skills Mismatch, …), admin-editable, mandatory on every Reject/Hold, **plus a free-text "Other reasons" entry at every stage (Q19)**. **UI rule (RT, 2026-07-14): when "Other" is picked, the typed text becomes the displayed/stored value everywhere — the literal word "Other" must never surface** in the timeline, exports, or `FinalStatus` write-back.
- **Cross-cutting requirement, not a new table (RT, 2026-07-14): whole-DB skill-based search.** A candidate must be findable by skill (e.g. "all Java resources") across the entire database regardless of MRF tagging, with stage history visible. Needs verification against the existing candidate search/vector-embedding layer (`vectorStore.service.js`) that stage history from `rpa_pipeline_stage_events` surfaces in results, not just resume content.

Seeds delivered as `backend/prisma/seed-pipeline-stages.js` (+ package.json `seed:stages:*` scripts mirroring `seed:recipients:*`).
Pre-flight: check the CHECK constraint on `rpa_email_templates.category` (schema.prisma:441) before seeding new templates — it must be **extended via manual DDL** before new categories (e.g., `stage_outcome`) can be inserted. Same pre-flight on `rpa_shortlisted_candidates.pipeline_status` before adding the **`future_prospect`** value to its 3-value vocabulary (see write-back below).

### Backward-compatibility / write-back strategy
On every outcome (single transaction): update pipeline row + insert event, then write back
- **`rpa_cv.FinalStatus`** with text engineered to hit the existing `classifyStatus()` keywords in `frontend/src/pages/VendorDashboard.jsx` (~line 130): `"<Stage Label> Approved"`→inProcess, `"…Rejected"`→rejected, `"…On Hold"`→onHold, `"Joined"`→selected, `"Candidate Withdrew"` for Withdrawn.
- **`rpa_shortlisted_candidates.pipeline_status`** (when `shortlist_id` set) collapsed to its vocabulary (`shortlisted|rejected|on_hold`, **+ new `future_prospect`** for the extended Stage 0 status set — pre-flight the column for a CHECK constraint before DDL).
Legacy endpoint `POST /api/screening/analytics/status` (`updateCandidateStatus`, `backend/src/services/screening.service.js:2391`): **delegates** to the new engine when a pipeline row exists (skipping its own `STATUS_EMAIL_MAP` send → no double emails); byte-for-byte unchanged otherwise.

### Backend
New files:
- `backend/src/config/pipelineStages.js` — STAGE_KEYS / STAGE_OUTCOMES / FINAL_OUTCOMES constants, `finalStatusLabelFor()`, `shortlistStatusFor()` (pattern: `config/roles.js`).
- `backend/src/services/pipeline.service.js` — `listPipeline` (board data, filters, aging), `getPipelineDetail` (row + event timeline + emails), `setStageOutcome` (the transaction above; **email dispatched after commit** — send failure never rolls back state, result recorded on the event), `advanceStage` (forward-only, optional-stage skip logged), `setFinalOutcome`.
- `backend/src/services/stageNotification.service.js` — **the single email dispatcher** used by every module: resolves template (`rpa_stage_email_templates` stage×outcome mapping → 3 generic fallback templates interpolating `{{stage_label}}`), compiles via existing `compileTemplate`, recipients = candidate `to` + **`vendor_email` cc when set** (new `stageOutcome` flow key in `backend/src/config/emailRecipients.js` → staging redirect honored automatically), sends via existing `sendGraphEmail` + `injectTrackingPixel`, logs the `rpa_email_messages` / `rpa_email_tracking` / `rpa_email_log` trio (`email_type='stage_outcome'`).
- `backend/src/controllers/pipeline.controller.js` + `backend/src/routes/pipeline.routes.js` mounted at `/api/pipeline` (authenticate + `checkModuleAccess('recruitment_pipeline')`): `GET /`, `GET /stages`, `GET /reasons`, `GET /:id`, `POST /:id/outcome`, `POST /:id/advance`, `POST /:id/closure`, **plus admin config CRUD (RT ask 2026-07-13): `POST/PUT /stages`, `POST/PUT /stages/:key/outcomes`, `POST/PUT /reasons`** — behind the existing admin access control.
- **Email template create (RT ask 2026-07-13):** `backend/src/routes/emailTemplate.routes.js` today has only `GET /templates`, `GET /templates/:id`, `PUT /templates/:id` — add **`POST /templates`** (+ controller/service) so admins can create per-stage/per-outcome templates. (Category CHECK pre-flight above applies.)
- **Bell notifications (minimal — integration ask):** emit Socket.io events (`pipeline:outcome`, `pipeline:awaiting_feedback`, `assessment:import_done`) from the outcome/import transactions, following the existing `review:new` pattern consumed by `frontend/src/components/common/NotificationBell.jsx`. In-memory only, as today; a persistent notification center is deferred.
- **Ad-hoc per-candidate email (new, RT 2026-07-14):** a send-time override on `stageNotification.service.js` — `POST /api/pipeline/:id/email` with `{ templateId?, subject, body }`; if `templateId` is omitted the recruiter's edited subject/body is sent as-is. Still uses the same dispatcher plumbing (vendor cc rules, `rpa_email_log`, tracking). Not yet built.

Changed files:
- `backend/src/config/roles.js` — add `recruitment_pipeline` module key.
- `backend/src/services/screening.service.js` — `shortlistCandidates` (line 1628) upserts a pipeline row (`source='screening_shortlist'`, Stage 0 approved — shortlisting *is* resume approval); `updateCandidateStatus` (line 2391) delegation; Stage 0 status handling extended with **Future Prospect** (visible/retrievable on the Screening page — Q30).
- `backend/src/controllers/vendor.controller.js` upload path — pipeline row with `source='vendor'` + `vendor_email`.
- `backend/prisma/seed-email-templates.js` — 3 generic stage-outcome templates + **"Recruitment Process & Interview Stages"** template (trigger: Stage 0 approved / info form received).

### Frontend (per RT prototype feedback, 2026-07-10)
- `frontend/src/pages/Pipeline.jsx` — kanban board starting at **Shortlisted**, **columns rendered from the stage config** (not hard-coded). Shortlisting (screening page) is the **only entry point** — no manual-add into the Tracker (RT decision, 2026-07-10); vendor candidates enter the same way, carrying their vendor tag. Stage columns, candidate cards with aging badge/source tag/status chip/**concurrency badge for candidates active in another MRF journey (Q13)**, counts, filters; route `/pipeline` behind `ModuleRoute`.
- **Admin config UI (RT ask 2026-07-13):** a simple admin tab (stages / outcomes / reasons CRUD) so stages and outcome sets can be extended without code changes; `frontend/src/pages/EmailManagement.jsx` gains a **"New template"** flow (create, not just edit).
- `frontend/src/components/pipeline/PipelineDrawer.jsx` — **per-round drawer**: clickable round stepper (future rounds disabled), one round panel at a time (round-scoped schedule/scores/scorecard/outcome/emails), actions only on the current round; outcome modal with mandatory reason dropdown + notes; closure select on the Offer round.
- **Pipeline analytics = new tab in the existing `frontend/src/pages/Analytics.jsx`** (funnel, aging/stuck, rejection reasons) — no new analytics page.
- `frontend/src/services/pipeline.js` API client.
- Working reference: the approved prototype (`/pipeline-prototype` route + `docs/phase3/prototype.html`) is the UX spec for M1.

### M1 verification (staging, `EMAIL_REDIRECT_TO_TEST` on)
1. DDL applied; `prisma db pull` diff reviewed; app boots under PM2 staging.
2. Stage + reason + template seeds run (category CHECK passes).
3. One outcome email per type lands in the test inbox with `rpa_email_log` (`stage_outcome`) + tracking rows.
4. Vendor dual-send: recipient assembly unit-tested with redirect mocked off → candidate `to` + vendor `cc`.
5. Legacy regression: analytics/status with pipeline row → single email + event + write-backs; without → unchanged behavior.
6. VendorDashboard buckets shift correctly as outcomes are set across stages; shortlist flow creates the pipeline row.
7. Reject without reason is impossible from UI and API.
8. Outcome-config round-trip: add a custom outcome to a stage via the admin UI → use it on a candidate → event recorded with the new key → outcome email resolves via the mapping table.
9. Template create via `EmailManagement.jsx` → mapped to a stage×outcome → used by the dispatcher.
10. Future Prospect at Stage 0: write-back lands in `pipeline_status='future_prospect'`; candidate remains visible/retrievable on the Screening page and can be re-shortlisted.
11. Concurrent-MRF pair: two journeys for one candidate render as two cards with concurrency badges, no cross-contamination of events/emails; cooling-off blocks a third journey after a Stage 1+ rejection but does not touch the surviving active journey.
12. `docs/CHANGES-phase3-m1-pipeline.md` written.

---

## M2 — Evalground Import (inside the IQ / Tech Assessment round)

**✅ Fully specified and unblocked as of 2026-07-15 — full plan in [07-EVALGROUND-IMPORT-PLAN.md](07-EVALGROUND-IMPORT-PLAN.md).** Summary below; see doc 07 for the data model, backend/frontend build plan, and verification plan.

**No Evalground API — import only, via TWO mechanisms, both to be supported (RT, 2026-07-14):**
1. **Bulk CSV upload** — the original design. Format verified 2026-07-15 against the real sample.
2. **Single-candidate result report received on Outlook** — RT gets one result at a time via email; ingested automatically via the shared-mailbox poller (see doc 07 §4), with a manual-upload fallback.

**Import mechanics, fully specified 2026-07-14, format-verified 2026-07-15:**
- **Unique key = candidate email; names may repeat** (confirms Q1).
- **CSV columns are generic** (GA, Section 2, Section 3 — no test name or role attached). Decision: **import the columns as-is under Section 1/2/3 labels; RT renames/edits the section labels afterward** — no manual pre-tagging required from RT. **Section→skill mapping approach decided 2026-07-15 (doc 07 §2): an AI step suggests the mapping from the test title, RT confirms once per import batch, with per-candidate correction afterward** — for both the bulk and single-candidate paths alike.
- **Re-import / retake behavior (RT-confirmed, closes the earlier "latest vs best" open item):** a row already in the DB is **skipped**; if the candidate retook the test and the **score changed**, **only the score is overwritten** — no other candidate fields touched. This is now an RT-confirmed rule, not our default assumption.
- **Untested candidates show "Evalground test pending" indefinitely and are never deleted** — no expiry/cleanup job for this state.
- **Pass mark 50% for both GA and Technical (Q4)** drives the Passed/Failed auto-suggestion.
- **UI placement (RT decision, 2026-07-10, unchanged):** the import is an action on the Assessment round (board column + round panel in the Tracker), never a standalone screen — results map by candidate email to candidates currently in that round, filling IQ (GA) and Technical scores (`rpa_cv.IQScore`/`TechScore` — IQ = General Aptitude, Technical = Evalground Technical).

Build (full detail in [07-EVALGROUND-IMPORT-PLAN.md](07-EVALGROUND-IMPORT-PLAN.md)):
- New tables `rpa_assessment_imports` + `rpa_assessment_results` (doc 07 §3).
- Backend: `assessmentImport.service.js` — parse CSV (existing `xlsx` dep handles CSV) for bulk; a shared-mailbox poller (`evalgroundResultIntake.js`) plus manual-upload fallback for the Outlook mechanism; AI-suggested Section→skill mapping; skip-unless-score-changed logic; match candidates by email; validation preview, commit + import log (doc 07 §4).
- Frontend: import action inside the Assessment round panel — upload (or auto-detected queue) → section-mapping confirm (AI-suggested, editable) → validation report (matched / unmatched / malformed) → commit; import history list; "Evalground test pending" badge for untested candidates (doc 07 §5).
- HR sets Test Passed/Failed/Hold in the Tracker (auto-suggested at the 50% pass mark); outcome email via the M1 dispatcher.
- Verification plan in doc 07 §6, using the real sample files as fixtures.

## M3 — Teams/Outlook Scheduling + Reminders + Interviewer Scorecards

**Prerequisites (verify before coding):** tenant admin grants **`Calendars.ReadWrite` (Application)** for the shared mailbox **plus `Schedule.Read.All`/`Calendars.Read`** — free/busy and self-scheduling are confirmed (Q6, RT 2026-07-13), so the extended grant is mandatory, not optional (Q16 — the only remaining gate on the scheduling/reminder/scorecard build). Verification scratch script: token via existing `getAccessToken()` (`backend/src/services/onedrive.service.js`) → `POST /users/{defaultSender}/events` with `isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness'` → assert `onlineMeeting.joinUrl` → delete event.

**🚨 Separate, unvalidated dependency (2026-07-14) — the biggest schedule risk in Phase 3.** The Zeko score-band design (Q4) has been superseded on the call by a proposed auto-advance rule (score ≥50% + cheat probability Low → auto-advance; Moderate → recruiter approval; High → auto-reject), plus a request for the full Zeko test report and interview recording inside the ATS. **None of this has been checked against what the Zeko API actually returns.** "If Zeko provides the data, we can present it" was said repeatedly on the call as an unexamined assumption, and **no one was assigned to verify it.** If Zeko has no such API (or it's a paid tier), this collapses to manual score entry from a Zeko dashboard screenshot/export. Do not start building the auto-advance/report/recording UI until someone (Harish, per his own action item #5) has confirmed the Zeko API surface. Also rename `rpa_cv.ZekoCommunicationScore` → a coding-score field (Zeko dropped communication score; interview score always, coding score for coding roles).

- Tables: **`rpa_interview_schedules`** (pipeline_id, stage_key, interviewer emails, start/end TIMESTAMPTZ, `graph_event_id`, `teams_join_url`, status `scheduled|rescheduled|cancelled|completed|no_show`, `feedback_token`, `feedback_status PENDING|SENT|RECEIVED`) and **`rpa_interview_feedback`** (schedule_id, ratings JSONB, recommendation `approved|rejected|hold`, comments, submitted_by/at).
- Backend: new `calendar.service.js` (Graph events create/patch/cancel — Outlook auto-sends/updates invites to attendees); schedule endpoints under `/api/pipeline/:id/interviews`; public no-login scorecard endpoints (token pattern copied from `rpa_cv.cvMissingToken` / `candidate.routes.js:45-47`); new `jobs/interviewReminderScheduler.js` (env-gated like `zekoScheduler.js`) with the **real cadence agreed on the 2026-07-14 call (supersedes the Q7 "daily" placeholder and closes the earlier "cap at 5" open item)**: candidate **T-30 min**, interviewer **T-30 min**; post-interview feedback reminder **~1 hour after the interview ends, then every 2 days through day 6, one final reminder 3–4 days after that, stop at ~day 10** — no named-person escalation (the card keeps its "awaiting feedback" flag) — all through `rpa_email_log` with new `email_type`s so existing reminder accounting works. Reschedules are **recruiter-triggered only**; no-show is recorded but never auto-moves the round to Hold (Q9).
- Frontend: schedule modal in the drawer (DatePicker + interviewer picker from `rpa_users`; **free/busy display — confirmed, Q6**); public `InterviewFeedbackForm.jsx` (scorecard — structure below); feedback review panel; round-status chips wired to schedule + feedback state.
- **Scorecard structure (received 2026-07-14 — Harish's "Interview Evaluation Format V2"):** the ATS in-app form replaces the old MS Forms + Power Automate → Excel flow. Two card layouts:
  - **Technical Rounds 1–3 / CEO Round (shared card):** candidate email, date, position, round, interviewer — **all auto-filled from the schedule** (the old form asked for them manually); recommendation **Shortlisted / Rejected / On Hold** (maps to `rpa_interview_feedback.recommendation` approved/rejected/hold); **Skills 1–3 mandatory + Skills 4–5 optional**, each = skill name + rating **out of 5 in 0.5 steps** + remarks (ratings JSONB); **Communication** rating + comments; **Attitude** rating + comments; **Final Rating** (out of 5) + **Final Comments**; optional **interview recording link**.
  - **HR Round card (own variant — present in the template workbook):** family background, general/other, timings, communication rating + comments, attitude rating + comments, relocation, notice period, CTC & ETC, strength, weakness, only-negative, any other observation/request, final feedback, **next step for recruitment team**, final rating + final comments, recording link.
  - The old flow also auto-generated a **consolidated feedback text block** per round and notified HR — the ATS reproduces both natively (feedback summary rendered in the drawer; HR notified on submission via the existing bell/email path).
- **Second increment of M3 (Q6: both modes confirmed):** published-slots model + candidate slot-picker page. Interviewer-fixed mode ships first. Slot conflicts are resolved by the **interviewer updating/overwriting their published slots** — first-come holds a slot, no complex locking (Q31).
- **Safety items:** the staging email redirect does **NOT** cover calendar invites — non-prod must substitute attendees with test recipients inside `calendar.service.js`. Timezones: store TIMESTAMPTZ, render IST in templates. Reschedule = Graph event PATCH (keep `graph_event_id` stable).
- Verification: full round-trip on staging (schedule → invite in test calendar → reminder fires → scorecard submit → outcome email); reschedule + cancel paths; no real attendee ever receives staging invites.

## M4 — Document Collection

- **Q8 checklist: one list for all roles.** **Request email template received from Chhaya, 2026-07-14** (exact text in [04-QUESTIONS.md](04-QUESTIONS.md) Q8) — fires after final rounds clear, before offer roll-out; asks for **last 3 months' payslips**, **permanent address**, and **one government ID showing DOB + father's name**. **⚠️ Narrower than the earlier proposed default** (which also had education certificates and experience/relieving letters) — confirm with RT which is the real checklist before finalizing seed data; build the checklist as **admin-editable data**, not hard-coded, so either answer is a config change, not a redeploy.
- **Retention — RT-confirmed 2026-07-14, replacing the earlier "1 year post-decision" default: documents are never deleted.** Records must be pullable up to 3 years later (appraisals). If storage forces it, older documents **archive to SharePoint** (still retrievable) — **no threshold has been agreed** (open item, owed by Harish to propose, e.g. "archive to SharePoint 12 months after final decision"). Build the archive path as a job that can be scheduled once a threshold lands; do not build a hard-delete job at all.
- **Storage-capacity contingency (open, 2026-07-14):** Chhaya asked directly how much data the current system can hold; Harish owes a capacity check with Pankaj + IT. **If capacity is tight, RT's stated fallback is to keep documents out of the portal entirely and store resumes only** — this could descope the multi-document upload/checklist UI to a resume-only flow. Don't over-invest in the full multi-document upload UI until the capacity answer lands.
- Tables: `rpa_document_requests` (pipeline_id, requested_types JSONB from checklist Q8, token, token_status, requested_by/at) and `rpa_candidate_documents` (request_id, doc_type, file_url, original_name, status `uploaded|verified|rejected`, remarks, verified_by/at).
- Backend: request endpoint (dispatcher email — seed the **"Document Collection Request" template with Chhaya's exact text**, `{{position}}` merge field for the "[ ]" placeholder); public token-gated multi-file upload (multer config from `candidate.routes.js` extended to pdf/docx/jpg/png; storage via existing OneDrive service); verify/reject-with-reason endpoint → auto re-request loop; reminder `email_type='document_request'`; archive-to-SharePoint job (threshold-driven, once set).
- Frontend: public `DocumentUpload.jsx` (checklist + multi-file); verification checklist tab in the drawer.
- Guards: documents never exposed on vendor APIs; **no document-stage emails to vendors at all (Q5)**.

## M5 — Offer Management + Closure

**Scope decided (Q3, RT 2026-07-13), further simplified 2026-07-14: record-only, no letter file at all** — the smallest module, fully unblocked. Appointment/offer letters stay **entirely manual and outside the ATS**; the ATS only needs the stage/status to change (no `offer_letter_url` storage/upload is required — simpler than originally scoped).
- Core: `rpa_offers` (pipeline_id, shared_at, candidate_decision `pending|accepted|rejected`, decision_at, joining_date, remarks — **`offer_letter_url` is optional/unused unless RT later asks for it**); populate legacy `rpa_shortlisted_candidates.offer_sent_at/offer_accepted_at/joined_at` for reporting continuity; closure via M1's endpoint with comms.
- **Approval flow (Q3 + Q26):** before an offer is recorded as shared, the recruiter marks "approval requested" → **daily reminder nudge** via the M1 dispatcher until marked **approved in-app by the recruiter** → then "offer shared" is recordable. **Soft gate:** recording "offer shared" without the approval step is allowed for exceptional cases. No validity timer; **no offer version tracking** (revisions handled manually).
- **90-day post-Joined auto-close job (Q12):** the record closes automatically 90 days after Joined unless marked Joined-and-Left first (env-gated cron, `zekoScheduler.js` pattern).
- Vendor communication at this stage: at most a status-only notification, never the letter or figures (Q5; bare-line vs nothing pending Q29).
- *Parked (RT rejected):* send-from-ATS (Graph attachment send) and tokenized accept/decline page — both remain in the backlog should RT revisit.

## M6 — Vendor Completion + Hardening

- VendorDashboard gains a real stage column from `rpa_candidate_pipeline` (fallback to `classifyStatus(FinalStatus)` for legacy rows).
- Isolation audit: every pipeline API filtered by `VendorEmail` for vendor role; dual-send coverage audit across M2–M5 (every candidate-facing send goes through the dispatcher).
- **Vendor sensitive-stage suppression audit (Q5):** verify no code path anywhere sends the offer letter, CTC figures, or document-collection content to a vendor.
- **Cooling-off enforcement audit (Q11/Q23):** journey creation blocked/warned within the window; active journeys untouched.
- 90-day lock vs closure interaction; admin exposure of new templates/reason lists/flow keys; docs updates (`VENDOR_PROCESS.md`, consolidated `CHANGES-phase3-*.md`).
- **MS Access — elevated priority (2026-07-14), no longer "if simple":** build the **cheap interim win first** — a scheduled CSV/Excel export of core candidate tables — regardless of the full schema-reconciliation outcome (Harish's feasibility assessment still owed). The one-time historic-data import is a separate, likely-manual-assisted task once Chhaya shares the Access table format (manual RT top-up is an accepted fallback).
- **Whole-DB skill-search verification:** confirm existing candidate search (`vectorStore.service.js`) surfaces results across all MRFs with stage history attached, per the non-negotiable requirement in doc 02 §1.1 — extend if it doesn't.

---

## Key existing assets to build on (do not reinvent)

| Asset | Where | Used by |
|---|---|---|
| Graph email send/reply/tracking + template compiler | `backend/src/services/emailNotification.service.js` | all modules (via new dispatcher) |
| Recipient routing + staging redirect | `backend/src/config/emailRecipients.js` | dispatcher |
| Reminder engine pattern (`rpa_email_log`) | `backend/src/jobs/reminderScheduler.js` | M3, M4 |
| Token-gated public form pattern | `rpa_cv.cvMissingToken` + `MissingJdUpload.jsx` + `candidate.routes.js:45-47` | M3 scorecards, M4 uploads, M5 offer link |
| Graph auth (client credentials) | `onedrive.service.js getAccessToken()` | M3 calendar |
| Zeko pipeline/status semantics | `rpa_zeko_candidate_pipeline`, `zeko.service.js` | Tracker chips |
| Cron job pattern (env-gated) | `backend/src/jobs/zekoScheduler.js` | M3 reminder job, M5 auto-close job |
| Manual DDL → `prisma db pull` workflow | `docs/reference/VENDOR_PROCESS.md` §13 | all schema work |
| In-app bell + Socket.io events (`review:new` pattern) | `frontend/src/components/common/NotificationBell.jsx`, `frontend/src/services/socket.js` | M1 pipeline events |
| Email template CRUD (edit-only today) + editor UI | `backend/src/routes/emailTemplate.routes.js`, `frontend/src/pages/EmailManagement.jsx` | M1 template create |

## Standing verification rules (every module)
- Staging first, `EMAIL_REDIRECT_TO_TEST` on; legacy regression suite (analytics/status endpoint, VendorDashboard buckets, shortlist flow).
- `docs/CHANGES-phase3-m<N>-<topic>.md` written at the end of each module (repo habit).
- No module starts until the previous one is verified on staging and its blocking questions are answered.
