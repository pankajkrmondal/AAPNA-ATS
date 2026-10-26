# L15 · MRF emails and the public MRF form on the AAPNA design (23 Oct 2026)

**Sheet:** Phase 3 Enh - Later, row 20 (added 23 Oct). **Plan:** PLAN-Phase3-in-Phase4.md › Other bugs › L15.

## Why
Harish, 23 Oct: "MRF New addition code and email is not matching the design format of ours." Every email in the new-MRF flow built its own HTML, and none of them used the branded shell the pipeline and MRF Hold emails use:

| Email | Before |
|---|---|
| New MRF Request, to the hiring manager | Div-based, its own logo and header, footer "© 2025" |
| Approval request (shared and per-approver) | "AAPNA Requisition Portal" header, Calibri |
| HR copy of a submission | Plain Calibri page |
| Approved / Declined outcome | Plain Calibri fragment with a "Forwarded message" block |
| Already actioned / Decision confirmation | Their own layout |

The public form the email links to (`/mrf-submit`) also kept the n8n form's own header band and footer, while every other public page uses `PublicPageShell`.

## What changed
- **New `backend/src/services/mrfEmailBodies.js`** (pure, no imports). It holds one body builder per email, plus `emailButton`, `emailCallout` and the requisition details table. `emailNotification.service.js` wraps each body with `wrapBrandedEmail(body, { title: subject })`.
  - Wording, buttons and links are unchanged: the JD and "Open MRF" steps, Approve / Reject / Hold, the personal-link note, the back-from-hold banner, and the editable "MRF Approval Request" intro and subject.
  - Subjects and recipients (including the staging redirect) are unchanged.
  - Buttons and cards are table-based for Outlook.
  - The shell adds the sign-off. The outcome email keeps its "Best regards, CEO, AAPNA" signature, so the shell adds no second one.
  - The outcome email keeps the exact `<strong>Comment from Management:</strong> … </p>` markup that the audit backfill (`2026-09-25-mrf-approval-audit.sql`) parses.
- **The requisition details table** (`rpa_mrf.emailbody`) is now built by `buildMrfDetailsTable` in the same module, replacing `generateMrfEmailTable` in `mrf.controller.js`. It uses the brand styling (light borders, a tinted header) and is shown under a "Requisition details" heading.
  - Tables stored before this change are restyled when an email is sent (`brandLegacyMrfTable`): only style values change, and it is idempotent.
- **Security:** every value in that table is now escaped. The form is public, and the values used to go into the approvers' email raw, so markup typed into any field rendered in the approval request.
- **`/mrf-submit` (`MrfSubmit.jsx`):** the form and its success view now sit inside `PublicPageShell` (920 px wide for this long form): the same green band, logo, card and footer as the email that links to it.
  - Fields, sections, validation and submit logic are unchanged.
  - Field descriptions use the muted grey instead of the n8n green.
- **In-app "New MRF Request" card on `/mrf`:** reviewed and left unchanged. It already uses the V2 glass card and the same label style as the other V2 forms (Settings uses identical label markup). Point to the specific difference if one was meant.
- **Not in scope:** the internal ops alerts (resume error, rerank, backend error) keep their plain developer format.

## Tests
- `src/tests/unit/mrfEmailBodies.test.js` (10 tests):
  - each body is wrapped once, with no legacy chrome or flex;
  - exactly one sign-off each (CEO only on the outcome);
  - the JD step appears only when there is a JD;
  - the approval buttons, with Hold optional;
  - the backfill pattern still matches, with the comment escaped;
  - the legacy restyle is idempotent;
  - the table escapes every value;
  - links, "Not Uploaded" and the AI rows;
  - `emailButton` escapes its inputs.
- The MRF approval, hold and detail-export suites pass (80/80 together). The frontend builds.
- All seven emails were rendered from the real builders and checked in Chrome.
- **Still to check:** submit a test MRF on staging and look at the HM, approval, HR and outcome emails in Outlook; `/mrf-submit` at phone width.

## Files
- `backend/src/services/mrfEmailBodies.js` (new)
- `backend/src/services/emailNotification.service.js`
- `backend/src/controllers/mrf.controller.js`
- `frontend/src/pages/MrfSubmit.jsx`
- `backend/src/tests/unit/mrfEmailBodies.test.js` (new)
