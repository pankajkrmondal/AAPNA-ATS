# Phase 3 — Module 6: Placement Vendor Completion & Hardening

**Date:** 2026-08-12 · **Module:** M6 · **Scope:** Category A (Placement) only

## Why

M6 was written up as an audit pass. The
[coverage audit](../phase3/PHASE3-COVERAGE-AUDIT.md) excluded it ("RT is picking
that up separately") and the
[module status report](../phase3/PHASE3-MODULE-STATUS.md) marked it *Excluded*,
so it was the one module never checked against the code. The nine tracker rows
in [03-DEVELOPMENT-PLAN.md](../phase3/03-DEVELOPMENT-PLAN.md) §M6 read as
verification tasks, on the assumption that M1–M5 had already built the vendor
behaviour.

They had not. **The vendor dual-notification had never fired once** — not in
production, not in staging, not in a test. Everything else here follows from
finding that.

## The headline defect

`vendorCcFor()` in `pipeline.service.js` returned a vendor only when
`pipeline.source === 'vendor'`. Nothing in the codebase ever wrote that value:
the sole caller of `createPipelineJourney` is `screening.service.js`'s
`shortlistCandidates`, which passes `source: 'screening_shortlist'`. The dev
plan's line item — "`vendor.controller.js` upload path — pipeline row with
`source='vendor'`" — was never built.

Three things were dead as a result:

- no vendor ever received a stage email, at any stage, ever;
- the `vendorPerformance` table in `getPipelineAnalytics` was permanently empty,
  because it filters on the same `source === 'vendor'`;
- the drawer's "Vendor — email" tag and its cc promise never rendered.

The Q5 dual-send has been in the plan since M1 and was reported as "built in".
It was wired end to end except for the one write that would have switched it on.

## Decisions taken

| Question | Decision |
|---|---|
| What triggers a vendor notification | The candidate's **active 90-day lock**, read once at journey creation and snapshotted onto the journey |
| Which stages the vendor hears about | All of them, **plus a content-free line at Offer**; Documents stay silent — **this answers Q29** |
| How the vendor copy is delivered | A **separate status-only email**, never a cc on the candidate's own mail |
| C2C (Category B) | Out of scope — stays in [`c2c_vendor_plan.md`](../reference/c2c_vendor_plan.md) |

The snapshot-at-creation rule is what makes the lock usable as a trigger. Read
once, at the moment a candidate enters a journey, it gives both halves of the
behaviour: a lapsed attribution from years ago never pulls a vendor onto a
keyword-search shortlist (the leak RT reported on 2026-07-22), and a lock
expiring mid-journey does not cut a vendor off from a journey they started.

## What changed

### The vendor is now a separate send, not a cc

New `backend/src/services/vendorNotification.service.js`. It has **no subject or
body parameter** — every word a vendor receives is generated from a template
plus a fixed status vocabulary, driven by an `eventType` enum the caller passes.

That is the substantive change, not a refactor. The old design cc'd the vendor on
the candidate's own email, so a vendor would have read the entire body, including
whatever a recruiter typed into the outcome modal or the ad-hoc email box
(`POST /api/pipeline/:id/email`, free text, cc'd unconditionally with no stage
awareness). "Status-only, no figures" was a comment above a `cc:` line. It is now
a property of the code: there is no parameter through which candidate copy could
reach a vendor, so the guarantee does not depend on anyone remembering it.

`sendStageOutcomeEmail` and `sendAdHocCandidateEmail` lost their `vendorEmail`
parameter and their `cc` entirely.

### Per-stage disclosure (Q5 / Q29)

`VENDOR_STAGE_POLICY`, exported so it is testable directly:

| Stage | Policy | Why |
|---|---|---|
| `documents` | **never** | The whole stage is the candidate's personal paperwork |
| `offer` | **bare** | The vendor learns an offer happened, never what was in it |
| everything else | standard | The ordinary status line |

A stage an admin adds through the config screen discloses normally — silence
would be the surprising default for an ordinary interview round, and anything
genuinely sensitive has to be added to the map deliberately.

### Dual-send coverage across M2–M5

| Module | Before | Now |
|---|---|---|
| M1 stage outcomes | cc, dead | separate vendor send |
| M1 closure | cc, dead | separate vendor send, independent of `SILENT_FINAL_OUTCOMES` |
| M1 ad-hoc email | **cc'd free text** | generated status line only |
| M2 Evalground invite | cc, dead | separate vendor send |
| M3 scheduled / rescheduled / cancelled | **no vendor path at all** | separate vendor send |
| M4 documents | silent | silent — unchanged, now with a test asserting it |
| M5 offer shared / decision | nothing | bare milestone line |

Closure is deliberately independent of `SILENT_FINAL_OUTCOMES`. That set exists
because there is nothing to tell a candidate who backed out that they don't
already know — but their vendor was never in that conversation, and "did this
placement land?" is the one question they are actually tracking.

### Isolation hardening

`pipeline.routes.js`, `screening.routes.js` and `hrUpload.routes.js` were guarded
by `checkModuleAccess()` alone — no role floor. A module toggle answers "was this
switched on for this user?", not "should this role ever have it". One mis-clicked
checkbox on a vendor account in the Admin Portal exposed the entire pipeline
board: every candidate, every MRF, plus the outcome/closure/offer/document write
endpoints. `MainLayout`'s `VENDOR_ALLOWED_PATHS` confines vendors in the browser;
it does not bind a token. Same shape as the CSV-export hole closed in `b671236`.

New `requireStaff` middleware, applied to all three routers. Rank-based
(`ROLE_RANK >= recruiter`) rather than a hardcoded list, so a future
low-privilege role is denied by default instead of needing to be remembered.

`enforceVendorScope` moved to `utils/vendorScope.js` — pure, no database — and
`vendor.controller.js`'s `getVendorCandidates` now uses it instead of its own
hand-rolled copy of the same rule. Two implementations of "which vendor may this
caller see" is precisely how the list and the export drifted apart last time.

### The 90-day lock, which did not actually lock anything

Two defects found beyond the tracker rows:

**The merge path never enforced ownership.** `VENDOR_PROCESS.md` §8 has described
first-vendor ownership since June. `mergeDuplicates` copied `VendorEmail`,
`vendorName` and `lockForNinetyDays` through the generic `prefer()` field loop
like any other column, so an incoming vendor overwrote the existing one whenever
they supplied a value — and the post-merge block then stamped a fresh 90-day
window on top. A second vendor re-submitting a candidate and getting the
duplicate merged took the placement outright, inside the window meant to prevent
exactly that. The documented rule is now implemented.

**Closure and the lock never interacted.** Someone we actually hired is not a
lead any more, but their lock kept ticking down as if they were; once it lapsed,
a second vendor could claim a placement they had no part in. `setFinalOutcome`
now freezes the lock on `JOINED` (sentinel `9999-12-31`, no DDL needed — every
existing reader treats it as "still active" without knowing the concept exists).
Only on `JOINED`: every other closure means the seat is open and the candidate
genuinely is back in the market.

### Cooling-off

The 6-month re-application gate lived only in `createPipelineJourney`, so it
fired at shortlisting — after a recruiter had already read the CV and made the
call. Nothing warned them when the duplicate landed. Vendor uploads now carry a
`rpa_upload_jobs.advisory` note surfaced on the upload dashboard.

**Advisory, not a block.** A vendor re-submitting someone rejected in March is
not doing anything wrong and usually has no way to know. The resume is still
queued for review; the recruiter just gets the fact up front rather than a 409 at
the end.

The two windows — 90-day search exclusion, 6-month re-application gate — are
documented in `utils/rejectionCooldown.js` rather than reconciled. They answer
different questions: the shorter one stops accidental rediscovery, the longer one
stops deliberate re-entry. A candidate at month 4 is findable by name but cannot
be put back into the pipeline, which is intended.

### Vendor Dashboard: real stages

Every number came from `rpa_cv.FinalStatus` through a client-side keyword matcher
(`classifyStatus`), which reads a string the stage engine writes back rather than
the engine itself. It lagged, and could not tell "no journey yet" from "journey
with no outcome recorded".

The dashboard now reads `rpa_candidate_pipeline` directly — a Stage column on
Recent Submissions and a current-stage breakdown. `classifyStatus` stays as the
documented fallback for rows the stage engine never saw. That population never
reaches zero (anyone uploaded pre-M1, anyone never shortlisted), so the fallback
is permanent, not transitional, and rows using it say **Not in pipeline** rather
than borrowing a stage they don't have.

### Whole-DB skill search + stage history

The search half of doc 02 §1.1's non-negotiable requirement was already true:
both tabs query all of `rpa_cv`, uncapped, no MRF tagging needed. The history
half was not — results carried only the legacy `rpa_shortlisted_candidates`
stamps, which say a decision happened but not at which round.

So a recruiter searching "Java" saw that someone had been rejected, with no way
to distinguish a resume-screening reject from a candidate who reached the CEO
round — the difference that decides whether to approach them again. Results now
carry `pipelineHistory`: every journey (concurrent MRFs included) with its
current stage and last five events, shown as chips on the result card.

### Admin exposure

- **Stage → email template mapping** — the table existed and the dispatcher read
  it, but no screen ever wrote to it; staging held **zero** mapping rows. New
  *Outcome Emails* tab. The grid is built from the stage list, not the mapping
  table, so unmapped pairs are visible — they are the interesting case.
- **Email flow keys** — `email_recipients.<flowKey>.to/.cc` was editable only
  through a SQL client. New *Email Routing* tab plus admin-gated
  `GET`/`POST /api/settings/flow-keys`, reloading the in-memory map so changes
  apply without a restart. The screen reports `dynamic` and `redirectExempt` so
  an empty `to` and a staging send to a real inbox both read as intentional.
- `POST /api/email/templates` and the stages/outcomes/reasons CRUD screen already
  landed after the 2026-07-31 audit was written; that audit is now corrected.

## Database

`backend/prisma/ddl/2026-08-12-vendor-status-templates.sql` — idempotent,
additive. No new tables: `rpa_candidate_pipeline.source` / `.vendor_email` and
`rpa_cv.lockForNinetyDays` all already existed.

1. Extends the `rpa_email_templates.category` CHECK for `vendor_status`
   (**required before seeding**).
2. `rpa_upload_jobs.advisory TEXT` — recruiter-facing context on a row that did
   *not* fail. Kept separate from `error_message` so a healthy duplicate does not
   render as a failure everywhere the dashboards colour by it.
3. Two indexes: `rpa_cv (VendorEmail, lockForNinetyDays)` and
   `rpa_candidate_pipeline (cv_id, modified_at DESC)`.
4. Seeds the `vendorStatus` flow-key rows.

Then `npx prisma db pull && npx prisma generate`, then
`npm run seed:templates:<env>` for the two new vendor templates.

## Tests

`vendorNotification.test.js` (22) and `vendorIsolation.test.js` (15), joining the
existing suites — **160 passing, 0 failing**.

Covered: the lock window including its inclusive final day; malformed locks
failing closed; the frozen lock; `activeVendorFor` requiring both attribution and
a live lock; the `source`-vs-column gate; the disclosure matrix pinned as a
literal so widening it fails the build; `requireStaff` across every role; the
route files carrying the floor (and `vendor.routes.js` deliberately not);
`enforceVendorScope` refusing to be widened; and `documentCollection.service.js`
containing no vendor reference at all.

Two of these caught real defects while being written: `isVendorLockActive`
accepted `"2026-13-45"` — shape-valid, impossible, and lexicographically above
every real date, so it read as a lock that never expires — and the M4 silence
check confirmed that service is genuinely clean rather than clean by comment.

## Still open

- **RT decision:** the five closure email templates that exist but deliberately
  never send (`PHASE3-MODULE-STATUS.md` §3 #5) — untouched by M6.
- **Not built:** the MS Access interim export, listed under §M6 in the dev plan
  but not among the nine tracker rows for this pass.
- **Not run:** the staging end-to-end pass. Everything above is unit-tested and
  builds clean; the eight-step walkthrough in the plan has not been executed
  against a live server.
