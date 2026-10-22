# Implementation plan: Phase 3 enhancements in Phase 4

**Date:** 7 Oct 2026 · **Scope:** the "Phase 3 Enh - Phase 4" sheet of `ATS App - Phase wise Task Items.xlsx`
**Companion files:**
- [PLAN-Phase3-Now.md](PLAN-Phase3-Now.md): defines the conventions this plan follows (DDL, tests, settings, cron, changelogs, email safety)
- [PLAN-Phase4.md](PLAN-Phase4.md)
- [Phase-3-Feedback-Triage-Notes.md](Phase-3-Feedback-Triage-Notes.md)

All paths are relative to `AAPNA-ATS/`. Line numbers were checked on `harish-project-staging-v25` (head `3365d5b`).

---

## 1. Context and scope

These items come from the Phase 3 feedback. They are important but not urgent. RT did not mark them as most important, or they depend on decisions that haven't been made yet.

They start once the Do Now list is closed. The plan assumes these Do Now items are already in place:
- Filter utility (N01)
- JD - skill gate, JD - other criteria and JD - ranking (N07–N09)
- JD tagging - data model (N13), which provides `rpa_candidate_mrf_tags`
- JD attached to emails (N17), which provides email attachments
- Pipeline popup crash (N30), which provides the ErrorBoundary
- Skip guard (N33), the server-side skip check
- Developer logging & error tracing (N42), which provides `runJob` and the error log

**Moved on 9 Oct:** the three parked longevity items (alerts, error view, runbook) moved into the Do Now list. They are now part of Developer logging & error tracing (N42) and System documentation & development history (N43).

| Group | Items | Hours |
|---|---|---|
| Search, scoring and candidate movement | Scoring weights & recency (L01), Move / re-tag candidate (L02), Flexible stages (L03) | 128 |
| MRF and pipeline hygiene | MRF Hold (L04), Drop-out rules (L05) | 48 |
| Analytics and JD records | Analytics - date range & Total Applied (L06), Editable JD label (no MRF) (L07) | 26 |
| **Total** | | **202** |

## 2. Build order (easy items first)

1. **Editable JD label (no MRF) (L07)**, 6 h. Small, with no dependencies.
2. **Scoring weights & recency (L01)**, 16 h. Starts once the filtering rework from Do Now has been in real use, so RT can judge the ranking.
3. **Analytics - date range & Total Applied (L06)**, 20 h. Needs a few weeks of JD tags from JD tagging - data model (N13), so that "Total Applied" means something.
4. **MRF Hold (L04)**, 24 h. Self-contained.
5. **Move / re-tag candidate (L02)**, 40 h. Needs JD tagging - data model (N13) and RT's decision on where a moved candidate lands.
6. **Flexible stages (L03)**, 72 h. Needs RT's written requirement. It is the largest item, so it is built near the end, on a settled pipeline.
7. **Drop-out rules (L05)**, 24 h. Last despite its size, because it builds on Flexible stages' stage-state model and needs RT's sign-off.

---

## 3. Items

The item format is the same as in [PLAN-Phase3-Now.md](PLAN-Phase3-Now.md): Goal, Current behaviour, Design, Files, Reuse, Tests, Risks & rollout, Depends on / blocks, Open decisions.

Shorthand used below:
- **SVC** = `backend/src/services/screening.service.js`
- **PIPE** = `backend/src/services/pipeline.service.js`
- **DRAWER** = `frontend/src/components/pipeline/PipelineDrawer.jsx`

### Search, scoring and candidate movement

#### L01 · Scoring weights & recency
**Medium · 16 h · RT §5, CEO (Phase 4 sheet row 84)**

**Goal**
- **Today:** after JD - skill gate through JD - ranking (N07–N09), ranking among qualified candidates uses fixed weights and ignores when a candidate applied.
- **Change:** re-tune the weights and score bands with RT, and rank recent applicants higher.
- **Done when:** RT agrees with the ranking on their sample JDs.

**Current behaviour**
- JD - ranking (N09) introduces `JD_RANK_WEIGHTS` (coverage 0.6, experience 0.2, CTC 0.1, notice 0.1).
- Keyword ranking is skill coverage plus job stability (Keyword - score & summary (N05)).
- Nothing uses `rpa_cv.createdAt`. Star bands are at SVC:589-595 and SVC:1716-1723.

**Design**
- Move the weights and band cut-offs into `rpa_settings`, under `screening_rank_weights` (JSON) and `screening_bands` (JSON).
  - Validate on save: weights must sum to 1; bands must be ascending.
  - Admin-only, so add `requireAdmin` on that key.
- Add a **recency** component:
  - `recency = 1` if added within 30 days
  - linear decay to `0` at 365 days
  - `null` dates score 0
  - default weight 0.1, with the other weights rescaled
- When Responded status & source marker (P01) ships, recency switches to the last response date.
- Admin UI in `frontend/src/pages/Settings.jsx`: a "Screening ranking" card with sliders, a live total check, and "Reset to defaults".
- Re-run the Before/after check (N11) comparison script with the new weights before saving them in production.

**Files:** SVC, `backend/src/utils/screeningFilters.js` (score helper), `backend/src/controllers/settings.controller.js`, `backend/src/routes/settings.routes.js`, `frontend/src/pages/Settings.jsx`.

**Reuse:** `backend/scripts/screening-compare.mjs` (Before/after check (N11)), the `rpa_settings` read pattern (`backend/src/jobs/interviewReminder.js:43-72`).

**Tests:**
- Unit tests: weight validation, the recency curve, band mapping.
- The comparison CSV reviewed by RT.

**Risks & rollout:**
- Changing the weights changes every ranking.
- Each change is logged (who, when, old → new) in `rpa_processing_log`.
- The cache version is bumped on save.

**Depends on:** JD - ranking (N09), Before/after check (N11). **Blocks:** none.

**Open decisions:** the default recency weight and decay window. Recommended: 0.1, 30-365 days.

#### L02 · Move / re-tag candidate
**High · 40 h · RT §6.2**

**Goal**
- **Today:**
  - A candidate already tagged to one JD can't be moved to another.
  - A wrong tag can only be closed.
  - Tags always start at the first stage.
- **Change:** move a candidate to another JD with a chosen landing stage (history kept), and remove a wrong tag.
- **Done when:** a final-round candidate can move to a new role at a chosen stage without extra emails.

**Current behaviour**
- `shortlistCandidates` (SVC:1871) skips candidates who already have a non-rejected record for that MRF (SVC:1912-1924).
- `createPipelineJourney` (PIPE:1733) always starts at the first active stage (~:1797) and reuses an existing journey (:1758-1763).
- There is no re-assign path.
- `rpa_candidate_pipeline.mrf_id` is set at creation (`backend/prisma/schema.prisma:760`).

**Design**
- **Data:** add `moved_from_pipeline_id bigint null` and `moved_reason text` to `rpa_candidate_pipeline` (DDL).
  - The old journey is closed with the final outcome `moved_to_other_jd`. Add it to `FINAL_OUTCOMES` in `backend/src/config/pipelineStages.js`, as a silent closure (no email), and to the `pipeline_status` CHECK in step with `SHORTLIST_STATUSES`. See the warning in `docs/PHASE3-CLOSURE-FOLLOWON-PROGRESS.md` about that constraint.
- **Service:** new `moveJourney({ pipelineId, targetMrfId, landingStageKey, carryHistory, reason, actedBy })` in PIPE:
  1. Claim the source journey (same claim pattern as `reopenJourney`, PIPE:1484) and close it as `moved_to_other_jd`.
  2. Create the target shortlist row and journey at `landingStageKey`, with events `entered` plus a `note` linking the source.
  3. Copy scorecards and assessment results only as **read-only references** (link by `moved_from_pipeline_id`). Do not duplicate rows.
  4. Tag the CV to the target MRF (JD tagging - data model (N13) service, `source='move'`).
  5. Emails:
     - Default: none.
     - Optional "notify candidate" toggle: sends a template "You are now being considered for <role>", with the JD attached (JD attached to emails (N17)).
- **Remove wrong tag:** `untagCandidate(cvId, mrfId, actor, reason)`. Allowed only when no open journey exists for that MRF; otherwise the user must use move or close. Logged.
- **Bulk:** the keyword/screening multi-select reuses `moveJourney` per row. The bulk case always lands at the first stage, as previously assumed in `PHASE-4-DEFERRED-SCOPE.md` §4.2. Confirm this with RT.
- **UI:**
  - The drawer gets a "Move to another JD" action, with a modal: target MRF (JD date & version (N19) list), landing stage (default: same stage as now, if that stage exists in the target), notify toggle, and a required reason.
  - The Search Candidate tag chips get a "Remove tag" action.
- **Permissions:** recruiter and above (`requireStaff`).

**Files:**
- DDL + rollback
- Backend: PIPE, `backend/src/config/pipelineStages.js`, `backend/src/services/candidateTag.service.js`, `backend/src/controllers/pipeline.controller.js`, `backend/src/routes/pipeline.routes.js`
- Frontend: DRAWER, `frontend/src/pages/Candidates.jsx`
- A new email template seed

**Reuse:** `reopenJourney` claim/audit pattern, `createPipelineJourney`, `setFinalOutcome` (PIPE:1159), the JD tagging - data model (N13) tag service, the JD attached to emails (N17) attachment.

**Tests:**
- Integration:
  - Move a final-round fixture to a new MRF at the same stage.
  - Assert the source is closed and silent, the target is at the right stage, no stage-arrival email is sent, and the history link is present.
- Run `pipelineClosure`, `crossModuleE2E`, `shortlistStatus`, `referralSuppression` and `vendorIsolation`.

**Risks & rollout:**
- Re-entry must never send a "progressed" email. Keep the duplicate-email guard around PIPE:863 in force.
- Vendor ownership (90-day lock) is unchanged by a move.

**Depends on:** JD tagging - data model (N13), JD attached to emails (N17), JD date & version (N19). **Blocks:** none.

**Open decisions:**
- D-02 landing stage. Options: keep the current stage / restart at shortlisted / recruiter chooses. **Recommended: recruiter chooses, defaulting to the current stage.**
- Should moves notify the candidate by default? Recommended: off.

#### L03 · Flexible stages
**High · 72 h · RT §7**

**Goal**
- **Today:**
  - The pipeline moves forward one stage at a time.
  - Only Tech 3 and the Client round can be skipped.
  - A skipped stage can never be done later.
- **Change:**
  - Authorized users can skip stages (HR Screening → Evalground, HR Screening → Functional, Assessment → CEO round).
  - A skipped stage can be re-opened or completed later. In the walk-in case, Tech 1 happens first and Evalground at the weekend.
  - Evalground import matches candidates at any stage.
  - Candidates get no duplicate emails.
- **Done when:** the walk-in example runs end to end with correct emails and history.

**Current behaviour**
- The next stage is `stages[currentIdx+1]`. `skipOptionalNext` jumps only over optional stages (PIPE:919-941; CEO round optional (N24) generalises this to consecutive optional stages). `advanceStage` is always `+1` (PIPE:1090).
- There is no backward transition. `reopenJourney` (PIPE:1484) only undoes a closure.
- Four blocks assume "current stage only":
  1. Evalground invite requires the current stage to be `assessment` (`backend/src/services/assessmentInvite.service.js:60`).
  2. Evalground import matches only journeys at `assessment` (`backend/src/services/assessmentImport.service.js:266`, note at :282).
  3. Interview booking uses `stageKey || pipeline.current_stage_key` and is guarded by `isSchedulableStage` (`backend/src/services/interviewSchedule.service.js:713-718`).
  4. Zeko scheduling always uses the current stage (DRAWER ~1717).
- Analytics assumes forward movement (PIPE:1957-1977).
- The duplicate-email guard and its incident note are at PIPE:863-864.

**Design**
- **Per-stage state:** a new table `rpa_pipeline_stage_state` with columns `pipeline_id`, `stage_key`, `status` (`pending|active|completed|skipped|reopened`), `completed_at`, `skipped_at`, `skipped_by`, `skip_reason`, and UNIQUE `(pipeline_id, stage_key)`.
  - Backfill it from the existing `rpa_pipeline_stage_events`: entered + approved = completed, skip = skipped.
  - `current_stage_key` stays as "where the candidate is now".
- **Transitions:** a new `moveToStage({ pipelineId, targetStageKey, mode: 'skip_to'|'reopen', reason, actedBy })`:
  - **`skip_to` (forward):** every stage between current and target is marked `skipped` (one `skip` event each). Only the target stage's arrival email is sent, and only if that stage's template exists and the candidate hasn't already received it (checked against `rpa_pipeline_stage_events.email_sent`).
  - **`reopen` (backward or side):** the target must be `skipped` (or `completed`, with an admin reason). Its state becomes `reopened` / `active` **in parallel**, and the current stage stays as it is. This is how the walk-in case works: Evalground is reopened while Tech 1 continues. Completing the reopened stage marks it `completed` and does not move `current_stage_key`.
  - **No arrival email on reopen by default.** An optional "notify" toggle uses the stage template.
- **Relax the four blocks:**
  1. Invite: allowed when the assessment state is `active` or `reopened`.
  2. Import: match journeys whose assessment state is not `completed` (any current stage).
  3. Booking: `stageKey` may be any stage whose state is `active` or `reopened`.
  4. Zeko scheduling: pass the selected stage, not the current one.
- **Authorized users:** a new setting `stage_skip_roles` (default `['admin','superadmin']`; RT may add recruiter). Enforced in `moveToStage` with `restrictTo`-style checks. the Skip guard (N33) mandatory-stage guard is replaced by this role check plus a required reason.
- **Walk-in start:** `createPipelineJourney` accepts `startStageKey` (authorized users only). The earlier stages are marked `skipped`.
- **UI** (`DRAWER`):
  - The stage strip (~2429-2450) shows state chips (Skipped / Reopened / Done).
  - New actions: "Skip to…" (stage picker plus reason) and "Re-open this stage".
  - Panels for reopened stages are actionable even when they are not current.
- **Analytics:** arrival detection uses state rows, not `sort_order`.

**Files:**
- DDL (state table + backfill) + rollback
- Backend: PIPE, `assessmentInvite.service.js`, `assessmentImport.service.js`, `interviewSchedule.service.js`, `pipelineAnalytics.helpers.js`, `pipeline.controller.js`, `pipeline.routes.js`
- Frontend: DRAWER, `frontend/src/pages/Pipeline.jsx`
- Settings: the `stage_skip_roles` key

**Reuse:** `isStageArrival`, the claim-then-act `updateMany` guard (PIPE:959-969), the stale-tab guard (PIPE:849-881), the existing `skip` event type, the CEO round optional (N24) consecutive-skip logic.

**Tests:**
- Integration:
  - Walk-in: start at Tech 1 with Evalground skipped, then reopen Evalground, import its result while the candidate is on Tech 2, and complete it.
  - Assert the email count per stage is at most 1.
  - Skip_to from HR Screening to CEO: 5 skip events and 1 email.
  - A stage-skip by a recruiter is refused when that role isn't allowed.
- Run every pipeline integration file:
  - `pipelineStageEngine`, `pipelineClosure`, `schedulingAndScorecard`, `crossModuleE2E`, `rescheduleEmails`, `documentsAndOffer`

**Risks & rollout:**
- This is the highest-risk item. Ship it behind the flag `FLEXIBLE_STAGES_ENABLED`, staging first, and run RT UAT on 3 real requisitions.
- The backfill is idempotent and conditional.

**Depends on:** CEO round optional (N24), Skip guard (N33), and RT's written requirement. **Blocks:** Drop-out rules (L05).

**Open decisions (needed in writing from RT):**
1. Who may skip or reopen. Recommended: admin and lead recruiter.
2. What the candidate is told on skip and reopen. Recommended: nothing on skip beyond the target stage's normal email; nothing on reopen unless the recruiter chooses to notify.
3. Whether reopening a *completed* stage is allowed. Recommended: admin only, with a reason.
4. "Trello-style" free movement versus these defined moves. Recommended: defined moves only.

### MRF and pipeline hygiene

#### L04 · MRF Hold
**Medium · 24 h · RT §1**

**Goal**
- **Today:** approvers can only approve or reject an MRF.
- **Change:**
  - A Hold option at approval, with a note and a hold-until date.
  - On that date the approver is reminded, with Approve / Reject / Hold further.
  - Held MRFs appear as open nowhere.
- **Done when:** a held MRF re-prompts its approver on the hold-until date.

**Current behaviour**
- `handleMrfApproval` (`backend/src/controllers/mrf.controller.js:931`) accepts only approve/reject.
- `decide()` (`backend/src/services/mrfApproval.service.js:291`) sets the status around :303.
- `rpa_mrf.approval_status` is a free-text string (`backend/prisma/schema.prisma:212`). The enum at :1268 has pending/approved/rejected.
- The audit table restricts `event_type` with `chk_mrf_approval_events_type` (`backend/prisma/ddl/2026-09-25-mrf-approval-audit.sql:75`).
- Unused columns `paused_at`, `paused_reason`, `paused_by` and `resume_on` exist (`backend/prisma/schema.prisma:227-230`).
- Reminders run in `backend/src/jobs/reminderScheduler.js`, with eligibility rules in `reminderEligibility.js`. "Still open" means pending or waiting (:52, :61).
- Link re-issue: `reissueApprovalLinks` (`backend/src/services/mrfApproval.service.js:552`).

**Design**
- **DDL:**
  - Widen `chk_mrf_approval_events_type` to include `held` and `hold_reminder_sent`.
  - Add `held` to the enum, in step with the string column.
- **Decide:** the action `hold` requires `comments` and a `holdUntil` date (today+1 to today+180).
  - Set `approval_status='held'`, `paused_at=now`, `paused_reason=comments`, `paused_by=approver`, `resume_on=holdUntil`.
  - Record the `held` audit event.
  - Notify the requester and RT that the MRF is on hold until the given date.
- **Not open anywhere:** add `held` to every "is open" check:
  - `getApprovedRoles` (SVC:21) already requires approved.
  - Dashboard pending counts (`backend/src/services/dashboard.service.js`) should count held separately.
  - MRF list badge "On hold" (`frontend/src/pages/MRF.jsx:250-271`).
  - The approval-trail labels (`frontend/src/components/mrf/ApprovalTrail.jsx`).
- **Reminder:** extend `reminderEligibility.js` with the type `mrf_hold_due`.
  - When `approval_status='held'` and `resume_on <= today`, `reminderScheduler` re-issues links (`reissueApprovalLinks`) to the approver who held it, then sends "Would you like to reopen this position now?" with Approve / Reject / Hold further.
  - It then sets `approval_status='pending'` (status `held → pending` with event `hold_reminder_sent`).
  - Hold further repeats the cycle.
- **Email buttons:** add "Hold" to the shared approval layout (`backend/src/services/emailNotification.service.js` ~1088-1120).
- **Page:** a third button plus a date picker on `frontend/src/pages/MrfApprovalAction.jsx` (~371-433).

**Files:**
- DDL + rollback
- Backend: `mrfApproval.service.js`, `mrfApprovalRules.js`, `mrf.controller.js`, `emailNotification.service.js`, `reminderEligibility.js`, `reminderScheduler.js`, `dashboard.service.js`
- Frontend: `MrfApprovalAction.jsx`, `MRF.jsx`, `ApprovalTrail.jsx`

**Reuse:** the atomic decision update in `decide()`, `reissueApprovalLinks`, `publicDecision`.

**Tests:**
- Unit: extend `mrfApprovalRules.test.js` (hold validation) and `reminderEligibility.test.js` (hold-due eligibility).
- Integration:
  - hold → the date passes (fake clock) → the reminder is sent and the links are reissued
  - approve after reminder works
- Run `mrfClosure` unchanged.

**Risks & rollout:**
- Pause and hold are different. Pause acts on an approved MRF; hold acts at the approval gate. The reused columns get a `COMMENT ON` that explains both uses.
- Keep the closure separation documented at `mrf.controller.js` ~971-978.

**Depends on:** none. **Blocks:** none.

**Open decisions:** the maximum hold length. Recommended: 180 days.

#### L05 · Drop-out rules
**Medium · 24 h · CEO (Phase 4 sheet row 85)**

**Goal**
- **Today:** candidates who never take a Zeko test or never respond stay in the pipeline indefinitely and clutter the columns.
- **Change:** per-stage reminder and timeout rules, auto-close as "Unresponsive" after the timeout, and settings to tune them.
- **Done when:** non-responders leave the board automatically after the set time.

**Current behaviour**
- Zeko's no-result statuses (`ZEKO_NO_RESULT_STATUSES` incl. `slotMissed`, `backend/src/services/zeko.service.js:709`) are logged but not stored.
- Other signals exist:
  - `rpa_assessment_invites.deadline_at`
  - interview `no_show`
  - `days_in_stage` (PIPE:357-359)
- The only auto-close is `runPostJoiningAutoClose` (`backend/src/jobs/offerSweep.js:121`), using `setFinalOutcome(..., notifyCandidate:false)`.
- The reason "Unresponsive / No-show" exists in the seed (`backend/prisma/seed-pipeline-stages.js:109`).
- Current RT rule: an expired Zeko window is recorded and the recruiter decides (`docs/phase3/04-QUESTIONS.md:101`).

**Design**
- **Store Zeko status:** a new `rpa_zeko_candidate_pipeline.last_zeko_status` column with `_at` (DDL), written when the scheduler syncs.
- **Rules** in a new setting `dropout_rules` (JSON, admin-only), per stage: `{ enabled, waitDays, reminders: [days…], action: 'close'|'flag' }`. Defaults:
  - zeko_hr / zeko_fn: wait 5 days after the link was sent, a reminder on day 2, then close.
  - assessment: 2 days after `deadline_at`, then close.
  - Interview stages: flag only.
- **Job:** `backend/src/jobs/dropoutSweep.js`, daily at 09:00 IST, with an overlap guard.
  - Candidates are eligible when the stage is open with no response signal since entry, and the journey is not paused (`is_paused` guard, as in the 4 existing sweeps).
  - Reminders use the existing ad-hoc candidate email (`sendAdHocCandidateEmail` in `backend/src/services/stageNotification.service.js:316`).
  - Close uses `setFinalOutcome(finalOutcomeKey='withdrawn', reason='Unresponsive / No-show', notifyCandidate:false)`.
  - **Flag** adds a "No response" tag on the board instead.
- **Dry-run mode:** the setting `dropout_dry_run=true` is on for the first two weeks. It produces a daily report email to RT of who *would* be closed.
- **UI:** a Settings card for the rules; board filter "No response".

**Files:**
- DDL
- Backend: new job, `server.js`, `zeko.service.js` / `backend/src/jobs/zekoScheduler.js`, PIPE (`listPipeline` flag), `settings.controller.js`
- Frontend: `Settings.jsx`, `Pipeline.jsx`

**Reuse:** `setFinalOutcome`, `sendAdHocCandidateEmail`, the sweep pattern (`backend/src/tests/integration/sweepJobs.test.js` covers the existing sweeps).

**Tests:**
- Unit: the eligibility function.
- Integration: extend `sweepJobs.test.js`. A fixture past the threshold is closed silently, and a paused journey is untouched.

**Risks & rollout:**
- This reverses RT's current rule, so it needs sign-off.
- Run dry-run first.
- A wrong close can be undone with `reopenJourney`.

**Depends on:** Flexible stages (L03; state model), RT sign-off. **Blocks:** none.

**Open decisions:**
- The thresholds per stage. Recommended: the defaults above.
- Should the candidate get a "we're closing your application" email? Recommended: no.

### Analytics and JD records

#### L06 · Analytics – date range & Total Applied
**Medium · 20 h · CEO (Phase 3 Enh. row 5); 10 Sep review**

**Goal**
- **Today:** Analytics uses fixed windows, and "Total Applied" per role can't be counted without JD tags.
- **Change:**
  - Presets (30 / 60 / 90 / 365 days, all) plus a custom date picker applied to every tile.
  - Per-role "Total Applied" from the JD tags (JD tagging on upload (N13–N15)).
- **Done when:** every Analytics number follows the chosen range.

**Current behaviour**
- `parseAnalyticsParams` (`backend/src/services/pipelineAnalytics.helpers.js:56`) takes only `mrf_id` and thresholds.
- `getZekoPipeline` (SVC ~2344-2487) and `getPipelineAnalytics` (PIPE:1838) have no date parameters.
- The Role Summary is grouped in the browser (`frontend/src/pages/Analytics.jsx:777-819`), with a CSV twin `groupByRole` (`backend/src/exports/screening.export.js:174`).

**Design**
- `parseAnalyticsParams` adds `from`, `to` (ISO dates, IST day boundaries) and `preset`.
  - Validate `from <= to` and a maximum span of 3 years.
- Every aggregate filters on its natural date:
  - journeys: `created_at`
  - shortlists: `shortlisted_at`
  - Zeko: `link_sent_at`
  - offers: `approval_requested_at`
  - joins: `joined_at`
  - candidates: `createdAt`
- One helper, `inRange(date, params)`, so each aggregate states which date it uses.
- **Total Applied per role:** count `rpa_candidate_mrf_tags` per MRF, where `tagged_at` is in range.
- **Moved Forward:** reuse the Analytics - Positions tab (N39) definition.
- Add both columns to Role Summary and the Positions tab (Analytics - Positions tab (N39)).
- **UI:** a range bar on `Analytics.jsx` (Segmented presets plus `RangePicker`). The active range is shown on every card and in CSV file names (`csvFilename`, `backend/src/utils/csvExport.js:210`).
- The Dashboard keeps its own range (Dashboard fixes (N36)) and is unaffected.

**Files:** `pipelineAnalytics.helpers.js`, PIPE, SVC, `screening.export.js`, `pipelineAnalytics.export.js`, `Analytics.jsx`.

**Reuse:** `parseAnalyticsParams`, `bucketFor`, `timeToHireFor`, the Analytics - Positions tab (N39) positions service.

**Tests:** extend `analyticsParams.test.js` (range parsing and validation) and `pipelineAnalytics.test.js` (range filtering per aggregate).

**Risks & rollout:** every number changes meaning. Document the date used per metric in `metricDefinitions.js` tooltips.

**Depends on:** JD tagging - data model (N13; with real tag data), Analytics - Positions tab (N39). **Blocks:** none.

**Open decisions:** the default range. Recommended: 90 days, as today.

#### L07 · Editable JD label (no MRF)
**Low · 6 h · RT §3 (second half)**

**Goal**
- **Today:** JDs without an MRF have no date or label to tell versions apart.
- **Change:** a recruiter-editable date / label on such JDs, shown next to the JD name.
- **Done when:** RT can mark the latest version of a JD that has no MRF.

**Current behaviour**
- JDs without an MRF are the `rpa_mrf_jd_send` records (the older Send-JD form, `backend/src/controllers/mrf.controller.js:45-113`): `role` and `jd_doc_link`, with `mrf_id` null.
- JD date & version (N19) shows the date and reference only for `rpa_mrf` rows.

**Design**
- DDL: `rpa_mrf_jd_send.version_label varchar(60)` and `version_date date`.
- PATCH endpoint (recruiter and above) to set them.
- Wherever these JDs are listed (MRF page "JD sent" list, any picker that includes them), show `"<role> · <version_label or date>"`, with a "Latest" marker per role on the newest `version_date`.
- An inline edit (pencil icon) on the MRF page list.

**Files:** DDL, `mrf.controller.js`, `backend/src/routes/mrf.routes.js`, `frontend/src/pages/MRF.jsx`.

**Reuse:** the JD date & version (N19) label format and the Date format (N34) date helper.

**Tests:** a unit test for label building; a manual check that the edit persists.

**Risks & rollout:** none.

**Depends on:** JD date & version (N19), Date format (N34). **Blocks:** none.

**Open decisions:** none.

---

## 4. Cross-cutting tables

### DDL

| # | Change | Item |
|---|---|---|
| 1 | `rpa_candidate_pipeline.moved_from_pipeline_id`, `moved_reason`; final outcome `moved_to_other_jd` added to the `pipeline_status` CHECK | Move / re-tag candidate (L02) |
| 2 | New `rpa_pipeline_stage_state` + backfill | Flexible stages (L03) |
| 3 | `chk_mrf_approval_events_type` widened with `held`, `hold_reminder_sent`; enum gets `held` | MRF Hold (L04) |
| 4 | `rpa_zeko_candidate_pipeline.last_zeko_status`, `last_zeko_status_at` | Drop-out rules (L05) |
| 5 | `rpa_mrf_jd_send.version_label`, `version_date` | Editable JD label (no MRF) (L07) |

### Settings keys

| Key | Item | Default |
|---|---|---|
| `screening_rank_weights`, `screening_bands` | Scoring weights & recency (L01) | JD - ranking (N09) values |
| `stage_skip_roles` | Flexible stages (L03) | `['admin','superadmin']` |
| `dropout_rules`, `dropout_dry_run` | Drop-out rules (L05) | defaults in Drop-out rules (L05); dry-run `true` |

### Feature flags

`FLEXIBLE_STAGES_ENABLED` (Flexible stages (L03)).

### New cron jobs

| Job | Item |
|---|---|
| `dropoutSweep` (daily 09:00 IST) | Drop-out rules (L05) |
| `mrf_hold_due` handled inside `reminderScheduler` | MRF Hold (L04) |

### Emails

| Email | Item |
|---|---|
| "Now considered for <role>" (optional, on move) | Move / re-tag candidate (L02) |
| Hold notice to requester; hold-due reminder to approver | MRF Hold (L04) |
| Drop-out reminder to candidate; daily dry-run report to RT | Drop-out rules (L05) |

## 5. Release plan

| Release | Contents |
|---|---|
| A | Editable JD label (no MRF) (L07) |
| B | Scoring weights & recency (L01; settings stay off until RT approves the weights), Analytics - date range & Total Applied (L06) |
| C | MRF Hold (L04) |
| D | Move / re-tag candidate (L02) |
| E | Flexible stages (L03), behind the flag; staging UAT on 3 real requisitions |
| F | Drop-out rules (L05), in dry-run for 2 weeks, then live |

Each release follows the steps in [PLAN-Phase3-Now.md](PLAN-Phase3-Now.md) §6.

## 6. Open decisions register

| # | Decision | Item | Owner | Recommended default |
|---|---|---|---|---|
| 1 | Recency weight / decay | Scoring weights & recency (L01) | RT | 0.1, 30-365 days |
| 2 | D-02 landing stage on move | Move / re-tag candidate (L02) | RT | Recruiter chooses, default current stage |
| 3 | Notify candidate on move | Move / re-tag candidate (L02) | RT | Off |
| 4 | Who may skip / reopen; candidate messaging; reopening completed stages; free vs defined moves | Flexible stages (L03) | RT (in writing) | Admin + lead recruiter; no extra emails; admin-only; defined moves |
| 5 | Maximum hold length | MRF Hold (L04) | RT | 180 days |
| 6 | Drop-out thresholds; closing email | Drop-out rules (L05) | RT + CEO | Drop-out rules (L05) defaults; no email |
| 7 | Analytics default range | Analytics - date range & Total Applied (L06) | RT | 90 days |

## 7. ID index (ID → task name)

| ID | Task |
|---|---|
| L01 | Scoring weights & recency |
| L02 | Move / re-tag candidate |
| L03 | Flexible stages |
| L04 | MRF Hold |
| L05 | Drop-out rules |
| L06 | Analytics - date range & Total Applied |
| L07 | Editable JD label (no MRF) |
