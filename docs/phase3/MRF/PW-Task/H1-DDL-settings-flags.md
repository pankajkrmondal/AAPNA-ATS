# H1: DDL, settings keys, flags, pure rules

## Test plan

**Scope.** The schema change, the feature flags and the pure rules everything else stands on:

- `prisma/ddl/2026-10-22-mrf-hold-and-delegate.sql`: 8 `rpa_mrf` columns, partial index `idx_rpa_mrf_held_due`, and wider CHECK lists for the event types, identity source and token revoke reasons.
- `MRF_HOLD_ENABLED`, `MRF_DELEGATE_DECISION_ENABLED`.
- Settings keys: `mrf_hold_default_days`, `mrf_hold_max_days`, `mrf_hold_release_time` ('HH:MM' IST) and `mrf_approver_absence` (JSON). Missing rows fall back to 30 / 180 / 09:00 / off.
- `utils/mrfApprovalRules.js` hold and on-behalf rules.

**Approach.** Guarded runner (dry run, then the real run) on the **staging** DB only. Dry-run the rollback. Run `prisma generate` with the dev server and the queue worker stopped. Unit tests.

## Test cases

| ID | Case | Expected |
|---|---|---|
| H1-01 | Dry run on staging | 18 statements succeed, rolled back |
| H1-02 | Real run on staging | COMMITTED, `--expect-db recruitmentautomationdb` guard passes |
| H1-03 | Rollback rehearsal (dry run) | Every statement succeeds |
| H1-04 | `prisma generate` | Client regenerated (no EPERM) |
| H1-05 | Old code still works against the new schema | Nothing breaks: all new columns are nullable/defaulted and the CHECK lists only grew |
| H1-06 | Unit: `mrfHoldRules.test.js` | IST date rollover, hold-until bounds, rules parsing/validation, absence window, who may decide on behalf, held is not open, labels |
| H1-07 | Unit: full suite | All pass |

## Results log

### Run 1: 22 Oct 2026

| ID | Result | Notes |
|---|---|---|
| H1-01 | PASS | 18/18, rolled back on purpose |
| H1-02 | PASS | COMMITTED on `recruitmentautomationdb` (staging). Prod not touched |
| H1-03 | PASS | Rollback dry run OK |
| H1-04 | PASS | Stopped my backend + `queue:worker` first; generated; worker restarted; backend handed back to the user's nodemon |
| H1-05 | PASS | The deployed staging server (old code) keeps running against the same DB |
| H1-06 | PASS | 25/25 |
| H1-07 | PASS | 882/882 (`src/tests/unit/*.test.js` + `src/tests/*.test.js`) |

**Change from the plan.** The release time is stored as `mrf_hold_release_time` 'HH:MM' (IST) instead of a cron string, which is simpler to edit in Settings; the job builds the cron itself. The pgAdmin bundle (`pgadmin/01-ddl-all.sql`) is a snapshot that ends at 2026-09-04, so like every later DDL this one goes through `scripts/run-ddl.mjs` and is not added to it.
