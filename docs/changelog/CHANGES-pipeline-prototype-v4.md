# CHANGES — Pipeline Tracker Prototype v4 (frontend-only)

**Date:** 2026-07-14
**Scope:** frontend only — `frontend/src/pages/PipelinePrototype.jsx` (mock-data prototype at `/pipeline-prototype`, plus its `PipelineAnalyticsPreview` export consumed by `Analytics.jsx`). No backend, schema, or route changes.

---

## Why

Live RT walkthrough feedback on the v3 prototype:

1. Shortlisting already happens in Candidate Screening — the pipeline board showing it again as a working column was redundant.
2. The Zeko rounds in the prototype used invented score fields, disconnected from the real, already-live Zeko integration in `Analytics.jsx` / `CandidateScreening.jsx` (`screeningService.assignZekoJob` / `scheduleZekoInterview` / `cancelZekoInterview`).
3. Every round that involves an external candidate action (Zeko test, Evalground test, interview) needed the same explicit three-part pattern: **send link → received from candidate? → recruiter approve/reject to next round.**
4. EvalGround only had the bulk-CSV import path; RT's confirmed decision (see [phase3-planning-state] memory) calls for **two** import mechanisms — bulk CSV and single-result via Outlook.
5. It was unclear where interviewer feedback actually gets captured.

## What changed

1. **Board structure** — removed "Shortlisted" as a `STAGES` entry/board column; the board now starts at HR Screening (Zeko). The two mock candidates that were sitting at `stage: 'shortlist'` (Rohit Kulkarni, Ananya Singh) now sit at `zeko_hr` (not yet assigned). Shortlist context (JD match %, who/when) is preserved as read-only data and now renders as a summary card at the top of the candidate drawer, above the round stepper — not as a working round anymore. `FUNNEL` (pipeline analytics preview) dropped its "Shortlisted" bar to match.

   **Decision kept both Zeko rounds separate** (HR Screening + Functional) rather than collapsing to one, even though the real backend only supports a single Zeko job/interview per candidate today — RT chose to treat two rounds as forward-looking design.

2. **Zeko rounds (HR Screening + Functional)** — rebuilt to speak the same vocabulary as the live integration:
   - Status tag: `NOT ASSIGNED` / `PENDING` / `SENT` / `COMPLETED` (same color mapping as `Analytics.jsx`'s Zeko Status column).
   - Scores: three fields matching the real ones — Zeko Interview / Coding / Communication (previously only two, mislabeled).
   - Actions: **Assign Zeko Job** (job picker modal) → **Schedule interview** (sends the invitation, matches the real "invitation email sent" success message) → **Cancel interview** (reason required, matches the real cancel flow) — same verbs as Analytics → Zeko Interview Schedule.
   - "Received from candidate?" is answered by the status itself: `SENT` = awaiting, scores present = received. The **Approve round** button is now disabled until a result is received.

3. **IQ / Tech Assessment (Evalground)** — added a **Send / Resend assessment invite** action (previously only the CSV import existed, with no visible way to send the test). The import modal now offers two modes: **Bulk CSV** (unchanged) and **Single result (via Outlook)** — a lightweight one-candidate score-entry form, per RT's confirmed two-import-mechanism decision.

4. **Interview feedback capture — answered "where exactly":** it does not happen inside the ATS admin drawer. The "scorecard" modal is relabelled **"preview of the interviewer's emailed link"** with an explicit note that the real form is a public, tokenized, no-login page — the same pattern this codebase already uses for `/mrf/:id/approve` (`MrfApprovalAction.jsx`). RT does not fill this in from the drawer; the button that opens it is now labelled "Preview interviewer's link."

5. Docs and Offer rounds were left unchanged — they already followed the send/status/decide pattern.

## Not changed

- No backend/API work. The prototype is still 100% mock state, no persistence, no real emails — per its original disclaimer.
- Reminder cadence, Hold rules, offer record-only flow, Evalground 50% pass mark, and concurrent-MRF handling are untouched (already RT-confirmed in v3).

## Verification

`npx vite build --mode production` — succeeds, no errors.
