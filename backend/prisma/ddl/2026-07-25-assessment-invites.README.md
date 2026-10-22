# Evalground Invite/Deadline Tracking — DDL Apply Instructions

**File:** `2026-07-25-assessment-invites.sql`
**Do not hand-edit `schema.prisma`** — per `docs/reference/VENDOR_PROCESS.md` §13, this repo always introspects the live DB.

## Steps to apply

1. Run the SQL file against the database:
   ```
   psql "$DATABASE_URL" -f backend/prisma/ddl/2026-07-25-assessment-invites.sql
   ```
   Idempotent — safe to re-run.

2. Stop the backend, then introspect + regenerate the Prisma client:
   ```
   cd backend
   npx prisma db pull
   npx prisma generate
   ```

3. Restart the backend.

## What this adds

| Change | Purpose |
|---|---|
| `rpa_assessment_invites` (new table) | One row per Evalground invite attempt (email or marked-manual). Supports re-invites as new rows so the deadline checker always keys off the latest attempt. |
| `rpa_assessment_results.overall_marks_scored` (new column) | Evalground's raw "Marks Scored" total — the literal basis for the new auto-advance/auto-reject toggle, deliberately distinct from `overall_percentage`/`overall_result`. |

## After this lands

- `backend/src/services/assessmentInvite.service.js` — send/record invites, read invite state
- `backend/src/services/assessmentSettings.service.js` — `assessment_deadline_days` / `assessment_auto_advance_enabled` (`rpa_settings`-backed)
- `backend/src/jobs/assessmentDeadlineChecker.js` — hourly cron, in-app-only overdue notification
- `backend/src/services/assessmentImport.service.js` — captures `overallMarksScored`, gates auto-advance/auto-reject on it when the toggle is ON
