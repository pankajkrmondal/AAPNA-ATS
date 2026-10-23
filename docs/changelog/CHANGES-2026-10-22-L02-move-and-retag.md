# L02-A · Move to another JD, L02-B · Remove or switch a JD tag

**Date:** 22 Oct 2026 · **Plan:** `PLAN-Phase3-in-Phase4.md` L02, revised with Harish on 22 Oct. The design was approved on the L01/L02 design canvas.

**Status:**
- **DDL `2026-10-22-journey-move.sql` is applied on staging** (`recruitmentautomationdb`).
- **Tested on 22 Oct against the staging database:**
  - unit tests pass;
  - new `integration/journeyMove.test.js` passes 4/4;
  - no email was sent by any move, to the candidate or the vendor;
  - regressions pass: `sectionB` 9/9, `sectionG` 5/5, `candidateDataSync` 6/6, `crossModuleE2E` 6/6, `pipelineClosure` 22/22, `pipelineStageEngine` 17/17 (run with `FLEXIBLE_STAGES_ENABLED=false`; with the flag on, its three skip-guard tests fail by design, because flexible stages lift that guard);
  - the frontend builds.
- **Test fixes made along the way:**
  - `pipelineClosure` now expects 9 closure outcomes;
  - its vendor lock date was a fixed 2026-10-03, which had expired; it is now 30 days from today;
  - `helpers/fixture.js` teardown used a non-existent `shortlist_id` on the Zeko table; it now uses `candidate_id`.
- **Not checked in the browser yet.** Harish found and we fixed the landing-stage dropdown in the Move dialog: it sat inside the radio button's label.
- Nothing is deployed or committed.

**Decisions (Harish, 22 Oct):**
- A move closes the old record and starts the new JD from scratch by default. A chosen stage is optional. Stages can then be done in any order (flexible stages).
- The old role's data must stay available at any time after the switch. Nothing is copied or deleted; the new record shows it under "Earlier roles for this candidate".
- If the candidate has only one JD, it can only be switched, never removed. This applies especially in the pipeline.

---

## What users see

**Pipeline drawer**
- A **Move to another JD** button on open records. The dialog has:
  - the new JD (open MRFs, minus any the candidate is already on);
  - **Start from scratch** (default), or **A chosen stage**;
  - a required reason;
  - "Email the candidate", off by default.
- After the move, the drawer opens the new record. It shows:
  - a "Moved from …" banner with "Open earlier record";
  - **Earlier roles for this candidate**, expanded: each other JD's results (Zeko, Evalground, scorecards, report and recording links), its stage history, and "Open full record".
- The old record shows the tag "Moved to another JD" and a "Moved to …" banner.
- Approving on the new JD with no score there yet pre-fills the required note with the earlier role's result for that stage. The recruiter can edit it.

**Search Candidate → candidate view → "JD tags"**
- The **×** removes a wrong tag, only while another tag remains and the JD is not in the pipeline. It asks for a reason.
- **Switch JD** handles the last tag, or a JD in the pipeline:
  - a tag not in the pipeline is replaced with the picked JD;
  - a JD in the pipeline opens the Move dialog.
- "Pipeline scores" labels journeys "Moved to …" / "Moved from …".

**Emails**
- None by default. The old record closes silently for both the candidate and the vendor.
- Upcoming interviews on the old record are cancelled, and only the panel is told (existing closure behaviour).
- An offer blocks the move.

## Rules
- **Move** (`backend/src/utils/journeyMove.js`):
  - open, not paused, no offer;
  - a stage rejection does not block, and the cool-off is not applied;
  - the target JD must be open and approved, and the candidate must not already be on it;
  - the landing stage must be an active board stage.
- **Tags** (`backend/src/utils/candidateTag.js` `tagChangeBlock`, `tagActions`):
  - remove: not the only tag, not in the pipeline;
  - switch: not in the pipeline (use Move instead).

## Code

**Database:** DDL `backend/prisma/ddl/2026-10-22-journey-move.sql` + rollback.
- `rpa_candidate_pipeline.moved_from_pipeline_id`, indexed.
- `'moved'` added to the shortlist `pipeline_status` CHECK.
- `schema.prisma` is updated by hand. Run `prisma db pull` after the DDL.

**Backend**
- `config/pipelineStages.js`:
  - `FINAL_OUTCOMES.MOVED_TO_OTHER_JD`, labelled "Moved to Another JD";
  - `SHORTLIST_STATUSES.MOVED`, which is terminal;
  - the `shortlistStatusFor` mapping.
- `stageNotification.service.js`: the new outcome is silent.
- `pipeline.service.js`:
  - `setFinalOutcome` takes `notifyVendor`;
  - `createPipelineJourney` takes `move` (start stage, kept vendor attribution, no cool-off, no journey reuse, link);
  - `getCandidatePipelineScores` adds moved-from/to, the outcome label, recording links and optional events;
  - new `getRelatedJourneys`.
- `services/journeyMove.service.js` (new): the move happens in three steps.
  1. Create the new shortlist row under the advisory lock.
  2. Close the old journey silently.
  3. Create the new journey.

  If step 3 fails, the old journey is reopened and the new row removed. Then the tag (`move`), the FinalStatus and the screening cache are updated, and the optional email is sent.
- `candidateTag.service.js`: `listCandidateTags`, `untagCandidate`, `switchCandidateTag`, audited in `rpa_processing_log` (source `JD_TAG`).
- `screening.service.js`: re-adding a candidate to a JD they were moved from is skipped as `moved_away` ("reopen the old record").
- `POST /api/pipeline/:id/closure` refuses `moved_to_other_jd`.
- Routes:
  - `GET` / `POST /api/pipeline/:id/move-jd`
  - `GET /api/pipeline/:id/related-journeys`
  - `GET /api/candidates/:id/tags`, `DELETE /api/candidates/:id/tags/:mrfId`, `POST /api/candidates/:id/tags/:mrfId/switch` (all staff)

**Frontend**
- New: `components/pipeline/MoveJdModal.jsx`, `components/pipeline/EarlierRolesSection.jsx`, `components/candidates/CandidateTagsSection.jsx`
- `PipelineDrawer.jsx` (button, banners, section, pre-filled note), `pages/Pipeline.jsx` (`onOpenJourney`), `PipelineScoresSection.jsx`, `CandidateDetailCard.jsx`, `services/pipeline.js`, `services/candidateService.js`

## Release steps
1. Apply `2026-10-22-journey-move.sql` (done on staging; production at release), then run `prisma db pull` / `generate`.
2. Deploy the backend, then the frontend.

## Still to test
- Run `journeyMove.test.js` on staging.
- Re-run `pipelineClosure`, `crossModuleE2E`, `sectionB`, `sectionG` and `candidateDataSync`.
- Browser:
  - a move at a chosen stage, and from scratch;
  - the banners and "Earlier roles";
  - remove and switch on the tag chips;
  - a vendor receives no email on a move.
