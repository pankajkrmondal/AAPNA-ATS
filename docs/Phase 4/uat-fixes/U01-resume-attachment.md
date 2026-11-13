# U01 · Never attach a spreadsheet as the resume; warn when there is none
**Release 1 · High · ~10 h · Depends on: none**

**Goal**
- **Today:** when the resume is missing, the interviewer gets an Excel file with candidate details. HR also saw a **wrong** resume attached.
- **Change:**
  - a spreadsheet is never attached as the resume
  - the Schedule window warns when there is no resume, so HR can pause and fix it
  - HR can still send without one, with alternatives suggested
- **Done when:** scheduling for a candidate from an Excel upload shows the warning, and no `.xlsx` reaches the panel.

## Cause (verified)
**The workbook becomes every row's resume.** An `.xlsx` bulk upload is split into one candidate per row (`backend/src/services/hrUpload.service.js:1172-1198`). The workbook is uploaded to OneDrive once (`:1207-1222`) and saved as **every row's** `cvFileUrl` / `cv_file_item_id`:
- duplicate tmp row: `:1409-1410`
- direct update: `:1553-1554`
- new candidate: `:1659-1660`

That workbook holds every other row's details, which explains the "wrong resume".

**Nothing checks for it.** The only sign of a missing resume is `missingData.uploadResume = 'Null'` (`:1319-1321`), and nothing on the attach path reads it.
- `collectAttachments` (`backend/src/services/candidateDossier.service.js:990-1012`) treats any `cvFileUrl` or `cv_file_item_id` as a resume.
- `buildPanelPack` (`backend/src/services/interviewPanelPack.service.js:103-118`) attaches `files[0]` without a type check.

**Merge can pair a new URL with an old item id.** `mergeDuplicates` (`hrUpload.service.js:640-651`, `prefer()` at `:570-578`) picks the URL and the item id separately, which can attach the **old** resume.

**A failed fetch is silent.** `summary.cv` stays `'none'` (`interviewPanelPack.service.js:105-118`), and the email block only mentions `too_large` (`backend/src/utils/panelPackBlock.js:89`).

**The UI has no warning.**
- The Schedule window has one checkbox, `sendPanelPack`, default true (`frontend/src/components/pipeline/PipelineDrawer.jsx:983, 1885, 1904, 3616-3628`).
- "View resume" depends only on `cvFileUrl` (`PipelineDrawer.jsx:2787-2789`; data from `backend/src/services/pipeline.service.js:899-912`).

## Changes
1. **Upload:**
   - For Excel rows (`isExcel`), set `cvFileUrl` and `cv_file_item_id` to **null** in all three write paths. The workbook link stays only on the upload-job record (`jobInfo.file_url`).
   - In `mergeDuplicates`, take the URL and the item id **as a pair** from the same side. A null incoming pair never replaces a real one.
   - Check that nothing needs `cvFileUrl` to be non-null for these rows (`statusActive` / missing-data logic).
2. **Guard:** add `isRealResume(cv)` near `collectAttachments`. It is true only when the file is pdf, doc or docx (use the existing `fileSignature` util; see `src/tests/unit/fileSignature.test.js`) and `uploadResume` is not flagged.
   - `buildPanelPack` sets `summary.cv` to `attached | missing | not_a_resume | failed | too_large`, and `panelPackBlock.js` words each one.
   - The docx content type is set correctly.
   - The drawer's "View resume" / "No resume on file" uses the same rule.
3. **Preflight:** `previewScheduleEmails` (`backend/src/services/interviewSchedule.service.js:815-848`) also returns `pack: { resume: 'ok'|'missing'|'not_a_resume', jd, report }`. This is a metadata check; nothing is downloaded.
4. **Schedule window** (`PipelineDrawer.jsx` around `:3616-3628`): when the resume is not `ok`, show a warning Alert: "No resume on file for <name>. The panel will get the JD and the report only." It offers:
   - **[Upload resume]**, which uses step 5
   - an unticked checkbox, **"Attach the candidate profile summary instead"**, which forces the HTML report via `renderDossierHtml`
   - a confirm before booking: "Send without a resume"

   The same check applies to the post-booking button "Send JD, CV & report" (`PipelineDrawer.jsx:4302-4376`; `sendPanelPackForBooking` at `interviewPanelPack.service.js:171-213`).
5. **Staff upload:** `POST /api/candidates/:id/resume` (pdf/doc/docx, multer single, `requireStaff`) in `backend/src/routes/candidate.routes.js` and `candidate.controller.js`.
   - It reuses the replace-URL-and-clear-flag logic from the public form (`candidate.controller.js:652-679`) and `onedrive.uploadFileToOneDriveDetailed`.
   - It sets the URL and the item id together.
6. **Repair script:** `backend/scripts/repair-excel-resume-links.mjs`.
   - Dry run by default: it lists `rpa_cv` rows whose resume is an `.xlsx`, or whose `uploadResume` flag is set while a URL exists.
   - `--apply` clears the pair and logs the old values to `rpa_processing_log`.
   - Run it on staging. Use it to trace the record HR flagged as "Abhay Ranjan". The production run is in R1.

## Tests
- **Unit:** `isRealResume` and the merge pairing.
- **Integration:** extend `src/tests/integration/panelPack.test.js` with an Excel-row candidate and a failed fetch. Today it asserts `summary.cv === 'none'` for no CV; update that.
- `cd frontend && npm run build`, plus a browser check of the warning.

## Handoff
**Status: built and tested, 10 Nov** (local stack against the staging DB, over VPN). Write-up: `docs/changelog/CHANGES-2026-11-10-U01-resume-attachment.md`.
- **Rule, `utils/resumeCheck.js`:**
  - `resumeStatus(cv)` → `'ok'|'missing'|'not_a_resume'`; `isRealResume(cv)`
  - `checkResumeBytes(buf)` → `{ok, ext, contentType}`
  - `pickResumePair(incoming, existing)` → `{cvFileUrl, cv_file_item_id, from}`
  - `withoutResumeFlag(md)`, `missingFieldCount(md)`, `resumeFileExtension(url)`
  - `fileSignature.js`: `bufferMatchesSignature(buf, ext)` and `sniffDocumentType(buf)`
- **Pack:** `buildPanelPack(id, {user, attachProfile})` returns `summary = {report, profile, jd: 'attached'|'link'|'none', cv: 'attached'|'missing'|'not_a_resume'|'failed'|'too_large', rounds}`.
  - `PACK_CV_STATUS` and `panelPackBlock.CV_NOTES` give the invite wording.
  - `collectAttachments()` also returns `resumeStatus`. The dossier ZIP now leaves out non-resumes too.
- **Preview:** `previewScheduleEmails` and `previewRescheduleEmails` return `pack: {resume: 'ok'|'missing'|'not_a_resume', jd: 'ok'|'missing', report: boolean}`. It is `null` when the round sends no invite or the pack is off.
  - Built by `panelPackPreflight(pipelineId)` from the records only. The JD part comes from `jdAttachment.getMrfJdPresence(mrfId)`.
- **API:**
  - `POST /api/candidates/:id/resume` (field `resume`)
  - `attach_profile: true` on schedule, reschedule and `send-pack`; `sendPanelPackForBooking(id, user, {attachProfile})`
  - Pipeline detail adds `resumeStatus` and sends `cvFileUrl` only when it is `ok`
- **Frontend:** new `components/pipeline/ResumeUploadButton.jsx`; `candidateService.uploadResume`; `pipelineService.sendPanelPack(id, {attachProfile})`.
- **Tests:**
  - unit: `resumeCheck` 21/21, `panelPack` 13/13, full run 1052/1052
  - `npm run build` passes
  - `integration/panelPack.test.js` 7/7 (Excel row, failed fetch, profile, preflight)
  - browser: `frontend/e2e/u01-resume-warning.spec.js` 1/1, run with `npx playwright test -c playwright.u01.config.js` and `E2E_SESSION_EMAIL`. It covers the warning, Go back, profile and upload payloads, and unticking the pack; every API write is stubbed, nothing is booked or sent.
- **Repair, staging dry run:** 70 `workbook` rows, all pointing at 2 workbooks (53 and 17 rows); no `stale_flag` or `review` rows. "Abhay Ranjan" is #257 Abhay Ranjan Singh, whose resume is `cleaned_Pmo_Associate_….xlsx`, shared with 52 others.
- **Left over:**
  - (1) `--apply` ran on staging on 10 Nov with the owner's go-ahead. It cleared 70 links; a re-run finds 0. The old values are in `rpa_processing_log` (source `U01_REPAIR_EXCEL_RESUME`), and #257 now reads `missing`. The production run is in R1.
  - (1b) The post-booking button's warning isn't in the browser run: the journey has no live booking. Its code path is shared with the Schedule window.
  - (2) The upload-job orphan re-link (`uploadJob.service.js`, matched on `cvFileUrl`) no longer fires for Excel jobs. It was ambiguous there already: one URL, many rows.
  - (3) A staff upload doesn't parse the file, so `resume_full_text` keeps the Excel row text.
