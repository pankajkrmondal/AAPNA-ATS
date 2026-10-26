# L10 · Profile link from HR Manual Upload rows (23 Oct 2026)

**Sheet:** Phase 3 Enh - Later, row 15 ("HR Manual Upload - User Profile redirect"). **Plan:** PLAN-Phase3-in-Phase4.md › Other bugs › L10.

## Why
"In the resume uploaded by HR, if user wants to check the candidate details in detail, they don't have the option to redirect the user to the candidate profile view page."

## What changed
- **HR Manual Upload (`frontend/src/pages/HRUpload.jsx`):**
  - When an upload has a candidate record (`cv_id`: new, merged, or waiting for missing details), the Candidate Name opens `/candidates/:id`.
  - The Duplicate Review window shows "Already in ATS → Open existing profile" once the matched candidate's id is known. The id arrives with L09.
- **Candidate profile:** Back reads "Back to HR Manual Upload" and returns there (`CandidateDetail.jsx`). The sidebar keeps HR Manual Upload highlighted (`MainLayout.jsx`).
- **Vendor Upload is deliberately unchanged** (decision 23 Oct: share no unnecessary links or access on that page). Staff can still open any profile from Search Candidate.

## Security fixes found on the way
- **`GET /api/candidates/:id`** had no vendor scope. The list, the export and the vendor dashboard were scoped, but a vendor token could read any candidate by id.
  - A vendor now gets only candidates they submitted (`vendorMayReadCandidate`, `utils/vendorScope.js`).
  - Anyone else's candidate returns 404, the same answer as a missing one, so ids can't be probed.
  - Staff are unaffected.
- **`GET /api/candidates/:id/emails`** (the recruiters' email conversations with a candidate) had no role check. It is now `requireStaff`. No vendor screen reads it.

## Tests
- `src/tests/vendorIsolation.test.js`: 5 new tests for the vendor read rule and the two routes.
- Full unit run: 958/958.
- The frontend builds.
- **Browser check still to do:** HR upload row → profile → Back.

## Files
- `frontend/src/pages/HRUpload.jsx`
- `frontend/src/pages/CandidateDetail.jsx`
- `frontend/src/layouts/MainLayout.jsx`
- `backend/src/utils/vendorScope.js`
- `backend/src/controllers/candidate.controller.js`
- `backend/src/routes/candidate.routes.js`
- `backend/src/tests/vendorIsolation.test.js`
