# L08 · Forms & Links: find, copy or re-send any link the ATS has sent (24 Oct 2026)

**Sheet:** Phase 3 Enh - Later, row 13 ("Adhoc links for all forms"). **Plan:** PLAN-Phase3-in-Phase4.md › Other bugs › L08. **Design:** `docs/Phase 3 Enhancements or Feedback/Forms & Links — design for approval.html`, approved 23 Oct as recommended (D1–D10, full version).

## Why
"If Recruiter wants to access some links, right now, they are not accessible easily… I have sent a link to interviewer post interview, I can't find the link from the app easily."

The ATS sends nine kinds of link: scorecards, Teams meetings, no-login recording links, document uploads, complete-profile forms, Zeko interviews, Evalground tests, MRF request forms and MRF approvals. Each lived in its own table and its own email, and none could be found again in the app.

## What changed

### The page: `/forms-links` (menu: after Recruitment Analytics, D1)
- **Search** on candidate, interviewer, approver, email, role or MRF. Search covers every type and every date, complete-profile forms included.
- **Four tiles that filter the list:** waiting for a response, expiring within 48 h, expired before a response, email not delivered.
- **Tabs by recipient:** All / Interviewers / Candidates / Hiring managers & approvers / Standing forms, with counts.
- **Filters:**
  - type chips with counts;
  - status: Open & expired (the default, D6), Open, Expired, Done, Closed, All;
  - Sent: any time, 7 / 30 / 90 days;
  - "My candidates": journeys this user shortlisted. The default is the whole team (D7).
- **Complete-profile forms:** the ATS sends one to every upload with missing details, so they stay hidden while browsing, behind their own chip, until you search (D6).
- **Table:** Link, Sent to, Candidate · role, Sent (when, by whom), Status (with detail such as "2 of 5 uploaded" or "never opened"), Expires (with "in 3 days" / "2 days ago"), Actions. Newest first, 10 per page.
- **Row actions,** worked out on the server per type and state:
  - Copy link, plus "Copy with message", a ready-to-paste text per type (D9). A meeting message carries the time, meeting ID and passcode; a document message lists what is still missing.
  - Join or Open, for meetings, document uploads, tests and MRF forms.
  - Re-send.
  - Renew & re-send, for an expired scorecard: the same link works for 7 more days and is emailed again (D5).
  - Revoke, for recording links.
  - Re-send approval links.
  - Scorecards and recording links are copy-only. Opening one from here would count as the interviewer opening it.
- **MRF approval links are never copied or opened (D3).** Whoever opens one decides in the approver's name, so the row shows status only and offers "Re-send approval links" (new personal links; the old ones stop working).
- **Anything that sends an email asks first.**
- **The list never holds a URL.** Copy fetches the link, and every copy or open is recorded (D4):
  - a pipeline link is noted on the candidate's timeline ("Scorecard (Technical Round 1) link copied by anita (Forms & Links).");
  - an MRF link is noted in `rpa_processing_log` (source `FORMS_LINKS_COPY`).
- **Standing forms tab (D10):**
  - the blank MRF request form, ATS sign-in and Forgot password, each with Copy and Open;
  - the JD and test paper of every open MRF (approved, not closed, not filled).
  - Personal links never appear here.
- **Access:**
  - **Staff only** (`requireStaff`); vendors are also confined by `VENDOR_ALLOWED_PATHS`.
  - **Pipeline-backed types** (scorecards, meetings, recordings, documents, profile forms, Zeko, Evalground) show only to admin tier or users with the `recruitment_pipeline` module, the board's own rule. Everyone else sees MRF and standing rows and a note saying so (board 9).
- **Deep links:** `?q=`, `?candidate=<pipeline or cv id>`, `?mrf=<id>`, `?mrfRequest=<request id>`.
- **States:** loading, error (with Try again), empty (worded for search versus filters), and the no-pipeline-access note.

### Shortcuts (D8)
- **Scorecard report → "Still awaiting feedback"** (`PendingScorecardLinkActions`):
  - per round, Copy link / Copy with message and Re-send; "Send now" when the link was never delivered; Renew & re-send once it has expired;
  - "All links for this candidate →" opens the page filtered to the journey.
- **MRF details → "Links for this MRF"** (`MrfLinksBlock`):
  - the hiring manager's request-form link with Copy. It is there before an MRF number exists.
  - "Open in Forms & Links →".
  - The approvers' status lines and "Re-send approval links" are not repeated: the Approval trail directly above already has them.
- **Ctrl+K:** a "Forms & Links" command, and "Find a link for '<query>'" once you type two characters.
- **Dashboard → Needs your attention:** "Links waiting for a response: N", which opens the page. The server keeps each user's counts for a minute, because building them reads every link type (~3 s on staging).

### Scorecard fixes (`interviewScorecard.service.js`)
- **The drawer's "Retry scorecard link" sent nothing.** The early `scorecard_dispatched_at` return in `dispatchScorecards` made the retry branch unreachable. Removed.
- **`resendScorecard(cardId)`:** the same link again, for a card that is pending and not expired (409 when expired).
- **`renewScorecard(cardId)`:** back to pending, 7 more days on the same token, emailed again.

### Found and fixed by the integration test
- **The module check selected a column `rpa_module_permissions` does not have** (`id`; its key is `user_id + module_key`). The error was swallowed, so every non-admin recruiter would have seen MRF rows only. It now selects `module_key`, and a failed lookup is logged and fails closed.
- **The copied scorecard message said "the candidate's"** instead of the candidate's name.

### Found and fixed by the browser check
- **Tab and type counts ignored the status filter:** "All 208" sat above a list of 111. Each count now applies every filter except its own, so a tab's number matches the list it opens.
- **The Actions column was clipped** at desktop width. Columns are now sized to fit the card on a 1440 px screen, with Actions pinned right (200 px). On narrower screens the table scrolls under it.
- **At phone width the page scrolled sideways:** the recipient tabs and status buttons now scroll inside their own row, and the search row shrinks.

### Switch
- `VITE_FORMS_LINKS_ENABLED` (frontend). It shows the menu item and all four shortcuts.
  - **On** in `.env.development` and `.env.staging`; **off** in `.env.production` until Chhaya signs off the new menu slot (HR set the menu order on 10 Sep).
  - The page itself works at `/forms-links` either way.

## Not changed
- **No DDL.** Every link is read from the tables that already hold it.
- **No new email templates.** Re-send and Renew reuse the existing scorecard, document-reminder and MRF-approval emails and their recipient rules.

## Tests
- `src/tests/unit/formsLinksModel.test.js` (9):
  - status per type: expired while still "pending", not delivered, opened, done;
  - actions: approval links reissue-only, expired scorecards renew-only, scorecards and recordings copy-only;
  - tiles;
  - the messages;
  - `firstUrlIn`.
- `src/tests/vendorIsolation.test.js` +1: every Forms & Links route sits behind `requireStaff`.
- `src/tests/integration/formsLinks.test.js` (7/7 on staging, own fixtures, no email):
  - the list shows the open and the expired scorecard with the right status and actions, and no token or URL;
  - Copy returns the URL and a named message and writes the timeline note; Open writes an "opened" note;
  - an expired scorecard is refused (409, "Renew it instead"); an approval link is refused (403); no note is written for either;
  - without the module, MRF rows only, and a scorecard copy is refused (403);
  - with the module, a recruiter sees the scorecard;
  - `mrfRequest` finds the hiring manager's form before an MRF exists, and its copy is logged in the processing log;
  - "My candidates".
- **Fixture check:** nothing was left on staging.
- **Full unit run:** 1019/1019. The frontend builds (staging mode).
- **Not run:**
  - Re-send and Renew against real mail: `scorecardInvite` is operator-addressed, so on staging it reaches the real interviewer. Try them on a scorecard sent to your own address.
  - `schedulingAndScorecard`, which would cover the retry fix: it needs the fixture seed and sends real mail.
  - Browser checks of the shortcuts that need real data: the scorecard-report card and the MRF-details block.
- **Browser check:** headless Edge, 24/24.
  - Page data came from the real service against staging; Copy was stubbed.
  - Covered: tiles, tile filter, tabs and counts, Copy (toast and clipboard), Standing forms, search empty state, columns not clipped or covered, dark mode, phone width, the `?candidate=` deep link, the Dashboard row, and Ctrl+K "Find a link".
  - No console errors apart from AntD deprecation warnings that occur across the app.

## Files
- **Backend:**
  - `backend/src/services/formsLinks.service.js` (new)
  - `backend/src/utils/formsLinksModel.js` (new)
  - `backend/src/controllers/formsLinks.controller.js` (new)
  - `backend/src/routes/formsLinks.routes.js` (new)
  - `backend/src/routes/index.js`
  - `backend/src/services/interviewScorecard.service.js`
- **Frontend:**
  - `frontend/src/pages/FormsLinks.jsx` (new)
  - `frontend/src/services/formsLinksService.js` (new)
  - `frontend/src/utils/featureFlags.js` (new)
  - `frontend/src/utils/clipboard.js` (new)
  - `frontend/src/components/pipeline/PendingScorecardLinkActions.jsx` (new)
  - `frontend/src/components/mrf/MrfLinksBlock.jsx` (new)
  - `frontend/src/components/pipeline/PipelineDrawer.jsx`
  - `frontend/src/pages/MRF.jsx`
  - `frontend/src/components/dashboard/CommandPalette.jsx`
  - `frontend/src/components/dashboard/ActionCenterCard.jsx`
  - `frontend/src/pages/Dashboard.jsx`
  - `frontend/src/layouts/MainLayout.jsx`
  - `frontend/src/App.jsx`
  - `frontend/.env.*` (the switch)
- **Docs:** `docs/user-guides/01-RECRUITER-HR-GUIDE.md` ("Finding a link you sent")
- **Tests:** as above.
