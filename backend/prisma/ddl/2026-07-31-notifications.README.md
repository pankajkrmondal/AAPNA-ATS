# Notification Centre — DDL Apply Instructions

**File:** `2026-07-31-notifications.sql`
**Do not hand-edit `schema.prisma`** — per `docs/reference/VENDOR_PROCESS.md` §13, this repo always introspects the live DB.

## Steps to apply

1. Run the SQL against the database:
   ```
   psql "$DATABASE_URL" -f backend/prisma/ddl/2026-07-31-notifications.sql
   ```
   Additive and idempotent — safe to re-run.

2. Stop the backend (and the queue worker — both hold the Prisma query engine
   DLL on Windows), then introspect + regenerate:
   ```
   cd backend
   npx prisma db pull
   npx prisma generate
   ```

3. Restart the backend. Until steps 1–2 are done, `/api/notifications` returns
   errors and no notification is written — but **nothing else breaks**:
   `notify()` swallows its own failures by design, so every business action it
   hangs off (recording an outcome, verifying a document, accepting an offer)
   still succeeds.

## New table

| Table | Purpose |
|---|---|
| `rpa_notifications` | One row per recipient per event — the recruitment team's in-app inbox. |

## Why fan-out on write

One row per recipient, not one event row plus a read-state join table. The
recruitment team is a handful of users, so duplicating a short text row keeps
every read a plain `WHERE user_id = $1` with no join, and marking one read is a
single `UPDATE`. Revisit only if the team grows into the hundreds.

## What this replaces

The header bell was **in-memory only**: notifications lived in one browser tab's
React state, vanished on refresh, and never reached a recruiter who was logged
out when the event fired. The Phase 3 plan deferred a persistent centre
("minimal bell in Module 1"); this is that centre, built now instead.

## Event types written today

`pipeline.outcome`, `pipeline.closure`, `interview.awaiting_feedback`,
`interview.feedback_received`, `interview.no_show`, `interview.confirm_needed`,
`document.uploaded`, `document.all_verified`, `offer.approval_requested`,
`offer.decision`, `mrf.closed`, `assessment.import_done`,
`assessment.deadline_expired`, `review.new`.

`type` is free text with no CHECK constraint, so adding an event is a code
change and never a migration.

## Recipients

Resolved by role: `recruiter`, `hr`, `admin`, `superadmin` — the same list
`uploadJob.service.js` already uses for duplicate-review alerts. **Vendors never
receive a notification.** Users must be active and approved; company-scoped
users only see events from their own company, while superadmins see all.

## Retention

No pruning job. The inbox query is capped by `limit`, so rows accumulate
harmlessly; add a retention sweep only if the table becomes large in practice.
