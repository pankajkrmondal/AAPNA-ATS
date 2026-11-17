# U07 · Move to another JD: the JD by default, and the earlier role's rounds (10 Nov 2026)

**Sheet:** Phase 3 UAT Fixes - Nov, U07. **Brief:** [U07](../Phase%204/uat-fixes/U07-move-jd-earlier-rounds.md). **Builds on:** [U03](CHANGES-2026-11-10-U03-panel-table-and-pack.md).
**HR ask:** a moved candidate should get the new JD without anyone remembering to tick a box, and the next interviewer should see what the candidate did for the earlier role.

## What changed
- **Move to another JD window:** "Email the candidate about the new role, with its JD attached" is now ticked by default. The recruiter can untick it. The server rule is unchanged: it sends only when `notify_candidate` is true.
- **Earlier role in the panel invite:** when the journey was moved from another JD, the candidate table shows that journey's rounds first, for example "Technical Round 1 feedback · earlier role: Senior QA Engineer", with its recording row. Its Zeko and Evalground scores appear under this journey's own, marked "(earlier role: …)". A Zeko result from either journey takes precedence over the score uploaded on the CV.
- **Earlier role in the report so far:** the `panel_tech` and `panel_leadership` cuts get the same rounds with the same labels: the named feedback, the scorecards, AI screening, the assessment and the recordings (with their own no-login links). An earlier Tech 1 now counts as feedback, so a Tech 1 or Tech 2 panel on the new JD gets the report.
- **How:** the backend follows the `moved_from_pipeline_id` chain, up to 5 journeys, same candidate only. It builds one redacted dossier model per earlier journey (Zeko by that journey's own shortlist) and merges them with the pure `mergeEarlierRoles()` (`utils/panelEarlierRoles.js`). It covers schedule, reschedule, "Send to panel" and the Schedule window's preview and pre-send check.
- **Not carried over:** the earlier role's progress events, bookings, pending scorecards and earlier attempts. Round notes live on the CV and are already shown.
- **Unchanged:** the dossier download (`buildDossierModel` is untouched), Change JD, the email itself.
- **No new flags, no DDL.**

## Tests
- **Unit:** `panelEarlierRoles` 10/10 (new). `panelCandidateTable` 18/18, `panelPack` 15/15, `candidateDossier` 127/127 (the download snapshot is unchanged), `dossierRedaction` 43/43, `journeyMove` 11/11. Full `npm run test:unit` 1121/1121.
- **Integration (staging DB, nothing sent):** `journeyMove.test.js` 5/5. One case is new: moved after Tech 1, the Tech 2 table and report name the earlier Tech 1, and the download doesn't.
- **Frontend:** `npm run build` passes.
