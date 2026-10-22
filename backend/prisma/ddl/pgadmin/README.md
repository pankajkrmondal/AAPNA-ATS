# pgAdmin deployment scripts

Paste-and-run versions of the production migration, for when you have **pgAdmin but no
`psql`**. The runbook's `for f in *.sql` loop needs a shell; these do not.

Full context and the reasoning behind every change:
[docs/phase3/STAGING-TO-PRODUCTION-DB-AND-ONEDRIVE-PLAN.md](../../../../docs/phase3/STAGING-TO-PRODUCTION-DB-AND-ONEDRIVE-PLAN.md)

## Run order

| # | File | Writes? | What it does |
|---|---|---|---|
| 1 | `00-preflight.sql` | read-only¹ | Confirms you are on production, shows **exactly how many rows step 3 will delete**, checks nothing will be rejected |
| 2 | `01-ddl-all.sql` | yes | All 23 feature DDL files concatenated in order. Creates the 21 Phase-3 tables |
| 3 | [`../2026-09-09-prod-parity-backfill.sql`](../2026-09-09-prod-parity-backfill.sql) | **yes — deletes rows** | The drift no DDL file covers. **Needs sign-off (plan §D-1)** |
| 4 | `03-settings.sql` | yes | The 8 `rpa_settings` rows that no script seeds |
| 5 | *(seed scripts)* | yes | `npm run seed:stages:prod`, `seed:documents:prod`, then the template seed — these need a terminal, not pgAdmin |
| 6 | `04-verify.sql` | read-only | Proves the whole thing landed |

¹ except its last block, which copies `rpa_email_templates` and `rpa_settings` into an
`ats_backup` schema. That is a safety net, **not** a substitute for the `pg_dump` in the
runbook — it lives in the same database and dies with it.

## Using them in pgAdmin

1. Check the Query Tool title bar reads **`recruitmentautomationdbProd/appuser@RPA`**.
   `recruitmentautomationdb` (no `Prod`) is staging.
2. Open the file with the folder icon, or paste the whole thing in.
3. Press **F5** once. The entire buffer runs — you do not select anything.
4. Watch the **Messages** tab, not Data Output. Success ends in `COMMIT`.

`00-preflight.sql` and `04-verify.sql` return result grids. pgAdmin only shows the grid for
the *last* statement, so for those two, **highlight one numbered block at a time** and press F5.

### Things that look like problems but are not

- `NOTICE: relation "..." already exists, skipping` — expected. Every script is idempotent.
- `NOTICE: PASS: duplicate re-insert rejected` in `04-verify.sql` — that is the **success**
  message. It means the constraint is doing its job.

### If a script errors

`01`, `03` and the parity script each run inside a single `BEGIN … COMMIT`. An error rolls the
whole thing back, so production is left exactly as it was — there is no half-applied state to
untangle. Fix the cause and run the file again from the top.

## Rehearsal

Every script here was replayed end-to-end on 2026-09-09/10 against a throwaway PostgreSQL 18.6
cluster restored from a **read-only** `pg_dump --schema-only` of production, with synthetic data
reproducing production's duplicate and orphan conditions. All 23 DDL files applied with zero
failures; the parity script produced the intended result; re-running every script was a clean
no-op. Production was never written to.

## Regenerating `01-ddl-all.sql`

It is a generated concatenation — do not hand-edit it. If a new DDL file is added, rebuild it
by concatenating `backend/prisma/ddl/*.sql` in filename order, excluding
`2026-09-09-prod-parity-backfill.sql`, wrapped in one `BEGIN; … COMMIT;`.
