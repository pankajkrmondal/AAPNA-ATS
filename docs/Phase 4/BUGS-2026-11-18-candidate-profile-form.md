# Deferred bugs: candidate "Complete your profile" form

**Found:** 18 Nov 2026, while debugging the live form (`/missing-jd-upload`). **Owner:** Harish. **Status:** logged, to fix later.

Paths are relative to `AAPNA-ATS/`. Line numbers were checked on 18 Nov 2026 in the V32 working copy. If they have moved, `Grep` for the function name.

## Summary
| ID | Issue | Severity | Size | Status |
|---|---|---|---|---|
| PF-0 | A chosen rating or attached resume is reported as "required" | High: blocks the submit | XS | **Fixed in V32 code, not deployed** |
| PF-1 | The form link token is the candidate's email in base64 | High: security | M | Open, needs a decision |
| PF-2 | "Email id" is asked for and the answer is thrown away | Low | XS | Open |
| PF-3 | Browser and server checks disagree in two cases | Low | S | Open |
| PF-4 | Small usability points | Low | XS each | Open |

## PF-0 · Rating and resume reported as missing (fixed, not deployed)
- **Symptom:** after choosing a rating, the form shows "English communication rating is required." and won't submit. An attached resume can show "Please upload your resume file." the same way.
- **Cause:**
  - The required rule gave every field a `whitespace` key.
  - With any key besides `required`, the antd validator (`@rc-component/async-validator` 5.1.0) checks the value as a string. `whitespace: false` fails too.
  - The rating is a number and the resume is a file list, so both failed. The custom message hid the real reason.
- **Fix:** `NON_TEXT_KEYS` at [MissingJdUpload.jsx:89](../../frontend/src/pages/MissingJdUpload.jsx#L89). The rule at line 384 leaves the key out for those two fields.
- **Test:** a regression check was added to the N18 test in `frontend/e2e/section-c.spec.js`. It needs the seeded DB.
- **Verified:**
  - Validator: 8/8.
  - Headless Edge with the API stubbed: 13/13.
  - All 31 possible fields were accepted and sent.
- **Left:**
  - Deploy to production. The live site still has the bug.
  - Commit.
  - Changelog entries (`docs/changelog/`, `frontend/UI-CHANGELOG.md`).

## PF-1 · The form link can be guessed (security)
- **Problem:** the link token is `base64(EmailID)`. Anyone who knows a candidate's email can do all of this:
  - open their form, which shows their name;
  - change their details;
  - upload a resume to their record.

  The code already flags this weak point at [candidate.controller.js:531-534](../../backend/src/controllers/candidate.controller.js#L531-L534).
- **Where tokens are made:**
  - [emailNotification.service.js:507](../../backend/src/services/emailNotification.service.js#L507), the missing-details email;
  - [screening.service.js:2356](../../backend/src/services/screening.service.js#L2356), the phone request on shortlist (N22).
- **Where the stored token is reused:** `reminderScheduler.js:167` and `formsLinks.service.js:474`.
- **Where tokens are read:** `findCandidateByDetailsToken`, [candidate.controller.js:404-414](../../backend/src/controllers/candidate.controller.js#L404-L414). It tries the stored token first, then falls back to the decoded email:
  1. an exact match;
  2. the only record that holds that address.

  **Those fallbacks alone keep any `base64(email)` working**, so random tokens are not enough on their own.
- **Fix direction:**
  - Create a random token at both creation points and store it in `cvMissingToken`.
  - Look candidates up by the stored token only, and remove the email fallbacks.
  - Consider adding an expiry.
  - Add a test: `base64(email)` for a candidate with a random token gets a 404.
- **Decision needed:** what to do about links already sent. Their stored tokens are base64 emails, so they stay guessable. Options:
  - Rotate the tokens of candidates whose form is still pending (`cvMissingTokenStatus` not `RECEIVED`) and re-send their links.
  - Accept the risk until those forms are completed.

  Links from before tokens were stored (N29) work only through the fallback and would stop working.

## PF-2 · "Email id" asked for, answer thrown away
- **Cause:**
  - At upload, missing fields are worked out from `parsed` ([hrUpload.service.js:1338](../../backend/src/services/hrUpload.service.js#L1338)).
  - The saved email comes from `cleanEmails` instead (line 1373).
  - When the email is found only in `unique_key` (line 1319), it is saved but `EmailID` is still listed as missing.
- **What the candidate sees:** the form asks for it under the fallback label "Email id", because `EmailID` isn't in `FIELDS` in MissingJdUpload.jsx.
- **What the server does:**
  - Its `fieldMapping` ([candidate.controller.js:557-588](../../backend/src/controllers/candidate.controller.js#L557-L588)) has no `EmailID`, so the typed value is dropped.
  - Lines 788-793 still mark it as done, because they tick off every submitted key, saved or not.
- **Impact:** the candidate answers a question for nothing. No data is lost, since the email was already saved. How often this happens is unchecked (no DB access). Count rows whose `rpa_cv."missingData"` contains `"EmailID"`.
- **Fix:**
  - Set `parsed.EmailID` from `cleanEmails` before `getMissingFields`.
  - In the submit, tick off only keys that were actually saved: mapped keys, `CurrentCompany` and `uploadResume`.

## PF-3 · Browser and server checks disagree
In both cases the server's error appears as a red banner at the top of the form, not by the field. The form stays open.
- **(a) Last company experience:** when it is the only experience field missing, the browser rule (`notMoreThanTotalRule`, [candidateFields.js:130](../../frontend/src/constants/candidateFields.js#L130)) has no total to compare against. The server compares with the stored total ([candidateFieldRules.js:78-83](../../backend/src/utils/candidateFieldRules.js#L78-L83)).
- **(b) Phone:** the browser `phoneRule` ([candidateFields.js:47](../../frontend/src/constants/candidateFields.js#L47)) passes if any one number in the box is valid, e.g. `98765 43210, 123`. The server needs every number to be valid (candidateFieldRules.js:49-56).
- **Fix:**
  - Make `phoneRule` check every part, as `phoneListRule` already does.
  - Return the stored total experience from the GET and use it in the rule.
  - Or return field-level errors (`validateCandidateFields` already gives `{field, message}`) and show them with `form.setFields`.

## PF-4 · Small usability points
- **Esc in "Current location":** it wipes the typed city (antd AutoComplete behaviour). The box empties, so the "required" message is correct, but it surprises people.
- **"Job source" is free text:** both on this form and in the recruiter Edit form (Candidates.jsx:1058). Typos like "Naurki" reach the reports. A dropdown needs the list from HR.
- **Resume size limit:** the 10 MB limit (`backend/src/routes/candidate.routes.js:33`) isn't shown. A bigger file gets "File too large. Please upload a smaller file." with no size given. Add the limit to the upload button text and check the size in the browser.

## Checked and fine (18 Nov)
- No other frontend form has the PF-0 pattern. The remaining rules with extra keys are all on text inputs.
- **Every field:** valid values are accepted and sent, and the multipart header is correct. axios 1.17 lets the browser set the boundary.
- **Server:** it saves every form field except `EmailID`. The rating is stored as text, and its number and percentage checks match the browser's.
- **How to re-check:** build, then drive `/missing-jd-upload` in headless Edge with `/api/candidates/public/*` stubbed and every other request blocked. The production build points the API at the live server. See the frontend `verify` skill.
