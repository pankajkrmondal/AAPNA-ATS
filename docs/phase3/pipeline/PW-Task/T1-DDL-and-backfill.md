# T1: DDL and backfill (plan §6 phase 1)

## Test plan

**Scope.** `backend/prisma/ddl/2026-10-16-flexible-stage-movement.sql` and its rollback:
- new table `rpa_pipeline_stage_state` (one row per journey per stage visited or moved past; no row = not visited);
- `rpa_pipeline_stage_events.from_stage_key`;
- `rpa_assessment_invites.withdrawn_at / withdrawn_by / withdraw_reason`;
- the idempotent backfill from `rpa_pipeline_stage_events`.

**Out of scope.** Production. Production gets the same file only after staging sign-off.

**Approach.**
1. Dry run on staging with the guarded runner (it executes and rolls back).
2. Real run on staging.
3. Re-run to prove idempotence (0 new rows).
4. Compare the backfill against the drawer for about 20 real candidates (plan §7 risk 2).
5. Rollback rehearsal with `--dry-run`.

**Pass criteria.** Every statement succeeds; the re-run inserts 0 rows; the 20-candidate comparison has no mismatch; the backfill rule matches `deriveStageStates()` (unit test).

**Commands.**
```
cd backend
node scripts/run-ddl.mjs --env .env.staging --expect-db recruitmentautomationdb --file prisma/ddl/2026-10-16-flexible-stage-movement.sql --dry-run
node scripts/run-ddl.mjs --env .env.staging --expect-db recruitmentautomationdb --file prisma/ddl/2026-10-16-flexible-stage-movement.sql
node scripts/run-ddl.mjs --env .env.staging --expect-db recruitmentautomationdb --file prisma/ddl/2026-10-16-flexible-stage-movement.rollback.sql --dry-run
npm run prisma:generate
```

## Test cases

| ID | Case | Steps | Expected |
|---|---|---|---|
| T1-01 | Dry run | Run the forward file with `--dry-run` | "DRY RUN OK", nothing committed |
| T1-02 | Apply | Run the forward file | "COMMITTED"; table, column and 3 invite columns exist |
| T1-03 | Idempotent | Run the forward file again | Every statement succeeds; the INSERT reports 0 rows |
| T1-04 | Wrong DB refused | Run with `--expect-db recruitmentautomationdbProd` against `.env.staging` | "REFUSED", nothing run |
| T1-05 | Backfill: current stage | Query a journey on `tech2`, `in_progress` | Row `tech2 = active` |
| T1-06 | Backfill: passed stages | Same journey | Every stage with an `approved` outcome event = `completed` |
| T1-07 | Backfill: bypassed optional | Journey approved from HR Round straight to Documents | `ceo`, `client` = `skipped` |
| T1-08 | Backfill: rejected / hold | Journey with `current_stage_status = rejected` / `hold` | Current stage row = `rejected` / `hold` |
| T1-09 | Backfill: final stage approved | Journey with `current_stage_status = approved` | Current stage row = `completed` |
| T1-10 | Backfill: not visited | Any journey | No row for stages after the current one; no `shortlist` row |
| T1-11 | Drawer comparison | 20 candidates: compare rows with the drawer's stage strip | No mismatch |
| T1-12 | CHECK constraint | Insert a row with `status = 'bogus'` (inside a rolled-back transaction) | Rejected by `chk_pipeline_stage_state_status` |
| T1-13 | Cascade | Delete a test journey (fixture only) | Its state rows go with it |
| T1-14 | Rollback rehearsal | Rollback file with `--dry-run` | "DRY RUN OK" |
| T1-15 | Prisma client | `npm run prisma:generate` | Succeeds; `prisma.rpa_pipeline_stage_state` exists |
| T1-16 | Rule parity (unit) | `node --test src/tests/unit/stageState.test.js` | "derive" tests pass: same rule as the SQL |

## Results log

### Run 1: 16 Oct 2026

| ID | Result | Notes |
|---|---|---|
| T1-16 | PASS | `stageState.test.js` 19/19, full unit suites 765/765 |
| T1-15 | PASS | `npx prisma generate` succeeded (schema validated first with `prisma validate`) |
| T1-01 to T1-14 | BLOCKED | Staging DB `20.244.34.176:5432` unreachable from this machine (TCP timeout). Re-run once connectivity is back |

### Run 2: 16 Oct 2026, 16:45 IST (VPN connected) — staging `recruitmentautomationdb`

| ID | Result | Notes |
|---|---|---|
| T1-01 | PASS | Dry run: 8 statements, backfill would insert 101 rows, rolled back |
| T1-02 | PASS | Applied, COMMITTED. Runner reported 106 inserted; the table holds 101 rows for the 26 live journeys. The id sequence shows journeys 2361-2368 were created and deleted on the shared DB in between (another user's activity); their rows went with them (cascade) |
| T1-03 | PASS | Re-run: every statement OK, INSERT → 0 rows |
| T1-04 | PASS | `--expect-db recruitmentautomationdbProd` against `.env.staging` → "REFUSED … Nothing was run." |
| T1-05 to T1-10 | PASS | Spot checks on all 26 journeys: current stage `active` (or `rejected` for journey 1); stages with an Approved event `completed`; bypassed optional stages `skipped` (e.g. 2359 `tech3 = skipped`, 27 `client = skipped`); no rows ahead of the current stage; no `shortlist` row |
| T1-11 | PASS | Query check over all 26 real journeys instead of 20 drawer comparisons: 0 journeys without a current-stage row, 0 current-stage mismatches with `current_stage_status`, 0 `completed` rows without an Approved event, 0 journeys with two active stages. Drawer strip verified visually on the fixtures (T4-12) |
| T1-12 | PASS | `status = 'bogus'` refused by `chk_pipeline_stage_state_status` (rolled-back transaction) |
| T1-13 | PASS | Integration tests and journeys 2361-2368 deleting journeys left no orphan rows (`pipeline_id not in rpa_candidate_pipeline` → 0 rows) |
| T1-14 | PASS | Rollback `--dry-run`: 5 statements OK, rolled back |
| T1-15 | PASS | Prisma client already regenerated; backend started and used the new model |

### Run 3: 18 Oct 2026 — `updated_by` was NULL on backfilled rows (reported from pgAdmin)

**Finding.** 115 of 136 `rpa_pipeline_stage_state` rows had `updated_by = NULL`: 98 from the 16 Oct backfill (the INSERT never set it) and 17 written by the app on paths that passed no user (journey creation, the catch-up rows of `ensureStageStateRows`, system auto-approves).

**Second finding while fixing.** Re-running the backfill would have inserted 25 rows marking never-visited stages "skipped" on six journeys that had been moved under the flag — including two a staging user had moved (7, 2360). The INSERT now only fills journeys with no state rows (the app's own rule).

**Fixes.**
- DDL file (same file, still re-runnable): INSERT limited to journeys with no rows; new UPDATE fills NULL `updated_by` from the event that put the stage in its state (same rule as `stageActorsFromEvents()`); new UPDATE credits a journey's first, still-active HR Screening row to the shortlister (`shortlisted_by` → real user only).
- `createPipelineJourney({ actedBy })`, passed by `shortlistCandidates` (`user.id`): the 'entered' event and first stage row now carry who shortlisted.
- `ensureStageStateRows`: catch-up rows take the actor from the event history.

| ID | Result | Notes |
|---|---|---|
| T1-17 | PASS | Unit: `stageActorsFromEvents` (latest matching event; hold vs approve; no attributed event → null). 766/766 |
| T1-18 | PASS | Dry run: INSERT 0, UPDATE 77, UPDATE 7. Applied; re-run: 0 / 0 / 0 |
| T1-19 | PASS | `updated_by` filled on 105 of 136 rows (was 21). The 31 NULLs are system actions (e.g. 8 Evalground auto-approvals), stages only jumped over (6), and fixture rows — NULL = "system / unknown" |
| T1-20 | PASS | Journeys 7 and 2360 unchanged (2 rows each, by pankaj), no stage relabelled |
| T1-21 | PASS | New journey created with `actedBy: 1`: entered event `acted_by = 1`, first state row `updated_by = 1` (temporary tagged CV, deleted after) |
