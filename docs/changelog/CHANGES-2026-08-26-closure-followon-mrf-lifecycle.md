# Phase 3 — Closure follow-on: the requisition lifecycle closes both ways

**Date:** 2026-08-26 · **Modules:** M1 (stage engine), M5 (offer/closure), MRF lifecycle
**Source:** [PHASE3-CLOSURE-AUDIT-2026-08-26.md](../PHASE3-CLOSURE-AUDIT-2026-08-26.md) §2.5–§2.7,
built after the product owner answered **Q32–Q34**. Follows
[CHANGES-2026-08-26-candidate-closure-graceful-exit.md](./CHANGES-2026-08-26-candidate-closure-graceful-exit.md),
which delivered §5 items 1–4 + 7. Live status:
[PHASE3-CLOSURE-FOLLOWON-PROGRESS.md](../PHASE3-CLOSURE-FOLLOWON-PROGRESS.md).

**Two manual DDL files.** Both applied to staging on 2026-08-26 and verified; see each README.

---

## 1. §2.7 — the MRF fill/free coupling now runs both ways

`setFinalOutcome` called `reopenMrfIfUnfilled` but never `closeMrfIfFilled`, so a journey outcome
could **free** a requisition seat but never **fill** one. A journey closed as `joined` without an
in-app accepted offer — the offline-offer path, and the Offer round has been record-only since
2026-08-25 — stamped `joined_at` and counted as Hired while its requisition **stayed open in the JD
dropdown forever**.

That was narrow while closure was Offer-only. §2.1 made it one click from Tech 1, which promoted it
from theoretical to routine.

### Wiring the call in was not enough

`closeMrfIfFilled` asks `countAcceptedHires`, which counted **`rpa_offers` rows**. The §2.7 case is
a closure with *no offer row at all*, so the call would have run, counted 0, and changed nothing —
in exactly the case it was added for. The seat count had to widen too.

- `services/mrfClosure.service.js` — `countAcceptedHires` → **`countFilledSeats`** (old name kept as
  a deprecated alias, per the no-delete rule). A seat is now held by **either** an accepted offer
  **or** a `HIRED_OUTCOMES` closure.
- It counts **journeys, not offer rows**, and that is the load-bearing detail: the normal path
  carries *both* an accepted offer *and* a `joined` closure on one journey, so counting the two
  sources separately would have **filled a 2-opening requisition on a single hire**. One row per
  journey dedupes by construction. (`rpa_offers.pipeline_id` is `@unique`, so no cardinality is lost.)
- `services/pipeline.service.js` — `setFinalOutcome` calls `closeMrfIfFilled` on a hire outcome,
  mirroring the `reopenMrfIfUnfilled` branch beside it, with the same audit note and the same
  never-throws guarantees.

**Verified on staging**, five cases: empty → 0; accepted offer → 1; `joined` with no offer row → 2;
offer **and** `joined` on one journey → **3, not 4**; `joined_and_left` → still 3; `closure_rejected`
→ still 3.

## 2. §2.6 — journeys can be re-opened

`assertJourneyOpen` has told users *"Reopen it before you…"* since Module 1, naming an action that
**did not exist**. The only undo was a hand-written database update.

`reopenJourney()` is not just "clear the flag" — closure's best-effort tail writes four other things
and every one is still true afterwards. Leaving them would re-create §2.4 in mirror image: a live
journey reading `pipeline_status = 'hired'` with a `joined_at` for someone who never joined.

It claims the re-open conditionally (409 on a race), writes a mandatory-reason audit note, resets
`pipeline_status` from the last **stage** outcome event, clears `joined_at`, and then calls **both**
`reopenMrfIfUnfilled` and `closeMrfIfFilled` — each a no-op unless its own condition holds, so the
pair simply recounts the seats and settles rather than guessing which way the requisition moved.

`POST /api/pipeline/:id/reopen`; a **Reopen record** action sits beside the purple `Closed —` tag,
the only place it could go since every other affordance is suppressed once an outcome exists.

## 3. Q33 — the pause/stop lever RT asked for

`is_paused` was in the schema, on every board card payload and in the CSV export, and **nothing
anywhere wrote it**. RT closed Q25 on 2026-07-14 with *"the system's only job is to provide a manual
action to pause/stop the other journey's status"*; it was never built.

Pausing is **not** closing: no `final_outcome`, no legacy write, no email. What makes it mean
anything is that a paused journey drops out of all four sweeps §2.3 had just guarded —
`interviewReminder`, `interviewOccurrence`, `assessmentDeadlineChecker`, `listUnresolvedInterviews`.
Without that the flag would be decorative.

`POST /api/pipeline/:id/pause` (explicit `paused` boolean, not a toggle, so two recruiters cannot
flip past each other); drawer control offered only on an **open** journey, and an orange **Paused**
badge on the board card beside *Role filled* — the case it exists for.

## 4. Q34 — manual requisition closure, with a reason

A requisition cancelled by the **business** had no representation at all: no close endpoint, a
disabled status `Select`, fill state written only by the automatic path, and **no closure-reason
column anywhere** — so even automatic closures recorded *when* but never *why*.

**DDL:** `2026-08-26-mrf-manual-closure.sql` adds `closed_at`, `closure_reason`, `closure_note`,
widens the `idx_rpa_mrf_open` partial index to `filled_at IS NULL AND closed_at IS NULL`, and
back-fills `all_openings_filled` onto already-filled rows so the column is complete from day one.

**Why not reuse `filled_at`:** a cancelled requisition was not filled, and `reopenMrfIfUnfilled`
clears only `filled_at` — so with a separate column a candidate backing out **can never resurrect a
deliberate business cancellation**. That invariant is free with two columns and would need a new
guard with one.

- `config/pipelineStages.js` — `MRF_CLOSURE_REASONS` and **`isMrfClosed()`** (`filled_at` **or**
  `closed_at`). `isMrfFilled()` is kept and still means exactly what its name says, because
  `mrfDetail.export`'s *"Openings Filled: YES/NO"* must stay false for a role nobody was hired into.
- **Every `select:` that feeds the predicate gained `closed_at`** — the trap `mrf.export.js` already
  warned about for `filled_at`: a missing column makes the check read `undefined`, return false, and
  silently put a closed requisition back in JD filtering.
- `getApprovedRoles()` — `AND closed_at IS NULL`. **This is the line that removes the role from the
  JD dropdown**, and the widened partial index matches it.
- `closeMrfManually` / `reopenMrfManually`, `POST /api/mrf/:id/close` and `/reopen`, role-gated.
  A reason is mandatory, `other` requires a note, and `all_openings_filled` is refused — only the
  automatic path may write it. **Neither touches `approval_status` or `mrfstatus`**; the MRF page's
  status `Select` stays disabled, because overwriting it to express closure is the lossy bug removed
  on 2026-08-11.

**Verified end to end on staging:** created → in JD dropdown → closed → **out of** the dropdown →
double close refused (409) → `all_openings_filled` refused (400) → `approval_status` still
`approved` and `filled_at` still null → re-opened → back in the dropdown.

---

## 🚨 5. A false premise, and the two silent bugs it caused

`prisma/ddl/2026-07-21-pipeline-stage-engine.README.md` states **in bold** that
`rpa_shortlisted_candidates.pipeline_status` is *"a plain VARCHAR(50) with no CHECK constraint"*.

**It is not.** `rpa_shortlisted_candidates_pipeline_status_check` exists and permitted 14 values.
Because every writer of that column is a best-effort legacy write-back inside a `try/catch`, the
rejection was **silent** — logged, never surfaced:

1. **`future_prospect`, since 2026-07-21.** `setStageOutcome` has written it for a month and the
   database has refused it every time. Staging: 79 `shortlisted`, 21 `rejected`, 2 `on_hold`,
   **zero** `future_prospect`. Pre-existing; nothing to do with the closure work.
2. **The closure statuses, earlier the same day.** Audit §6a relied on that README to decide the
   distinct closure vocabulary needed no DDL, so 5 of the 7 values were rejected — meaning §2.4
   could not move a candidate off `'shortlisted'`, **the exact defect it set out to fix**. It was
   reported unit-green; those tests covered the pure mapping function and never touched the DB.

**DDL:** `2026-08-26-shortlist-status-vocabulary.sql` widens the constraint to cover the five closure
values plus `future_prospect`, keeping all 14 originals. The constraint now carries a `COMMENT`
naming `SHORTLIST_STATUSES` as the list it must stay in lockstep with, because a unit test
structurally cannot catch this — only a real write can.

Both source documents are stamped in place with the correction.

## Files

**Backend:** `config/pipelineStages.js`, `services/mrfClosure.service.js`, `services/pipeline.service.js`,
`services/screening.service.js`, `services/interviewSchedule.service.js`, `controllers/pipeline.controller.js`,
`controllers/mrf.controller.js`, `routes/pipeline.routes.js`, `routes/mrf.routes.js`,
`exports/mrf.export.js`, `exports/mrfDetail.export.js`, `jobs/interviewReminder.js`,
`jobs/interviewOccurrence.js`, `jobs/assessmentDeadlineChecker.js`

**Frontend:** `services/pipeline.js`, `services/mrfService.js`, `components/pipeline/PipelineDrawer.jsx`,
`pages/Pipeline.jsx`, `pages/MRF.jsx`

**DDL:** `prisma/ddl/2026-08-26-mrf-manual-closure.{sql,README.md}`,
`prisma/ddl/2026-08-26-shortlist-status-vocabulary.sql`

## Verification

Beyond the staging smoke tests quoted above, the three changed integration files were **run**
individually on 2026-08-26 (never via `npm run test:unit`, whose glob recurses into `integration/`):

| File | Result |
|---|---|
| `pipelineClosure.test.js` | **21 pass, 0 fail** — PIPE-16/17/18/19/20/21, N2, MRF-01 |
| `sweepJobs.test.js` | **10 pass, 0 fail** — SWEEP-04 |
| `crossModuleE2E.test.js` | **7 pass, 0 fail** — extended E2E-01, new E2E-06 |

Unit suite unchanged at **207 pass**. The first run surfaced four failures, **all in the tests, none
in the product** — a unique index on `(pipeline_id, stage_key)`, two tests asserting fill state on a
shared fixture MRF an earlier test had legitimately filled, and a missing required `deadline_days`.
Notably one of those failures was `closeMrfManually` correctly refusing an already-filled
requisition: the guard working, not breaking.

## Still open

- **Q32 — CONFIRMED 2026-08-26.** Put and accepted: the stranded-candidate behaviour stands as
  shipped (manual only; the "Role filled" tag plus one aggregate notification is a sufficient
  signal). No code follows. Q33/Q34 and the §D accepted-risk bullet were refreshed in
  `04-QUESTIONS.md` at the same time.
- **Backfill applied to STAGING only** (2 rows), via
  `backend/scripts/backfill-closure-pipeline-status.mjs` — dry-run by default, idempotent.
  **Production was deliberately left untouched.** If that is revisited, re-read the script header:
  one row moved `'rejected'` → `'backed_out'`, which **removes that candidate from the Q11 six-month
  cooling-off**, and `--skip-rejected` exists for exactly that question.
