# U10b · Responded view inside Open Positions (replaces the Completed Forms tab)
**12 Nov feedback · goes live 16 Nov (R16) · ~4 h · Depends on: the U10 Handoff**

**Goal**
- **Today:** U10 added a separate "Completed Forms" tab in Recruitment Analytics. Open Positions already shows "Responded" per position, and the two counts differ.
- **Change (HR, 12 Nov):** "Open Positions has Responded within it. Revise what we did in the new tab."
- **Done when:**
  - Open Positions has a Responded view that lists candidates by JD for Yesterday (the default), Today, Last 7 days or chosen dates.
  - Its per-JD counts equal the Responded column for the same dates.
  - The Completed Forms tab is gone.
  - The 09:00 bell opens the new view.

## Current state (verified 12 Nov)
**Open Positions:**
- Route `/analytics`, tab key `open` (the default), at `frontend/src/pages/Analytics.jsx:668, 1029-1047`.
- It renders `frontend/src/components/analytics/PositionsTab.jsx`, which calls `GET /api/pipeline/analytics/positions?from&to` (`services/pipeline.js:34`, `PositionsTab.jsx:105`).
- The board is one row per MRF, with an Open/Closed/All switch (`:30-34, 113-117`).

**Where Responded appears today:**
- A sortable column; its number opens `MetricCandidatesDrawer.jsx` for that one MRF (`:184`, `pipeline.js:44`).
- A summary tile, "Responded · N% of applied" (`:73`). It isn't clickable, and it is a sum of rows, so a candidate linked to two JDs counts twice (`openPositions.service.js:272`).
- The role view, `?tab=open&mrf=<id>` (`RoleDetailDrawer.jsx:43, 205, 267-288, 321`).

**The page date range:** `AnalyticsRangeBar.jsx`, with 7/30/60/90/365 days, All and custom dates. The default is 7 days (`openPositionsShared.jsx:50-58`). There is no Yesterday or Today, and the range isn't in the URL (`Analytics.jsx:675`).

**What "Responded" means** (`backend/src/services/mrfApplicants.service.js`):
- `factsCte` (`:54-101`) gives one row per (MRF, CV): a tag, or a "Position Applied" match (`:66-85`).
- `responded_at` (`:93-98`) is `details_completed_at`. Otherwise it is `details_requested_at` when the token status is RECEIVED. Otherwise it is `createdAt` when the CV was never asked and is ACTIVE.

**What U10 built:**
- `completedFormsWithMrf` (`:221-251`) uses `details_completed_at` only, and counts each candidate once: open-journey MRF, else the latest link, else "No JD yet".
- Endpoint: `pipeline.routes.js:48`, `pipeline.controller.js:190-193`, `completedForms.service.js:42-51`, `parseFormsRange` (`completedForms.helpers.js:39-51`).
- UI: `CompletedFormsTab.jsx` has the presets at `:22-26`, `formsRangeFromParams` at `:37-43`, the picker (92-day cap) at `:105-125`, and the table at `:139-167`.
- Analytics wiring: import `:42`, URL sync `:705-716`, `formsRange` / `changeFormsRange` `:718-731`, the tab `:1049-1060`, `FormOutlined` `:32`.
- Bell:
  - `formsTabLink` (`completedForms.helpers.js:138-140`) returns `/analytics?tab=completed-forms&from=D&to=D`, set in `planDigest` (`:160`).
  - The job is `jobs/completedFormsDigest.js:37-75`; the type is `CANDIDATE_FORMS_DIGEST` (`notification.service.js:56`).
  - A click runs `navigate(link_path)` (`NotificationBell.jsx:65-71`).

## Changes
1. **Definition:** in `completedFormsWithMrf`'s `done` CTE (`:225-231`), use the `factsCte` `responded_at` expression (`:93-98`) instead of `details_completed_at` alone. The `factsCte` (MRF, CV) pairing is what the column counts.
   - A candidate linked to two JDs appears under both, as in the column.
   - Unlinked responders go under "No JD yet", last.
   - The headline total counts each candidate once ("N candidates responded across M JDs").
   - Rename the service function to `respondedByJd`, keeping the endpoint path.
2. **MRF set:** the view follows the board's Open/Closed/All switch (default Open). Pass `status` to the endpoint. The bell uses all open positions plus "No JD yet".
3. **UI in `PositionsTab.jsx`:**
   - A `Segmented` control, "Board | Responded", above the board.
   - The Responded tile (`:73`) becomes clickable and opens the Responded view.
   - Move `CompletedFormsTab.jsx` into `components/analytics/RespondedByJdPanel.jsx`. It keeps its own presets (Yesterday default, Today, Last 7 days, custom, 92-day cap), independent of the page range bar. Each candidate links to the profile.
   - The per-row Responded number still opens the per-MRF drawer.
4. **URL:**
   - `?tab=open&view=responded&from=D&to=D` (or `range=`). Move the logic from `Analytics.jsx:718-731`.
   - Map old links (`?tab=completed-forms…`) to the new view at `:708`, because notes already in the database carry them.
5. **Remove** the Analytics tab: `:1049-1060`, and the `FormOutlined` / `CompletedFormsTab` imports if nothing else uses them.
6. **Bell:**
   - `formsTabLink` returns the new URL.
   - `digestNote` says "N candidates responded yesterday across M JDs".
   - `FORMS_DIGEST_ENABLED` / `FORMS_DIGEST_ROLES` are unchanged. The owner decided on 12 Nov: on in staging on 13 Nov and in production on 16 Nov. R16 sets it.
7. **Docs and comments:**
   - `docs/system/05-CONFIGURATION.md:86`
   - `notification.service.js:54-55`, `completedFormsDigest.js:2-4`, `config/index.js:684`
   - `frontend/UI-CHANGELOG.md`
   - changelog `docs/changelog/CHANGES-2026-11-12-U10b-responded-view.md`

## Tests
- **Unit:** `backend/src/tests/unit/completedForms.test.js`: the link assertions at `:165, 184`, the note wording, and a CV with fallback `responded_at` (asked before 14 Oct; never asked).
- **Integration:** `node src/tests/run-block.mjs src/tests/integration/completedForms.test.js` (`:151` link). Add one check that the per-JD count equals the positions endpoint's Responded count for the same range.
- **Frontend:**
  - `cd frontend && npm run build`
  - Update `frontend/e2e/u10-completed-forms.spec.js` (`:48, 81, 103, 120, 127, 146`) for the new location, and rename it `u10b-responded-view.spec.js`.
  - Run it with `playwright.u10.config.js` (mocked API).

## Handoff
**Built 12 Nov.** Write-up: [CHANGES-2026-11-12-U10b-responded-view.md](../../changelog/CHANGES-2026-11-12-U10b-responded-view.md).
- **Backend:**
  - `mrfApplicants.service.js`: `RESPONDED_AT` is shared by `factsCte` and the view. `respondedByJd(mrfs, range, { shownIds, unlinked, limit })` replaces `completedFormsWithMrf`.
  - `completedForms.service.js`: `getRespondedByJd(range, { status })`.
  - `completedForms.helpers.js`: `groupRespondedByJd`, `inStatusFilter`, and the new `formsTabLink` and note wording.
  - `pipeline.controller.js` / `pipeline.routes.js`: handler `getRespondedByJd`. The path is still `/analytics/completed-forms`; it adds `status`.
  - `jobs/completedFormsDigest.js`: the decision for an empty day is `nobody_responded`.
- **Frontend:**
  - `RespondedByJdPanel.jsx` (new; `CompletedFormsTab.jsx` deleted).
  - `PositionsTab.jsx`: the Board | Responded switch and the clickable tile.
  - `Analytics.jsx`: URL sync. Old `?tab=completed-forms` links are mapped.
  - `services/pipeline.js`: `getRespondedByJd`.
- **Docs:** `05-CONFIGURATION.md` (:86, :158), `UI-CHANGELOG.md`, and the comments in `notification.service.js` and `config/index.js`.
- **Run here:** unit `completedForms.test.js` 31/31; `npm run build` passes.
- **For the user to run** (lean mode):
  - integration `node src/tests/run-block.mjs src/tests/integration/completedForms.test.js` (9 tests, including per-JD view = column)
  - `npx playwright test -c playwright.u10.config.js e2e/u10b-responded-view.spec.js` (7 tests, mocked API)
  - the full `npm run test:unit`
- **Left over:** none in scope. `FORMS_DIGEST_ENABLED` is set by R16. F6 re-captures the U10 screen.
