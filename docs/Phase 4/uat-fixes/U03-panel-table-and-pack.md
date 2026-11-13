# U03 · Candidate table in the panel invite body, plus a slimmer pack
**Release 2 · High · ~16 h · Depends on: the U01 Handoff (`summary.cv`, `pack` preview) and the U02 Handoff (base64 `fits()`)**

**Goal**
- **Today:** the panel invite has a one-line-per-round block and an attached report. Interviewers and the CHRO/CEO don't open attachments.
- **Change:** the invite body shows Chhaya's table, filled with the rounds done so far. CTC shows only on HR and CEO rounds.
- **Done when:** a Tech 2 invite shows Zeko, Evalground and Tech 1 in the table without CTC, and a CEO invite shows CTC.

**Also in scope** (Process Phases sheet, row 15):
- Tech 2/3 interviewers need only the consolidated interviewer feedback, with interviewer names.
- For the CHRO/CEO, remove "when moved" and "What is in this pack", and put the position details last.

**Decision on Source:** a checkbox in the Schedule window, **off** by default, shows the vendor source to the panel. Referral candidates are never shown (Phase 3 rule).

**Not changed:** the dossier download.

## Current state (verified)
- **The panel body** is `wrapBrandedEmail(ensureRecordingNotice(ensureTeamsBlock(panelBody)) + pack.blockHtml)` (`backend/src/services/interviewSchedule.service.js:1065-1074`; reschedule `:1572-1575`). The block is appended outside the template and isn't in the modal preview.
- **The one-line block** is in `backend/src/utils/panelPackBlock.js:24-97` (`hasEarlierResults`, `earlierRoundLines`, `buildEarlierRoundsBlock`).
- **The template** is "Interview Scheduled — Panel" (`backend/prisma/seed-email-templates.js:638-642, 896-904`). That seed **overwrites** existing rows, whereas `seed-interview-email-templates.js` only creates them.
  - Tokens come from `interviewTokens()` (`interviewSchedule.service.js:711-733`) and `buildInterviewEmails` (`:743-768`).
  - The preview is `previewScheduleEmails` (`:815-848`).
  - The post-booking re-send uses "Candidate Pack for Interview Panel" (`backend/src/services/interviewEmailTemplates.js:41-48`, rendered at `interviewPanelPack.service.js:191-199`).
  - `compileTemplate` is at `emailNotification.service.js:395-419` and `renderInterviewTemplate` at `interviewEmailRender.js:23-35`.
- **The redaction guard:** `assertNoForbiddenFields` (`interviewPanelPack.service.js:79`; rules in `backend/src/utils/dossierRedaction.js:118-230`) forbids CTC, `jobsource` and any `*_ctc_*` key in the dossier model. So **CTC, source and email must stay out of the model.**
- **Stage keys** (`backend/src/config/pipelineStages.js:16-28`): `zeko_hr, assessment, zeko_fn, tech1, tech2, tech3, hr_round, ceo, client, documents, offer`.

**Where each field comes from**

| Field | Source |
|---|---|
| CTC | `rpa_cv.CTC_LPA`, `ExpectedCTC_LPA` (`schema.prisma:93-94`); HR scorecard `hr_current_ctc` / `hr_expected_ctc` |
| Notice | `NoticePeriod` |
| Qualification | `HighestQualification` |
| Experience | `TotalExperienceYears` |
| Source | `JobSource` |
| Date applied | `createdAt` |
| Zeko | `fetchZekoRounds` (`candidateDossier.service.js:214-259`) |
| Evalground | `fetchAssessments` (`:423-479`) |
| Scorecards | `getCandidateScorecardReport` (`interviewScorecard.service.js:816-894`) |
| Recordings | `collectRecordingShareLinks` (`candidateDossier.service.js:85-125`) |
| Consolidated feedback | `candidateDossier.service.js:684-714`. It is one summary text, **with no interviewer names**. |

- **The report renderer:** `renderDossierHtml` (`backend/src/exports/candidateDossier.export.js:498`, sections at `:864-889`). "Moved" events go into Progress so far (`candidateDossier.service.js:567-590`).

## Changes
1. **New `backend/src/utils/panelCandidateTable.js`**, a pure function: `buildPanelCandidateTable({ facts, rounds, stageKey, showSource })`. It returns an email-safe inline-styled table (no CSS classes). Rows, in this order:
   1. date applied
   2. name
   3. role
   4. source, *only when `showSource`*
   5. notice
   6. qualification
   7. email
   8. total experience
   9. Zeko functional, plus Zeko HR if it was done
   10. Evalground
   11. current CTC, *only when `stageKey` is `hr_round` or `ceo`*
   12. expected CTC, *same condition*
   13. for each **completed** round in order, a feedback row ("interviewer · recommendation · avg x/5 · short comment") and a recording row (share link, or none)

   Rounds not yet done are left out. Missing values use the existing empty-data token (`docs/changelog/CHANGES-empty-missing-data-token.md`).
2. **Loader** in `interviewPanelPack.service.js`:
   - The rounds come from the dossier model and links already built in `buildPanelPack`.
   - `facts` (email, CTC, source, notice and so on) come from a **separate** `rpa_cv` query. They never enter the model.
3. **Wiring:**
   - Add a `{{candidate_table}}` fragment to the panel template's code default and to its placeholders (in `seed-email-templates.js`, mind the overwrite behaviour).
   - If a DB template has no token, append the table after the body. It replaces `pack.blockHtml`.
   - `previewScheduleEmails` returns `candidate_table_html`, and the modal shows it read-only under the panel body.
   - Use it in schedule, reschedule and the post-booking re-send.
4. **Source checkbox** in `frontend/src/components/pipeline/PipelineDrawer.jsx`, in the Schedule window near the pack checkbox at `:3616-3628`:
   - Label: "Show the candidate's source (vendor) to the panel". Default off.
   - Sent as `show_source` and read in `backend/src/controllers/pipeline.controller.js:460, 520`.
   - Disabled, with a note, when the candidate is a referral. Find how referral is flagged with `Grep referral backend/src/services/referral.service.js`.
5. **Pack slimming:** `renderDossierHtml(model, { variant = 'download' })`. The `download` output must stay **byte-identical**.
   - **`panel_tech`** (`tech1/2/3`): the header and the consolidated interviewer feedback with names only. When there is no feedback (usually Tech 1), don't attach the report.
   - **`panel_leadership`** (`hr_round`, `ceo`): the order is
     1. profile
     2. progress so far, without the `moved` events
     3. consolidated feedback with names
     4. interview history & recordings
     5. scorecards, AI screening, assessment
     6. the position, **last**

     Drop section 10, "What is in this pack".
   - Add `consolidated_by_interviewer: [{round, interviewer, recommendation, average, comments}]` to the model, from the scorecard report.

## Tests
- **Unit:** the table (row order, CTC and source gating by stage, rounds so far, a referral with the checkbox ticked) and the renderer variants (a `download` snapshot unchanged). `node --test src/tests/unit/dossierRedaction.test.js` must still pass.
- **Integration:** `node src/tests/run-block.mjs src/tests/integration/panelPack.test.js`. A Tech 2 booking shows Zeko, Evalground and Tech 1 without CTC; a CEO booking shows CTC.
- Check rendering in Outlook desktop and OWA.

## Handoff
**Status: built and tested, 10 Nov** (local backend against the staging DB, nothing sent). Write-up: `docs/changelog/CHANGES-2026-11-10-U03-panel-table-and-pack.md`.
- **Table, `utils/panelCandidateTable.js` (pure):** `buildPanelCandidateTable({facts, rounds, stageKey, showSource, linksPending})` and `panelTableRounds(model, {excludeStageKey})` → `{zeko: {functional, hr}, evalground[], interviews[]}`. It gates CTC with `showsCtc(stageKey)` and Source with `sourceShown(showSource, facts)` (`facts.referral` wins). `placeCandidateTable(html, table)` and `insertBeforeCandidateTable(html, extra)` work with `CANDIDATE_TABLE_PLACEHOLDER`, which is what `{{candidate_table}}` compiles to.
- **Loader, for U07:** `loadPanelCandidateTable(pipelineId, {stageKey, showSource, model, linksPending})` → `{html, showSource, referral}`. It never throws. `model` is `buildPanelPack().tableModel` (with recording links); without it, the loader builds one with no links. Add `includeEarlierRoles` here and pass it on to `panelTableRounds`.
- **Pack:** `buildPanelPack(id, {user, attachProfile, stageKey})` now also returns `notesHtml` and `tableModel`; `blockHtml` is still there. `packVariantFor(stageKey)` and `buildPackNotes()` live in `panelPackBlock.js`. `renderDossierHtml(model, {variant})` takes `download`, `panel_tech` or `panel_leadership`. The model adds `consolidated_by_interviewer` and `recordings[].stage_key`. `interviewerNameFor()` is in `utils/dossierModel.js`.
- **API:** `show_source: true` on schedule, reschedule and send-pack; `?show_source=true` on both previews, which return `candidate_table_html`.
- **Tests:**
  - unit: `panelCandidateTable` 18/18, `candidateDossier` 127/127 (the download sha256 matched git HEAD before the change), `panelPack` 15/15, `dossierRedaction` 43/43
  - `npm run test:unit`: 1087/1090. The 3 failures are location SQL-builder tests: `screeningFilters.js` was being edited by another chat at 16:01 (U04?), and U03 doesn't touch it. A first run instead failed `fileSignature.test.js` at file level; it passes alone 23/23.
  - integration: `panelPack.test.js` 12/12
  - `npm run build` passes; sample invites checked in headless Edge
- **Left over:**
  - (1) Outlook desktop / OWA not checked. Do one real send to our own address in R2 UAT.
  - (2) No Playwright run of the Source checkbox or the table preview.
  - (3) `seed-email-templates.js` overwrites every template it seeds, so it was not run. Stored panel templates get the table after their body. U11 decides whether to reseed; it would also drop the "Candidate email" line.
  - (4) The brief's "empty-data token" doc is about portal links, so missing values use the dossier's `—`.
  - (5) A Zeko score uploaded on `rpa_cv.ZekoInterviewScore` stands in when there is no Zeko result.
