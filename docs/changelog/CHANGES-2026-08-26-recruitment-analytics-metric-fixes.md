# Recruitment Analytics — metric correctness pass (2026-08-26)

**Reported defect:** the **Zeko Passed** tile on `/analytics` reads `0` while **Zeko Sent**
reads `10`.

It is not a display bug, and it is not a data problem. The tile counted a state the
application has never been capable of producing. Auditing the rest of the page for that same
failure mode — *a metric filtered on a state the write path never writes, or aggregated in a
way that silently drops or distorts rows* — found three more. All four are fixed here.

Every one of them was **silent**: the number rendered, it was simply wrong. That is the
category this page has been fighting since the original audit (`docs/Recruitment-Analytics.md`
§2), and the reason `pipelineAnalytics.helpers.js` exists at all.

---

## 1. "Zeko Passed" counted a status nothing writes

`screening.service.js` counted `rpa_zeko_candidate_pipeline.status = 'passed'`. **No code path
in this repository writes `'passed'` to that column.** The complete set of writers is four:

| Writer | Value written |
|---|---|
| `assignCandidateToZekoJob()` — `screening.service.js:2452, :2470` (+ schema default `schema.prisma:558`) | `pending` |
| `scheduleInterview()` — `screening.service.js:2633` | `sent` |
| Zeko results sweep — `zeko.service.js:917` | `completed` |
| `cancelInterview()` — `screening.service.js:2778` | `cancelled` |

`'passed'`, `'failed'` and `'in_progress'` are unreachable. When a Zeko score syncs back, the
sweep writes the score into `rpa_zeko_interview_results` / `rpa_cv."ZekoInterviewScore"` and
marks the pipeline row **`completed`** — it does not evaluate the score. **There is no passing
threshold anywhere in the system.** The tile was therefore structurally `0` from the day it
shipped, and its tooltip ("Candidates who took a Zeko assessment and **met the passing
score**") described logic that has never existed.

**Fixed:** the tile is now **Zeko Score Received**, reading `tiles.zeko_completed` — the count
the system can actually justify, being candidates whose result has come back. Its icon changed
from a check mark to a document, because a check mark asserts a verdict the ATS never reaches.
The tooltip now says outright that this is not a pass count.

The three unreachable aliases stay in the SQL, under a comment recording the four-value
vocabulary above, so that a future writer of those values would be counted rather than silently
dropped. **Do not build a tile on one without first confirming a writer exists** — that is the
entire defect, restated.

## 2. `future_prospect` fell out of every total

`future_prospect` is one of the four `CORE_OUTCOME_KEYS` (`PipelineConfigPanel.jsx:49`), it is
offered in the pipeline drawer (`PipelineDrawer.jsx:141`), and `shortlistStatusFor()`
(`pipelineStages.js:306-307`) writes it to `rpa_shortlisted_candidates.pipeline_status`.

But all three readers of that column bucketed `shortlisted` / `rejected` / `on_hold` with **no
final `else`**, so such a candidate counted toward `Total` and toward nothing else:

- `screening.service.js` — the headline strip
- `Analytics.jsx` `roleStats` memo — the Role Summary table
- `screening.export.js` `groupByRole()` — the Role Summary CSV

Today the strip happens to add up (79 + 21 + 2 = 102) only because nobody has used the outcome
yet. **The first future prospect breaks the arithmetic silently**, on a strip whose own `Total`
tooltip promises the other tiles account for every candidate in it.

**Fixed:** a fourth bucket in all three readers, plus a **Future Prospect** column on the Role
Summary table and CSV in matching positions. No seventh headline tile — the strip is a 6-up
grid and a seventh wraps badly; the per-status breakdown belongs in the table. The
`analyticsTotal` tooltip now names all four subsets.

## 3. Time-to-hire added averages taken over different populations

The headline read *"Average days, shortlist to offer"* and was computed as the **sum of the
per-stage averages**. Each stage is averaged over a different set of journeys — a candidate
rejected at Tech-1 contributes to Tech-1's average and to no other — so adding them together
mixes cohorts and produces a duration **no candidate's journey has ever matched**.

Two aggravating details in the same block:

- `.filter(row => row.avg_days > 0)` deleted any stage averaging under 0.05 days, so the
  fastest-moving stages disappeared from the chart entirely.
- With no closed journeys the headline still rendered a confident **"0 days"**, while the bars
  directly beneath it correctly showed "No closed journeys yet".

**Fixed:** the whole computation moved into a new `timeToHireFor()` in
`pipelineAnalytics.helpers.js` — that module exists precisely so analytics arithmetic can be
unit-tested (importing `pipeline.service.js` opens a Redis connection that hangs `node --test`).
The headline is now the **median end-to-end duration** (`created_at` → `closed_at`) of journeys
that closed as a hire, per `bucketFor()`/`HIRED_OUTCOMES`.

- **Median, not mean** — hiring sets are small and long-tailed, and one 200-day requisition
  drags a mean somewhere no real hire has been.
- **`median_days` is `null`, never `0`,** when nothing has been hired; the screen renders an
  em-dash. A zero meaning "no data" is indistinguishable from a zero meaning "instant".
- **Sample size is published** next to the headline and on every stage row. A median of two
  hires and a median of two hundred read identically without it.
- The per-stage bars are kept and stay wider than the headline (all closed journeys, hired or
  not) — a stage duration is meaningful for a rejected journey too, and restricting them to
  hires would leave most stages with almost no sample. The drop filter is now `sample_size > 0`,
  so a stage that genuinely takes minutes shows `0d` instead of vanishing.

## 4. Zeko tiles counted invitations while their neighbours counted candidates

`rpa_zeko_candidate_pipeline` is unique on `(candidate_id, zeko_job_id, stage)`
(`schema.prisma:569`), and the HR and functional screening rounds reuse the **same** Zeko job —
functional screening is a second interview against it. A candidate who sits both rounds
therefore has **two rows**, and `COUNT(*)` counted them twice.

That put the two Zeko tiles in a different unit ("invitations") from the four candidate-counting
tiles sitting beside them in the same strip, which made any comparison between them meaningless.

**Fixed:** `COUNT(DISTINCT candidate_id)` throughout the tile query.

## 5. The funnel counted stages that were skipped

`getPipelineAnalytics()` treated a journey as having "reached" stage S if
`current_stage.sort_order >= S.sort_order`. But when an optional stage is bypassed,
`setStageOutcome()` logs the `'skip'` event against the stage the candidate **lands in**
(`pipeline.service.js:762`) and writes **nothing at all** for the one that was jumped — so a
stage nobody entered scored as though everyone had.

**Fixed:** an actual arrival event (`isStageArrival` — `'entered'` or `'skip'`) is now the
primary test. The `sort_order` rule survives only as a fallback for a journey carrying no
arrival events whatsoever, i.e. a row predating the event log; dropping it outright would swap
an over-count for an under-count, which is no better. `createPipelineJourney()` writes
`'entered'` (`:1259`), so the fallback should be dead code for anything this app created.

---

## ⚠ Published numbers that move

Anyone comparing against a screenshot taken before this change should expect:

| Number | Direction | Why |
|---|---|---|
| **Zeko Score Received** (was Zeko Passed) | `0` → real value | It was structurally zero (§1) |
| **Zeko Sent** | **falls** | Now counts candidates, not invitations (§4) |
| **Time-to-hire headline** | changes, possibly a lot | Different statistic on a different population (§3) |
| **Time-to-hire stage list** | may gain rows | Fast stages are no longer dropped (§3) |
| **Stage funnel** | **falls** for any MRF with a skipped optional stage | No longer counts bypassed stages (§5) |
| **Role Summary** | gains a column | Future Prospect (§2) |

Nothing here is a regression: in every case the previous figure was the wrong one.

## Files changed

| File | Change |
|---|---|
| `backend/src/services/screening.service.js` | `COUNT(DISTINCT candidate_id)`; `future_prospect` bucket; the Zeko status-vocabulary comment |
| `backend/src/services/pipelineAnalytics.helpers.js` | new `timeToHireFor()` + `median()` |
| `backend/src/services/pipeline.service.js` | funnel arrival test; time-to-hire delegates to the helper |
| `backend/src/exports/screening.export.js` | Future Prospect column + bucket |
| `backend/src/exports/pipelineAnalytics.export.js` | Sample Size column |
| `backend/src/tests/pipelineAnalytics.test.js` | 7 new cases (23 total, all passing) |
| `frontend/src/pages/Analytics.jsx` | Zeko tile rename + repoint; Future Prospect column; time-to-hire panel |
| `frontend/src/constants/metricDefinitions.js` | Zeko tooltips rewritten; `analyticsTotal` caveat; new `timeToHire` entry |
| `frontend/src/theme/index.css` | `.kpi-card__label` wraps instead of clipping (see below) |

### One shared-component fix the rename exposed

`.kpi-card__label` carried `white-space: nowrap` against the card's `overflow: hidden`, so any
label too long for its column was **silently truncated**. The longer "Zeko Score Received"
rendered as *"ZEKO SCORE RECEIV"* at a 1280px viewport — and because `MetricInfo`'s icon sits
inside that same span, the tooltip affordance disappeared off the card entirely.

The label now wraps, with `min-height: 2.5em` reserving both lines on **every** KPI card: these
sit in an Ant `Row` that aligns to the top, so without it a single wrapped tile would leave the
strip ragged. Verified at 1280px — all six tiles stay at a uniform 176px.

This is a shared component (Vendor Dashboard, HR Upload, Vendor screens also use `KpiCard`), so
every KPI card in the app gains ~10px of height. Uniformity is preserved by construction, since
the reservation applies to all of them. Clipping a label was never correct behaviour — the
rename only made an existing latent bug visible.

**No schema change.** No migration, no backfill — every fix is a read-side correction.

## Tests

`pipelineAnalytics.test.js` had no time-to-hire coverage at all. Added:

- time-to-hire reports `null`, never `0`, when nothing has been hired
- one slow requisition does not drag the figure (why it is a median)
- an even number of hires averages the two middle journeys
- only hired journeys count (`joined_and_left`, `backed_out`, rejections excluded)
- a stage that takes minutes reports `0d` instead of disappearing
- every stage row carries the sample size its average rests on
- an open journey contributes no stage durations

`node --test src/tests/pipelineAnalytics.test.js` → **23 pass, 0 fail** (16 pre-existing + 7 new).
