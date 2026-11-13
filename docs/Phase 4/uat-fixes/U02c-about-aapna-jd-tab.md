# U02c · About AAPNA in the Shortlist template, on every shortlist
**Release 16 Nov (R16) · Low · ~1–2 h · Depends on: U02 and U02b Handoffs (same shortlist email code). Build before the R16 staging deploy.**

**Goal**
- **Before:** an Admin set the "About AAPNA" text on a Settings card (N17), and code added it only to shortlists from the **Keyword filtering** tab.
- **The first brief (13 Nov):** add it to **JD filtering** shortlists too. This followed the owner's walkthrough comment "let's keep it for the JD filtering too".
- **Reworked the same day.** The user's question in chat was: why not put it in the email template, so recruiters can change it any time without the Settings step? Decided:
  - It goes in the one **Shortlist** template.
  - Every shortlist path uses that template: the JD tab, the Keyword tab, Search "Add to JD", Change JD and Move JD. So all of them carry it by default.
  - A recruiter can delete it from the draft before sending.
  - This replaces the earlier "Add to JD goes without it".
- **Done when:**
  - the Settings card and the send-time code are gone
  - the Shortlist template in Email Management carries the text above the sign-off
  - each shortlist path's email shows it once

## Changes
1. **Send time** (`backend/src/services/screening.service.js`): remove `isKeywordShortlist`, `companyBlock`, the `getCompanyProfileText` import and `sendShortlistEmail`'s `companyBlock` param. The body is just the template with the JD card and phone blocks.
2. **Settings step removed:**
   - `frontend/src/components/settings/CompanyProfileCard.jsx` and its use in `frontend/src/pages/Settings.jsx`
   - `settingsService.getCompanyProfile`/`saveCompanyProfile`
   - the two `settings.controller.js` handlers
   - the `/settings/company-profile` routes
   - `backend/src/services/companyProfile.service.js`
   - The `rpa_settings` row `company_profile_text` is kept.
3. **One-off script** `backend/scripts/move-about-aapna-into-shortlist-template.mjs`: dry run by default, `--apply` writes.
   - It copies the Settings text into the active `shortlist` template(s) with `companyBlockHtml` + `appendToBody`, so the block lands in the same place with the same look.
   - It skips a body that already says "About AAPNA".
   - Run it after the deploy. If it runs before, Keyword shortlists show the block twice.
4. **Docs:**
   - the changelog `docs/changelog/CHANGES-2026-11-13-U02c-about-aapna-in-template.md`
   - a line in `frontend/UI-CHANGELOG.md`
   - the admin guide's "Company profile" Settings line is removed
   - R16: the script step, the slip rule and the UAT check

No DDL, no flags.

## Not in this chat
- **The walkthrough page** (U02, "Doesn't carry it: ... 'About AAPNA' stays on Keyword shortlists only") is updated by the main chat or F6. Thread f202805f stays open until then.

## Handoff
**Built 13 Nov.**
- **Changed:**
  - `screening.service.js`
  - `settings.controller.js`, `settings.routes.js`
  - `Settings.jsx`, `settingsService.js`
  - the comment in `CandidateScreening.jsx`
  - the `companyBlockHtml` doc comment in `utils/candidateEmailBlocks.js`
  - unit `sectionC.test.js` (4 new tests)
  - e2e `section-c.spec.js` (the N17 card test removed)
- **Deleted:** `CompanyProfileCard.jsx`, `companyProfile.service.js`.
- **New:** `backend/scripts/move-about-aapna-into-shortlist-template.mjs`. It exports `addAboutAapna(bodyHtml, text)`, which returns `{ changed, body, reason: 'added'|'already_there'|'no_text' }`, and `resultLine(row, reason, apply)`.
- **Tests run:** `node --test src/tests/unit/sectionC.test.js` 27/27; `npm run build` OK. Staging dry run: Shortlist Notification (#2), Settings text **empty**, so nothing to add.
- **Left for the user:**
  - On staging, HR types the About AAPNA text into Email Management › Shortlist, above "Best regards". The script has nothing to copy there.
  - In production, run the script's dry run after the deploy and check the printed text; `--apply`, or type it in if it is empty.
  - Send a test shortlist from the JD tab, the Keyword tab and Add to JD, to our own addresses: the block shows once, above the sign-off.
  - Integration: `node src/tests/run-block.mjs src/tests/integration/sectionC.test.js src/tests/integration/jdEveryEmail.test.js`.
  - Then `npm run test:unit`.
- **Not done:** `prisma/seed-email-templates.js` is unchanged. There is no agreed text to put in a seed, and that seed isn't run on servers.
