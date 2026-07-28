# Phase 3 — Module 2 extension: Evalground Invite / Deadline / Auto-Advance

Scope: extends the already-shipped bulk-CSV Evalground import
(`docs/changelog/CHANGES-phase3-m2-evalground-import.md`) with the 4-step
lifecycle recruiters actually need on the Assessment round: a real invite
action, a configurable deadline, and an optional global auto-advance/reject
toggle. Full design in the plan session; summarized here per the repo's
changelog-every-change habit.

---

## 1. "Invite Sent" is no longer automatic

`PipelineDrawer.jsx`'s Assessment-stage segment 1 previously flipped to
"done" the instant a candidate entered the stage (the same generic baseline
every stage gets). Now it's a real recruiter action:

- **`backend/src/services/assessmentInvite.service.js`** (new) —
  `sendAssessmentInvite()` either emails the candidate (compose modal,
  recruiter pastes the Evalground link they created manually — there's no
  API to auto-generate one) or records a "marked sent manually" attempt (no
  email). Restricted to journeys currently on `stage_key === 'assessment'`.
  `getInviteState()` returns the latest invite + an `isOverdue` flag.
- **`rpa_assessment_invites`** (new table, `backend/prisma/ddl/2026-07-25-assessment-invites.sql`)
  — one row per invite *attempt*, not an overwrite, so re-invites stay
  auditable and the deadline checker always keys off the newest one.
- **`frontend/src/components/pipeline/AssessmentInviteModal.jsx`** (new) —
  plain compose modal (not the richer outcome-email iframe editor), pre-filled
  with a template naming the candidate/position/deadline and an explicit
  placeholder for the pasted link.
- `PipelineDrawer.jsx`: the universal "candidate entered this stage" baseline
  now skips the `assessment` stage specifically; segment 1 is derived from
  the invite/deadline state instead (not sent / sent + days left / overdue).

## 2. Deadline window, admin-configurable

- **`backend/src/services/assessmentSettings.service.js`** (new) — two
  `rpa_settings` keys bundled into one read/write pair:
  `assessment_deadline_days` (default `2`) and `assessment_auto_advance_enabled`
  (default `'false'`). Same pattern as the existing `reminder_interval_days`
  settings.
- **`GET`/`POST /api/settings/assessment-automation`** (new, on the existing
  `settings.controller.js`/`settings.routes.js`) — GET open to any
  authenticated user, **POST admin-gated** (`isAdminTier`) — a deliberate
  tightening beyond the ungated `/settings/reminder` endpoints, since this
  toggle can trigger unattended approve/reject decisions plus real emails.
- **`backend/src/jobs/assessmentDeadlineChecker.js`** (new) — hourly cron
  (`config.assessment.deadlineCheckCron`, env-configured, not admin-UI-tunable
  — the days-count is the knob that matters, not the polling cadence).
  Finds each pipeline's *latest* invite whose deadline has passed with no
  landed result, emits `assessment:deadline_expired` in-app only (no email,
  same idiom as `assessment:import_done`), and stamps `reminded_at` so it
  never fires twice for the same invite. Registered in `server.js` alongside
  the other three cron jobs.
- **`frontend/src/pages/Settings.jsx`** — new "Assessment Automation" card:
  an `InputNumber` for the deadline days, a `Switch` for the toggle (disabled
  client-side for non-admins; the real enforcement is the backend gate).
- **`NotificationBell.jsx`** — second listener, `assessment:deadline_expired`,
  alongside the existing `assessment:import_done` one.

## 3. CSV upload — unchanged

Still the same bulk-CSV importer shipped previously; this pass only adds one
new captured field (below) and reads it at commit time.

## 4. Auto-advance / auto-reject — global toggle, default OFF

The first non-recruiter-initiated stage outcome in this codebase: when
`assessment_auto_advance_enabled` is ON, a CSV commit alone can approve *or*
reject a candidate with zero clicks.

- **Gate value**: Evalground's literal **"Marks Scored"** column — a raw
  total-marks count (e.g. `55`), captured as a new AI-extraction field
  (`overallMarksScored`) and a new `rpa_assessment_results.overall_marks_scored`
  column. Deliberately *not* `overall_percentage` or `overall_result` —
  explicit product-owner choice, not normalized across tests with different
  total possible marks.
- **Toggle OFF (default)**: `commitImport()` behaves exactly as before this
  change — every row gets `rpa_cv.FinalStatus = 'Evalground Test Shared'` +
  a `'note'` event, recruiter still decides manually.
- **Toggle ON**:
  - `overall_marks_scored > 50` → `setStageOutcome(pipelineId, {outcomeKey:'approved', actedBy:null})`
    — the exact same transactional path (and real outcome email, through the
    existing `EMAIL_REDIRECT_TO_TEST`-safe send) a manual Approve click uses.
    Auto-advances to `zeko_fn` per the seeded stage order.
  - `overall_marks_scored <= 50` → `setStageOutcome(pipelineId, {outcomeKey:'rejected', reasonId:<looked up>})`,
    using the **already-seeded** global reason `'Failed Assessment Threshold'`
    (`seed-pipeline-stages.js`'s `REASON_TAXONOMY`) looked up by
    `reason_label` at runtime — never hardcoded, never a new reason row.
  - Either way, the transient `'Evalground Test Shared'` write and note event
    are skipped for that row — the outcome's own writeback supersedes them
    immediately. The `IQScore`/`TechScore` legacy writeback stays
    unconditional regardless (independent concern).
  - If the seeded reason is missing/inactive: a warning is logged and that
    row falls back to the manual path — never aborts the batch.

## 5. Explicit caveats (carried into this changelog, not just the plan)

- Toggle is global and coarse (one boolean, every candidate, both
  directions) — a finer per-candidate/per-MRF control was explicitly
  deferred, not built.
- Default OFF is deliberate: this is the first feature where a bulk import
  can silently approve-or-reject a real candidate and send a real outcome
  email with no recruiter in the loop.
- "Marks Scored" isn't normalized across different tests — accepted
  tradeoff, not something this pass silently "fixes" by substituting a
  percentage.
