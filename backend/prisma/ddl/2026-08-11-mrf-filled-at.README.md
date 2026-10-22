# Requisition `filled_at` — DDL Apply Instructions

**File:** `2026-08-11-mrf-filled-at.sql`
**Do not hand-edit `schema.prisma`** — per `docs/reference/VENDOR_PROCESS.md` §13, this repo always introspects the live DB.

## What this changes and why

Closure used to express "all openings filled" by overwriting two status columns
that mean something else, keeping no record of what they held before:

| Column | Was overwritten to | Restored on re-open as | Problem |
|---|---|---|---|
| `rpa_mrf.approval_status` | `'closed'` | hardcoded `'approved'` | `'completed'` is the most common real status, and `getApprovedRoles()` gates it on `approved_by_abhijit`. A `completed` requisition that filled and re-opened came back as `'approved'`, permanently escaping that gate. |
| `rpa_mrf_jd_send.mrfstatus` | `'closed'` | hardcoded `'approved'` | That is the protected "raise status" workflow column the MRF page filters, displays and exports. The write was an `updateMany` on a loose non-FK `mrf_id`, so one requisition could rewrite dozens of unrelated request rows. |

After this change, the closure path writes **only** `rpa_mrf.filled_at`.
Neither status column is touched again.

## Steps to apply

1. **Check for already-corrupted rows first.** For any row returned here, the
   original `approval_status` is **unrecoverable** — it was destroyed at
   closure time:
   ```sql
   SELECT id, position_hiring_for, approval_status FROM rpa_mrf WHERE approval_status = 'closed';
   SELECT mrf_id, COUNT(*), string_agg(DISTINCT mrfstatus, ', ')
     FROM rpa_mrf_jd_send WHERE mrfstatus = 'closed' GROUP BY mrf_id;
   ```
   Both return **0 rows** in development as of 2026-08-11. If staging or
   production returns rows, note them before step 2 — someone who knows the
   requisition has to set the right status by hand afterwards (see
   *Post-apply* below).

2. Run the SQL against the database:
   ```
   psql "$DATABASE_URL" -f backend/prisma/ddl/2026-08-11-mrf-filled-at.sql
   ```
   Additive and idempotent — safe to re-run.

3. Stop the backend (and the queue worker — both hold the Prisma query
   engine), then re-introspect and regenerate:
   ```
   cd backend
   npx prisma db pull
   npx prisma generate
   ```

4. Restart the backend. Confirm `filled_at` appears on the `rpa_mrf` model in
   `schema.prisma`.

## Post-apply — rows the backfill could not fully repair

The backfill sets `filled_at` for pre-existing `approval_status='closed'`
rows so they behave correctly going forward, but **deliberately leaves
`approval_status = 'closed'`**. Guessing between `'approved'` and
`'completed'` would repeat the very mistake this change removes.

Those requisitions stay out of JD filtering (the whitelist only accepts
`'approved'`/`'completed'`), which is safe but may be wrong if the role is
genuinely still hiring. For each row found in step 1, someone who knows the
requisition should set the correct status manually:

```sql
UPDATE rpa_mrf SET approval_status = 'approved'   -- or 'completed'
 WHERE id = <id>;
```

Same applies to any `rpa_mrf_jd_send.mrfstatus = 'closed'` rows — their prior
raise-status (`pendingfromleader` / `managersubmitted` / …) is likewise gone.

## Rollback

The column is additive and nothing reads it before the code change ships, so
rolling back the code is enough. To remove the column entirely:

```sql
DROP INDEX IF EXISTS idx_rpa_mrf_open;
ALTER TABLE rpa_mrf DROP COLUMN IF EXISTS filled_at;
```

Note this loses the fill state; requisitions filled after the change would
appear to be hiring again until the next offer acceptance re-closes them.
