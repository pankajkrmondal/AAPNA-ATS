# Phase 3 — Module 5: Offer Management + Closure

**Date:** 2026-07-29 · **Module:** M5

## Why

The Offer stage existed as a board column with the generic Approve/Reject/Hold
buttons and nothing else — no way to track the internal approval, when HR shared
the offer, or what the candidate said. Closure was in an odder state: the backend
(`setFinalOutcome`, the 8 final statuses, the legacy `FinalStatus` write-back) was
fully implemented and even exposed in the frontend API client, but **no UI ever
called it**, so a journey could never actually be closed from the app.

## Scope: record-only

RT confirmed (Q3, reinforced 2026-07-14) that appointment/offer letters stay
entirely outside the ATS — HR prepares and sends them from their own mailbox.
So `rpa_offers` deliberately has **no letter file and no letter URL**: it records
the approval, the share date, the proposed joining date, and the decision. This
is narrower than both prototypes, which still showed an `Offer_*.pdf` field from
an earlier scope.

## What changed

### Data model

New `backend/prisma/ddl/2026-07-29-offer-management.sql` → `rpa_offers`, one row
per journey (re-offers overwrite; RT wants no version tracking — revisions are
manual). Two partial indexes drive the sweeps.

### Backend

- `backend/src/services/offer.service.js` — `requestApproval`, `approveOffer`,
  `recordOfferShared`, `recordCandidateDecision`, `getOffer`. Every action writes
  a note to the journey's audit trail, and shared/accepted also populate the
  legacy `rpa_shortlisted_candidates.offer_sent_at` / `offer_accepted_at`
  columns for reporting continuity.
- **Soft gate (Q26), deliberately:** `recordOfferShared()` does *not* require
  approval first, so an exceptional case is never blocked — the skipped approval
  is recorded in the audit trail rather than rejected.
- `backend/src/jobs/offerSweep.js` — one daily cron (`OFFER_SWEEP_CRON`, default
  `0 7 * * *`) running two passes:
  - **approval nudge** — one email per calendar day while an offer awaits
    sign-off, guarded by `approval_nudged_at`;
  - **post-joining auto-close (Q12)** — closes a joined record
    `OFFER_AUTO_CLOSE_AFTER_DAYS` (90) days after the joining date, via the
    existing `setFinalOutcome`. A recruiter-set closure (including Joined and
    Left) always wins: the sweep only touches journeys with `final_outcome IS NULL`.
- Four routes under `/api/pipeline/:id/offer/*`; the closure route already existed.
- `getPipelineDetail` now returns the `offer` record.

### Frontend

- `PipelineDrawer.jsx` — new `OfferActions` component **replaces** the generic
  Approve/Reject/Hold bar on the Offer stage only, walking the real state
  machine: request internal approval → mark approved → record offer shared
  (captures joining date) → mark accepted/rejected.
- The Offer round's four progress segments are now driven by the offer record
  instead of showing "not available yet".
- **Closure UI, finally wired** — a modal with the 8 final statuses calling the
  long-existing `pipelineService.setFinalOutcome()`.

## Files

**New:** `backend/prisma/ddl/2026-07-29-offer-management.sql` (+ README),
`backend/src/services/offer.service.js`, `backend/src/jobs/offerSweep.js`

**Changed:** `pipeline.service.js` (returns `offer`), `pipeline.controller.js`,
`pipeline.routes.js`, `config/index.js` (offer cron + threshold),
`config/emailRecipients.js` (`offerApprovalNudge`), `server.js` (job start/stop),
`frontend/src/services/pipeline.js`, `PipelineDrawer.jsx`

## Verification

1. Apply the DDL, then `npx prisma db pull && npx prisma generate`.
2. Request approval → confirm the daily nudge fires (or invoke `runApprovalNudges()`
   directly) and does not repeat within the same day.
3. Approve → record shared with a joining date → mark accepted.
4. Close the record via the new closure modal; confirm `rpa_cv.FinalStatus` and
   `rpa_shortlisted_candidates.pipeline_status` write-backs match
   `finalStatusLabelFor()` / `shortlistStatusFor()`, and the card leaves the board.
5. Soft gate: on a fresh journey, record "offer shared" without ever requesting
   approval — it must succeed and note the skip in the audit trail.
6. Auto-close: back-date a joining date past 90 days on an accepted offer and run
   `runPostJoiningAutoClose()`; confirm it closes as `joined`, and that a journey
   already closed as `joined_and_left` is left alone.

## Still open

**Q29 (vendor notification at Offer/Documents) remains unanswered by RT.** No
offer-stage email goes to vendors in this pass — the safer default, and
consistent with how Documents behaves.
