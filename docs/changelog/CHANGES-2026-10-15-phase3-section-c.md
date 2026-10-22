# Phase 3 "Do Now", section C: JD attachment, candidate forms, Add to JD, phone, outcome email opt-out

**Date:** 15 Oct 2026 · **Plan:** [PLAN-Phase3-Now.md](../Phase%203%20Enhancements%20or%20Feedback/PLAN-Phase3-Now.md) §4.C.
**Items:** N17, N18, N20 (server side), N21, N22, N45 (new, 15 Oct). Together with week 1 ([CHANGES-2026-10-14-phase3-week1.md](./CHANGES-2026-10-14-phase3-week1.md)) this completes section C.
**Status:** built and tested locally against a throwaway database; not yet on staging. Nothing is committed. Production goes once, at the end, with the other sections.
**Screens:** agreed on the design mockup ("Section C") before they were built.

---

## What changed, by item

### N17 · JD attached to Keyword-tab shortlist emails
- **Decision (15 Oct):** only shortlist emails sent from the **Keyword filtering** tab carry the JD and the About AAPNA text. JD-filtering shortlists and pipeline stage emails are unchanged. HR / vendor upload emails follow after section B.
- **Sender:** `sendGraphEmail` takes `attachments` (`{ name, contentType, contentBytes }`), sent as Graph `fileAttachment`s on both send paths (`buildGraphAttachments`).
- **DDL** `backend/prisma/ddl/2026-10-15-mrf-jd-item-id.sql` (+ rollback): `rpa_mrf.jd_item_id varchar(512)`, the OneDrive item id of the MRF's JD. New MRFs store it on upload; older MRFs get it the first time their JD is resolved from the link. The code reads and writes it with raw SQL and tolerates the column being absent, so the build does not depend on the DDL order.
- **JD file** (`services/jdAttachment.service.js`): downloaded up to 3 MB, cached 10 minutes. Over 3 MB, unreadable, or no item: the email carries a "View the job description" link instead. No JD at all: the email goes without one.
- **About AAPNA** (`services/companyProfile.service.js`): setting `company_profile_text`, plain text, at most 3000 characters, admin only (`GET/POST /api/settings/company-profile`). Escaped, line breaks kept, added under the email body. Empty adds nothing.
- `GET /api/screening/roles/:id/jd` tells the dialog whether the JD can be attached (`attachable`, `name`, `size_bytes`, `has_link`, `reason`).
- The shortlist request carries `source` (`keyword` / `jd` / `search_candidate`); only `keyword` attaches. `rpa_email_messages` records `has_attachments` / `attachments_json`.

### N20 · Closed MRF refused by the server
- `shortlistCandidates` refuses an MRF that is closed (409 "… is closed"). Until now only the screen blocked it.

### N21 · Search Candidate → Add to JD, and who was left out
- Search Candidate: ticks (staff with Candidate Screening access; never vendors), kept across pages; "N selected · Add to JD · Clear selection". The dialog is the Screening shortlist dialog (open MRFs, same email), titled "Add N candidates to a JD".
- The shortlist now reports each candidate it left out, with the reason (`skipped_candidates: [{ cv_id, name, reason, message }]`):
  - `cool_off`: "Rejected on 25 Sep 2026 (Technical Round 1). Can be added again after 25 Mar 2027." (6-month cool-off);
  - `already_shortlisted`: "Already shortlisted for this MRF.";
  - `in_pipeline`: "Already in the pipeline for this MRF (…)".
  
  Left-out candidates get no shortlist row and no email. A cooled-off candidate used to get the shortlist row and the email, and only the pipeline journey was then refused, so the candidate heard "shortlisted" and never appeared on the board. A result dialog lists who was added and who was not, on both Search Candidate and the Screening page.

### N22 · Candidate phone
- **Shortlist email:** a candidate with no valid mobile number (10 digits after dropping +91, spaces, dashes) gets a "Confirm your mobile number" line linking to their details form; the phone joins their missing-details list (other missing fields kept). The dialog says "N of these candidates have no valid phone number".
- **Schedule interview:** the Interviewee phone is editable. A changed number is saved to the CV (10 digits) before the booking (schedule and reschedule, `candidate_phone`); an invalid one is refused (400). Logs show only the last 4 digits.
- **Zeko:** bookings send the candidate's number as `+91XXXXXXXXXX`, so Zeko's SMS reminders reach them. Outside production, while emails are redirected, Zeko gets `ZEKO_TEST_PHONE` instead (blank = no number), never a real candidate's.

### N18 · Candidate forms
- **Shared rules** (`backend/src/utils/candidateFieldRules.js`, mirrored in `frontend/src/constants/candidateFields.js`): mobile 10 digits; email format; CTC and expected CTC 0–200 LPA; experience 0–60 years and last company not more than total; 10th / 12th / graduation / post-graduation 0–100. Values must be plain numbers.
- **Server:** the public form is checked before the resume is processed (400 with the reasons). The recruiter edit checks only the fields whose value changed, so an old value such as "3 years" never blocks saving something else.
- **Lists:** qualification (BE / BTech … Other (please specify)), notice period (Immediate … More than 90 days), shift (adds Flexible), English rating 1–5. Current location suggests cities already in the ATS (`GET /api/candidates/public/locations`, names only, most common first). Recruiter (AAPNA) lists the **active Recruiter accounts** plus "None" (`GET /api/candidates/public/recruiters`, display names only, cached 5 minutes): deactivating a login removes the name.
- **Public form** (`MissingJdUpload.jsx`): a short version of the recruiter Edit form, showing only the missing fields, in the Edit form's order and labels, one field per row. A submit refused by the server keeps the form open with the reason.
- **Recruiter Edit form** (Candidates): one field per row, the same lists and rules. An old value that is not in a list shows as "(old value)" until changed.

### Dates: "Sep", not "Sept"
- `fmtIstDate` (bell text, cool-off messages) wrote en-GB's "Sept"; it now writes "Sep", like every screen.

### Bug found while testing: reschedule audit and vendor line
- Since before Phase 3, every interview reschedule skipped its follow-up: the pipeline note "<Round> rescheduled: <old> → <new>" was never written and the vendor never got the "interview rescheduled" status line (a variable was out of scope; the error was only logged as "follow-up bookkeeping failed — when is not defined"). Fixed in `interviewSchedule.service.js`; `rescheduleEmails.test.js` passes again. After release, vendors start receiving that status line, as designed (M6).

### N45 · Outcome email opt-out (new, 15 Oct)
- The outcome dialog has "Send email notification to candidate", ticked by default. Unticked: no candidate email, the button reads "Save outcome", and the round shows "Email not sent" (`email_error` = "Not sent: the recruiter chose not to email the candidate."). A vendor's status update still goes out. API: `send_email` on `POST /api/pipeline/:id/outcome` (default true).

---

## Tests
- **Unit:** 746 pass (11 new in `src/tests/unit/sectionC.test.js`: Graph attachments, email blocks, phone helpers, field rules, city ranking, "Sep" dates).
- **Integration (local):** new `src/tests/integration/sectionC.test.js` (6): closed MRF refused; cool-off and already-shortlisted skipped by name with nothing written; phone request added to the missing list; Schedule phone saved / refused; outcome without email; edit rules on changed fields only. Re-run green: `pipelineStageEngine` (17), `schedulingAndScorecard` (20), `missingDetailsCompleted` (3), `referralSuppression` (6), `crossModuleE2E` (6), `rescheduleEmails` (2, after the fix above), `jdGates` (12), `keywordFilters` (23). `documentsAndOffer`: 14 pass, 2 fail locally only (document reminders count only a sent email, and nothing can be sent here); untouched code, check on staging.
- **Playwright:** new `e2e/section-c.spec.js` (6, local seed `seed-sectionC.mjs`). Re-run green: `week1-ui`, `pipeline-drawer`, `public-forms-theme` (17), section A `jd-screening` / `keyword-screening` (13, 1 data-dependent skip).
- **Not testable locally:** the real JD attachment and Zeko's SMS (no Graph / Zeko credentials on the local stack). Check on staging: shortlist from the Keyword tab on an MRF with a JD and confirm the attachment arrives in the test inbox.

---

## Staging steps (dev → staging)
1. **DDL**, dry-run then for real:
   ```
   cd backend
   node scripts/run-ddl.mjs --env .env.staging --expect-db recruitmentautomationdb --file prisma/ddl/2026-10-15-mrf-jd-item-id.sql --dry-run
   node scripts/run-ddl.mjs --env .env.staging --expect-db recruitmentautomationdb --file prisma/ddl/2026-10-15-mrf-jd-item-id.sql
   ```
2. **Prisma:** `schema.prisma` has the one new line (`jd_item_id`). Stop the server and worker, run `npm run prisma:pull && npm run prisma:generate`, and confirm `git diff prisma/schema.prisma` shows nothing beyond that line.
3. **Settings → Candidate emails: About AAPNA:** paste RT's text (admin).
4. **Settings:** turn on interview reminders (N22).
5. **Admin → Users:** deactivate Prakash and Naveen; create Sweta Ganguly as Recruiter. Check every name that should be on the Recruiter list has the Recruiter role (Chhaya included), or it drops off the list.
6. Optional: `ZEKO_TEST_PHONE` in the staging `.env` to receive Zeko's test SMS.
7. **Check on staging:** Keyword-tab shortlist with a JD (attachment in the test inbox); Add to JD with a cooled-off candidate; the public form from a missing-details email; an outcome with the box unticked.

Production steps join the single final release list.

## Rollback
- `2026-10-15-mrf-jd-item-id.rollback.sql`. The build keeps working without the column (it falls back to resolving the JD from its link).
- The About AAPNA text is one `rpa_settings` row (`company_profile_text`); clearing it adds nothing to emails.
