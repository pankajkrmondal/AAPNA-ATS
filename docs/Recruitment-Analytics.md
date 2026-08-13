# Recruitment Analytics

**Date:** 2026-08-11 · **Scope:** the `/analytics` page — Role Summary, Pipeline Insights, Recruiter Insights, Email Delivery
**Related:** [Phase 3 module status](phase3/PHASE3-MODULE-STATUS.md) · [Code review](phase3/PHASE3-CODE-REVIEW-2026-08-06.md) · [Coverage audit](phase3/PHASE3-COVERAGE-AUDIT.md)

> **Status: implemented 2026-08-11.** Defects 2.1–2.5 are fixed; 111 unit tests
> pass (13 new in `backend/src/tests/pipelineAnalytics.test.js`). Two things
> turned out differently from the plan below — both recorded in §6:
> the vendor rate was **dropped, not rebuilt** (the staging data check failed),
> and a fourth event type (`skip`) had to be handled. §2.6 (Role Summary double
> aggregation) is the one item deliberately left open.

---

## Context

This document answers three questions about the Recruitment Analytics module: what is
done, what is pending, and for each number on screen — what it should show and where
it is fetched from.

The short answer: the module is **substantially real, not a mockup**. All four tabs are
wired to live endpoints and every Export button downloads a genuine server-built CSV.
But six numbers are wrong or fake, and the two most misleading ones are wrong
*silently* — they look like valid answers:

- **"Awaiting feedback" is a hardcoded `0`.** Its code comment says Module 3 isn't
  built. M3a *is* built and tested, and the data has been sitting in the database
  since. The tile has been reporting zero over real outstanding scorecards.
- **Vendor "Shortlist rate" is mathematically always 100%** for every vendor. A
  leaderboard where everyone scores 100% ranks nothing.
- **Time-to-hire and "days stuck" are corrupted by `note` events** that M3/M4/M5 write
  liberally. A scorecard email sent today resets a 40-day-stalled candidate's clock to
  0 — the alerting surface goes blind exactly when a journey is most stalled.

Agreed scope: **fix all defects, correctness first**, accepting that some published
numbers move and two CSVs get renamed headers. A release note ships with it (§5).

---

## 1. What is done

| Surface | Data source | Status |
|---|---|---|
| **KPI strip** (Shortlisted / Rejected / On Hold / Total / Zeko Sent / Zeko Passed) | `GET /api/screening/analytics/pipeline` → `backend/src/services/screening.service.js:2294-2305` | Real DB counts. Lifetime totals, unlabelled as such |
| **Role Summary** table | Same call, grouped client-side in `frontend/src/pages/Analytics.jsx:351-381` | Real, but duplicated logic (see 2.6) |
| **Stage funnel** | `GET /api/pipeline/analytics` → `backend/src/services/pipeline.service.js:1113-1132` | Real. Auto-picks the busiest MRF when none passed |
| **Stuck candidates** | Same endpoint, `pipeline.service.js:1135-1151` | Real rows, **wrong day counts** (2.3) |
| **Rejection reasons** | `pipeline.service.js:1153-1181`, from `rpa_pipeline_stage_events` ⋈ `rpa_outcome_reasons` | Real and correct |
| **Active in pipeline / On hold >30d / Offers pending** | `pipeline.service.js:1080-1093` | Real and correct |
| **Time-to-hire** | `pipeline.service.js:1183-1209` | Real source, **distorted** (2.3) |
| **Email Delivery** (Sent/Failed/Opened/Replied/Bounced, by-type, recent failures) | `GET /api/email/monitoring` → `backend/src/controllers/emailTemplate.controller.js:180` | Real, from `rpa_email_log` + `rpa_email_tracking` |
| **All 7 Export buttons** | `backend/src/exports/` builders, rate-limited | Real CSVs. Exports return the *complete* ranked list, not the top 10 |

Two things worth knowing that are **not** defects to fix here:

- **Email "delivered" is self-asserted on send** — it means "the API call didn't
  throw", not a real delivery receipt. There are no SendGrid/Graph webhooks.
  `bounced` is inferred by NDR subject-matching in
  `backend/src/jobs/inboundEmailSync.js:165`.
- `GET /api/analytics` (`backend/src/routes/index.js:56`) is a leftover stub returning
  *"Analytics module — coming soon"*. Nothing calls it. The real analytics live under
  `/api/pipeline/analytics`, `/api/email/monitoring` and `/api/screening/analytics/*`.

## 2. What is pending

| # | Defect | Where | Impact |
|---|---|---|---|
| 2.1 | `awaiting_feedback` hardcoded `0`; comment claims M3 unbuilt | `pipeline.service.js:1081-1085` | **High** — silently wrong |
| 2.2 | Vendor shortlist rate always 100% | `pipeline.service.js:1211-1224` | **High** — metric is noise |
| 2.3 | `note` events corrupt duration & staleness clocks | `pipeline.service.js:1077`, `:1190` | **High** — worsens over time |
| 2.4 | Source-of-hire columns overlap; open journeys counted as shortlisted | `pipeline.service.js:1235` | Medium |
| 2.5 | Duplicate `/api/pipeline/analytics` fetch; Refresh only refreshes 1 of 4 tabs; email errors swallowed; KPI strip shows `0` while loading | `Analytics.jsx:74`, `:216`, `:448`, `DeliveryMonitoring.jsx:50` | Medium |
| 2.6 | Role Summary aggregated twice — client-side for screen, server-side for CSV | `Analytics.jsx:351` vs `screening.export.js:172-198` | Low now, drifts on first edit |

---

## 3. Implementation

All backend defects live in one function, `getPipelineAnalytics()`
(`backend/src/services/pipeline.service.js:1054-1262`). **Land steps 1–4 as separate
commits in order, re-reading the whole function after each. Do not parallelise them.**

### Step 0 — Shared event-type constants

**File:** `backend/src/config/pipelineStages.js` (append near `STAGE_OUTCOMES`, ~L69)

`'entered'`/`'outcome'`/`'note'` are written at 16 call sites with no shared
definition. Step 1 branches on them, so give them a home first:

```js
export const EVENT_TYPES = Object.freeze({ ENTERED: 'entered', OUTCOME: 'outcome', NOTE: 'note' });
export const TRANSITION_EVENT_TYPES = Object.freeze([EVENT_TYPES.ENTERED, EVENT_TYPES.OUTCOME]);
export function isTransitionEvent(ev) { return TRANSITION_EVENT_TYPES.includes(ev?.event_type); }
```

Also add `HIRED_OUTCOMES = [FINAL_OUTCOMES.APPROVED, FINAL_OUTCOMES.JOINED]` beside the
existing `VACATING_OUTCOMES` (~L100) — Steps 3 and 4 both need one definition of "hired".

### Step 1 — Durations and staleness must ignore `note` events

`'entered'`/`'outcome'` are the only events that *move* a journey. `'note'` is an
annotation, written by `interviewScorecard.service.js`, `interviewSchedule.service.js`,
`assessmentImport.service.js`, `documentCollection.service.js` and `offer.service.js`.

**1a — stuck clock.** Delete `lastEventOf` (`:1077`) outright rather than adding a
sibling; two helpers differing by one predicate is how this bug returns.

```js
const lastTransitionOf = (j) => {
  const evs = j.rpa_pipeline_stage_events;
  for (let i = evs.length - 1; i >= 0; i -= 1) if (isTransitionEvent(evs[i])) return evs[i];
  return null;
};
const currentStageEntry = (j) => [...j.rpa_pipeline_stage_events].reverse()
  .find((ev) => ev.stage_key === j.current_stage_key && ev.event_type === EVENT_TYPES.ENTERED);
const stageClockStart = (j) =>
  currentStageEntry(j)?.created_at || lastTransitionOf(j)?.created_at || j.created_at;
```

The fallback moves from `j.modified_at` to `j.created_at` deliberately — `modified_at`
is bumped by non-transition writes, which is the same bug one level down.

**1b — time-to-hire** (`:1186-1201`): filter to transitions first, then pair each
`'entered'` with the next *transition*. Drop the `&& i !== 0` exception, which
attributed a note's timestamp to a stage. `createPipelineJourney()` (`:1027-1034`)
always opens with an `'entered'` event, so nothing legitimate is skipped.

**Effect:** time-to-hire and `days` values rise, sometimes a lot; the stuck list grows.
`time_to_hire` and `stuck` CSVs change values, not columns. No frontend change.

### Step 2 — Implement "Awaiting feedback"

Schema is confirmed present: `rpa_interview_schedule` (`backend/prisma/schema.prisma:792`,
incl. `occurrence_status`) and `rpa_interview_scorecard` (`:901`, incl. `status` default
`'pending'`, `sent_at`, `token_expires_at`). `PHASE3-MODULE-STATUS.md:26` marks M3a built
and tested.

**Count distinct journeys, not scorecards.** `dispatchScorecards()` creates one card per
interviewer mailbox, so a three-person panel would read as 3 beside "Active in pipeline:
12" — every neighbouring tile counts candidates. Expose the card count separately so
nothing is lost.

**Reuse the lifecycle strings, don't retype them.** `interviewScorecard.service.js` uses
bare `'pending'`/`'submitted'`/`'expired'` at L256/L362/L402/L469 with no exported
constant — add `SCORECARD_STATUS` there (it owns the lifecycle, near `TOKEN_TTL_DAYS`
~L28). Likewise export `OCCURRENCE_STATUS` (`'held'`/`'no_show'`) from
`interviewSchedule.service.js`, alongside its already-exported `parseInterviewerEmails`.

```js
const awaitingRows = await prisma.rpa_interview_scorecard.findMany({
  where: {
    status: SCORECARD_STATUS.PENDING,
    sent_at: { not: null },
    token_expires_at: { gt: new Date() },
    rpa_interview_schedule: { occurrence_status: OCCURRENCE_STATUS.HELD, cancelled_at: null },
    rpa_candidate_pipeline: { final_outcome: null },
  },
  select: { pipeline_id: true },
});
const awaitingFeedback = new Set(awaitingRows.map((r) => String(r.pipeline_id))).size;
const awaitingFeedbackCards = awaitingRows.length;
```

`token_expires_at` is the subtle clause: status only flips to `'expired'` when someone
*opens* the link (`getScorecardByToken` L254-259), so a never-opened card stays
`'pending'` forever and the tile would ratchet up and never come down. `pipeline_id` is
denormalised on the scorecard, so no join is needed; `idx_scorecard_pipeline` covers it.

**Frontend** (`Analytics.jsx:98-101`): delete the now-false caption *"Needs Module 3
(scorecards) to populate"* and state the unit instead — `candidates with an interviewer
scorecard still outstanding` — appending `· N cards` when the card count differs, so a
panel round doesn't look undercounted.

Adds `tiles.awaiting_feedback_cards`. No CSV impact.

### Step 3 — Source of hire: mutually-exclusive buckets

`:1235` counts every open journey as shortlisted and uses independent `if`s, so columns
overlap and can exceed `submitted`. Replace with a single `bucketFor(j)` returning
exactly one of `hired` / `rejected` / `on_hold` / `in_progress` / `closed_other`, with
closed state taking precedence over live state.

**Rename `shortlisted` → hire-based columns.** Keeping the word is part of the defect:
every `rpa_candidate_pipeline` row already *is* a shortlist by construction (the code
says so at `:1218`), so a per-source "shortlist rate" is definitionally ~100%. The real
question is which source converts to hires → the column becomes **Hire rate**
(`hired / submitted`).

Table becomes Source · Submitted · In progress · Hired · Rejected · On hold · Hire rate
(`Analytics.jsx:310-323`). **CSV headers change**
(`backend/src/exports/pipelineAnalytics.export.js:71-82`).

Invariant to assert in the test:
`in_progress + hired + rejected + on_hold + closed_other === submitted`.

### Step 4 — Vendor performance: verify the join, then decide

**Run this against staging before writing code:**

```sql
SELECT count(*) FILTER (WHERE cv_id IS NOT NULL) AS with_cv, count(*)
  FROM rpa_upload_jobs WHERE vendor_email IS NOT NULL;
SELECT count(*) FROM rpa_candidate_pipeline p
  JOIN rpa_upload_jobs u ON u.cv_id = p.cv_id WHERE p.source = 'vendor';
```

**If `cv_id` coverage is good:** build the real denominator from `rpa_upload_jobs`
(`schema.prisma:642` — has `vendor_email`, `vendor_name`, `is_duplicate`, `status`,
`cv_id`, indexed on `vendor_email`), joined to journeys on `cv_id`. Key vendors on
**lower-cased email** (`vendor.controller.js` L126/431 already compares
case-insensitively; analytics must match or one vendor splits into two rows). Exclude
`is_duplicate` rows and failed/cancelled jobs — import `JOB_STATUS` from
`backend/src/services/uploadJob.service.js:14` rather than retyping status strings.
Count in-flight jobs (`cv_id = null`) as `in_progress_uploads`, not in the denominator.
Attribute via the upload job, not `rpa_candidate_pipeline.vendor_email` —
`pipeline.service.js:85-93` already warns that column "is not sufficient proof"; use
`vendorEmailFor()` only as fallback. Add `advanced` (has an `approved` outcome event)
and `hired` — those carry the real signal.

**If `cv_id` is largely null:** remove the Shortlist rate column entirely and show
Vendor · Submitted · Shortlisted. Do **not** relabel the 100% as something else — the
number is the problem, not the label. A column readers learn to ignore is worse than one
fewer column.

If rebuilt, `submitted` changes meaning (CVs, not journeys) under an unchanged header —
the dangerous kind of change. **Rename the CSV header to `CVs Submitted`**
(`pipelineAnalytics.export.js:60-69`) to force the difference to be noticed. Assert
`shortlisted <= submitted` in the UI.

### Step 5 — Page wiring

Do **5a before Step 4**, since Step 4 makes the shared query heavier.

- **5a** — Lift `{ data, loading, errored }` and a `loadPipelineAnalytics` callback into
  `Analytics()`; pass as props and **delete** both children's `useState`/`useEffect`
  blocks (`Analytics.jsx:70-83` and `:212-225`). Keeping one "just in case" is what
  produced the duplicate request.
- **5b** — Refresh Data (`:448-455`) → `Promise.all([fetchMainData(), loadPipelineAnalytics()])`,
  plus a `refreshKey` prop for `DeliveryMonitoring`. Otherwise the button still lies
  about three of four tabs.
- **5c** — `DeliveryMonitoring.jsx:50-51`: add `error` state and an `Alert` + Retry,
  matching the pattern at `Analytics.jsx:86`. Today a failed request is
  indistinguishable from a clean month with zero failures and zero bounces — the worst
  failure mode for a monitoring tab.
- **5d** — KPI strip (`:427-434`, cards at `:462`): pass `loading`, render `—` when
  `tiles` is absent, and caption the strip **"all time"**. A confident `0` during fetch
  is a wrong answer, not a slow one. A real date-range picker must thread through
  `screening.service.js` *and* `screening.export.js` `roleSummarySpec.fetch` (L204-207)
  together or screen and CSV disagree — that is separate work, not part of this plan.
- **5e** — Role Summary: return a `role_summary` array built by the existing
  `groupByRole()` (`screening.export.js:172-198`), render that, delete the client
  useMemo. One definition, and no CSV change *because* it stays the single builder.

---

## 4. Verification

No tests currently cover `getPipelineAnalytics`, `pipelineAnalytics.export.js`, or the
Analytics page. `backend/src/tests/` holds five pure `node:test` suites run via
`npm run test:unit`.

1. **New `backend/src/tests/pipelineAnalytics.test.js`** in that style. This requires
   extracting `lastTransitionOf`, `stageClockStart`, a pure
   `stageDurations(events, closedAt)`, and `bucketFor` to module scope and exporting
   them — currently closures inside `getPipelineAnalytics`. That is a useful
   constraint: those are exactly the pieces that were wrong.
   - Duration fixture: `entered(d0) → note(d0.1) → note(d3) → outcome(d7)` ⇒ 7 days, not 0.1.
   - Source-of-hire: assert the buckets sum to `submitted`.
2. **Awaiting feedback, end to end:** mark an interview held → dispatch scorecards →
   tile increments by 1 (not by panel size) → submit the card → tile drops. Assert it
   never exceeds `active_in_pipeline`.
3. **Before/after snapshot** on staging: capture `/api/pipeline/analytics` JSON before
   Step 1 and after Step 4, and diff. Every moved number should be explainable by one
   of the four steps.
4. **Exports:** re-download all 7 CSVs; confirm only `stuck`, `time_to_hire`,
   `source_of_hire` and `vendor_performance` changed, and that row counts still match
   the `X-Export-Row-Count` header.
5. **Frontend:** drive all four tabs — confirm one `/api/pipeline/analytics` request per
   page load (not two), Refresh Data updates every tab, and the Email tab shows an error
   Alert when the request fails.

## 5. Release note (required)

Time-to-hire and stuck-candidate figures increase because durations previously stopped
at the first note; "Awaiting feedback" starts reporting real outstanding scorecards
instead of zero; the always-100% vendor shortlist rate is gone; vendor and
source-of-hire CSV headers change.

---

## 6. What actually shipped — deltas from the plan

### 6.1 The vendor rate was dropped, not rebuilt

The §4 staging gate ran and **failed**, so the "remove the column" branch was taken:

| Check | Result |
|---|---|
| `rpa_upload_jobs` rows with a vendor | 31 |
| …of those, carrying a `cv_id` | **7** (23%) |
| Those joined to a pipeline row | **1** |
| `rpa_candidate_pipeline` rows with `source='vendor'` | **0** |

Live sources are only `screening_shortlist` (18) and `recruiter` (2). No vendor
journey exists at all, which is why the table renders "No vendor-sourced journeys
yet". A rate built on a 1-row join would have been invented, so the column is gone
rather than relabelled. The table now shows Vendor · In pipeline · Hired · Rejected.
Re-run the gate query in §4 if a `cv_id` backfill ever lands.

### 6.2 A fourth event type — `skip`

The plan assumed three event types. Production has four: `entered` (54), `note` (61),
`outcome` (37) and **`skip` (9)**. `skip` is written *instead of* `entered` when a
candidate lands in a stage having bypassed an optional one before it — it is an
ARRIVAL, and `assessmentImport.service.js:186` already pairs `('entered','skip')`.

Treating it as a non-arrival would have made every skipped-into stage invisible to
both clocks. `isStageArrival()` in `config/pipelineStages.js` now covers both, with
two regression tests. This was caught by the before/after verification (§4 step 3),
not by the unit tests — the pass is worth keeping in the checklist.

### 6.3 Helpers moved to their own module

`lastTransitionOf`, `stageClockStart`, `stageDurations` and `bucketFor` live in
**`backend/src/services/pipelineAnalytics.helpers.js`**, not inside
`pipeline.service.js` as §4 assumed. Importing that service opens a shared Redis
connection that never closes, so `node --test` hangs forever — the same trap
documented in `mrfClosure.test.js`. The helpers module is dependency-free.

### 6.4 Measured effect on staging

Four of twenty open journeys reported a different age once notes stopped resetting
the clock. The worst case, pipeline #5, carried 23 note events:

| Pipeline | Days stuck, before | After | Notes |
|---|---|---|---|
| 5 | 1 | **5** | 23 |
| 27 | 2 | **4** | 10 |
| 35 | 2 | **4** | 7 |
| 1 | 20 | **21** | 0 |

`awaiting_feedback` went from a hardcoded `0` to a real **1**. The source-of-hire
bucket invariant holds on live data (18 = 18, 2 = 2). Time-to-hire is still empty
because staging has no closed journeys — correct, not a regression.

### 6.5 Left open

**§2.6, the Role Summary double aggregation.** The screen still groups candidates
client-side while the CSV uses `groupByRole()` server-side. They agree today, and
unifying them touches the Zeko screening payload rather than the pipeline analytics
this pass was scoped to. Worth doing before either is next edited.

---

## 7. Second pass — fixed parameters made dynamic (2026-08-12)

A follow-up audit asked whether anything was still a hardcoded *display* value.
**No fake numbers remained** — `awaiting_feedback` was the last one. What it did
find was four analysis parameters with no UI, and one latent export bug.

### 7.1 The export ignored every filter (found and fixed)

`pipelineAnalytics.export.js` built its spec with `getPipelineAnalytics({ topN: null })`
and discarded `req.query` entirely. Harmless while nothing sent filters — but the
moment controls shipped, every CSV would have returned the unfiltered, all-MRF set
while the toast claimed it matched the screen. Fixed **first**, before any UI, so
the two could never diverge.

Verified on staging: a `stuck` export went 9 rows → 0 under a 999-day threshold,
and the funnel export scoped correctly to a chosen MRF (7 rows → 11 for MRF-115).

### 7.2 Four parameters wired to controls

The backend already accepted all four; only `Analytics.jsx` never sent them.

| Control | Where | Default (unchanged) |
|---|---|---|
| Requisition selector | Stage funnel card header | busiest MRF, auto-picked |
| Stuck threshold | Stuck candidates card | 10 days |
| On-hold threshold | "On hold >" tile | 30 days |
| Rejection window | Rejection reasons card | 30 days |

The funnel selector matters most: staging has **8 requisitions with journeys**, and
the page silently showed one of them (".NET (MRF-110)") as though it were the whole
picture. It now lists all eight with journey counts, and captions an auto-pick as
*"showing the requisition with the most candidates"* so a default is never mistaken
for a deliberate choice.

The Stuck card title now also states its threshold — it was applying a 10-day
cut-off while presenting the result as simply "Stuck candidates".

### 7.3 `parseAnalyticsParams` — one parser, two callers

Extracted so the controller and the CSV export cannot drift. It lives in
`pipelineAnalytics.helpers.js`, **not** the export module: anything importing
`pipeline.service.js` opens a Redis connection that never closes and hangs
`node --test`. That trap caught this work once — the first version of
`analyticsParams.test.js` imported the export module and hung the suite. The export
module re-exports the parser for its own callers.

Junk input (`'abc'`, `'-3'`, `'0'`, `''`) yields `undefined`, not `NaN`: a NaN
threshold makes every comparison false and would silently empty the stuck list.
Six tests cover this.

### 7.4 Backward compatibility

Every new param is optional and falls through to the service's existing defaults.
Verified on staging that a no-param call is unchanged: same top-level keys, funnel
still carrying `mrf_id`/`mrf_label`/`stages`, identical tiles, 9 stuck rows. The two
new funnel fields (`available_mrfs`, `auto_selected`) are additive, and nothing
outside this page consumes the payload.

**117 unit tests pass** (13 helpers + 6 params, plus the existing 98).
