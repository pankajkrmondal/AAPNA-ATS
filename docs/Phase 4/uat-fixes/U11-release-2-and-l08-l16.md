# U11 · L08–L16 production steps and fix release 2 (staging 4 Dec, production 11 Dec)
**Release 2 · Medium · 10 h · Depends on: the Handoffs of U03, U07, U08, U10 and R1. Read only those sections.**

**Goal**
- **Today:** the L08–L16 production steps are still open.
- **Change:** close them with fix release 2, and run the staging checks and Chhaya's UAT.
- **Done when:** release 2 is live and the open L08–L16 steps are closed.

## Open L08–L16 steps
From `docs/Phase 3 Enhancements or Feedback/HANDOFF-2026-10-24-other-bugs-L08-L16.md` §4 (the code is already in commit `8c4c3a9`):
1. Remove the repeated sentence from the "MRF Approval Request" template (Email Templates page). The seed does not overwrite it.
2. Get Chhaya's sign-off on the "Forms & Links" menu slot, then set `VITE_FORMS_LINKS_ENABLED=true` in `frontend/.env.production`.
3. Production seeds: `seed-email-recipients.js` (`scorecardSubmitted`) and `seed-interview-email-templates.js`, plus any template added by U03 or U08.
4. Apply the L09 DDL on production (`backend/prisma/ddl/2026-10-23-duplicate-match-id.sql`).
5. Signed-in checks still open; do them on the next real interview:
   - L13 "Copy join details"
   - the L14 drawer button "Send JD, CV & report"
   - the L08 scorecard-report card
6. Check L14, L15 and L16 rendering in Outlook desktop and OWA, with a test MRF on staging.

## Release 2 steps
1. **Pre-flight:** the R2 Handoffs say `Built`. Run `npm run test:unit` and `cd frontend && npm run build`.
2. **Staging deploy** (`backend/deploy-staging.sh`):
   - the U08 DDL
   - `ZEKO_REMINDER_ENABLED` and `FORMS_DIGEST_ENABLED` on in staging
3. **Chhaya's UAT on staging:**
   - **U03:** Tech 2 invite table without CTC; CEO invite with CTC; the Source checkbox; the slimmer pack.
   - **U07:** a moved candidate gets the JD; the next panel sees the earlier role.
   - **U08:** the phone page, Skip, and the reminder.
   - **U10:** the tab and the 09:00 bell.
4. **Production (11 Dec)** following `docs/deployment/PHASE3-PRODUCTION-DEPLOYMENT.md`: the DDL, seeds and flags above, plus any R1 leftovers (for example `SCREENING_V2`, if it slipped).
5. Back up the sheet, then update the U03, U07, U08, U10 and U11 rows.

## Handoff
_(fill in at the end of the chat)_
