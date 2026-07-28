# Phase 2.3 — Rejection Cooldown, Shortlisted-By Display, Recruiter Dashboard

Follow-on to `CHANGES-phase2.2-screening-decision-modal-refinements.md`. Three
new, mostly-independent features on the Candidate Screening page + Dashboard.

1. **Time-bound rejection cooldown (flat 90 days)** — The JD tab already
   excluded a candidate from a role's search results forever once rejected for
   that specific role; the Keyword tab had no exclusion at all. Neither is
   right: permanent exclusion means an accidental/reconsidered reject can never
   be undone by re-searching, and the Keyword tab resurfacing recently-rejected
   candidates indefinitely was a real gap. New `backend/src/utils/rejectionCooldown.js`
   defines a single flat `REJECTION_COOLDOWN_DAYS = 90` (tiering by the MRF's
   `required_in` field was considered and explicitly deferred — simple flat
   value for now). `searchRoleCandidates` (JD tab) extends its existing
   per-MRF `NOT EXISTS` exclusion with a `rsc.modified_at > $5` time bound.
   `searchKeywordCandidates` (Keyword tab) gets a new `getRejectionCooldownExcludedCvIds()`
   helper (plain Prisma, no MRF-scoping needed since keyword search isn't
   role-scoped) applied to both its vector-search and no-keyword-filter
   sub-paths. Scoping is preserved exactly as required: a candidate rejected
   for MRF #5 stays fully visible when searching MRF #6; the MRF itself stays
   open/searchable for every other candidate throughout.

2. **"Shortlisted by X on Y" on Candidate Screening** — `rpa_shortlisted_candidates.shortlisted_by`/
   `.shortlisted_at` already existed but weren't surfaced anywhere on this
   page. Both search functions now join the most recent `pipeline_status =
   'shortlisted'` row per candidate (`LEFT JOIN LATERAL` for the two raw-SQL
   paths, a batch Prisma lookup for the no-keyword path) — filtering on
   `pipeline_status = 'shortlisted'` specifically, since `rejectCandidates()`'s
   create path also stamps these fields on a straight-reject row (confirmed
   live) and would otherwise show a bogus "shortlisted by" on a rejected
   candidate. JD tab scopes the join to the searched MRF; Keyword tab shows
   the most recent shortlist regardless of role (it isn't MRF-scoped). Shown
   in two places on `CandidateScreening.jsx`: a tooltip icon next to the
   result-card status badge, and two new rows ("Shortlisted By" / "Shortlisted
   On") in the candidate detail drawer's System Status card. Also patched the
   optimistic UI update in `handleDecisionConfirm` so a fresh shortlist shows
   the correct by/on immediately, without waiting for a refetch.

   **Known limitation, not fixed this pass**: `selectedCandidate` (the open
   drawer's data) is a plain snapshot set once when the drawer opens, not
   reactively derived from the candidate list — if the drawer happens to be
   open on a candidate who gets shortlisted via the bulk floating-dock action
   at the same time, the drawer won't show the new by/on until closed and
   reopened. Narrow edge case (shortlisting from the dock while that exact
   candidate's drawer is also open); not plumbed through since it wasn't part
   of the ask.

3. **Dashboard: candidates per recruiter (Added vs Tagged)** — New
   `getRecruiterBreakdown()` in `dashboard.service.js`, following the existing
   `groupBy` house style (`candidate.service.js`'s `vendorStatusSummary`):
   "Added" groups `rpa_cv` by `last_action_by` (who uploaded the candidate),
   "Tagged" groups `rpa_shortlisted_candidates` by `shortlisted_by` (who
   shortlisted them to a role, again filtered to `pipeline_status =
   'shortlisted'` for the same reason as item 2). New route `GET
   /api/dashboard/recruiter-breakdown` (optional `?limit=`, default 10). New
   frontend widget `RecruiterBreakdownCard.jsx`, modeled directly on the
   existing `TopRolesSkillsCard` (same `Segmented` toggle + `recharts`
   horizontal bar pattern), wired into `useDashboardData.js` as a 6th parallel
   task and rendered as a new full-width row on the Dashboard. Deliberately
   *not* normalized: `last_action_by` stores an email, `shortlisted_by` stores
   a username, so the same recruiter can appear under two different-looking
   labels across the two breakdowns — called out directly in the widget's UI
   caption rather than silently fixed, since no identity normalization was
   requested.

   **Follow-up A, same item**: live-tested, the "Added" chart's top bar was
   overwhelmingly "Unattributed" (candidates with no `last_action_by`) — traced
   to `hrUpload.service.js` being the *only* place in this backend that ever
   sets `last_action_by`; every other candidate (bulk-imported, or from
   whatever system predates this app — the `rpa_cv` naming implies a prior
   RPA/n8n pipeline) has none, and there's no other field to backfill it from.
   First fix attempt excluded "Unattributed"/blank buckets from the ranked bars
   entirely (with a separate count); reverted per direction — kept as a normal
   bar and added an explanatory hover tooltip instead of hiding real data.

   **Follow-up B, same item — redesigned after further feedback**: two more
   problems surfaced: (1) raw email/username strings ("ywali@aapnainfotech.com")
   are unreadable compared to a real name, and (2) a toggle between two
   *separate* rankings obscured the actual question — whether the same
   recruiter's Added and Tagged counts track together. Rebuilt
   `getRecruiterBreakdown()` to resolve both `last_action_by` (email) and
   `shortlisted_by` (username) against `rpa_users` (matching on `email`/
   `username` respectively) to get a real `first_name + last_name` display
   name and a stable join key (`rpa_users.id`) — that's what lets the two
   counts land on the *same row* for the same person instead of two
   unrelated-looking lists. Values with no matching account (e.g. "Self
   Applied", blank/legacy `last_action_by`) fall back to that raw label. The
   endpoint now returns one flat array (`[{ recruiter, added, tagged }]`)
   instead of `{ added: [...], tagged: [...] }`. The chart-with-toggle UI was
   replaced with a plain sortable `antd` `Table` (Recruiter / Added / Tagged
   columns) — a direct side-by-side comparison answers the "why do we need
   both" question with the data itself, rather than either metric being
   dropped on assumption. `LABEL_EXPLANATIONS` hover tooltip for "Unattributed"/
   "Self Applied" carried over onto the recruiter-name column. The now-unused
   `recharts` bar-chart plumbing and `.dash-chart-tip__note` CSS were removed.

   **Follow-up C, same item**: renamed "Tagged" → "Shortlisted" end-to-end
   (column header, subtitle, tooltip copy, *and* the data field itself —
   `{ recruiter, added, tagged }` → `{ recruiter, added, shortlisted }` in both
   `getRecruiterBreakdown()` and the frontend, not just a display-layer
   relabel). "Tagged" collided with "Tag to Open JD" — the label used for
   picking a role during *both* Shortlist and Reject — so it misleadingly
   implied rejected candidates counted too, when the metric is actually scoped
   to `pipeline_status = 'shortlisted'` only. "Shortlisted" matches the term
   already used everywhere else in the app (the status badge, the "Shortlist
   candidates" modal, the "Shortlisted by X on Y" display built earlier this
   session).

   **Follow-up D, same item**: converted back from the table to a chart, by
   request — now a grouped horizontal bar chart (`recharts`, matching the
   dashboard's existing chart cards) with two bars per recruiter (Added in
   gold, Shortlisted in blue, with a legend), sorted by total exactly as the
   table was. Chart height grows with the row count so nothing scrolls or
   clips. The "Unattributed"/"Self Applied" hover explanation moved from the
   table's row label into the bar tooltip (`.dash-chart-tip__note`, re-added
   after having been removed when the table replaced the original chart).

**Files touched**: `backend/src/utils/rejectionCooldown.js` (new),
`backend/src/services/screening.service.js`, `backend/src/services/dashboard.service.js`,
`backend/src/controllers/dashboard.controller.js`, `backend/src/routes/dashboard.routes.js`,
`frontend/src/components/dashboard/RecruiterBreakdownCard.jsx` (new),
`frontend/src/pages/CandidateScreening.jsx`, `frontend/src/pages/Dashboard.jsx`,
`frontend/src/services/dashboardService.js`, `frontend/src/hooks/useDashboardData.js`,
`frontend/src/theme/index.css` (`.dash-chart-tip__note` style).

No schema/migration changes — `required_in` (unused in the end), `shortlisted_by`,
`shortlisted_at`, and `last_action_by` all already existed.

**Verification**: All modified/new backend files pass `node --check`. Backend
briefly went down mid-session due to an unrelated database connectivity issue
(`Can't reach database server at 20.244.34.176:5432` — external network/DB
availability, not caused by these changes; confirmed via `logs/error.log`
timestamps predating this session's edits) and recovered on its own; confirmed
healthy (`GET /api/health` → 200) after. Frontend dev server compiled all
changes cleanly (no HMR errors). Full manual verification (cooldown expiry
behavior including the backdated-`modified_at` check, shortlisted-by accuracy
across JD vs Keyword tab scoping, dashboard counts cross-checked against raw
SQL `GROUP BY`) is pending — being done live against the running dev stack
rather than replayed here.
