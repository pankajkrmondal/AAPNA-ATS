# U02 · The JD goes with every email that moves a candidate forward
**Release 1 · High · 12 h · Depends on: U01 (read its Handoff, because both change `buildPanelPack`)**

**Goal**
- **Today:** the JD is attached only to keyword-tab shortlist emails and panel invites.
- **Change:** the JD goes with every email that moves a candidate forward:
  - JD-tab and keyword-tab shortlists
  - Search "Add to JD"
  - Zeko HR / Functional
  - Evalground
  - Tech 1/2/3, HR and CEO
  - every other round **except** documents and offer
- **Done when:** each of those emails carries the JD as a file, or as a link when the file is too large.

## Current state (verified)
**The helper.** `getMrfJdAttachment(mrfId)` (`backend/src/services/jdAttachment.service.js:83-132`) returns `{attachment, link, reason}` and never throws.
- The cache is 10 minutes.
- The cap is `JD_ATTACH_MAX_BYTES` = 3 MB **raw** (`:26`).
- The link fallback is `jdLinkHtml` plus `appendToBody` (`backend/src/utils/candidateEmailBlocks.js:40-69`).

**Graph.** `buildGraphAttachments` / `sendGraphEmail` (`backend/src/services/emailNotification.service.js:27-36, 72, 147`) send attachments inline as base64. Base64 adds about 33%, so a 3 MB file is about 4 MB, which is at Graph's inline limit.

| Path | JD today | Where |
|---|---|---|
| Keyword shortlist | yes | `screening.service.js:1892-1896` (gate `isKeywordShortlist`), sent in `sendShortlistEmail` `:2179-2301` |
| JD-tab shortlist | no | the same gate; frontend `DecisionEmailModal.jsx:115` `showJd = activeTab === 'keyword'` |
| Search "Add to JD" (`source:'search_candidate'`) | no | `frontend/src/pages/Candidates.jsx:461-474` → the same `shortlistCandidates` (`screening.controller.js:181-198`) |
| Zeko HR / Functional | no | `screening.service.js:2949-2987`, `sendGraphEmail` at `:2975-2983` |
| Evalground | no | `assessmentInvite.service.js:72-89` → `sendAdHocCandidateEmail` (`stageNotification.service.js:319-373`) |
| Tech/HR/CEO candidate invite | no | `interviewSchedule.service.js:1076-1089`; reschedule `:1580` |
| "Approved" outcome email | no | `pipeline.service.js:1499-1513` → `sendStageOutcomeEmail` (`stageNotification.service.js:191-298`) |
| Change JD / Move JD | yes | `changeJd.service.js:205-215`, `journeyMove.service.js:254-264` |
| Panel pack (to interviewers) | yes | `interviewPanelPack.service.js:92-101` |

## Changes
1. **In `jdAttachment.service.js`:**
   - `jdForCandidateEmail(mrfId)` returns `{ attachments: [], appendLink(html), status: 'attached'|'link'|'none' }`.
   - `shouldAttachJd(stageKey)` is false for `documents`, `offer` and closures.
   - Size is measured on the **base64** length (`ceil(n/3)*4`), with a 3.5 MB total per email. Apply the same measure in `buildPanelPack`'s `fits()`.
2. **Shortlist:**
   - Drop the keyword-only gate on the JD. The About AAPNA block stays keyword-only.
   - `DecisionEmailModal.jsx:115` shows the "JD attached" line on every tab.
   - The Search "Add to JD" dialog shows the same line. It uses `GET /screening/roles/:id/jd`, as in `DecisionEmailModal.jsx:152-158`.
3. **Zeko invite:** pass `attachments`, or append the link, in the `sendGraphEmail` call.
4. **Evalground:**
   - Add an optional `attachments` parameter to `sendAdHocCandidateEmail`.
   - `assessmentInvite.service.js` passes the JD.
   - `frontend/src/components/pipeline/AssessmentInviteModal.jsx` gets a note: "The JD is attached."
5. **Round invites:** the candidate email in schedule and reschedule attaches the JD when `shouldAttachJd(stageKey)`. The Schedule window shows the JD status from U01's `pack.jd`.
6. **"Approved" outcome email:** attach when `shouldAttachJd(nextStageKey)`.
7. **Logging:** record the attachment in `attachments_json` / `rpa_email_log`, where the path already logs (see `screening.service.js:2258-2259`).

**Out of scope:** editing an MRF's JD from the MRF pages (next phase).

## Tests
- **Unit:** `shouldAttachJd` and the base64 size limit.
- **Integration (staging, own address only):** one send per path. Check that the Graph message has the attachment, or the link when the file is over the limit.
- `cd frontend && npm run build`
- Check rendering in Outlook desktop and OWA.

## Handoff
**Status: built and tested, 10 Nov** (local backend against the staging DB). Write-up: `docs/changelog/CHANGES-2026-11-10-U02-jd-every-email.md`.
- **Helpers, `jdAttachment.service.js`:**
  - `shouldAttachJd(stageKey)` is false for `documents`, `offer`, any `FINAL_OUTCOMES` value and an empty key.
  - `jdForCandidateEmail(mrfId, {otherBase64})` → `{attachments, linkHtml, appendLink(html), status: 'attached'|'link'|'none', logEntries, jd}`. Its pure half is `jdEmailParts(jd, {otherBase64})`; the empty value is `NO_JD_FOR_EMAIL`.
  - `base64Size(n)`, `fitsEmailAttachments(total)`, `EMAIL_ATTACH_MAX_BASE64` (3.5 MB). `JD_ATTACH_MAX_BYTES` is now derived from it (about 2.6 MB raw).
- **For U03, base64 `fits()`:** `buildPanelPack` now counts base64 length against `EMAIL_ATTACH_MAX_BASE64`. Its `summary` shape is unchanged.
- **Send paths:**
  - `sendStageOutcomeEmail` and `sendAdHocCandidateEmail` take optional `attachments` and `attachmentsLog`.
  - `sendStageOutcomeEmail` also takes `extraHtml`, which is appended before branding.
  - `attachmentColumns()` fills `has_attachments` / `attachments_json`.
  - The shortlist gate is gone. `sendShortlistEmail` is unchanged, so Change JD and Move JD are untouched.
- **Tests:**
  - unit: `jdEveryEmail` 13/13, `panelPack` 13/13; all unit suites 1065/1065 (`node --test "src/tests/unit/**/*.test.js" "src/tests/*.test.js"`). `npm run test:unit` used to hang because its glob also ran the staging integration suites. It now covers only those unit paths (16 s), and the conventions say so.
  - integration: `integration/jdEveryEmail.test.js` 8/8, `panelPack` 7/7
  - `npm run build` passes
- **Left over:**
  - (1) Outlook desktop / OWA rendering wasn't checked. The integration run intercepts Graph, so nothing reached an inbox. Do one real send to our own address on staging during R1 UAT.
  - (2) No browser run. The UI changes are three text lines; the build passes.
  - (3) Approving onto Documents or Offer (no JD) is covered by unit tests only.
  - (4) Getting the JD's status in the Evalground window from `mrf.jd_document_link || jd_attachment` avoids `GET /screening/roles/:id/jd`, which needs `candidate_screening` access.
