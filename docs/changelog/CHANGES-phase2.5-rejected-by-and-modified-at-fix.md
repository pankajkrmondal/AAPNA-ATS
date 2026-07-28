# Phase 2.5 — Rejection Cooldown Bug Fix + "Rejected By X on Y"

Follow-on to `CHANGES-phase2.4-unlimited-search-and-visible-shortlisted-by.md`,
triggered by the user reporting rejected candidates still appearing in JD-tab
search results.

1. **Root cause found and fixed: `updateCandidateStatus()` never bumped
   `modified_at`.** This is the function behind the Recruitment Analytics
   (Legacy) page's inline Shortlisted/Rejected/On Hold status dropdown — a
   separate path from Candidate Screening's Reject flow. `rpa_shortlisted_candidates.modified_at`
   is a plain `@default(now())` column, **not** a Prisma `@updatedAt` field, so
   it only auto-populates on row creation — any `.update()` call must set it
   explicitly or it silently keeps whatever value the row already had.
   `rejectCandidates()` (Screening's Reject flow) already did this correctly;
   `updateCandidateStatus()` did not — it only wrote `{ pipeline_status: status }`.
   Since the Phase 2.3/2.4 rejection-cooldown exclusion checks `modified_at`
   (not just `pipeline_status`) to decide whether a rejection is still "recent
   enough" to hide, any candidate rejected via the Analytics page kept
   whatever stale timestamp their row already had (often from when they were
   originally shortlisted, sometimes months old) — so the cooldown check
   (`modified_at > cutoff`) evaluated false immediately, and they never got
   excluded at all. Fixed by adding `modified_at: new Date()` to that
   function's update call (`backend/src/services/screening.service.js`).

   **One-time data backfill, then reverted per direction**: ran a script
   resetting `modified_at` to now on the 17 currently-rejected rows affected
   by this bug (confirmed via live query — e.g. one row's `modified_at` was
   from `2026-04-10`, over 3 months stale). After review, reverted all 17 rows
   back to their original timestamps (preserved from the backfill script's own
   printed log before it ran) — **the underlying code fix above stays in
   place**, only the retroactive data touch-up was undone. No script files
   were kept in the repo (both were one-off, run from a temporary `backend/scratch/`
   directory and deleted immediately after use).

2. **Also fixed the identical bug in `rejectCandidates()`'s own update path**
   — found while auditing for the same class of issue. When rejecting a
   candidate who already has an `rpa_shortlisted_candidates` row (e.g.
   previously shortlisted, now being rejected), the function correctly bumped
   `modified_at`, but did **not** refresh `shortlisted_by`/`shortlisted_at` —
   so those columns (which double as the generic "who/when the last decision
   was made" fields for both shortlist and reject, not just shortlist —
   there's no separate `rejected_by`/`rejected_at` column on this table) kept
   showing the *original shortlister's* name/date instead of whoever actually
   rejected them. Fixed by refreshing both fields on this update path too,
   matching what the create path (and `shortlistCandidates()`'s own
   undo-reject path, fixed earlier this session) already did correctly.

3. **New: "Rejected by X on Y"**, mirroring "Shortlisted by X on Y" from
   Phase 2.3. Since the DB only has one pair of by/at columns shared by both
   decisions, the API now exposes them under decision-specific names —
   `rejected_by`/`rejected_at` — resolved the same way `shortlisted_by`/`shortlisted_at`
   already were: a second `LEFT JOIN LATERAL` (scoped to the searched MRF on
   the JD tab; unscoped — most recent regardless of role — on the Keyword
   tab's vector path, matching the shortlisted lookup's existing scoping
   choice) for the two raw-SQL search paths, and a second batch lookup
   (`pipeline_status: 'rejected'`) for the no-keyword Prisma path. Displayed
   in the same two places as the shortlisted version: a plain (no-hover) text
   line on the Candidate Screening result card, and "Rejected By"/"Rejected
   On" rows in the candidate detail drawer's System Status card — both
   conditional on `rejected_by` being present, so they only show for
   candidates who actually reappear in results after their cooldown lapses or
   under a different role.

**Files touched**: `backend/src/services/screening.service.js`,
`frontend/src/pages/CandidateScreening.jsx`.

No schema/migration changes — reuses the existing `shortlisted_by`/`shortlisted_at`
columns, just exposed under a second name when `pipeline_status = 'rejected'`.

**Verification**: Modified backend file passes `node --check`; backend
confirmed healthy (`GET /api/health` → 200) after each edit; frontend dev
server compiled cleanly. The backfill-then-revert was verified directly
against the database (each script printed the exact rows/timestamps it
touched, both before and after). Full manual verification (reject a
previously-shortlisted candidate and confirm "Rejected by" shows the current
user, not the original shortlister; confirm a candidate rejected via the
Analytics page's status dropdown is now properly excluded from JD-tab results
for 90 days from *today*, not from whatever their row's old timestamp was) is
pending — being done live against the running dev stack rather than replayed
here.
