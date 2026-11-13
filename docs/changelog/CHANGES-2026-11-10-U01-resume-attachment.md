# U01 · A spreadsheet is never sent as the resume; the Schedule window warns when there is none (10 Nov 2026)

**Sheet:** Phase 3 UAT Fixes - Nov, U01. **Brief:** [U01](../Phase%204/uat-fixes/U01-resume-attachment.md).
**HR report:** when a candidate had no resume, the panel got an Excel file with candidate details. Some were also sent the wrong resume.

## What changed
- **Upload:** an `.xlsx` row no longer saves the workbook as its resume. Its `cvFileUrl` / `cv_file_item_id` stay null in all three write paths. The workbook link stays on the upload job. A duplicate of an existing candidate keeps that candidate's resume.
- **Merge:** the resume URL and item id are taken as one pair, from one side (`pickResumePair`). A null or non-resume incoming pair never replaces a real one. The incoming "resume still owed" flag is dropped when the kept resume is real. Old queue rows that still carry a workbook link don't bring it over.
- **One rule, `utils/resumeCheck.js`:** only a pdf, doc or docx that isn't flagged `uploadResume` counts as a resume. After download, the bytes decide (`sniffDocumentType` in `fileSignature.js`, which tells `.docx` from `.xlsx`). The dossier ZIP uses the same rule.
- **Panel pack:** `summary.cv` is now `attached | missing | not_a_resume | failed | too_large`, and the invite gives one line for each (no internal detail). A docx is sent with the correct content type. When HR asks, the candidate profile summary is attached in place of the CV. The timeline note says why a CV wasn't sent.
- **Pre-send check:** the schedule and reschedule previews return `pack: { resume, jd, report }` from the records. Nothing is downloaded.
- **Schedule window:** shows a warning when there is no resume, with an **Upload resume** button and an unticked **Attach the candidate profile summary instead** box. Booking asks "Send without a resume?" first. The post-booking **Send JD, CV & report to panel** button does the same.
- **Drawer:** **View resume** appears only for a real resume. Otherwise it says "No resume on file" and offers **Upload resume**.
- **New endpoint:** `POST /api/candidates/:id/resume` (staff only; pdf, doc or docx; 10 MB). It stores the file in OneDrive, saves the URL and item id together, and clears the flag. A failed OneDrive upload returns 502, so the file is never saved to local disk only.
- **Repair script:** `backend/scripts/repair-excel-resume-links.mjs`. It runs as a dry run by default; `--apply` and `--name "<candidate>"` are the options. Each change is logged to `rpa_processing_log` (`U01_REPAIR_EXCEL_RESUME`).

## Tests
- **Unit:** `resumeCheck.test.js` 21/21 (new), `panelPack.test.js` 13/13, `fileSignature.test.js` 23/23, `candidateDossier.test.js` 122/122. Full unit run: 1052/1052.
- **Integration (staging DB):** `panelPack.test.js` 7/7. It adds an Excel-row candidate, a failed fetch, the profile option and the preflight.
- **Frontend:** `npm run build` passes.
- **Browser (Playwright, headless Edge, local stack on the staging DB):** `e2e/u01-resume-warning.spec.js` 1/1 on the real Excel-row candidate (pipeline 2904). It checks:
  - the preview's `pack.resume` is `not_a_resume`
  - the warning, Upload resume and the unticked profile box
  - the confirm, where "Go back" sends nothing
  - the booking payload carries `attach_profile`
  - the upload posts to `/api/candidates/:id/resume`
  - unticking the pack removes the warning

  Every API write is stubbed, so nothing was booked, emailed or uploaded. Run it with `npx playwright test -c playwright.u01.config.js` and `E2E_SESSION_EMAIL`: it mints a one-hour staff session and deletes it afterwards.
- **Repair (staging):** in the dry run, 70 candidates pointed at one of 2 workbooks. HR's "Abhay Ranjan" (#257) was one of them.
  - `--apply` cleared the 70 links. A re-run finds 0, and the old values are in `rpa_processing_log` (`U01_REPAIR_EXCEL_RESUME`).
  - The Playwright run passed again afterwards, now with the "No resume on file" wording.
  - The production run is part of R1.
