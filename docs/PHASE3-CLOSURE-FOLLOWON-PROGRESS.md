# Phase 3 — Closure follow-on: progress log

**Started:** 2026-08-26 · **Plan:** §2.7 coupling · journey re-open · Q33 pause · Q34 MRF close
**Predecessor:** [PHASE3-CLOSURE-AUDIT-2026-08-26.md](./PHASE3-CLOSURE-AUDIT-2026-08-26.md) §5
items 1–4 + 7 — **built and green**, see
[CHANGES-2026-08-26-candidate-closure-graceful-exit.md](./changelog/CHANGES-2026-08-26-candidate-closure-graceful-exit.md).

`%` per task: **0** not started · **50** code written, unverified · **100** written **and** verified
(syntax check + relevant test green). A workstream reads 100% only when every row in it does.

## Status

| WS | Scope | % |
|---|---|---|
| **W1** | §2.7 — make the MRF fill/free coupling bidirectional | **100** — integration-verified (PIPE-21 dedup, E2E-01) |
| **W2** | Journey re-open (§2.6 mirror gap) | **100** — integration-verified (PIPE-19) |
| **W3** | Q33 — pause/stop action | **100** — integration-verified (PIPE-20, SWEEP-04) |
| **W4** | Q34 — manual MRF close + closure reason | **100** — DDL applied; integration-verified (MRF-01) |
| **Close** | Changelogs, tests, integration run, backfill, register | **100** |

## Tasks

| # | Task | WS | % | Status |
|---|---|---|---|---|
| 0 | Create this progress log | — | 100 | done |
| 1.1 | `countAcceptedHires` → `countFilledSeats`; count journeys not offer rows; deprecated alias | W1 | 100 | **done** — 5/5 seat cases verified |
| 1.2 | Call `closeMrfIfFilled` from `setFinalOutcome` on a hire outcome + audit note | W1 | 100 | **done** |
| 1.3 | Unit tests for the seat-count constants | W1 | 100 | **done** — 4 tests green |
| 1.4 | Shortlist provenance regression — `screening.service.js` ×3 sites | W1 | 100 | **done** — 20/20 smoke assertions |
| 5.5 | Backfill — **staging only**, production out of scope by decision | Close | 100 | **done** — 2 rows, idempotent on re-run |
| 5.6 | Q32 confirmed + Q33/Q34/§D register refreshed | Close | 100 | **done** |
| 2.1 | `reopenJourney()` — claim, audit, `pipeline_status`, `joined_at`, MRF reconcile | W2 | 100 | **done** — smoke-verified |
| 2.2 | `POST /api/pipeline/:id/reopen` route + controller + service client | W2 | 100 | **done** |
| 2.3 | Drawer "Reopen record" action + reason modal | W2 | 100 | **done** — build clean |
| 2.4 | `assertJourneyOpen` message — now true, documented | W2 | 100 | **done** |
| 3.1 | `setJourneyPaused()` service + claim + audit event | W3 | 100 | **done** — smoke-verified |
| 3.2 | `POST /api/pipeline/:id/pause` route + controller + service client | W3 | 100 | **done** |
| 3.3 | `is_paused: false` guard in all four sweeps | W3 | 100 | **done** — guard verified both ways |
| 3.4 | Drawer pause/resume + Paused tag; board card badge | W3 | 100 | **done** — build clean |
| 4.1 | DDL `2026-08-26-mrf-manual-closure.sql` + README | W4 | 100 | **done** — written, not applied |
| 4.2 | Apply DDL to staging, `prisma db pull && generate` | W4 | 100 | **done** — 9/9 stmts, client regenerated |
| 4.3 | `isMrfClosed()` + `MRF_CLOSURE_REASONS`; all `select:` gained `closed_at` | W4 | 100 | **done** — smoke-verified |
| 4.4 | `getApprovedRoles()` raw SQL — `AND closed_at IS NULL` | W4 | 100 | **done** — role verified out of dropdown |
| 4.5 | `closeMrfManually`/`reopenMrfManually` + routes; both paths stamp a reason | W4 | 100 | **done** — smoke-verified |
| 4.6 | MRF page CLOSED tag, close/re-open action, reason picker modal | W4 | 100 | **done** — build clean |
| 4.7 | **DDL `2026-08-26-shortlist-status-vocabulary.sql`** — widen the `pipeline_status` CHECK | W4 | 100 | **done** — applied, all 9 values writable |
| 5.1 | `frontend/UI-CHANGELOG.md` — §2.1/§2.8 backfilled **and** re-open + pause | Close | 100 | **done** |
| 5.2 | Two-tier changelog + audit banner/§6a corrected + false-premise stamps | Close | 100 | **done** |
| 5.3 | `PIPE-16/17/18/19/20/21`, `N2`, `MRF-01`, `SWEEP-04` written | Close | 100 | **done** |
| 5.4 | Run the three changed integration files | Close | 100 | **done** — 21+10+7 pass, 0 fail |

## ⚠️ Finding: the `pipeline_status` CHECK constraint exists

`prisma/ddl/2026-07-21-pipeline-stage-engine.README.md` states in bold that
`rpa_shortlisted_candidates.pipeline_status` is *"a plain VARCHAR(50) with no CHECK constraint"*.
**That is false.** `rpa_shortlisted_candidates_pipeline_status_check` exists and permitted only 14
values. Audit §6a's "distinct closure values, no DDL" decision rested on that false premise.

Two silent bugs followed, silent because every writer of this column is a best-effort legacy
write-back inside a `try/catch`:

1. **`future_prospect`, since 2026-07-21** — `shortlistStatusFor()` returns it and `setStageOutcome`
   writes it, and the constraint has rejected it every time. Staging proves it: 79 `shortlisted`,
   21 `rejected`, 2 `on_hold`, and **zero** `future_prospect`. Pre-existing, not from this work.
2. **The closure statuses, 2026-08-26** — 5 of the 7 values §2.4 introduced were rejected, so
   closure could not move a candidate off `'shortlisted'`: the exact defect §2.4 set out to fix.
   §2.4 was reported unit-green, but those tests only covered the pure mapping function and never
   touched the database.

Resolved by task **4.7**, which widens the constraint to cover both. The unit tests still cannot
catch a recurrence — only a DB write can — so the constraint now carries a `COMMENT` naming
`SHORTLIST_STATUSES` as the list it must stay in lockstep with.

## Integration run — 2026-08-26

Three changed files, run individually against staging (never via `npm run test:unit`, whose glob
recurses into `integration/`).

| File | Result |
|---|---|
| `pipelineClosure.test.js` | **21 pass, 0 fail** — incl. PIPE-16/17/18/19/20/21, N2, MRF-01 |
| `sweepJobs.test.js` | **10 pass, 0 fail** — incl. SWEEP-04 |
| `crossModuleE2E.test.js` | **7 pass, 0 fail** — incl. extended E2E-01 and new E2E-06 |

Unit suite unchanged at **207 pass**. No orphaned processes; no stray fixture rows; both fixture
MRFs left with `filled_at` and `closed_at` null.

**First run found 4 failures, all of them bugs in the TESTS, none in the product:**

1. **PIPE-17** — created three schedule rows on one stage; `rpa_interview_schedule` has a unique
   index on `(pipeline_id, stage_key)`. Now one row per stage.
2. **PIPE-19** and **MRF-01** — both asserted on the fill state of a SHARED fixture MRF that an
   earlier test in the same file had legitimately filled by closing journeys as `joined`. Both now
   use single-use requisitions, the same way `crossModuleE2E` already does. Notably MRF-01's failure
   was `closeMrfManually` correctly refusing an already-filled requisition — the guard working.
3. **SWEEP-04** — omitted the required `deadline_days` on `rpa_assessment_invites`.

> Each file still reports one FILE-level failure: the process is killed by the run timeout after
> every test has passed, because module-level Redis handles keep it alive once `after()` finishes.
> That is the documented hang in these files' own headers, not a test failure.

## Notes

- **§2.7 needed two changes, not one.** `closeMrfIfFilled` asks `countAcceptedHires`, which counts
  only `rpa_offers` rows — so wiring the call in without widening the seat count would have been a
  no-op in exactly the case §2.7 describes (a `joined` closure with no offer row). Both are in W1.
- **Dedup matters in 1.1.** The normal path carries *both* an accepted offer *and* a `joined`
  closure on one journey. Counting the two sources separately would fill a 2-opening requisition on
  a single hire. Counting journeys instead of offer rows dedupes by construction.
- **4.2 unblocked and done** (2026-08-26): DDL applied to staging, 9/9 statements, client
  regenerated. Required stopping the backend dev server, which held the Prisma query-engine DLL;
  it was restarted afterwards.
- **W4 was smoke-verified end to end on staging**, not just syntax-checked: a throwaway requisition
  was created, confirmed present in the JD dropdown, closed manually (left the dropdown), refused a
  double close (409) and the automatic-only reason (400), confirmed `approval_status` untouched and
  `filled_at` still null, re-opened (back in the dropdown), then deleted.
- **5.4 remains blocked on the user** — the integration suite hits shared staging and sends real
  mail. Per the 2026-08-26 decision, the missing tests are written FIRST and everything runs once.
