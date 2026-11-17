# R16 · One release: staging Fri 13 Nov, production Mon 16 Nov
**Replaces [R1](R1-release-1.md) and the release half of [U11](U11-release-2-and-l08-l16.md) (12 Nov decision: "production ready by Monday 16 Nov, everything updated in prod").**
**Depends on:** the Handoffs of U01–U10, U02b, U02c, U03b, U04b, U06b and U10b. Read only those sections.

**Goal:** all of U01–U11 live on production on 16 Nov, after Chhaya's UAT on staging, with the open L08–L16 steps closed.

**NOTE:** no email or invite may go to a candidate or to HR on staging. Send only to Harish, Pankaj and n8nPankaj.

## 1 · Pre-flight (Fri 13 Nov morning)
1. In `AAPNA-ATS`, run `git status` and `git log -3`.
   - U02, U03 and U07 are in `4102495`.
   - The 11 Nov JD link-card work and the 12 Nov chats are uncommitted.
   - **Ask the owner** before any commit, merge or push. The deploy needs the code on the deploy branch.
2. Every brief listed above says `Built` in its Handoff. Run `npm run test:unit` once, then `cd frontend && npm run build`.
3. **Slip rules** (when a chat isn't done):
   - U10b not ready: hide the Completed Forms tab and keep `FORMS_DIGEST_ENABLED` off.
   - U06b not ready: keep `MRF_DELEGATE_DECISION_ENABLED` off in production.
   - U02b not ready: ship U02 as built (the JD added by code, today's rule).
   - U03b not ready: ship U03 as built, and don't run the template refresh.
   - U02c not ready: About AAPNA stays on Keyword shortlists only (the Settings card stays), and the U02c script is not run.
   - U04b not ready: ship U04 as built (the filtering is correct); the order and ×N stay as they are.
   - Record each slip in Handoff.

## 2 · Staging (Fri 13 Nov)
1. Deploy with `backend/deploy-staging.sh`, which includes the frontend.
2. **DDLs**, a dry run first where the file supports one:
   - U08 `2026-11-10-zeko-link-token.sql`
   - U02b `2026-11-12-email-template-attach-jd.sql`
   - then `npx prisma generate`
3. **Seeds:**
   - the Zeko reminder template (`prisma/seed-zeko-reminder-template.js`)
   - the U02b Evalground template (create-only)
4. **Scripts:** dry run, review the output, then `--apply`:
   - `repair-excel-resume-links.mjs`
   - `backfill-extra-contacts.mjs`
   - U03b `refresh-panel-invite-templates.mjs`
   - U02c `move-about-aapna-into-shortlist-template.mjs`. Only after the deploy, or Keyword shortlists show it twice. On 13 Nov staging had no Settings text, so the dry run says "nothing to add"; HR then types About AAPNA into Email Management › Shortlist.
5. **Server flags:**
   - Confirm on the server: `SCREENING_V2=true`, `MRF_HOLD_ENABLED=true` and `MRF_DELEGATE_DECISION_ENABLED=true`.
   - `ZEKO_REMINDER_ENABLED=true` and `FORMS_DIGEST_ENABLED=true`: the owner decided on 12 Nov to switch both on in staging now and in production on 16 Nov.
     - **Before the reminder goes on:** list the staging Zeko bookings that aren't attempted and whose window closes within the next 48 h. Run `sendZekoExpiryReminders({ dryRun: true })` too. If any candidate isn't a test candidate, ask the owner first, because of the NOTE above.
     - `FORMS_DIGEST_ENABLED` is a bell note only, with no email. It stays off if U10b slips.
6. **U06b:** an Admin sets the designee in Settings › MRF Approval & Hold (the owner names the person).

## 3 · Chhaya's UAT on staging (Fri 13 to Sat 14 Nov)
One check per item. Use test candidates and ZZ-TEST MRFs only (never MRF 137).
- **U01:** schedule a candidate from an Excel upload. The warning shows and no `.xlsx` is attached.
- **U02 / U02b:**
  - The JD is on the shortlist (all three sources), Zeko, Evalground, Tech, HR and CEO invites, and the Approved email.
  - Switch "Attach the JD" off on one template: the JD isn't sent.
  - Place `{{jd_link}}` in a body: the card sits there.
  - **U02c:** the Shortlist template in Email Management shows About AAPNA above the sign-off. A JD-tab, a Keyword-tab and a Search "Add to JD" shortlist to our own address each carry it once. The Settings page has no About AAPNA card.
  - **One real JD-as-link email to our own address, opened signed out in a private window.** Does the "anyone" link open without a Microsoft sign-in? Record the result. If it fails, tell the owner, who will decide what to do.
- **U03 / U03b:**
  - A Tech 2 invite has no CTC; a CEO invite has CTC; check the Source tick-box and the slimmer pack.
  - A candidate with Tech 1 skipped shows no Tech 1 rows.
  - There is no duplicate "Candidate email" line, on templates HR hadn't edited.
- **U04:**
  - "Java, Python" with All and with Any.
  - "Noida, Delhi" finds candidates in **Noida or Delhi only**, not "New Delhi" or "Greater Noida".
  - **U04b:** "java, python" shows no ×0 on a matched skill, and within the Active group more matched skills, then more mentions, come first.
    - JD tab: open one JD and press **Refresh** first, because results are cached for up to 1 h. No ×0 should show on the mandatory chips, and the card meter should read full (for example 3/3).
- **U05:** search by a second email, by "+91 …" and by a dashed number; open the Edit form.
- **U06 / U06b:** the designee decides on a ZZ-TEST MRF with no away window. Another Admin sees the panel locked.
- **U07:** a moved candidate gets the JD, and the next panel sees the earlier role.
- **U08:** the phone page and Skip. **Reminder:** on 13 Nov, book the test candidate (our own address) with a window longer than 24 h, for example 48 h. One reminder arrives when the window is within 24 h of closing, and no second one follows.
- **U09:** the new laptop wording.
- **U10 / U10b:** Open Positions › Responded for Yesterday, Today and 7 days. Its counts equal the column. **Bell:** a test candidate completes a form on 13 Nov. At 09:00 on 14 Nov the bell note arrives and opens the Responded view for 13 Nov. Nothing is sent on a day with no forms.

## 4 · Production (Mon 16 Nov)
Follow `docs/deployment/PHASE3-PRODUCTION-DEPLOYMENT.md`.
1. **Seed rule:** never run the full `seed-email-templates.js`, because it overwrites every template and wipes HR's edits. Every seed must create only, or skip a row HR has edited. Check each seed's mode before running it.
2. **Deploy** the backend and frontend, with every new flag off.
3. **DDLs**, each with a dry run first:
   - MRF hold and delegate, `2026-10-22-mrf-hold-and-delegate.sql`
   - U08 `2026-11-10-zeko-link-token.sql`
   - U02b `2026-11-12-email-template-attach-jd.sql`
   - L09 `2026-10-23-duplicate-match-id.sql`
   - then `npx prisma generate`
4. **Seeds:**
   - the 4 MRF hold templates (`docs/phase3/MRF/MRF-Hold-and-Delegate-Approval-Plan.md` §16.4)
   - the Zeko reminder template
   - the Evalground template
   - `seed-email-recipients.js` (`scorecardSubmitted`)
   - `seed-interview-email-templates.js` (create-only)
5. **Scripts:** dry run, review, then `--apply` for all four from step 2.4. For U02c, check the printed text is the real one; if production has none, HR types it into the Shortlist template.
6. **Flags:**
   - `SCREENING_V2=true` (strict search is final; N11 dropped).
   - `MRF_HOLD_ENABLED`, then `MRF_DELEGATE_DECISION_ENABLED`. **No role move for Chhaya.** An Admin sets the designee in Settings.
   - `VITE_FORMS_LINKS_ENABLED=true` in `frontend/.env.production`, only after Chhaya signs off the "Forms & Links" menu slot.
   - `ZEKO_REMINDER_ENABLED=true` and `FORMS_DIGEST_ENABLED=true` (the owner, 12 Nov). The digest stays off if U10b slipped.
7. **The "anyone" link check:** production uses a different mailbox and app registration, so repeat the signed-out JD link check with one email to our own address.
8. **L08–L16 leftovers** (from U11):
   - Remove the repeated sentence from the "MRF Approval Request" template, on the Email Templates page.
   - Signed-in checks on the next real interview: "Copy join details", "Send JD, CV & report" and the scorecard-report card.
   - The L14–L16 Outlook desktop and OWA rendering checks, with a test MRF.
9. **The sheet:** back it up, then set the U01–U11 rows in "Phase 3 UAT Fixes - Nov" to their final status.

## Handoff
_(fill in at the end of the chat: what went live, the "anyone" link result on staging and production, any slip)_
