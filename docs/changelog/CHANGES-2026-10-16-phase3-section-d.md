# Phase 3 "Do Now", section D: approver names, date format, scores in the drawer, candidate data sync

**Date:** 16 Oct 2026 · **Plan:** [PLAN-Phase3-Now.md](../Phase%203%20Enhancements%20or%20Feedback/PLAN-Phase3-Now.md) §4.D, revised 16 Oct after re-reading the tracker.
**Items:** N32 (reopened by QA on 16 Oct), N34, N28, N29. N30, N31 and N33 were done in week 1 ([CHANGES-2026-10-14-phase3-week1.md](./CHANGES-2026-10-14-phase3-week1.md)). This completes section D in code.
**Status:** built; unit tests pass and the frontend builds. Integration tests run on staging on 16 Oct (results under "Tests"). Staging data steps: backfill applied; the approver list is **not** in place (see below). Screen checks not yet run: they need a login (`E2E_USER` / `E2E_PASSWORD`). The code is not deployed to staging. Nothing is committed. Production goes once, at the end, with the other sections.
**Decisions (16 Oct):**
- N32: show approver names from today's approver list, looked up by email; don't rewrite stored rows.
- N34: covers screens and emails.
- N28: per-round scores only, no summary strip.
- N29:
  - legacy scores stay editable;
  - one sync helper in code;
  - re-embed only on searchable fields;
  - read-only pipeline scores in Search Candidate;
  - edit is staff only.

---

## What changed, by item

### N32 · Approver names (reopened)
- **Why QA still saw "Staging Approver A/B":** week 1 fixed the seed and the email note. But the MRF page's Approval trail shows names that were **copied onto each MRF's approval records when the emails went out**, and the live approver list (`rpa_settings.mrf_approvers`) was never updated on dev or staging.
- **Fix:** names shown for an MRF now come from today's approver list by email (`nameForApprover`, `utils/mrfApprovalRules.js`), falling back to the stored name. This applies to:
  - the Approval trail: approvers, "approved by" and the timeline
  - the public approval page ("Reviewing as", "already approved by")
  - the MRF detail export
  - new decisions, which record the current name
- Stored rows and the append-only audit events are untouched.
- **Data step:** the approver list update below (staging step 1). Without it, the list still says "Staging Approver A/B".

### N34 · One date format
- **Screens:** `frontend/src/utils/dateFormat.js` gains `fmtTime`, `fmtDayMonth`, `fmtRelative` and `istDateParts`. About 20 screens now show `07 Oct 2026`, `07 Oct 2026, 4:30 PM` or `5 min ago` / `3 h ago` / `2 d ago`, always in IST, whatever the browser's locale. These include:
  - the pipeline drawer
  - MRF list and detail
  - Screening, Search Candidate
  - HR upload, vendor portal and dashboard
  - referral panels, the notification bell, the activity feed
  - email delivery and templates
  - admin users, upcoming interviews

  Local helpers that disagreed are gone. The public MRF form's date picker shows `07 Oct 2026` instead of `07/10/2026`.
- **Emails:** new `backend/src/utils/dateFormat.js`, the same strings. Interview, reminder, Zeko-schedule and approval emails read `07 Oct 2026, 4:30 PM IST`, where they used to read "07 October 2026, 04:30 pm IST". The recording-share page and the dashboard's relative times use it too.
- **Bug fixed:** the new-MRF email's "Date of Request" followed the server's locale (`toLocaleDateString()`).
- **Kept as is:**
  - machine dates (`YYYY-MM-DD`: API parameters, CSV exports, "is it today" checks)
  - the dashboard header clock, which states it is in your local time
  - the trend chart's day buckets (local days; labels now `07 Oct`)
  - Settings' example times
  - the schedule dialog's preview, which follows its date picker
  - the prototype page

### N28 · Scores in the pipeline drawer
- **Every round keeps its scores after it passes:**
  - both Zeko rounds: score chips and report link
  - the assessment: the result, plus a new "View the Evalground report" link
  - each interview round: one line per interviewer with average /5 and verdict, instead of only "Feedback received"
- **Bug fixed:** the backend returned only the current Zeko round's scores, and the drawer passed them to both Zeko cards, so on Functional screening the HR card showed Functional's numbers. Each card now reads its own round (`zekoRounds`, built by `utils/roundScores.js` from the round-scoped lookup).
- **New "Uploaded scores (from Excel)" card:** collapsed, read-only, hidden when empty, labelled "editable in Search Candidate". It shows the candidate record's score columns, which are never shown under a round.
- API: `GET /api/pipeline/:id` adds `zekoRounds` and `uploadedScores`. The old current-round fields stay.

### N29 · Candidate data sync, both directions
- **Search Candidate → pipeline:** a name or email change now reaches the pipeline's copy (`rpa_shortlisted_candidates`), which the board, the drawer, Analytics and every pipeline email read. It goes through one helper, `syncShortlistIdentity` (`services/candidateSync.service.js`), called by every writer:
  - Search Candidate edit (in the same transaction)
  - public missing-details form
  - HR/vendor upload merge (same transaction)
  - Outlook intake

  A replaced address is kept in `candidate_email_all`, so the drawer's inbox still finds old threads.
- **Pipeline → Search Candidate:** the candidate view has a read-only **Pipeline scores** section, per MRF and round (Zeko, Evalground, interview scorecards), from the same sources as the drawer. New `GET /api/candidates/:id/pipeline-scores` (staff only).
- **Caches:** an edit clears the screening result lists and the candidate's insight cache; the browser drops its cached screening, pipeline and score data after a save.
- **Search profile:** rebuilt after an edit only when a searchable field changed (one embedding call). A name or phone fix doesn't trigger it.
- **Bug fixed:** the Search Candidate edit form sent every field back. A form opened before a pipeline update could write the old Final Status or Zeko score over the new one. It now sends only the fields you changed, or says "No changes to save".
- **Security:** `PATCH /api/candidates/:id` is now staff only. A vendor login could edit any candidate through the API. The Edit button is hidden for vendors.
- **Hint:** the three Zeko score fields say "Updated automatically by Zeko sync".
- **Audit:** [docs/reference/candidate-data-copies.md](../reference/candidate-data-copies.md) lists every copy, who writes and reads it, and the decision for each, plus the known limits.

### Later on 16 Oct: the rest of section D
- **Missing-details link survives an email change (N29 limit, fixed).** The link's token is the base64 of the email it was sent to, and the form looked the candidate up by that exact address. So once the email was edited, or an upload merge appended a second address, every link already sent said "Candidate not found". Both form endpoints now find the candidate by the token stored on the record when the link went out (`cvMissingToken`). Next comes the exact address (older links), then a record holding the address among others, but only when exactly one does: a shared address never opens someone else's form. (`candidate.controller.js`, `findCandidateByDetailsToken`)
- **Candidate Detail page (N29 limit, fixed):**
  - The Timeline tab showed the same demo events for everyone ("Resume uploaded · Jun 4, 2026", "Score: 92%"). It now lists the real history:
    - added to the ATS (with source)
    - details requested and completed
    - shortlisted per MRF (by whom)
    - closed with the outcome, or the current stage
  - A candidate that failed to load used to show a made-up "Priya Sharma"; it now says "Candidate not found".
  - The "% Match" tag is hidden when there is no score.
  - `GET /api/candidates/:id/pipeline-scores` adds `shortlisted_at`, `shortlisted_by` and `closed_at` per journey.
- **Left as is, by design:** the Zeko sync rewrites the candidate-level Zeko score columns. They hold one set for both rounds; the drawer reads each round's own result, and the edit form says so. The Emails and Resume tabs on Candidate Detail are still placeholders: not section D, noted for later.
- **Test fixes:**
  - `mrfApprovalExpiredLink` restores the approver list first in its clean-up, and refuses to start while the list still holds its own fixture.
  - PIPE-13 creates its own second MRF when the fixture one is missing (17/17 on staging).
  - `run-block.mjs` names logs `<folder>-<file>.log`, so `unit/` and `integration/` files with one name no longer overwrite each other.
- **`saukumar@` removed** from the non-production test-recipient default (`config/index.js`) and the staging MRF recipient defaults (`emailRecipients.js`). The staging seed now uses `pkmondal@` as the second staging approver. Restart the queue worker (`npm run queue:worker`): it holds the old list until restarted.

### Testing to do later
| # | What | How | Pass when |
|---|---|---|---|
| T1 | Missing-details link after an email edit | Send a candidate the missing-details email; edit their email in Search Candidate; open the link from the first email | The form opens (not "Candidate not found"); submitting it updates that candidate |
| T2 | Link after an upload merge | Missing-details email to a candidate, then upload a resume for them with a second address (duplicate merge); open the first link | The form opens |
| T3 | Candidate Detail timeline | Open `/candidates/<id>` for a candidate in the pipeline (e.g. from the bell) → Timeline | Real dated events in order, ending with "Now at <stage> for <role>"; no "Jun 4, 2026" or "Score: 92%" |
| T4 | Candidate Detail, bad id | Open `/candidates/999999999` | "Candidate not found", no demo profile |
| T5 | Integration test | `NODE_ENV=staging node src/tests/run-block.mjs src/tests/integration/candidateDataSync.test.js` | 6/6 (new: old link after an email edit) |
| T6 | Approver test, after the approver list is restored | `NODE_ENV=staging node src/tests/run-block.mjs src/tests/integration/mrfApprovalExpiredLink.test.js`, then read `mrf_approvers` | 4/4, **and** `mrf_approvers` unchanged afterwards |
| T7 | No mail to `saukumar@` | Restart the queue worker and the API; upload a resume on staging | The upload emails go to the test inbox list only (`hmopuri@`, `pkmondal@`) |
| T8 | Section D screens | [phase3-section-d-testing-points.md](../test-plans/phase3-section-d-testing-points.md), or `npx playwright test e2e/section-d.spec.js` with `E2E_USER` / `E2E_PASSWORD` set | All points pass |

---

## Tests
- **Unit, all green:** 37 files. New:
  - `unit/dateFormat.test.js` (4)
  - `unit/candidateSync.test.js` (9)
  - `zekoRoundScoreScoping.test.js`, +4 (12 in all)
  - `mrfApprovalRules.test.js`, +1 (15)

  `missingDetails`, `sectionC`, `recordingShare` and `mrfDetailExport` pass with the shared date helper.
- **Frontend:** `vite build` succeeds.
- **Integration, on staging, 16 Oct** (`NODE_ENV=staging node src/tests/run-block.mjs <file>`):

  | File | Result |
  |---|---|
  | new `candidateDataSync` | 5/5 (run twice) |
  | `mrfApprovalExpiredLink` (N32) | 4/4; its clean-up fails (below) |
  | `missingDetailsCompleted` | 3/3 |
  | `sectionC` | 6/6 |
  | `rescheduleEmails` | 2/2 |
  | `schedulingAndScorecard` | 20/20 |
  | `pipelineStageEngine` | 16/17: PIPE-13 fails because staging has no fixture MRF with two openings (`otherMrf` is null, line 358). Test data, not section D; it failed the same way on 15 Oct |

- **Found while testing:**
  - **`mrfApprovalExpiredLink` overwrites the staging approver list.** Its clean-up deletes audit events, the append-only trigger refuses, and the roster restore after it never runs. That left the N16 fixture as the staging approver list before today, and again after today's run (DB-CHANGE-LOG #10). Fix the test (restore first, leave its labelled audit rows) before running it again.
  - **The test runner always sat out its 15-minute ceiling.** node:test prints its summary only when the test file's process exits, and open Redis/queue handles kept it alive. `run-block.mjs` now passes `--test-force-exit` and checks for the summary per line.
  - `unit/sectionC` and `integration/sectionC` write the same `test-results/sectionC.log`; the second run overwrites the first.
- **Screens to check** (read-only spec `frontend/e2e/section-d.spec.js`, `npx playwright test e2e/section-d.spec.js` with `E2E_USER` / `E2E_PASSWORD` set). It covers N34, N28 and the N29 Pipeline scores section on real data, and skips what the data can't show. The name-edit check needs a throwaway candidate, which wasn't created. The full list:
  - an old MRF's Approval trail shows the real names
  - dates on the main pages, with the browser set to en-US
  - a candidate at Tech 2 shows HR, Evalground, Functional and Tech 1 scores, and on Functional the HR card shows HR's numbers
  - edit a name in Search Candidate, then open the board, the drawer and a preview email
  - Search Candidate shows the candidate's pipeline scores

---

## Staging run, 19 Oct
Run against the staging database from the dev machine, with the mail redirect confirmed on. No email was sent.

| # | Check | Result |
|---|---|---|
| T5 | `candidateDataSync.test.js` | **6/6**, including the old link opening after an email edit (T1 in test form) |
| T3, T4, T8 | `frontend/e2e/section-d.spec.js` | **9/9**. One check first failed on the test itself: it looked for a placeholder containing "name", but the box says "e.g. Rahul Sharma". The selector now uses the field's label; the page was fine. |
| T1 | Real email: link after an email edit | Not run by hand. Covered by T5. |
| T2 | Link after an upload merge | Not run: needs a real upload |
| T6 | Approver test | Not run: waits for the staging approver list to be restored |
| T7 | No mail to saukumar@ after a worker restart | Not run: needs the deployed staging server |

## Staging steps (dev → staging)
1. **Approver list (N32), the list row only.** Don't re-run `seed-email-recipients.js` (it overwrites every `email_recipients.*` key). This is week 1's step 4, never run. Check first, then:
   ```sql
   SELECT value FROM rpa_settings WHERE key = 'mrf_approvers';
   UPDATE rpa_settings
   SET value = '[{"email":"hmopuri@aapnainfotech.com","name":"Abhijit Roy","title":"CEO"},{"email":"pkmondal@aapnainfotech.com","name":"Sanghamitra Roy","title":"CHRO"}]'
   WHERE key = 'mrf_approvers';
   ```
   Applied on staging 16 Oct (DB-CHANGE-LOG #9), then overwritten the same day by the N16 test's clean-up (#10); **not restored**, by decision. On 16 Oct `saukumar@` was removed from every recipient list; the second staging approver is now `pkmondal@` (the staging seed matches).
2. **Shortlist backfill (N29):** done on staging 16 Oct. The report found 2 drifted test rows: #70 "Pankaj K Mondal" became "HARISH MOPURI" with that record's 3 addresses, and #2624 "Pankaj Kumar Mondal" became "Sa Kumar". A re-run finds 0. Production, in the final release:
   ```
   cd backend
   NODE_ENV=production node scripts/backfill-shortlist-identity.mjs --json > before.json   # report, keep it
   NODE_ENV=production node scripts/backfill-shortlist-identity.mjs --apply --expect-db recruitmentautomationdbProd
   ```
3. **No DDL** and no Prisma change in this section.
4. **Deploy**, run the integration files above, check the screens, then RT UAT.
5. **Tell RT:**
   - dates look the same everywhere, including emails
   - the drawer keeps each round's scores
   - Search Candidate shows pipeline scores
   - name or email edits now reach the pipeline and its emails
   - vendors can no longer edit candidates

Production steps join the single final release list: the approver list with the production emails (already listed from week 1) and the backfill script.

## Rollback
- Code only, so rolling back the build is enough. The backfill changes only the name, email and other-addresses columns on shortlist rows, and the `--json` report taken before `--apply` holds the old values.
