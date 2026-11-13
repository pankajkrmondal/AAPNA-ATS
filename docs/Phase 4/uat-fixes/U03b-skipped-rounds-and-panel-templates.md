# U03b · Skipped rounds with no gaps, and the two panel templates
**12 Nov feedback · goes live 16 Nov (R16) · ~3 h · Depends on: the U03 and U07 Handoffs; run after U02b (both change the email-building code)**

**Goal**
- **HR asked (12 Nov):** "We can skip some rounds. Will the table show only the completed rounds' details, correctly?" and "We should not miss the gaps."
- **Also asked:** refresh the panel templates to remove the duplicate "Candidate email" line, but **"if HR updated, don't change it"**.
- **Done when:**
  - The panel table shows a round only if it really happened, in this journey or in an earlier role that U07 follows.
  - A test covers each skip case.
  - A refresh script fixes the two panel templates only where HR never edited them.

## Current state (verified 12 Nov)
**How a skip is recorded:**
- `pipeline.service.js:1457-1467` logs an `rpa_pipeline_stage_events` row with `event_type: 'skip'`.
- `:1475-1477` marks the bypassed stages `SKIPPED` in the stage-state table, but not when flexible stages are on.
- `advanceStage` does the same at `:1644-1651`.

**Where table rows come from** (`backend/src/utils/panelCandidateTable.js`):
- submitted scorecards (`:178-192`, fed by `interviewScorecard.service.js:819`, `SUBMITTED` only)
- recruiter notes (`:193-195`)
- recordings (`:196-198`)

The builder never reads stage states or events. Numbering is the row's position, so it is always continuous (`:338-339`).

**The gaps:**
1. **Notes from a skipped round:** notes come from `rpa_cv` columns (`dossierRedaction.js:89-95`, `candidateDossier.service.js:743`), which belong to the CV, not the journey. A `TechRoundOne` note from an older journey or an Excel import adds a "Tech 1 feedback" row even when Tech 1 was skipped.
2. **Notes from an older journey:** the same note carries no "earlier role" label (U07 labels only scorecard rows).
3. **Recordings from a cancelled or never-held booking:** these add a row whose feedback cell is "—".

**The report gating is correct and must stay so:**
- A Tech invite attaches the report only if a named scorecard exists (`interviewPanelPack.service.js:196`).
- HR and CEO invites attach it whenever any result exists (`panelPackBlock.js:24-31`).

**The existing tests:** `panelCandidateTable.test.js:136` and `:165`. None of them cover a skip.

**The templates:**
- Stored rows "Interview Scheduled — Panel" and "Interview Rescheduled — Panel" were seeded before U03 and still have a `Candidate email:` line, with no `{{candidate_table}}`. So the table is appended below the old line (`panelCandidateTable.js:356-361`).
- The new defaults are at `seed-email-templates.js:642-646, 669-675` (U03, commit `4102495`).
- That seed **overwrites every template it covers** (`:1254-1260`), so it must not be run.

## Changes
1. **Round evidence:** pass the journey's stage states and skip events into the table data, wherever the panel pack loads the candidate (`interviewPanelPack.service.js` and the U07 earlier-role loader). `Grep` for the function first. Then:
   - Drop a **note** row when the current journey marks that stage `SKIPPED`. With flexible stages on, use the `skip` events instead.
   - Drop a note row when no journey in the U07 chain reached that stage.
   - When the stage was reached only in an earlier role, label the note "· earlier role: <title>", as U07 does.
   - Show a **recording** row only for a held booking (not cancelled, not a no-show), in the journey or role it belongs to.
   - Scorecard rows are unchanged.
2. **Refresh script** `backend/scripts/refresh-panel-invite-templates.mjs`:
   - It is a dry run by default; `--apply` writes.
   - It touches only the two panel templates, by name.
   - For each row it compares the stored subject and body with the **old default**, taken from `seed-email-templates.js` at `4102495^`. Embed the old text in the script, so it works without git on the server.
     - **Unedited** (equal after whitespace normalisation): replace it with the new default.
     - **Edited**: never change it, with no override. Print "HR edited <name>; left as is. Remove the 'Candidate email:' line by hand on the Email Templates page."
   - It prints a one-line result per row.
3. **Docs:** the changelog `docs/changelog/CHANGES-2026-11-12-U03b-skipped-rounds.md`, and the script in `docs/deployment/PHASE3-PRODUCTION-DEPLOYMENT.md`'s seed list.

## Tests
- **Unit** `backend/src/tests/unit/panelCandidateTable.test.js`, new cases:
  - Tech 1 skipped; Tech 2 skipped; both skipped
  - skips with flexible stages on (events only)
  - HR and CEO invites after skips
  - a moved candidate with a skip in the earlier role
  - a stale CV note with no matching stage
  - a recording from a cancelled booking
  - Each case asserts the row list, continuous numbering, and the report gating (with `panelPack.test.js`).
- **Unit:** the refresh script's compare function (unedited → replace; edited → keep).
- **Integration:** `node src/tests/run-block.mjs src/tests/integration/panelPack.test.js`.
- **Staging:** run the script dry, read its output, then `--apply`. Re-preview one Tech 2 invite and check that there is no duplicate line.

## Handoff
**Status: built, 12 Nov** (F4 chat). Unit tests only, per lean mode; nothing was written to staging. Write-up: `docs/changelog/CHANGES-2026-11-12-U03b-skipped-rounds.md`.
- **Table** `utils/panelCandidateTable.js` (pure):
  - `skippedStagesFromEvents(events, labelByKey)` reads all three skip-note wordings. `bookingHeld(b)` means not cancelled and not a no-show; an unconfirmed booking with a recording counts as held.
  - `journeyRoundEvidence({states, skipEvents, labelByKey, recordingBookings})` returns `{reached, skipped, recordings:[{stage_key, held}]}`.
  - `markHeldRecordings(model, recordings)` sets `booking_held` by position on the journey's own recordings. It does nothing when the lists don't line up.
  - `roundNoteHome(stageKey, evidence)` returns `{current}`, `{earlier: i}` or null.
  - `panelTableRounds(model, {excludeStageKey, evidence})`. With no evidence, it behaves as before.
- **U07 helper** `utils/panelEarlierRoles.js`: `mergeEarlierRoles` adds `earlier_role_ids`. `earlierRoleHasResults` ignores a recording with `booking_held === false`.
- **Service** `interviewPanelPack.service.js`:
  - New `loadRoundEvidence(pipelineId)` returns `{current, earlier[]}` or null. It uses `loadStageStates`, the `skip` events, and the recordings with their booking.
  - `buildPanelPack` marks the recordings and returns `tableModel.round_evidence`.
  - `loadEarlierRoleModels` takes `evidence`.
  - `loadPanelCandidateTable` reads the evidence from the model, or loads it.
- **Reading chosen:** if this journey skipped a round that an earlier role reached, the CV note shows under that earlier role, labelled. It is not dropped.
- **Script** `backend/scripts/refresh-panel-invite-templates.mjs`:
  - It is a dry run by default; `--apply` writes. It knows 3 old defaults per template: 4102495^, plus 0b8f723 and b671236 with the sign-off.
  - The staging dry run (12 Nov) found #23 and #27 unedited, so both would be replaced.
- **Tests:**
  - unit: `panelCandidateTable` 26/26 (8 new), `refreshPanelTemplates` 4/4 (new), `panelEarlierRoles` 10/10, `panelPack` 15/15
  - Not run: the full unit suite.
- **For the user (lean mode):**
  1. `npm run test:unit`
  2. integration `node src/tests/run-block.mjs src/tests/integration/panelPack.test.js`
  3. staging: `node scripts/refresh-panel-invite-templates.mjs --apply`, then re-preview one Tech 2 invite and check there is no "Candidate email:" line
  4. R16: run the script dry, then `--apply`, on production
- **Left over:**
  - The report so far (the dossier attachment) still lists every recording and note. Only the table filters them.
  - Share links are still minted for a recording from a cancelled booking.
