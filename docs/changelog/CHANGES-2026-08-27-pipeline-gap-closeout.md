# Candidate Pipeline — gap closeout: rejected filter, real conversations, my candidates

**Date:** 2026-08-27 · **Modules:** M1 (stage engine), M6 (board/filters)

**Source:** [HR-CANDIDATE-PIPELINE-FAQ-AND-GAP-PLAN-2026-08-26.md](../../HR-CANDIDATE-PIPELINE-FAQ-AND-GAP-PLAN-2026-08-26.md)
(external, HR-facing doc), gaps **G2** (remainder), **G4**, **G6**.

## ⚠️ A premise in the source doc was stale before this work started

The gap doc, dated 2026-08-26, lists **G1** (pause a requisition), **G3** (reopen a journey), and
the core of **G2** (closure reachable from every stage) as unbuilt. They were not — same-day work
recorded in [CHANGES-2026-08-26-candidate-closure-graceful-exit.md](./CHANGES-2026-08-26-candidate-closure-graceful-exit.md)
and [CHANGES-2026-08-26-closure-followon-mrf-lifecycle.md](./CHANGES-2026-08-26-closure-followon-mrf-lifecycle.md)
shipped and verified on staging the same day, in a session the gap doc's author never saw. This was
verified against the live code (routes, service functions, DDL, UI) before starting, not assumed
from either document. Only the genuinely open remainder — **G2**'s filter/checkbox, **G4**, **G6**
— is in this change set. **G5** (click reduction) is logged for a future session.

## Why

Recruitment Team FAQ answers exposed three real gaps once the stale ones above were ruled out:
rejected candidates had no board filter and no one-step reject-and-close; the pipeline drawer's
"emails" list was entirely synthetic (built from pipeline events) and never showed what a
candidate actually wrote back, unlike Candidate Screening's existing Outlook thread view; and there
was no way to answer "what's on my plate?" on a board every recruiter sees identically.

## What changed — G2 remainder

- **`backend/src/services/pipeline.service.js`** — `listPipeline` gained a `rejectedOnly` filter
  (`current_stage_status = 'rejected'`, mutually exclusive with `onHoldOnly` on the same column) and
  a `closedCount` in its response — the count of closed journeys matching the current source/MRF
  filters, so "Show closed" can say how much history it's hiding.
- **`backend/src/controllers/pipeline.controller.js`** — `rejected_only` query param wired through.
- **`frontend/src/pages/Pipeline.jsx`** — a "Rejected only" checkbox (unchecks "On Hold only" and
  vice versa), and "Show closed" now reads "Show closed (N)".
- **`frontend/src/components/pipeline/PipelineDrawer.jsx`** — the outcome modal gained a **"Close
  this candidate's record as Rejected"** checkbox, shown only for a Reject outcome. Defaults **on**
  for a normal interview round, **off** for the Zeko screening rounds (a re-decision is more common
  there). On submit: `setStageOutcome` first, then — only if checked — `setFinalOutcome` with
  `closure_rejected`, as **two sequential calls**, not one combined transaction (`setFinalOutcome`
  runs its own MRF-reopen/notification path that a shared transaction would risk leaving partial).
  A failure on the second call surfaces its own error rather than silently swallowing it; the
  standalone "Close this candidate's record" button (built 2026-08-26) still exists for every other
  case.

## What changed — G4 (real Outlook conversations in the pipeline drawer)

The data already existed in `rpa_email_messages`; this is a second entry point onto the existing
`screeningService.getOutlookConversations()`, not a forked query.

- **`backend/src/services/screening.service.js`** — `getOutlookConversations(email)` now accepts a
  string **or an array** of addresses, matched with `emailMatchesSql()` instead of a plain
  `LOWER(...) = LOWER($1)` equality — the stored `candidate_email` column can itself already hold
  more than one address, same as `rpa_cv."EmailID"` (see `emailMatch.js`), so a bare equality test
  could always have missed a candidate with two addresses on file. Switched from
  `$queryRawUnsafe` to a tagged `$queryRaw` template to compose the predicate safely. Fully
  backward-compatible: the existing Candidate Screening call site still passes one string.
- **`backend/src/controllers/pipeline.controller.js`** — new `getPipelineConversations`: resolves
  the journey's known addresses (`candidate_email` + `candidate_email_all`, both split via
  `emailCandidates()`) and calls the shared function with all of them. Imports `screeningService`
  directly rather than routing it through `pipeline.service.js`, to avoid a service-to-service
  import cycle (`screening.service.js` already imports `createPipelineJourney` from
  `pipeline.service.js`).
- **`backend/src/routes/pipeline.routes.js`** — `GET /api/pipeline/:id/conversations`. No
  route-ordering hazard: unlike the bare `/analytics`/`/export` paths, this is nested under `/:id/`
  and can't be captured by the plain `/:id` route regardless of registration order.
- **`frontend/src/components/pipeline/PipelineDrawer.jsx`** — a collapsed-by-default "Conversation
  with candidate" panel beside the existing (unchanged) "Emails in this round" log. Labelled
  distinctly on purpose: the existing log answers "did the system send it, did it deliver?" from
  pipeline events; this one answers "what did the candidate actually say?" from the real thread. A
  message count and an "Awaiting reply" tag (shown when the latest message is inbound) sit on the
  collapse header so a recruiter doesn't have to open it to know there's something to read.
  Bodies render as **plain text**, not sanitised HTML — `body_html` is third-party content from an
  external mailbox, and stripping it to text sidesteps HTML/script injection entirely rather than
  maintaining a sanitiser. Reply is wired to the **existing** `POST /api/screening/outlook/reply`
  (`screeningService.replyToOutlookConversation`), which had a frontend wrapper but was not called
  from anywhere in the app before this — no second reply implementation was added.
- **`frontend/src/utils/emailText.js`** (new) — `cleanMsgBody()`, extracted from
  `CandidateScreening.jsx` (which is now unchanged in behaviour, just imports it) so both
  conversation surfaces share one HTML-to-text implementation instead of two.

## What changed — G6 ("my candidates" filter)

**Data-quality check done before writing any code** (per the plan): queried staging directly.
`rpa_shortlisted_candidates.shortlisted_by` is populated on all 102 rows, but only 37 (36%) match a
*current* `rpa_users.username` exactly — the rest are stale/test values (`phase3-testpass`,
`harish.mopuri130`, a bare `recruiter`) that predate today's user list. That's old seed/test data,
not an ongoing data-integrity problem, so this ships as a **plain string filter against the
caller's own username** — no new column, no backfill, no DDL. Rows with a stale owner value simply
never match anyone's "my candidates" view, which is the correct behaviour for orphaned test data.

- **`backend/src/services/pipeline.service.js`** — `listPipeline` gained an `ownedByUsername`
  filter (`rpa_shortlisted_candidates: { shortlisted_by: ... }`) and every card now carries `owner`.
- **`backend/src/controllers/pipeline.controller.js`** — `owned_by=me` is resolved **server-side**
  to `req.user.username`; a client-supplied identity is never trusted for this filter.
- **`backend/src/exports/pipeline.export.js`** — `buildPipelineWhere`/`parseFilters` gained the same
  `rejectedOnly`/`ownedByUsername` filters as the board (so the CSV never contains rows the board
  filtered away), plus a new **Shortlisted By** column.
- **`frontend/src/pages/Pipeline.jsx`** — a "My candidates" toggle in the filter bar, and the
  owner's name appended to the card's secondary line (`position · source · owner`).

## Tests

- Backend: `node --check` clean on every modified file. Targeted unit runs (never the recursive
  `test:unit` glob): `emailMatchSql.test.js` (63 pass — covers the array-input path
  `getOutlookConversations` now relies on), `shortlistStatus.test.js`, `mrfClosure.test.js`,
  `pipelineAnalytics.test.js`, `csvExport.test.js`, `analyticsParams.test.js` — all green, no
  regressions from the filter/export changes.
- Frontend: `npx vite build` clean after each of the three items.
- Not yet done: a manual click-through of the Conversations tab against a real candidate thread,
  and of the reject-and-close checkbox's two-call sequence under a genuine 409 race. Flagged below.

## Files

**Backend:** `services/pipeline.service.js`, `controllers/pipeline.controller.js`,
`routes/pipeline.routes.js`, `services/screening.service.js`, `exports/pipeline.export.js`

**Frontend:** `pages/Pipeline.jsx`, `components/pipeline/PipelineDrawer.jsx`, `services/pipeline.js`,
`pages/CandidateScreening.jsx`, `utils/emailText.js` (new)

**No schema change.**

## Still open

- **G5** (click reduction — collapsed email preview, inline card actions, bulk actions) — logged,
  not started this session. Bulk-approve scope still needs a Recruitment Team answer before its
  Phase 3.
- Manual click-through of the new Conversations tab and the reject-and-close path against a real
  staging candidate has not been done yet — the changes above are verified by unit tests and a
  clean build only.
- `getOutlookConversations`'s multi-address support is exercised by `emailMatchesSql`'s own unit
  tests, but no integration test yet calls the new `/pipeline/:id/conversations` route end to end.
