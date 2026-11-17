# U10b · Responded view inside Open Positions (12 Nov 2026)

**Feedback:** walkthrough comment, 12 Nov: "Open Positions has Responded within it. Revise what we did in the new tab." **Brief:** [U10b](../Phase%204/uat-fixes/U10b-responded-in-open-positions.md). Replaces [U10](CHANGES-2026-11-11-U10-completed-forms.md)'s Completed Forms tab.

## What changed
- **Definition = the Responded column.** `RESPONDED_AT` in `mrfApplicants.service.js` is now the single expression for both `factsCte` (the column) and the view: the form completed; otherwise the request date when the token is RECEIVED (CVs asked before 14 Oct); otherwise the arrival date of an ACTIVE CV that was never asked.
- **`respondedByJd(mrfs, range, { shownIds, unlinked, limit })`** replaces `completedFormsWithMrf`. It returns one row per (MRF, CV), so a candidate linked to two JDs appears under both, and a JD's count equals its column for the same dates. Responders with no link to any board MRF go under "No JD yet", last. The headline total counts each candidate once. A journey alone no longer picks the JD.
- **Endpoint** `GET /api/pipeline/analytics/completed-forms` keeps its path. It adds `status=open|closed|all` (default open, the board's rule, so Open includes Paused). The response adds `status`, and each candidate gets `responded_at` and `how` (`form` or `complete_cv`). "No JD yet" is listed for Open and All. Handler `getRespondedByJd`; service `getRespondedByJd(range, { status })`.
- **UI:**
  - Open Positions has a "Board | Responded" switch. Responded (`RespondedByJdPanel.jsx`, moved from `CompletedFormsTab.jsx`) keeps its own presets (Yesterday by default, Today, Last 7 days, custom up to 92 days) and follows Open/Closed/All.
  - The Responded tile is clickable and opens the view for the page's dates. If the page shows All time or more than 92 days, it opens on Yesterday.
  - The Completed Forms tab is removed.
- **URL:** `?tab=open&view=responded&range=…` or `&from&to`. Old `?tab=completed-forms…` links (bell notes already sent) map to the view and keep their dates.
- **Bell:** `formsTabLink` now gives `/analytics?tab=open&view=responded&from=D&to=D`. The note reads "N candidates responded yesterday across M JDs" and counts open positions plus "No JD yet". The "nothing to send" decision is now `nobody_responded`. Flags are unchanged; R16 turns them on.

## Tests
- **Unit:** `completedForms.test.js` 31/31. Covers the status filter, pair grouping, the shared `RESPONDED_AT` order and its use in both queries, the note wording and the link.
- **Integration (to run):** `completedForms.test.js` was rewritten for the two fallback dates, a candidate linked to two JDs, an asked-but-unanswered CV, and the switch. It also checks that the view equals the positions endpoint's Responded per JD, on the fixture day and on the real yesterday.
- **Frontend:** `npm run build` passes. The spec was renamed to `e2e/u10b-responded-view.spec.js` (7 tests, mocked API, `playwright.u10.config.js`). It has not been run yet.
