# Offer Management (Module 5) — DDL Apply Instructions

**File:** `2026-07-29-offer-management.sql`
**Do not hand-edit `schema.prisma`** — per `docs/reference/VENDOR_PROCESS.md` §13, this repo always introspects the live DB.

## Steps to apply

1. Run the SQL against the database:
   ```
   psql "$DATABASE_URL" -f backend/prisma/ddl/2026-07-29-offer-management.sql
   ```
   Additive and idempotent — safe to re-run.

2. Stop the backend (and the queue worker — both hold the Prisma query engine
   DLL on Windows), then introspect + regenerate:
   ```
   cd backend
   npx prisma db pull
   npx prisma generate
   ```

3. Restart the backend. Until steps 1–2 are done, every `/api/pipeline/:id/offer/*`
   endpoint fails, and the drawer's Offer round shows no offer state — the
   Prisma client doesn't yet know `rpa_offers`.

## New table

| Table | Purpose |
|---|---|
| `rpa_offers` | One row per journey: internal approval state, the date HR shared the offer, the proposed joining date, and the candidate's accept/reject. |

**No letter is stored.** RT confirmed (2026-07-14) appointment/offer letters stay
entirely outside the ATS — HR prepares and sends them from their own mailbox, so
there is deliberately no `offer_letter_url` or file column.

## What this unlocks

- **Offer round action bar** (`OfferActions` in `PipelineDrawer.jsx`) — replaces
  the generic Approve/Reject/Hold buttons on the Offer stage only:
  request internal approval → mark approved → record offer shared → mark
  accepted/rejected → close candidate record.
- **Closure UI** — the 8 final statuses (Q12) wired to the already-existing
  `POST /api/pipeline/:id/closure`, which until now had no caller in the UI.
- **`jobs/offerSweep.js`** (daily, `OFFER_SWEEP_CRON`, default `0 7 * * *`):
  - approval nudge — one email per day while an offer is awaiting sign-off (Q26),
  - post-joining auto-close — closes a joined record `OFFER_AUTO_CLOSE_AFTER_DAYS`
    (default 90) days after the joining date, unless the recruiter already closed
    it (e.g. as Joined and Left), which always wins (Q12).

## Soft gate, deliberately

`recordOfferShared()` does **not** require approval first (Q26): recording an
offer that went out without the approval step is allowed for exceptional cases,
and the skipped approval is written to the journey's audit trail rather than
blocking the action.

## Optional email template

The approval nudge falls back to a built-in body, but HR can override the copy by
adding an `rpa_email_templates` row named **"Offer Approval Reminder"**
(placeholders: `{{candidate_name}}`, `{{position}}`, `{{waiting_days}}`,
`{{pipeline_link}}`). No seeder change is required for the job to work.
