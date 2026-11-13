# R1 · Fix release 1: staging 20 Nov, production 27 Nov
> **Replaced on 12 Nov by [R16](R16-release-16-nov.md):** one release, staging 13 Nov and production 16 Nov. This file is kept for reference only.
**Depends on:** the Handoffs of U09, U06, U04, U05, U01 and U02. Read only those Handoff sections.

**Goal:** U01, U02, U04, U05, U06 and U09 live on production, after Chhaya's UAT on staging.

**NOTE:** No email or invite should go to candidate or HR on staging. Only to Harish, Pankaj and n8nPankaj only.

## Steps
1. **Pre-flight:** every R1 brief's Handoff says `Built`. Run `npm run test:unit` once and `cd frontend && npm run build`.
2. **Staging deploy** with `backend/deploy-staging.sh`. Then:
   - run `repair-excel-resume-links.mjs` and `backfill-extra-contacts.mjs` in **dry-run** mode first, review the output, then run them with `--apply`
   - set `SCREENING_V2=true` on staging
3. **Chhaya's UAT on staging,** one check per item:
   - **U01:** schedule a candidate from an Excel upload. The warning shows and no `.xlsx` is attached.
   - **U02:** the JD is on the shortlist (all three sources), Zeko, Evalground, Tech, HR and CEO invites, and the Approved email.
   - **U04:** "Java, Python" with All and with Any; "Noida, Delhi" finds Noida or Delhi only, not "New Delhi" or "Greater Noida" (HR's exact-match decision, 10 Nov).
   - **U05:** search by a second email, by "+91 …" and by a dashed number.
   - **U06:** Chhaya decides on behalf for a test MRF.
   - **U09:** the new laptop wording.
4. **Production (27 Nov),** following `docs/deployment/PHASE3-PRODUCTION-DEPLOYMENT.md`:
   - backend and frontend deploy
   - the two scripts: dry run, then `--apply`
   - the U06 decision on production: the MRF Hold/Delegate DDL, Chhaya's role move, the flags
   - `SCREENING_V2` only if N11 is built and RT has signed it off; otherwise production keeps the old search (see the U04 Handoff)
5. Back up the sheet, then set the U01, U02, U04, U05, U06 and U09 rows in "Phase 3 UAT Fixes - Nov" to their final status.

## Handoff
_(fill in at the end of the chat: what went live, anything that slipped to R2)_
