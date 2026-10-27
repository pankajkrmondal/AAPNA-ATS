# L09 · Duplicate Review: old vs new comparison (23 Oct 2026)

**Sheet:** Phase 3 Enh - Later, row 14 ("HR Manual Upload & Vendor Manual Upload"). **Plan:** PLAN-Phase3-in-Phase4.md › Other bugs › L09.

## Why
"If there is any duplicate, right now, REVIEW is showing what is the current user name and his/her resume instead of a pure comparison of what data has been there already vs what is new one and what changed since last resume."

What we found:
- The Review window rendered only the staged upload (`rpa_cv_tmp`).
- That staged row was padded with the existing candidate's values, so a field missing from the new resume looked unchanged.
- The matched candidate's id was thrown away.
- The match query was `LIMIT 1` with no `ORDER BY`, so with several candidates sharing a phone the upload and the merge could pick different people.
- "View full details" found the staged row by searching on email and fell back to `rows[0]`, which could be a different staged row.

## What changed
- **DDL** `2026-10-23-duplicate-match-id.sql`, applied on staging (dry run first) with a rollback: `rpa_cv_tmp.matched_cv_id` (BIGINT NULL, no FK, because the merge re-checks the candidate exists). `schema.prisma` updated by hand and the client regenerated.
- **One match helper** `findExistingCandidateMatch()` in `hrUpload.service.js`, used by both the upload and the merge. Deterministic order: most recently updated first, then newest id.
  - The upload stores `matched_cv_id`.
  - The merge updates that candidate while it still exists, and otherwise matches again.
- **The staged row now holds only what the new resume says.** Merge results are unchanged, because `prefer()` already keeps the existing value wherever the new one is empty.
- **The comparison:**
  - `utils/duplicateCompare.js` (pure) lists every field either side has. For each it gives the change (`same / updated / added / not_in_new`) and what Merge will do (`replaced / added / combined / kept`), mirroring `mergeDuplicates`: emails and phones are combined, employment history is replaced when present, everything else takes the new value when one exists.
  - It normalises values first (case, spacing, phone formatting, number formatting, skill order).
  - `duplicateReview.service.js` adds the upload history of the existing candidate and which keys matched.
- **Routes, staff only:** `GET /api/hr-upload/duplicates/:tmpId/compare` and `GET /api/vendor/review/:tmpId/compare` (`restrictTo(STAFF_ROLES)`).
- **Bookkeeping:**
  - Merge and Cancel now write `rpa_upload_jobs.reviewed_by` / `review_action`. The columns already existed (and are in the CSV) but were never written.
  - The processing log names who acted and which candidate.
- **The HR jobs list** carries `matched_cv_id` for pending duplicates, so the compact Review window links "Open existing profile" (L10).
- **UI:** new `components/uploads/DuplicateCompareModal.jsx`, opened by "Compare with the ATS record". It replaces the old full-details modal on both pages.
  - **Header:** matched by email / phone, in the ATS since, last updated by, and who uploaded this and when.
  - **Summary tags** (changed / new / not in new resume / same), and an "Only show differences" switch, on by default.
  - **Table:** Field | Already in ATS | This upload | On merge.
  - **Links:** earlier and new resume links.
  - **Earlier uploads:** a collapsible list.
  - **Actions:** "Open existing profile", Merge / Cancel.
  - **Vendor page (`linksHidden`):** the same data and actions, with no profile or resume links, rendered for staff only. Vendors still never see the review.

## Tests
- `src/tests/unit/duplicateCompare.test.js` (11 tests): formatting is not a change; updates, additions and "not in new resume"; emails and phones combined; matched-by; history display.
- `src/tests/vendorIsolation.test.js` (+1): both compare routes are staff-only.
- `src/tests/integration/sectionB.test.js` (11/11 on staging, 2 new):
  - two candidates share a phone; the comparison shows the one the upload matched, and the merge updates that one and leaves the other untouched;
  - a row staged before L09 is still compared, by email;
  - a missing row gets 404.
- The frontend builds.
- **Still to do:** a browser check of the window on both pages.

## Files
- `backend/prisma/ddl/2026-10-23-duplicate-match-id{,.rollback}.sql`
- `backend/prisma/schema.prisma`
- `backend/src/services/hrUpload.service.js`
- `backend/src/services/duplicateReview.service.js` (new)
- `backend/src/utils/duplicateCompare.js` (new)
- `backend/src/controllers/hrUpload.controller.js`
- `backend/src/controllers/vendor.controller.js`
- `backend/src/routes/hrUpload.routes.js`
- `backend/src/routes/vendor.routes.js`
- `frontend/src/components/uploads/DuplicateCompareModal.jsx` (new)
- `frontend/src/pages/HRUpload.jsx`
- `frontend/src/pages/VendorPortal.jsx`
- `frontend/src/services/hrUploadService.js`
- `frontend/src/services/vendorService.js`
- tests as above
