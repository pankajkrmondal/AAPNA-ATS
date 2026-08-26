# Pipeline Stage Engine — DDL Apply Instructions

**File:** `2026-07-21-pipeline-stage-engine.sql`
**Do not hand-edit `schema.prisma`** — per `docs/reference/VENDOR_PROCESS.md` §13, this repo always introspects the live DB.

## Steps to apply (requires staging DB access)

1. Run the SQL file against the staging Postgres database:
   ```
   psql "$DATABASE_URL" -f backend/prisma/ddl/2026-07-21-pipeline-stage-engine.sql
   ```
   (or paste it into your usual DB tool). It is idempotent — safe to re-run.

2. Stop the backend, then introspect + regenerate the Prisma client:
   ```
   cd backend
   npx prisma db pull
   npx prisma generate
   ```
   This adds the 6 new models below to `schema.prisma` automatically — no hand-editing.

3. Restart the backend. Until steps 1–2 are done, `pipeline.service.js` (once built)
   will fail because the Prisma client doesn't yet know these tables.

## New tables this introduces

| Table | Purpose |
|---|---|
| `rpa_pipeline_stages` | Stage config: key, label, sort order, optional/active flags, stage_type (manual/zeko/scheduled_interview/document/offer) |
| `rpa_stage_outcomes` | Outcome sets per stage (Approved/Rejected/Hold/Future Prospect/closure values), each flagged advance/final |
| `rpa_outcome_reasons` | Reason taxonomy for Reject/Hold, stage-scoped or global, includes the free-text "Other reasons" entry |
| `rpa_stage_email_templates` | Maps stage × outcome → an `rpa_email_templates` row |
| `rpa_candidate_pipeline` | One row per candidate-per-MRF journey; partial unique indexes prevent duplicate no-MRF journeys while still allowing two concurrent MRF journeys per candidate (Q13) |
| `rpa_pipeline_stage_events` | Append-only audit trail: every stage entry/outcome/note/skip |

## Also included in the DDL

- **`rpa_email_templates.category` CHECK constraint extended** to add `'stage_outcome'` — required before seeding any per-stage-outcome templates (flagged as a pre-flight risk in `03-DEVELOPMENT-PLAN.md`).
- **Confirmed, no DDL needed:** `rpa_shortlisted_candidates.pipeline_status` is a plain `VARCHAR(50)` with no CHECK constraint in the current staging DB — the planned `future_prospect` value can be written immediately, unlike the cautious pre-flight note in `03-DEVELOPMENT-PLAN.md` assumed.

## After this lands

Next steps (per `docs/phase3/ZEKO-GAP-ANALYSIS.md` Step 6):
- `backend/prisma/seed-pipeline-stages.js` — seeds the 12 stages + default outcomes + Stage 0 reason taxonomy
- `backend/src/config/pipelineStages.js` — STAGE_KEYS / STAGE_OUTCOMES constants
- `backend/src/services/pipeline.service.js`, `stageNotification.service.js`
- `backend/src/controllers/pipeline.controller.js`, `backend/src/routes/pipeline.routes.js` (mounted at `/api/pipeline`)
- `recruitment_pipeline` module key in `backend/src/config/roles.js`
