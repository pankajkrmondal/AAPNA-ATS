# U03b · Skipped rounds with no gaps, and the two panel templates (12 Nov 2026)
Brief: `docs/Phase 4/uat-fixes/U03b-skipped-rounds-and-panel-templates.md`. It goes live with R16 (16 Nov).

**What changed**
- The panel invite's candidate table shows a round only if it really happened:
  - **Recruiter round notes** (rpa_cv) show under a round this journey reached. If only an earlier role reached it (the U07 chain), the note shows under that role, labelled "· earlier role: <title>". A note for a round that was skipped, or that no journey reached, is dropped.
  - "Skipped" means the stage-state row, or the stage named in a `skip` event. The event covers flexible stages, where a bypassed stage keeps no state row.
  - **Recordings** get a row only when their booking was held (not cancelled, not a no-show).
  - Scorecard rows and the report gating are unchanged. Numbering stays continuous.
- `backend/scripts/refresh-panel-invite-templates.mjs` refreshes "Interview Scheduled — Panel" and "Interview Rescheduled — Panel" to the U03 defaults, only where the stored text equals a known old default.
  - It is a dry run by default; `--apply` writes. An edited row is never changed.
  - Staging dry run (12 Nov): #23 and #27 are both unedited old defaults.

**Files**
- `utils/panelCandidateTable.js`: `skippedStagesFromEvents`, `bookingHeld`, `journeyRoundEvidence`, `markHeldRecordings`, `roundNoteHome`. `panelTableRounds` takes `evidence`.
- `utils/panelEarlierRoles.js`: the merge adds `earlier_role_ids`, and a recording from an unheld booking is not a result.
- `services/interviewPanelPack.service.js`: new `loadRoundEvidence(pipelineId)`, used by `buildPanelPack` (`tableModel.round_evidence`), `loadEarlierRoleModels` and `loadPanelCandidateTable`.
- Tests: `panelCandidateTable.test.js` (8 new cases) and the new `refreshPanelTemplates.test.js`.
- `docs/deployment/PHASE3-PRODUCTION-DEPLOYMENT.md`: the script is in the seed step.
