# U10 · Completed forms: an Analytics view plus a morning bell note
**Release 2 · Medium · ~5 h · Depends on: none**

**Goal**
- **Today:** a bell alert per candidate only.
- **Change:** HR can see the forms completed each day, grouped by JD, and get a morning bell note.
- **Done when:**
  - the Analytics "Completed forms" tab shows yesterday's forms by JD
  - HR and Admin get a 09:00 IST bell note that links to the tab

**Decision:** an Analytics view and a bell note only. **No email.**

## Current state (verified)
**The per-candidate bell today**
- `submitPublicMissingData` (`backend/src/controllers/candidate.controller.js:433`) sets `rpa_cv.details_completed_at` on the first completion (`:691-697`).
- `onMissingDetailsCompleted` (`:384-426`) then calls `notify({type: 'candidate.details_completed'})`.
- `notify` (`backend/src/services/notification.service.js:51-53, 104-157`) writes one row per **active recruiter**. It has no role option.

**Grouping by JD already exists.** The "Responded" definition is in `backend/src/services/mrfApplicants.service.js:54-205`. JD links come from `rpa_candidate_mrf_tags` or the open journey's `mrf_id`.

**Code to reuse**
- **IST ranges:** `backend/src/utils/analyticsRange.js:52-81`.
- **Analytics tabs:** `frontend/src/pages/Analytics.jsx:995-1107`. The drawer patterns are `components/analytics/MetricCandidatesDrawer.jsx` and `RoleDetailDrawer.jsx`.
- **Routes** sit near `backend/src/routes/pipeline.routes.js:25-45`.
- **Jobs:** `runJob` (`backend/src/utils/jobRunner.js:51-106`) and registration in `backend/src/server.js`. `mrfHoldSweep.js:57` is the IST cron precedent.

## Changes
1. **Backend:** `GET /api/pipeline/analytics/completed-forms?from&to`, defaulting to yesterday, IST.
   - Returns `{ range, total, groups: [{ mrf_id, title, count, candidates: [{ cv_id, name, completed_at }] }] }`.
   - Candidates with no tag and no journey go under "No JD yet".
   - Reuse the `mrfApplicants` query pieces rather than writing new SQL.
2. **Frontend:** a **"Completed forms"** tab in `Analytics.jsx`.
   - A range picker with presets Yesterday (the default), Today and Last 7 days.
   - One row per JD with its count, expanding to the candidates, each linking to the profile.
   - Read `?tab=completed-forms&range=yesterday` from the URL so the bell link opens it directly.
3. **Bell note:** `backend/src/jobs/completedFormsDigest.js`, `0 9 * * *`, `{ timezone: 'Asia/Kolkata' }`, wrapped in `runJob` and registered in `server.js`.
   - One `notify` of the new type `candidate.forms_digest`: "12 forms completed yesterday across 4 JDs", linking to the tab.
   - Add a role-targeting option to `notify`, so only **HR and Admin** roles get it.
   - Nothing is sent when the total is 0.
   - Add an env switch `FORMS_DIGEST_ENABLED`, documented in `docs/system/05-CONFIGURATION.md`.

## Tests
- **Unit:** the IST "yesterday" window and the grouping, including "No JD yet".
- **Integration:** the endpoint on staging, and a dry run of the job (log the note without writing it).
- `cd frontend && npm run build`, plus a browser check of the tab.

## Handoff
**Built and tested on 11 Nov 2026.** Write-up: `docs/changelog/CHANGES-2026-11-11-U10-completed-forms.md`.
- **New files:**
  - backend: `services/completedForms.helpers.js` (pure), `services/completedForms.service.js`, `jobs/completedFormsDigest.js`
  - tests: `tests/unit/completedForms.test.js`, `tests/integration/completedForms.test.js`
  - frontend: `components/analytics/CompletedFormsTab.jsx`, `e2e/u10-completed-forms.spec.js`, `playwright.u10.config.js`
- **Changed:** `mrfApplicants.service.js` (`completedFormsWithMrf(mrfs, range, limit)`), `notification.service.js` (type `CANDIDATE_FORMS_DIGEST`, `targetRoles`, `resolveRecipients` now exported and narrowed), `config/roles.js` (`recruiterTierSubset(roles)`), `config/index.js` (`formsDigest.enabled` / `.roles`), `pipeline.controller.js` / `pipeline.routes.js`, `server.js`, `Analytics.jsx`, `services/pipeline.js` (`getCompletedForms(params)`).
- **Helpers:** `parseFormsRange(query, now)`, `yesterdayRange(now)`, `groupCompletedForms(rows, titleOf)`, `digestNote(...)`, `formsTabLink(range)`, `planDigest(...)`, `claimDigestDay(day, db)`, and the job's `sendCompletedFormsDigest({ dryRun, now, roles })`.
- **Differences from the brief:**
  - `notify` already had a `roles` param. It now narrows only, so vendors are never reached.
  - The bell link carries `from` / `to` dates rather than `range=yesterday`, so a note read late still shows the right day. The tab also reads `range=`.
  - Each candidate gets **one** JD: the open journey's MRF, else the latest tag or Position Applied match, else "No JD yet".
  - "HR and Admin" = superadmin, admin, hr_admin_recruiter and hr. This can be changed with `FORMS_DIGEST_ROLES`.
- **Tests:** unit 26/26 (new suite), full unit 1178/1178, integration 7/7 on staging (job dry run reached 2 users), `npm run build` passes, Playwright 4/4 with a mocked API.
- **Left for R2 / U11:**
  - Set `FORMS_DIGEST_ENABLED=true` on staging. Production stays `false` until R2.
  - HR to confirm plain recruiters should not get the note.
  - At 1366 px, "Email Delivery" moves into the tabs' "…" menu.
  - No real note has been sent yet: check the first 09:00 bell on staging.
