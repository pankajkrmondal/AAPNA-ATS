# U10c · Responded per open position (the role view)
**13 Nov feedback · goes live 16 Nov (R16) · ~2 h · Depends on: the U10b Handoff**

**Goal**
- **Today:** Open Positions › Responded (U10b) lists who responded for all JDs together. One position's role view (`?tab=open&mrf=<id>`) only has a Responded count for the page's range (7 days by default).
- **Change (owner, 13 Nov):** "the analytics is not per open position's". The role view gets the same Responded filter as all roles.
- **Done when:**
  - The role view has a Responded section with the same presets (Yesterday by default, Today, Last 7 days, custom up to 92 days) and that position's candidates, newest first, each opening the profile.
  - Its count equals the position's Responded column for the same dates.
  - In the all-roles Responded view, each JD links to its role view, which opens on the same dates.

## Changes
- **Backend:** `GET /api/pipeline/analytics/completed-forms` takes `mrf=<id>` (`parseRespondedMrf`, `completedForms.helpers.js`). `getRespondedByJd(range, { status, mrfId })` (`completedForms.service.js`) lists that MRF only, whatever its status, without "No JD yet". The latest-MRF pairing still uses the whole board set, so the count equals the column.
- **Frontend:**
  - `RespondedByJdPanel.jsx`: an `mrfId` prop (one position, plain list) and an `onOpenRole` prop ("Role view →" on each JD).
  - `RoleDetailDrawer.jsx`: a "Responded" card after Needs attention. It starts on the Responded view's dates when opened from it, else Yesterday.
  - `PositionsTab.jsx` passes `onOpenRole`; `Analytics.jsx` passes the Responded view's range to the role view.

## Handoff
**Built and tested 13 Nov.** Write-up: [CHANGES-2026-11-13-U10c-responded-per-position.md](../../changelog/CHANGES-2026-11-13-U10c-responded-per-position.md).
- **Run here:**
  - unit `completedForms.test.js` 34/34 (3 new)
  - `npm run build` passes
  - Playwright `playwright.u10.config.js` 9/9 (2 new, mocked API)
  - read-only check on the local database: the per-position count equals the column for MRF 686 (30 days, 8), 110 (30 days, 2), 222 (90 days, 7) and 31 (0).
- **For the user to run:**
  - the full `npm run test:unit`
  - integration `node src/tests/run-block.mjs src/tests/integration/completedForms.test.js`
  - a staging look at one role view, for example FlexStage Test Role (MRF-686) on Last 7 days or custom dates
- **Left over:** the walkthrough page's U10 text and screenshots (F6).
