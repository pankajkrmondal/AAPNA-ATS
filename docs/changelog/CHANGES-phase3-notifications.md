# Phase 3 — Notification Centre

**Date:** 2026-07-31 · **Module:** M1 (bell notifications), built out beyond the original scope

## Why

Bell notifications were the one M1 deliverable with nothing built. The plan named
`pipeline:outcome` and `pipeline:awaiting_feedback`; neither was ever emitted, so the bell
only ever showed duplicate-resume reviews and the two assessment events.

Worse, it was **in-memory only**: notifications lived in one browser tab's React state.
They vanished on refresh, and a recruiter who was logged out when an event fired never saw
it at all. The Phase 3 plan deferred a persistent centre ("minimal bell in Module 1"); it
is built now instead, because a notification that disappears is not a work queue.

## What changed

### `rpa_notifications` — the inbox

New table (`backend/prisma/ddl/2026-07-31-notifications.sql`), **one row per recipient per
event** — fan-out on write rather than one event row plus a read-state join table. The
recruitment team is a handful of people, so duplicating a short text row keeps every read a
plain `WHERE user_id = $1` and marking one read a single `UPDATE`.

Carries `type`, `title`, `description`, a nullable `pipeline_id`, a precomputed `link_path`
for click-through, free-form `meta`, and `read_at` (a timestamp, not a boolean, so "when
did they see it" stays answerable). `type` is free text with no CHECK — a new event is a
code change, never a migration.

### `notification.service.js` — write and read

`notify()` resolves recipients, writes a row each, then pushes `notification:new` to those
connected. **The row is the source of truth; the socket is only a nudge** — a missed push
costs nothing because the row is already saved.

**`notify()` never throws.** Every call site hangs off a business action that has already
committed — an outcome recorded, a document verified, an offer accepted. Failing to tell
someone must never fail the thing itself, so failures are logged and swallowed, the same
contract as the existing `emitToRole` try/catch in `assessmentImport.service.js`.

Recipients come from the roles `uploadJob.service.js` already used for review alerts —
`recruiter`, `hr`, `admin`, `superadmin` — filtered to active + approved users.
**Vendors never receive a notification**, matching the rule that keeps them off document
and offer emails (Q5). Company-scoped users see only their own company's events;
superadmins (no company) see all. Where an actor is known they are excluded from their own
notification — nobody needs telling about their own click.

### The event catalogue

Fourteen event types, each fired where work lands back on a human:

| Type | Fires from |
|---|---|
| `pipeline.outcome` | `setStageOutcome()` — **the original M1 deliverable** |
| `pipeline.closure` | `setFinalOutcome()` |
| `interview.awaiting_feedback` | `dispatchScorecards()` — **the other M1 deliverable** |
| `interview.feedback_received` | `submitScorecardByToken()` — **closes the "HR notify" half of the consolidated-feedback task** |
| `interview.no_show` | `markInterviewOccurrence()` |
| `interview.confirm_needed` | `jobs/interviewOccurrence.js` nudge branch |
| `document.uploaded` | `uploadDocument()` — a candidate acted on a public link with nobody watching |
| `document.all_verified` | `verifyDocument()`, when the last item clears |
| `offer.approval_requested` | `requestApproval()` |
| `offer.decision` | `recordCandidateDecision()` |
| `mrf.closed` | `closeMrfIfFilled()` |
| `assessment.import_done` · `assessment.deadline_expired` · `review.new` | existing call sites, migrated onto the centre |

### Existing socket events are untouched

`review:new`, `upload:job`, `assessment:*` and `mrf:closed` all still emit exactly as
before — `HRUpload.jsx`, `VendorPortal.jsx` and `useScreeningData.js` rely on them to
refresh their own views. This work is purely additive; only the bell changed where it
reads from.

### Frontend

- **`NotificationBell.jsx`** rewritten: React Query fetches list + unread count from the
  API, the socket listener becomes `notification:new` and simply invalidates the query,
  and mark-read/mark-all-read persist through the API instead of mutating local state.
  Timestamps render as relative ages ("12m ago"). Popover and badge markup unchanged.
- **Click-through:** clicking a notification marks it read and navigates to its
  `link_path`.
- **`Pipeline.jsx`** accepts `?candidate=<pipelineId>` via `useSearchParams` (the pattern
  already used by `MissingJdUpload.jsx` and `MrfSubmit.jsx`) and opens that candidate's
  drawer directly; closing the drawer clears the param so a refresh doesn't reopen it.

## Files

**New:** `backend/prisma/ddl/2026-07-31-notifications.sql` (+ `.README.md`),
`backend/src/services/notification.service.js`,
`backend/src/controllers/notification.controller.js`,
`backend/src/routes/notification.routes.js`,
`frontend/src/services/notificationService.js`

**Changed:** `backend/src/routes/index.js` (replaced the `/notifications` placeholder),
`pipeline.service.js`, `interviewScorecard.service.js`, `interviewSchedule.service.js`,
`documentCollection.service.js`, `offer.service.js`, `mrfClosure.service.js`,
`uploadJob.service.js`, `assessmentImport.service.js`, `jobs/interviewOccurrence.js`,
`jobs/assessmentDeadlineChecker.js`,
`frontend/src/components/common/NotificationBell.jsx`, `frontend/src/pages/Pipeline.jsx`

## Verified

- DDL applied; table + both indexes present; `prisma db pull` + `generate` run and
  `rpa_notifications` confirmed in the client.
- `notify()` fanned out to **4 eligible staff** (2 admins, 2 recruiters) and **0 of the 2
  vendor users** — the vendor-exclusion rule holds.
- `notify()` with a malformed call returns `{created: 0}` rather than throwing.
- Over HTTP with a real session: `GET /notifications` 200 (items + unread),
  `GET /unread-count` 200, `POST /:id/read` 200 (unread drops to 0), `POST /read-all` 200,
  and **401 without a token**.
- Frontend builds clean.

## Still open

The three notification-adjacent gaps from the coverage audit are unchanged by this work:
the **consolidated feedback text block** is still not generated (only the HR-notify half is
now done), and **closure emails still do not send** — the eight closure outcomes have no
template and `rpa_stage_email_templates` holds 0 rows. Seeding those needs
`POST /api/email/templates`, which does not exist yet.
