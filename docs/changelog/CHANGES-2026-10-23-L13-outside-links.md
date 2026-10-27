# L13 · Meeting and recording links for people outside the ATS (23 Oct 2026)

**Sheet:** Phase 3 Enh - Later, row 18 ("Meetings links"). **Plan:** PLAN-Phase3-in-Phase4.md › Other bugs › L13.

## Why
"If I copy the link from ATS and share the recording of interview outside ATS via Outlook mail, will ma'am be able to access it?"

Before this change she could not. The drawer's recording "Copy link" copied an in-app address (`/pipeline?candidate=…&recording=…`) that needs an ATS sign-in. A no-login link existed only after downloading a whole dossier. Harish also asked (23 Oct) that the candidate's JD go along with anything shared.

## What changed
- **"Copy link for outside the ATS"** on every playable recording in the drawer. It appears both in the round panel and in the Schedule window's earlier-rounds list.
  - **Endpoint:** it calls the new `POST /api/pipeline/:id/recordings/:recordingId/share-link` (recruiter tier and above, pipeline module). That endpoint runs `shareLinkForRecording()` in `recordingShare.service.js`.
  - **Same rules as the dossier links, because it runs the same `mintShareLinks()`:**
    - a live link is reused, and its expiry is never extended;
    - a link lives 14 days (`DOSSIER_SHARE_LINK_DAYS`);
    - every view is logged;
    - the recruiter can revoke it under Shared recording links;
    - a recording with nothing to play is refused (409).
  - **What gets copied:** a ready-to-paste message: candidate · round (role), the link, until when it works, and the JD link when the role has one (`recordingShareMessage`, `utils/recordingShareModel.js`).
  - **Timeline:** each request is noted, as "created" or "copied again", with who did it.
- **The old button** is now "Copy ATS link". Its toast still says the recipient must sign in.
- **"Copy join details"** on the Teams meeting card. One paste carries: candidate · round (role), when, the Teams join link, the meeting ID and passcode, and the JD link. A Teams join link needs no ATS sign-in.
- **Still to come:** the JD file itself goes on the panel invite for every round. That is part of L14, which owns the invite's attachments.

## Checked on staging
- `rpa_recording_share_link` exists on staging.
- `MS_RECORDING_ARCHIVE_ENABLED=true`, so a link keeps working after Teams drops the original recording (about 60 days).
- Staging has no interview recordings yet (0 rows), so the integration test uses a fixture recording. No Graph call is needed to mint a link.

## Tests
- **Unit** (`src/tests/unit/recordingShare.test.js`, 3 new tests for the message): names and role, the JD line only when there is a JD, plain text with one fact per line.
- **Integration** (`src/tests/integration/recordingShareLink.test.js`, 4/4 on staging):
  - the first request mints a link; the second returns the same link with the same expiry and one row;
  - the message carries the round, the role and the JD;
  - a timeline note per request;
  - another journey's recording gets 404, and an unplayable one gets 409 with no link created.
- Full unit run: 958/958. The frontend builds.
- **Browser check still to do:** open the copied link in a private window.

## Files
- `backend/src/services/recordingShare.service.js`
- `backend/src/utils/recordingShareModel.js`
- `backend/src/controllers/pipeline.controller.js`
- `backend/src/routes/pipeline.routes.js`
- `frontend/src/services/pipeline.js`
- `frontend/src/components/pipeline/PipelineDrawer.jsx`
- `backend/src/tests/unit/recordingShare.test.js`
- `backend/src/tests/integration/recordingShareLink.test.js` (new)
