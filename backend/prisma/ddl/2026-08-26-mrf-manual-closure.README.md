# Requisition manual closure — DDL Apply Instructions

**File:** `2026-08-26-mrf-manual-closure.sql`
**Do not hand-edit `schema.prisma`** — per `docs/reference/VENDOR_PROCESS.md` §13, this repo always
introspects the live DB.

## What this changes and why

A requisition cancelled by the **business** — budget pulled, role withdrawn, filled externally — had
no representation in the system at all. It stayed open in the JD dropdown forever, and there was no
column anywhere on `rpa_mrf` recording *why* a requisition closed, so even the automatic
offer-acceptance closure recorded **when** but never **why**.

Logged as [PHASE3-CLOSURE-AUDIT-2026-08-26.md](../../../docs/PHASE3-CLOSURE-AUDIT-2026-08-26.md)
§2.6, filed as **Q34**, answered *"yes — action + reason"*.

| Column | Type | Meaning |
|---|---|---|
| `closed_at` | `TIMESTAMPTZ NULL` | When a **human** closed this requisition. `NULL` = not manually closed. |
| `closure_reason` | `VARCHAR(50) NULL` | Why it closed. Written by **both** paths. |
| `closure_note` | `TEXT NULL` | Free text; required when `closure_reason = 'other'`. |

### Why not reuse `filled_at`

A cancelled requisition was **not filled**, and `filled_at`'s column comment says exactly that. Two
further reasons make separate columns safer:

1. **`reopenMrfIfUnfilled()` clears only `filled_at`.** With a separate `closed_at`, a candidate
   backing out can never silently resurrect a requisition the business deliberately cancelled.
   Merging the two would need a new guard to get that invariant back.
2. **"Openings Filled: YES/NO"** (`mrfDetail.export.js`) stays truthful, because `isMrfFilled()`
   keeps meaning what its name says. The wider *"is this still hiring?"* question moves to the new
   `isMrfClosed()`.

## ⚠️ The trap this column shares with `filled_at`

`isMrfClosed()` reads `closed_at` off whatever row it is handed. **Any `select:` that omits the
column makes it read `undefined` and return `false`** — a closed requisition silently reappears in
JD filtering, with no error. `mrf.export.js` already carries a comment warning about exactly this for
`filled_at`; that warning now covers both.

Every one of these must select `closed_at`:

- `controllers/mrf.controller.js` (two places)
- `exports/mrf.export.js`, `exports/mrfDetail.export.js`
- `services/mrfClosure.service.js` (close + re-open)
- `services/pipeline.service.js` (the board card's `mrf_closed`)

And `getApprovedRoles()` in `services/screening.service.js` is **raw SQL** — it needs
`AND closed_at IS NULL` beside its existing `AND filled_at IS NULL`. **That is the line that
actually removes the role from the JD dropdown.**

## Steps to apply

1. **Look at what exists first.** The backfill only touches rows that are already filled:
   ```sql
   SELECT count(*) FROM rpa_mrf WHERE filled_at IS NOT NULL;  -- will get closure_reason
   SELECT count(*) FROM rpa_mrf WHERE closed_at IS NOT NULL;  -- expect 0 (column is new)
   ```
2. **Apply the DDL:**
   ```bash
   psql "$DATABASE_URL" -f backend/prisma/ddl/2026-08-26-mrf-manual-closure.sql
   ```
3. **Re-introspect and regenerate:**
   ```bash
   cd backend && npx prisma db pull && npx prisma generate
   ```
4. **Confirm the three columns and the widened index landed:**
   ```sql
   SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_name = 'rpa_mrf' AND column_name IN ('closed_at','closure_reason','closure_note');
   SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_rpa_mrf_open';
   -- expect: ... WHERE ((filled_at IS NULL) AND (closed_at IS NULL))
   ```
5. **Confirm the backfill:** every filled requisition now has a reason, and none has been marked
   manually closed.
   ```sql
   SELECT closure_reason, count(*) FROM rpa_mrf WHERE filled_at IS NOT NULL GROUP BY 1;
   -- expect: all_openings_filled | <n>
   SELECT count(*) FROM rpa_mrf WHERE closed_at IS NOT NULL;  -- still 0
   ```

## What is deliberately NOT done

- **No CHECK constraint / enum on `closure_reason`.** Every other status column in this schema is a
  plain `VARCHAR`. A CHECK is what turns "add a reason" into a migration; the vocabulary lives in
  `config/pipelineStages.js` and is validated in the service.
- **`closed_at` is not backfilled.** Existing rows were *filled*, not manually closed. Conflating
  the two would make `isMrfFilled()` and `isMrfClosed()` indistinguishable on precisely the rows
  that prove they differ.
- **`approval_status` and `mrfstatus` are never written.** Expressing closure by overwriting those
  is the lossy bug removed on 2026-08-11 — see
  [`2026-08-11-mrf-filled-at.README.md`](./2026-08-11-mrf-filled-at.README.md). The MRF page's
  status `Select` stays `disabled`; manual closure gets its own action.

## Rollback

Additive and non-destructive, so rollback is only needed if the feature is abandoned:

```sql
DROP INDEX IF EXISTS idx_rpa_mrf_open;
CREATE INDEX IF NOT EXISTS idx_rpa_mrf_open ON rpa_mrf (id) WHERE filled_at IS NULL;
ALTER TABLE rpa_mrf DROP COLUMN IF EXISTS closure_note;
ALTER TABLE rpa_mrf DROP COLUMN IF EXISTS closure_reason;
ALTER TABLE rpa_mrf DROP COLUMN IF EXISTS closed_at;
```

Then `npx prisma db pull && npx prisma generate` again.
