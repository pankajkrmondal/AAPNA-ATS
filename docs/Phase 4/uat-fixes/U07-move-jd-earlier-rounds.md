# U07 · Move to another JD: the JD by default, and the earlier role's rounds
**Release 2 · Medium · 8 h · Depends on: the U03 Handoff (table loader signature)**

**Goal**
- **Today:** moving a candidate sends no email unless the box is ticked, and the next interviewer sees nothing from the earlier role.
- **Change:** the "send the new JD" box is ticked by default, and the panel table and report include the earlier role's rounds.
- **Done when:** a moved candidate gets the JD, and the next interviewer sees the earlier role's scores.

## Current state (verified)
**The modal and its email**
- `frontend/src/components/pipeline/MoveJdModal.jsx`: the checkbox state is `useState(false)` (`:40`), reset at `:52` and rendered at `:211-214`.
- The controller sends only when `notify_candidate === true` (`backend/src/controllers/pipeline.controller.js:1080`).
- The email goes through `sendShortlistEmail` with the new JD (`backend/src/services/journeyMove.service.js:244-266`).

**How a move is stored.** It creates a new shortlist row and a new journey with `moved_from_pipeline_id` (`journeyMove.service.js:157-190`; `pipeline.service.js:2430-2442`; column `schema.prisma:821`).

**The panel only sees the current journey.** The dossier and panel pack are scoped to the current `pipeline_id`:
- scorecards, schedules and recordings: `candidateDossier.service.js:505-543`
- assessments: `:423-428`
- Zeko is looked up by the **current** `shortlist_id` (`:217-220`)

**Where earlier roles show up today.** Only in the drawer: `getRelatedJourneys` / `getCandidatePipelineScores` (`pipeline.service.js:1071-1206`) and `EarlierRolesSection.jsx`.

`ChangeJdModal` is a separate correction flow. **Leave it unchanged.**

## Changes
1. `MoveJdModal.jsx`: default `true` at `:40` and `:52`.
2. **Earlier rounds,** in the U03 loader with a panel-only option `includeEarlierRoles: true`:
   - Follow the `moved_from_pipeline_id` chain using `getRelatedJourneys`.
   - For each earlier journey, collect scorecards, assessments, Zeko (by **that** journey's `shortlist_id`) and recording share links (`collectRecordingShareLinks(earlierPipelineId, …)`).
   - Label the rows "Tech 1 · earlier role: <MRF title>". `hasEarlierResults` counts them.
   - The same rounds appear in the panel report (the `panel_tech` / `panel_leadership` variants).
   - The dossier download doesn't change.

## Tests
- Extend `node src/tests/run-block.mjs src/tests/integration/journeyMove.test.js`: move a candidate after Tech 1, then book Tech 2 on the new JD. The table and the report show the earlier Tech 1.
- Run `node --test src/tests/unit/journeyMove.test.js`.
- `cd frontend && npm run build`

## Handoff
**Status: built and tested, 10 Nov** (local backend against the staging DB, nothing sent). Write-up: `docs/changelog/CHANGES-2026-11-10-U07-move-jd-earlier-rounds.md`.
- **Frontend:** `MoveJdModal.jsx` has `notify` set to `true` at init and on reopen, and the hint text is updated. There is a line in `UI-CHANGELOG.md`.
- **Merge helper, `utils/panelEarlierRoles.js` (pure):** `mergeEarlierRoles(model, [{role, model}])` puts the earlier rounds first and returns a new model with `earlier_roles: [title]`. A second call is a no-op. Relabelled items carry `earlier_role`, `earlier_label` and `earlier_seq`. On scorecards, named feedback and recordings, `stage_key` is null and the original is kept as `earlier_stage_key`. The file also has `earlierRoleHasResults(model)` and `earlierRoleLabel(label, role)`.
- **Service, `interviewPanelPack.service.js`:**
  - `earlierJourneyIds(pipelineId)` walks `moved_from_pipeline_id`, oldest first, up to 5 journeys and the same `cv_id` only.
  - `loadEarlierRoleModels(pipelineId, {user, recordingLinks, includeAssessmentDetail})` builds the earlier models.
  - `buildPanelPack` and `loadPanelCandidateTable` take `includeEarlierRoles` (**default true**).
  - `panelPackPreflight().report` counts earlier roles.
- **Table:** `panelTableRounds()` interviews gain `earlier_role`, and `zeko` gains `earlier: [{screening, role, overall, …}]`. Evalground items gain `role`.
- **Deviation from the brief:** the chain is walked with a direct `prisma` query, not `getRelatedJourneys`. That function scores every journey of the candidate, including ones not moved from, and importing `pipeline.service` here would risk an import cycle.
- **Tests:**
  - unit: `panelEarlierRoles` 10/10 (new), `panelCandidateTable` 18/18, `panelPack` 15/15, `candidateDossier` 127/127, `dossierRedaction` 43/43, `journeyMove` 11/11
  - `npm run test:unit`: 1121/1121
  - integration: `journeyMove.test.js` 5/5, 1 new
  - `npm run build` passes
- **Left over:**
  - (1) Not run, following the conventions: `panelPack.test.js` (integration) and a Playwright check of the ticked box.
  - (2) There was no real move with the email on. Do one to our own address in R2 UAT.
  - (3) The leadership report's "Interview history" lists only this journey's bookings. The earlier role's recordings are listed under it.
