# U02c · About AAPNA in the Shortlist template (13 Nov 2026)

**Feedback:** the owner, 13 Nov, on the walkthrough page: "let's keep it for the JD filtering too". Then in chat: put it in the email template, so recruiters can change it any time without a separate Settings step. **Brief:** [U02c](../Phase%204/uat-fixes/U02c-about-aapna-jd-tab.md).

- **Before:** an Admin wrote the text on a Settings card, and the code added it at send time to Keyword-tab shortlists only.
- **Now:** the text is part of the **Shortlist** template and is edited in Email Management. Every shortlist email carries it: the JD tab, the Keyword tab, Search "Add to JD", Change JD and Move JD. A recruiter can still delete it from the draft before sending.
- **Removed:**
  - the Settings card `CompanyProfileCard.jsx`
  - `GET`/`POST /api/settings/company-profile`
  - `companyProfile.service.js`
  - the `companyBlock` parameter of `sendShortlistEmail`
- **Kept:** the `rpa_settings` row `company_profile_text` is still there and is never deleted.
- **One-off:** `backend/scripts/move-about-aapna-into-shortlist-template.mjs` (dry run, then `--apply`). It copies that text into the active Shortlist template, above the sign-off, with the same look. It skips a template that already says "About AAPNA". Run it after the deploy.
- **Staging (13 Nov):** the Settings text was empty, so the script adds nothing there. HR types the text into the template.
- **Tests:** unit `sectionC.test.js` 27/27 (4 new); `npm run build`. The N17 Settings-card Playwright test is removed.
