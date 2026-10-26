# Handoff: Other bugs L08–L16 (paused 24 Oct 2026)

**Plan:** PLAN-Phase3-in-Phase4.md › Other bugs (L08–L16). **Sheet:** Phase 3 Enh - Later, rows 13–21, all marked Completed.

**State:**
- Build is 100% done; overall about 95%, counting all testing and checks. What is left needs a real sign-in or a real inbox.
- Nothing is committed or deployed.
- The DDL for L09 (`2026-10-23-duplicate-match-id.sql`) is applied on staging. The two L14 email templates are seeded on staging.

## Done
| ID | Item | Write-up (docs/changelog/) |
|---|---|---|
| L16 | Password emails on the branded shell | CHANGES-2026-10-23-L16-password-emails.md |
| L10 | HR upload → profile link | CHANGES-2026-10-23-L10-upload-profile-link.md |
| L13 | No-login recording link, meeting join details, JD | CHANGES-2026-10-23-L13-outside-links.md |
| L15 | MRF emails + public MRF form | CHANGES-2026-10-23-L15-mrf-emails-and-form.md |
| L12 | One-record exports as Field \| Value, dossier round feedback | CHANGES-2026-10-23-L12-field-value-exports-and-dossier.md |
| L09 | Duplicate Review old-vs-new | CHANGES-2026-10-23-L09-duplicate-compare.md |
| L14 | Panel pack (JD, CV, report so far) + feedback email | CHANGES-2026-10-23-L14-next-round-pack.md |
| L11 | Screening "not shown" list | CHANGES-2026-10-23-L11-screening-not-shown.md |
| L08 | Forms & Links page + shortcuts | CHANGES-2026-10-24-L08-forms-and-links.md |

**Tests:**
- Unit: 1019/1019.
- Staging integration suites pass for every item. L08 is `src/tests/integration/formsLinks.test.js`, 7/7.
- The frontend builds.
- Browser (headless Edge): Forms & Links and `/mrf-submit`, 24/24.

## Left to do
1. **Done (24 Oct, resumed):** the Forms & Links layout fix. Columns now fit at 1440 px with nothing covered. Browser check 24/24, integration 7/7, the frontend builds.
2. **Signed-in browser checks (24 Oct, as the recruiter test account, read-only):**
   - The script blocked every write call (POST/PUT/PATCH/DELETE) except the login and the two read-only screening searches. None was attempted, so no email or data change.
   - **Passed:**
     - L08: Forms & Links with real data. A recruiter with the module sees the pipeline links, so the permission fix works on the live backend.
     - L08: the "Links for this MRF" block.
     - L10: profile link, menu highlight and Back.
     - L09: compare window (Field | Already in ATS | This upload | On merge; "Open existing profile").
     - L11: "See the 178 not shown" drawer with reasons.
     - L14: the Schedule window checkbox, ticked by default (window opened, then cancelled).
   - **Not checkable on current staging data:**
     - L13 "Copy join details" and the L14 drawer button "Send JD, CV & report": no unresolved Teams meeting exists, and booking one sends invites.
     - L13 "Copy link for outside the ATS": no recording with playable content.
     - The L08 scorecard-report card: no scorecard awaiting feedback.
     - Check these on the next real interview.
   - Script: `scratchpad/pw/verify-signed-in.mjs` (reads TEST_USER / TEST_USER_PASSWORD from backend/.env.development).
3. **Manual checks:**
   - email rendering in Outlook desktop and OWA (L14, L15, L16);
   - L08 Re-send and Renew with real mail (`scorecardInvite` reaches real addresses on staging, so use your own);
   - the `schedulingAndScorecard` suite (needs the fixture seed; sends real mail);
   - a test MRF on staging to see the L15 emails.
3a. **L15 follow-up (26 Oct):** the MRF approval email now has a compact design ([write-up](../changelog/CHANGES-2026-10-26-L15-mrf-approval-email-design.md)). Submit a test MRF on staging and check the approval email in Outlook.
4. **Before production:**
   - Remove the repeated sentence from the "MRF Approval Request" template in Email Templates (the seed does not overwrite it).
   - Chhaya's sign-off on the "Forms & Links" menu slot. `VITE_FORMS_LINKS_ENABLED` is false in `.env.production`.
   - Production seeds: `seed-email-recipients.js` (`scorecardSubmitted`) and `seed-interview-email-templates.js`.
   - The L09 DDL on production.
5. **Commit:** only when asked.

## Notes for whoever picks this up
- **Browser check script:** in the session scratchpad, at `C:\Users\hmopuri\AppData\Local\Temp\claude\d--Projects-ATS-V30\b060ad48-62e0-4e27-8a87-70d2a57731c1\scratchpad\pw\verify-l08.mjs`.
  - Run it from PowerShell, with cwd `AAPNA-ATS\backend`. The Bash sandbox blocks Edge, and Edge needs `--no-sandbox`.
  - It intercepts `/api`: Forms & Links is answered by the real service against staging, and Copy is stubbed.
- **Sheet backup** from before the 24 Oct row update: `scratchpad\Task-Items-backup-2026-10-24.xlsx`, in the same folder as the script.
- **Pre-existing, not from this work:** `/analytics` scrolls sideways at phone width (516 px), and the header crowds at phone width (`MainLayout`).
