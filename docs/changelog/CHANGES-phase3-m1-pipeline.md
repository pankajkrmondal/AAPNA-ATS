# Phase 3 — Module 1 hardening: email safety, closure emails, admin config

**Date:** 2026-08-05 · **Module:** M1 (plus M3/M4/M5 fixes it turned up)

## Why

Two things prompted this pass.

First, a standing rule that the code did not fully honour: **no interview email
may reach a candidate from local or staging — production only.** The Graph mail
path respected it. Two other paths did not.

Second, the outstanding rows from
[PHASE3-COVERAGE-AUDIT.md](../phase3/PHASE3-COVERAGE-AUDIT.md), minus the vendor
module (M6, owned separately) and the Evalground single-result intake (deferred).
M1 was also the only module with no changelog; this is it.

---

## 1. Non-production email safety

### The two leaks

**Zeko scheduled real candidates from staging.** `scheduleInterview()` in
`screening.service.js` POSTed `shortlist.candidate_email` to the Zeko API in
every environment, and Zeko emails its own interview invitation to whatever
address it is given. Our own confirmation mail a few lines later *was* correctly
redirected — so the guard looked present while the actual invite went out.
`cancelInterview()` had the same shape.

**`sendGraphEmail()` was a raw pipe.** It sent to whatever `to` it was handed.
Every protection lived at ~40 individual call sites, so one new call site written
without `resolveRecipients()` would email a real candidate from staging, with
nothing to catch it.

### The fixes

**A global gate inside `sendGraphEmail()`.** Outside production it now rewrites
`to` to the test inbox and clears `cc` before anything is built, logging the
substitution. Call sites that must reach real recipients pass
`allowRealRecipients: true` — and only the flows already listed in
`NEVER_REDIRECT` (internal alerts, credentials, password reset) or
`OPERATOR_ADDRESSED` (the panel/scorecard/nudge addresses an operator typed in)
do so. Everything else is safe by default. This is deliberately redundant with
`resolveRecipients()`: it is the net under the call sites, not a replacement.

**`nonProdSafeCandidateEmail()`** in `config/emailRecipients.js` — a shared
helper for the hand-off points a mail guard structurally cannot cover, because
*something else* does the sending:

| Hand-off | Who sends |
|---|---|
| Zeko schedule payload | Zeko |
| Zeko cancel payload | Zeko |
| Calendar attendee list | Outlook |

The calendar case already had a local version of this; it was generalised rather
than duplicated. Schedule and cancel resolve identically on purpose — cancelling
by the real address in non-prod would not match the booking Zeko actually holds.

**Vendor cc no longer bypasses the redirect.** `stageNotification.service.js` set
`cc = vendorEmail` verbatim in both send paths. `resolveRecipients()` clears cc
outside production; this put a real external vendor address straight back onto a
staging send. Dropped explicitly at the source.

**Tests.** New `backend/src/tests/emailRecipients.test.js` (27 cases, `npm run
test:unit`) asserts every candidate-facing flow redirects, every bypass flow does
not, and the hand-off helper substitutes. The bypass list is duplicated in the
test *on purpose* — widening either set in the source fails the test and forces a
second look.

---

## 2. Closure emails now send — and the five that must not, cannot

The eight closure outcomes had no template and `rpa_stage_email_templates` held
zero rows, so `resolveTemplate()` returned null on every closure and the send was
skipped. Mapping them onto the approve/reject generics had been rejected for a
good reason: it would email *"Congratulations"* to a candidate who backed out.

**Three closure templates seeded** — `Closure — Approved`, `Closure — Rejected`,
`Closure — On Hold` — resolved through `GENERIC_FALLBACK_BY_OUTCOME` rather than
per-stage mapping rows, because a journey can be closed from **any** stage. A
candidate withdrawing at Tech 2 never reaches the offer stage, so a per-stage
mapping would have missed most real closures — which is precisely why this never
worked before.

**`SILENT_FINAL_OUTCOMES`** makes the other five deliberately silent: `joined`,
`joined_and_left`, `backed_out`, `did_not_join`, `candidate_withdrawn`. These
record something the candidate already lived through. Checked in two places —
inside `resolveTemplate()` so an admin cannot map one to a template from the new
config screen, and again in `sendStageOutcomeEmail()` because a recruiter-edited
subject/body override skips template resolution entirely.

### The trap this closed

`runPostJoiningAutoClose()` in `offerSweep.js` calls `setFinalOutcome(…, JOINED)`.
It sent nothing **only because no closure template resolved**. Seeding the
templates would have armed it: every auto-closed record emailing its candidate 90
days after they joined, unprompted. `setFinalOutcome` now takes
`notifyCandidate`, and the sweep passes `false` — a cron tidying up a record
months later must never be the thing that emails someone.

### Four other templates seeded

`Recruitment Process & Interview Stages` (M1), `Document Collection Request` and
`Document Collection Reminder` (M4), `Offer Approval Reminder` (M5). The last
three had code fallbacks and still sent; seeding moves the copy onto the Email
Templates page so HR can reword it without a deploy.

> **Open decision:** `Recruitment Process & Interview Stages` is seeded but
> **not wired to a trigger**. Its intended trigger is Stage 0 approval — where
> the candidate already receives the Shortlist Notification. Firing both at the
> same moment is a behaviour change RT should choose, not one to make silently.
> With the new admin config screen it can be mapped without a developer.

---

## 3. `POST /api/email/templates`

Admins could edit templates but not create them, which is why every template gap
above needed a developer and a seed run. The endpoint is admin-only, rejects
duplicate names (templates are resolved *by name* throughout the codebase, so a
duplicate would make precedence a matter of insertion order), and accepts
`placeholders` rather than inferring them — an inferred placeholder the body does
not use would lock the template into failing its own edit validator.

The inline admin gate in `pipeline.routes.js` was lifted into a shared
`requireAdmin` middleware rather than copied.

---

## 4. Correctness fixes

| Fix | Was |
|---|---|
| `final_outcome_key` validated against `FINAL_OUTCOMES` | Any string was written through; `finalStatusLabelFor()` falls back to `` `${stageLabel} ${outcomeKey}` ``, so typos landed in `final_outcome` **and** legacy `rpa_cv.FinalStatus` |
| `assertJourneyOpen()` on every mutating entry point | A closed or rejected journey could be advanced, re-outcomed and emailed again |
| Claim-then-act in `setStageOutcome` / `advanceStage` / `setFinalOutcome` | Two concurrent approvals both read the same stage, both advanced, both emailed. Now a conditional `updateMany` inside an interactive transaction; 0 rows matched → 409 and the events roll back with it |
| Offer decision is no longer silently overwritable | `recordOfferShared` reset `candidate_decision` to `'pending'` unconditionally, so correcting a joining date wiped a recorded acceptance. Re-deciding now needs an explicit `amend: true` |
| Acceptance reversal is now symmetric | Only the `accepted` half of the legacy write-back existed, so amending down to `rejected` left `offer_accepted_at` set and the MRF closed. New `reopenMrfIfUnfilled()` brings the requisition back into JD filtering |
| Document upload token actually closes | `token_status` existed from day one but nothing ever wrote `'closed'` — a no-login upload URL stayed live forever, past verification and past the hire. Now closed when the checklist completes or the journey closes, and re-opened by a rejection |
| Occurrence sweep re-nudges | It sent exactly one nudge then excluded the booking permanently. If that mail was missed the interview stalled forever — and because the same filter gated the attendance branch, a Teams report published later was never read. Now up to 3 nudges ~24h apart, bounded by a time window so no new column was needed |
| Stage deactivation is blocked while candidates are on it | Deactivating stranded them: the engine resolves the next stage from the *active* list, so approve silently recorded an outcome with nowhere to go. Now a 409 at both ends |

---

## 5. Admin configuration UI

`frontend/src/components/pipeline/PipelineConfigPanel.jsx`, mounted on Settings
behind the admin check. Stages (with their outcome sets) and the Reject/Hold
reason taxonomy, wiring the client methods in `services/pipeline.js` that had
existed since M1 with **no screen calling them**.

Two supporting API changes: `listStages` now includes each stage's outcomes
(additive — existing consumers read the same top-level fields), and `listReasons`
accepts `include_inactive=true`, without which a deactivated reason becomes
invisible and therefore impossible to reactivate from the UI that deactivated it.

Stage keys and a reason's stage/outcome scope are immutable after creation:
everything downstream is keyed on them, and re-scoping a reason would silently
re-file every past decision that cited it.

---

## 6. Document reminders are automatic

`jobs/documentReminder.js` — RT asked for "reminders until submitted"; what
existed was a manual button, so a candidate who went quiet was only chased if
somebody noticed. Daily sweep, first reminder after 2 days, ≥24h apart, max 3.
Calls the existing `sendReminder()` so the button and the cron send identical
mail. Skips journeys that have since closed.

---

## 7. Consolidated feedback

`getCandidateScorecardReport()` now returns a `consolidated_feedback` block:
every interviewer's verdict on one candidate as one passage, with a recommendation
tally and low-rated skills surfaced separately (the thing a later interviewer most
wants to probe, and the easiest to miss inside a card). Returns null when nothing
has been submitted — an empty summary is worse than none, because it reads as
"no concerns raised".

---

## 8. The demo pipeline is no longer the front door

The mock walkthrough page was labelled **"Candidate Pipeline"** in the sidebar,
sitting *above* the real Pipeline Tracker with an identical icon. Anyone looking
for the pipeline clicked the demo and saw invented candidates. It was also a bare
route — a user explicitly denied the `recruitment_pipeline` module could still
open a full pipeline UI and act on it.

**Nothing was deleted.** The page, its route and its file all stay:

- The real page takes the plain name **"Candidate Pipeline"**; the demo is off
  the sidebar entirely but still reachable at `/candidate-pipeline-prototype`
  for client walkthroughs and as the design reference `PipelineDrawer`,
  `AssessmentImportModal` and `DecisionEmailModal` cite in comments.
- The demo route is now behind the same `ModuleRoute` guard as the real page.
- A non-dismissible banner on the demo says every candidate is invented and links
  across to the real board. Anyone arriving now came by direct link, quite
  possibly expecting the real thing.
- The **"Candidate Pipeline (Preview)"** tab was removed from `AnalyticsLegacy`.
  It rendered the prototype's hardcoded funnel inside an operational analytics
  page, where invented numbers are indistinguishable from real ones. It was not
  repointed, because `Analytics.jsx`'s `PipelineInsights` already reads the same
  figures live from `GET /api/pipeline/analytics` — the tab was duplicated, not
  merely mocked. That also removed the last code-level import of the prototype.

---

## Files

**New:** `backend/src/tests/emailRecipients.test.js`,
`backend/src/jobs/documentReminder.js`,
`frontend/src/components/pipeline/PipelineConfigPanel.jsx`, this changelog.

**Changed (backend):** `services/emailNotification.service.js`,
`config/emailRecipients.js`, `config/index.js`, `middleware/auth.js`,
`services/screening.service.js`, `services/interviewSchedule.service.js`,
`services/interviewScorecard.service.js`, `services/stageNotification.service.js`,
`services/pipeline.service.js`, `services/offer.service.js`,
`services/mrfClosure.service.js`, `services/documentCollection.service.js`,
`controllers/pipeline.controller.js`, `controllers/emailTemplate.controller.js`,
`routes/emailTemplate.routes.js`, `routes/pipeline.routes.js`,
`jobs/offerSweep.js`, `jobs/interviewOccurrence.js`, `jobs/interviewReminder.js`,
`server.js`, `prisma/seed-email-templates.js`.

**Changed (frontend):** `App.jsx`, `layouts/MainLayout.jsx`, `pages/Settings.jsx`,
`pages/AnalyticsLegacy.jsx`, `pages/CandidatePipelinePrototype.jsx`,
`services/pipeline.js`.

## Verified

- `npm run test:unit` — 54/54 pass (27 new).
- Frontend `npm run build` clean.
- All modified backend files pass `node --check`; the new cross-service import
  (`offer.service.js` → `pipeline.service.js`) introduces no cycle, confirmed by
  loading every touched service.
- The document-reminder Prisma query was executed against the live schema and
  returns valid SQL.
- Seeded template placeholders were checked against the tokens each service
  actually supplies. This caught a real defect before it shipped: the three
  closure templates declared `stage_label` without using it, which would have
  made every future edit fail the `PUT /templates/:id` validator.

---

## 9. Second pass (2026-08-06): audit of the unreviewed files + live testing

The first pass was verified by unit tests, `node --check` and clean builds — not by
execution. This pass ran everything against a live server on the dev database (46 checks,
all data removed afterwards) and audited the files the first pass skipped.

### Bugs found and fixed

**Scorecard double-submit race** (`interviewScorecard.service.js`). The status check was a
read; the update was not conditional on it. Proven live: two concurrent submits both
returned 200, wrote **2 audit notes and 8 notifications**, and the later payload silently
overwrote the earlier. On a public no-login page a double-click does this. Fixed with the
same claim-then-act pattern used in the stage engine; retested `200 + 409`, one audit note.

**Stale-CSV auto-advance pushed candidates through rounds they never sat**
(`assessmentImport.service.js`). `setStageOutcome()` resolves the outcome against the
journey's CURRENT stage, not the stage the CSV is about. Re-importing an older Evalground
export for someone since moved to Tech 1 approved them out of **Tech 1** and advanced them
to Tech 2. Now gated on the journey actually sitting on `assessment` and still open;
anything else records the result and leaves the decision to a human. Only ever reachable
with `assessment_auto_advance_enabled` ON (default OFF).

**Attendance sweep auto-no-showed every staging interview** (`jobs/interviewOccurrence.js`).
`MS_ATTENDANCE_ENABLED=true` in dev/staging, but the calendar attendee is the substituted
test inbox — so matching on the real candidate address found them absent every time,
marked the interview `no_show`, and sent a no-show alert. Now the sweep matches the address
that was actually **put on the invite**, keeping both ends symmetric. No-op in production.
Pre-existing; not introduced by this work.

**Server error messages never reached the user** (14 sites). The axios interceptor in
`services/api.js` rejects a *flattened* `{status, message, data}` — there is no
`err.response`. Every site reading `err.response?.data?.message` without an `err.message`
fallback silently showed its generic text instead, including two written in this pass. So
"3 open candidates are currently on this stage" and the new 409s were being swallowed.
Fixed across `PipelineDrawer`, `PipelineConfigPanel`, `Settings`, `AnalyticsLegacy`,
`CandidateDetail`, `EmailManagement`, `VendorDashboard`.

**Consolidated feedback is now rendered.** It was returned by the API in the first pass but
nothing displayed it; it now heads the scorecard report modal, with low-rated skills called
out as concerns.

### Verified working, not merely built

Live against real Microsoft Graph: full interview round-trip (calendar event, Teams join
URL, meeting id, invite stamped), reschedule, cancel. The decisive check for the
non-production rule — reading the event back from Graph:

```
ATTENDEES ON THE REAL EVENT:  n8npankajmondal@gmail.com
candidate on file          :  qa.phase3.candidate3@example.invalid
RESULT                     :  candidate is NOT on the invite
```

Also confirmed live: concurrent approvals → one 200 / one 409 and **one** email; closed
journeys reject outcome/advance/email with 409; invalid `final_outcome_key` → 400; stage
deactivation blocked with a live count; offer decision needs explicit `amend`; document
token closes on completion and re-opens on rejection; reminder sweep respects its
thresholds; vendor cc dropped; closure email suppressed by policy; fail-closed guard throws
on a blank test inbox.

**A design point confirmed rather than broken:** `rpa_candidate_pipeline` carries two
*partial* unique indexes — `(cv_id, mrf_id) WHERE mrf_id IS NOT NULL` and
`(cv_id) WHERE mrf_id IS NULL`. Concurrent-MRF journeys work exactly as designed; only
MRF-less journeys are one-per-candidate.

### Still not audited

`PipelineDrawer.jsx` was reviewed for error handling, the no-show vocabulary (matches the
backend), and the report modal — **not** line by line across all 2,700 lines.

## Not done

- **`prisma/seed-email-templates.js` has NOT been run.** It upserts by name, so
  it overwrites the subject/body of all ~34 existing templates with the seed's
  canonical copy — any template edited through the UI would lose those edits.
  Run it deliberately, per environment, after checking that.
- **Company scoping is still absent across Phase 3** (`listPipeline` filters on
  request params only; no Phase 3 service references `company_id`, and no Phase 3
  controller calls the existing `assertSameCompany` helper). Any authenticated
  user with the module sees and mutates every company's journeys. This belongs to
  M6's isolation audit, which is out of scope here — raised so the exclusion is a
  decision rather than an oversight.
- `authenticate()` still accepts a JWT from `req.query.token`, putting session
  tokens into access logs and referrers. Same M6 caveat.
- Free/busy display and candidate self-scheduling (M3) are deferred to their own
  plan. Zeko M3b remains blocked on the API validation spike.
