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
