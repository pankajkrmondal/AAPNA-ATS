# Phase 3 "Do Now", section G: housekeeping and Change JD

**Date:** 21 Oct 2026 · **Plan:** [PLAN-Phase3-Now.md](../Phase%203%20Enhancements%20or%20Feedback/PLAN-Phase3-Now.md) §4.G, revised on 21 Oct.
**Item:** N40. This completes section G: the code is done, and the admin steps are listed below.
**Status:**
- **Tested on 21 Oct against the staging database:**
  - unit tests pass;
  - the new section G integration file passes 5/5;
  - sections B and C still pass after the shortlist-email refactor;
  - the frontend builds.
- **Not done yet:**
  - screen checks in the browser;
  - deploying the build to the staging server;
  - committing.
- **Needs section B first:** it uses the JD tag table, so the B DDL must be applied.
- **No email was sent during testing.**

**Decisions (21 Oct):**
- **HRD logins (Susmita, Subhajit): closed.** The admin creates them as recruiters whenever needed. No code.
- **A wrong JD is fixed with "Change JD", which replaces the saved JD.** It is not an undo or a close. The candidate stays where they are.
  - A "Closed – tagged in error" outcome was only ever a nice-to-have, and it is not built.
- **Change JD is refused once anything was set up under the old JD:**
  - an interview booking;
  - an assessment invite or result;
  - a document request;
  - an offer;
  - a Zeko interview.

  The normal close is then the way out.
- **The corrected shortlist email is optional, off by default.**

---

## What changed

### G3 · Change JD
**What users see**
- **Keyword filtering tab:** each JD chip on a candidate card has a **Change JD** link. A keyword shortlist saved without a JD shows **Set JD** instead.
- **Search Candidate:** in the candidate view (eye icon), each JD card under "Pipeline scores" has the same link, for users who can "Add to JD".
- **The dialog:**
  - It shows the current JD and checks, as it opens, whether the change is allowed. If it isn't, it says why (for example "an interview is booked under the current JD. Close the record instead").
  - Otherwise the recruiter picks the correct open JD and gives a reason. JDs the candidate is already on are not offered.
  - A tick box, **"Send corrected shortlist email to the candidate (with the new JD)"**, is off by default.
- **After saving:**
  - the candidate is on the new JD at the **same stage**;
  - the old JD's lists and counts drop them;
  - the journey history shows "JD changed from "QA Engineer" (MRF-12) to "Automation Engineer" (MRF-15). Reason: …";
  - the chip updates at once.

**How**
- **Endpoints** on the screening router (`requireStaff` plus the `candidate_screening` module):
  - `GET /api/screening/shortlist/:shortlistId/change-jd`: allowed or not (with the reason), the current JD, and the JDs to leave out;
  - `POST /api/screening/shortlist/:shortlistId/change-jd` with `{ newMrfId, reason, notifyCandidate }`.
- **The rule** is in `backend/src/utils/changeJd.js` (pure, unit-tested). Refused when:
  - the shortlist is rejected;
  - the journey is closed;
  - the current stage is rejected;
  - any activity exists under the old JD on **any** stage. `getStageLocks` only looks at the current stage, so this check has its own queries.
- **The service** is `backend/src/services/changeJd.service.js`. Everything runs in one transaction:
  1. Lock (candidate, new JD) with the same advisory-lock key as Add to JD, so the two cannot race.
  2. Re-check that the candidate is not already on the target, and re-check the rule.
  3. Claim the shortlist row on the JD the request saw (`updateMany … where mrf_id = old`), so a second click or a second recruiter is told "just changed by someone else".
  4. Repoint the shortlist (`mrf_id`, `position_applied`) and the journey (`mrf_id`).
  5. Write a `note` event.
  6. Move the JD tag (`retagCandidate`). The old JD's tag is removed unless an upload made it: "uploaded for JD A" stays true.

  The new JD must pass the same check as Add to JD and uploads (`mrfCandidateBlock`).
- **What is not changed:**
  - the stage and stage state;
  - `shortlisted_by` / `shortlisted_at`;
  - the snapshot of the email that was sent;
  - logged emails (history).
- **The corrected email** goes through the shortlist email path, now extracted as `sendShortlistEmail` in `screening.service.js`. `shortlistCandidates` uses the same helper, unchanged in behaviour. It carries:
  - the new role;
  - the new JD file attached (or linked);
  - a line saying it replaces the earlier message.
- **Card data:** journey chips (`attachStageHistory`) and Search Candidate's JD cards (`getCandidatePipelineScores`) now carry `shortlist_id` and `mrf_id`. Eligibility is fetched when the dialog opens, not cached with search results, so it is never stale.
- **Frontend:**
  - `frontend/src/components/screening/ChangeJdModal.jsx` (new);
  - the link in `CandidateScreening.jsx` (Keyword tab) and in `PipelineScoresSection.jsx`.

### G1 · Close the stale MRFs (admin)
Use MRF page → **Close**, with a reason, for Business Development Services, T Snap Project One and any other test or stale MRFs. This uses the existing manual close. Rehearse on staging, then do it on production.

### G2 · HRD logins: closed
Admin → Users, as Recruiter, when needed.

### Samriddhi (wrong JD)
On Keyword filtering or Search Candidate, use **Change JD** on Samriddhi's wrong-JD shortlist and pick the correct JD. If the dialog refuses because something was already set up under the wrong JD, close that record instead.

---

## Tests
**Unit:** `unit/changeJd.test.js`, 5 new:
- a fresh shortlist may change;
- every refusal code;
- every activity cause is named;
- the reason is cleaned and capped;
- the history note wording.

**Integration (staging DB):**

| File | Result |
|---|---|
| `integration/sectionG.test.js` (new) | 5/5 |
| `integration/sectionB.test.js` | 9/9 (re-run after the email refactor) |
| `integration/sectionC.test.js` | 6/6, including N22, which sends a shortlist email through the extracted helper |

`sectionG.test.js` covers:
- **Repointing:** the shortlist and journey move, the stage stays, the tag moves (the upload tag on the old JD is kept), and the note is written.
- **Set JD** on a keyword shortlist.
- **Refusals:** same JD, closed JD, no reason, and the candidate already on the target (nothing changes).
- **An interview booked under the old JD** blocks the change, and the status endpoint says why.
- **Two changes at once:** one wins, the other gets 409, and there is exactly one `change_jd` tag.

**Lint:** `no-undef` is clean on every touched file. `vite build` passes.

## Staging steps (dev → staging)
1. Apply the section B DDL first (done on staging on 21 Oct).
2. **Deploy.** Section G has no DDL of its own.
3. **Screen checks:**
   - Change JD from the Keyword tab and from Search Candidate;
   - Set JD on a keyword shortlist;
   - a refused case, such as a candidate with an interview booked;
   - the corrected email, ticked once, to the test inbox.
4. **Admin:** close the stale MRFs, then fix Samriddhi with Change JD (staging rehearsal).
5. **Tell RT** how Change JD works and when it is refused.

## Final production release (add to the single list)
1. Deploy, after the section B DDL.
2. **Admin on production:** close the stale MRFs; Change JD for Samriddhi.
3. RT briefing.

## Rollback
- **Code only:** deploy the previous build.
- **Changes already made stay:** a Change JD that was already saved stays saved. Its journey note records the old JD, so a mistake can be undone by hand with another Change JD.
