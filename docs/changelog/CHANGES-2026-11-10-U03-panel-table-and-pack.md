# U03 · Candidate table in the panel invite, plus a slimmer pack (10 Nov 2026)

**Sheet:** Phase 3 UAT Fixes - Nov, U03, and Process Phases row 15. **Brief:** [U03](../Phase%204/uat-fixes/U03-panel-table-and-pack.md).
**HR ask:** interviewers and the CHRO/CEO don't open attachments. Put Chhaya's candidate table in the invite body, CTC only on HR and CEO rounds, and slim the attached report.

## What changed
- **Table in the invite body:** Chhaya's format (S. No. · Particulars · Details), filled with the rounds done so far. The rows are date applied, name, role, source (only when ticked), notice, qualification, email, experience, Zeko functional (plus Zeko HR when done), Evalground, CTC current/expected (HR and CEO rounds only), then a feedback row and a recording row for each completed round. It goes into schedule, reschedule and the post-booking "Send to panel" email, whether or not the pack is ticked. With the pack off, the recording rows say to ask the recruitment team. The table replaces the "Earlier rounds" lines. The notes on what is attached stay under it.
- **Where the data comes from:** CTC, source and email come from their own `rpa_cv` query (CTC from the latest HR scorecard first) and never enter the dossier model. Missing values show `—`.
- **Template:** the panel schedule and reschedule defaults get `{{candidate_table}}` and lose the "Candidate email" line, which the table now carries. The Schedule window shows a placeholder at the token. The table replaces it at send time, below the Teams block and recording notice. A stored template without the token gets the table after its body, so **staging and production need no reseed**.
- **Source tick-box:** "Show the candidate's source (vendor) to the panel", off by default. It is disabled for a referral, and the server refuses it for a referral too.
- **Slimmer pack:** `renderDossierHtml(model, {variant})`. Tech 1/2/3 get the consolidated feedback with interviewer names only, and no report until there is feedback. HR and CEO get the profile first, no "moved" events, the named feedback, history & recordings, scorecards / AI / assessment, the position last, and no "What is in this pack". The client round and the dossier download are unchanged, and `download` is byte-identical.
- **Model:** adds `consolidated_by_interviewer` (name from a single-person booking, else the scorecard address) and `stage_key` on recordings.
- **No new flags, no DDL.**

## Tests
- **Unit:** `panelCandidateTable` 18/18 (new), `candidateDossier` 127/127 (variants, plus a sha256 snapshot of the download), `panelPack` 15/15, `dossierRedaction` 43/43.
- **Integration (staging DB, nothing sent):** `panelPack.test.js` 12/12 (5 new: Tech 1 with no report, Tech 2 without CTC, CEO with CTC, Source and referral, preview).
- **Frontend:** `npm run build` passes. Sample Tech 2 and CEO invites were checked in headless Edge. Outlook desktop and OWA were not checked.
