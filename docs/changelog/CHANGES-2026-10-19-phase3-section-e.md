# Phase 3 "Do Now", section E: labels & legends, dashboard fixes, Positions tab, recency filter

**Date:** 19 Oct 2026 · **Plan:** [PLAN-Phase3-Now.md](../Phase%203%20Enhancements%20or%20Feedback/PLAN-Phase3-Now.md) §4.E.
**Items:** N35, N36, N39, N38. **N37 is on hold** until Chhaya agrees what "qualified" means (decision 19 Oct). This completes section E in code, except N37.
**Status:**
- **Tested on 19 Oct against the staging database** (local backend and frontend; results under "Tests"):
  - unit tests pass and the frontend builds;
  - the dashboard-vs-Analytics cross-check is all "OK";
  - the JD integration test passes 13/13;
  - the screen checks pass (one skipped: no interviews booked in the next 7 days).
- **No email was sent during testing** (none at all, so none to saukumar@).
- **Not done:** nothing is deployed to staging and nothing is committed. Production goes once, at the end, with the other sections.

**Decisions (19 Oct):**
- **N35:** use the proposed wording now, all in one file (`frontend/src/constants/pipelineLabels.js`). RT confirms it at the walkthrough.
- **N37:** on hold.
- **N36 and N37 without JD tagging:** section B (N13) isn't built, so a candidate isn't linked to an MRF before shortlisting. Until it is, "candidates added for this MRF" and "top roles" match on the candidate's typed "Position Applied", and the tooltips say so.

---

## What changed, by item

### N35 · Labels & legends
**What users see**
- **Pipeline cards say where the candidate is:**

  | Was | Now | Where |
  |---|---|---|
  | In progress | **Not yet invited** | Zeko rounds |
  | In progress | **Not yet scheduled** | Interview rounds |
  | In progress | **Awaiting action** | Documents, offer |
  | Invited | **Zeko link sent** | Zeko rounds |
  | Ready for decision | **Awaiting decision** | |
  | Evalground test pending | **Test not sent** / **Test sent · due 22 Oct 2026** / **Test overdue** (red) | Assessment round |

  Every chip explains itself on hover.
- **Legend:** a "What do these mean?" button on the board header lists every card label and every stage with a one-line meaning. Column headings show the stage's meaning on hover. The progress bar's hover reads "In stage: done · Invited / booked: now · …" instead of "Invite: done · Awaiting: active".
- **Drawer:** it uses the same words: "Awaiting decision", "In this stage" (was the raw `in_progress`), and "Test sent — waiting for the candidate to take it".
- **Screening chips:** keyword search on the old path (SCREENING_V2 off) now counts Strong / Moderate / Weak by stars, as V2 already did. A 4-star candidate used to count as "Moderate". Both tabs use one wording: "Excellent / Strong / Moderate / Weak / Poor match". Each chip explains its band on hover.
- **Upload statuses:** HR Upload and the Vendor portal share one status list (`frontend/src/constants/uploadStatus.jsx`), with clearer hover text.
- **MRF page:** "Manager submitted" is one word in the list and the drawer (the drawer used to say "COMPLETED"). Every raise and approval status has hover text.
- **Vendor dashboard:** the KPI cards show their ⓘ explanations (the definitions existed but were never wired). Status tags say which tile they count under.

**How**
- `listPipeline` adds `assessment_invite_sent_at`, `assessment_due_at` and `assessment_overdue` to assessment-stage cards. They come from one batched read of `rpa_assessment_invites`, newest first per journey.
- The overdue rule moved into `backend/src/utils/assessmentInviteState.js`, and `getInviteState` (drawer) and the board both use it, so they can't disagree. A withdrawn invite reads as "Test not sent".

**Different from the plan**
- **"Weak" chip kept:** the plan said to drop it as always 0. On V2 it can be non-zero, so it stays, with hover text.
- **Two labels added:** "Not yet scheduled" and "Awaiting action". The plan only had "Not yet invited", which would be wrong on interview, document and offer stages.

### N36 · Dashboard fixes
**What users see**
- **Server counts:** the charts, Talent Insights and the KPI sparklines count every candidate in the period. They used to sample the newest 200.
- **India time:** days are India-time days, and "Today's uploads" starts at IST midnight (was the server's midnight).
- **Shortlisted** = candidates in the pipeline now (open journeys), the same count as the board. With an MRF picked, only that MRF. The footnote shows the shortlist rate for the period.
- **Shortlist rate** = entered the pipeline in the period ÷ added in the period.
- **Funnel:** the stage is renamed "Entered pipeline" (every journey ever). **Hired** = closed as approved or joined, the Analytics rule. Time-to-hire now shows; it used to need dates the Zeko list never had.
- **Active MRFs** no longer counts MRFs closed by the business (`closed_at`).
- **Role filter → MRF filter:** the old drop-down only ever said "All roles", because it read a field the API never sent. It now lists open MRFs as Screening does (role · MRF-41 · date · Latest).
- **Upcoming Interviews:** shows Zeko and Teams interviews, marked by type. A row opens that candidate's drawer on the board (`/pipeline?candidate=<id>`); it used to open Analytics. "View all" opens the board.
- **Recent uploads:** a row opens the candidate's own page, with "Back to Dashboard". Undated legacy rows no longer sort to the top.
- **Definitions note:** a dismissible "Dashboard definitions updated on 19 Oct 2026" note shows for 14 days. All ⓘ definitions were rewritten to match.

**How**
- `GET /api/dashboard/stats?range=&mrfId=` now returns `hired`, `mrf`, `period { added, enteredPipeline, shortlistRate }` and `timeToHireDays`.
- New endpoints, staff only (they name candidates):
  - `GET /api/dashboard/trends?range=7|30|90&mrfId=` (daily series and top roles / skills, in SQL)
  - `GET /api/dashboard/upcoming-interviews?days=7`
  - `GET /api/dashboard/mrf-options` (the Screening MRF list without the Screening module check, so everyone who can see the dashboard gets the filter)
- The counting rules are in `backend/src/utils/dashboardMetrics.js` (pure, unit-tested).
- The dashboard no longer calls `/candidates`, `/mrf?status=pending` or `/screening/analytics/pipeline`.

**Time zones (assumption to check on staging):** `rpa_cv."createdAt"` and `rpa_mrf.created_at` are `timestamp` without a zone. They are read as UTC (`AT TIME ZONE 'UTC'`), which is how Prisma writes them and how the app already displays them. If staging counts look a day off around midnight, check this first.

### N39 · Analytics: Positions tab
**What users see**
- **One row per MRF.** Columns:
  - position, MRF reference and status (Open / Paused / Filled / Closed)
  - opened, days open (stops at closure) and openings
  - shortlisted and moved forward (past the first stage)
  - one "reached" column per stage
  - offers, accepted, joined and joining ratio (joined ÷ accepted; "–" with no acceptances)
  - closed date and reason
- **Controls:** sortable columns, an Open / Closed / All filter and a CSV export. Clicking a row opens that MRF's funnel on Pipeline Insights.
- **Which MRFs:** every approved MRF (open or closed), plus any MRF with candidates in the pipeline.

**How**
- `positionsOverview()` and `positionStatus()` in `backend/src/services/pipelineAnalytics.helpers.js` (pure). They use the same arrival rule as the funnel, so a skipped optional stage isn't counted as reached.
- Endpoints: `GET /api/pipeline/analytics/positions` and `GET /api/pipeline/analytics/positions/export?status=`, behind the Recruitment Pipeline module.
- The CSV has one column per active stage (`backend/src/exports/positions.export.js`).
- "Joined" counts `joined` and `joined_and_left`. "Hired" (the Analytics rule) is in the CSV too.

### N38 · Recency filter
**What users see**
- **Keyword tab:** "Added within" gains **10 days**. The options are now 7 / 10 / 15 days, 1 month, 3 months.
- **JD tab:** gets the same filter next to "Include closed MRFs". The summary line says "only candidates added in the last N days". The CSV export uses the same filter.
- **Undated candidates:** left out while a window is set, as on the keyword tab.

**How**
- The JD controller passes `addedWithinDays`. V2 adds the existing `addedWithin` SQL condition to its cheap gates, and the old search adds `$6`.
- Each offered value has its own cache key (`screening:role[:v2]:<mrf>:d<days>`), and other values aren't cached (`backend/src/utils/screeningCacheKeys.js`).
- MRF edit and close now delete every variant (`allRoleCacheKeys`). Candidate edits already cleared `screening:role:*`.
- The plan's "bump the screening cache version" isn't needed: the unfiltered keys are unchanged.

### Also fixed: GET /api/mrf/:id always failed (from section A)
Section A (commit `4227049`, 14 Oct) put one line, "clear the JD cache after a budget edit", in the wrong handler: `getMrfRequest`, which has no `updated` variable. That caused two bugs:
- **Reading any MRF request failed.** The MRF page's refresh after a closure swallowed the error, so nobody saw it.
- **Edited budgets didn't refresh JD screening.** Editing a request's budget never cleared the cached results.

The line now sits in `updateMrfRequest`. A lint pass for undefined names over every file touched in this section found it.

---

## Tests
**Unit (`node:test`), all passing:**

| File | Result |
|---|---|
| `unit/assessmentInviteState.test.js` | 6 new |
| `unit/dashboardMetrics.test.js` | 8 new |
| `unit/screeningCacheKeys.test.js` | 4 new |
| `unit/screeningFilters.test.js` | 61, 1 new (10 days, and the JD reuse of the SQL condition) |
| `pipelineAnalytics.test.js` | 29, 6 new (positions grouping, joining ratio, no-event fallback, MRF with no candidates, status, CSV) |

Every other unit file also passes when run on its own (41 files, 810 tests in all).

**Known:** `npm run test:unit` hangs, because its glob also picks up `src/tests/integration/*` (Redis). Run unit files one at a time, or fix the glob separately.

**Lint:** `no-undef` is clean on every file touched, and every JSX component name is declared.

**Frontend:** `npm run build` passes.

**Staging run, 19 Oct** (local backend in development mode and Vite, both on the staging database; mail redirect confirmed on before each step):

- **Dashboard vs Analytics** (`NODE_ENV=staging node scripts/check-dashboard-vs-analytics.mjs`): every line "OK" for 30, 90 and 7 days, and for MRF-686.

  | Check | 30 days | 90 days | 7 days | MRF-686 |
  |---|---|---|---|---|
  | Hired | 2 = 2 | 2 = 2 | 2 = 2 | 2 = 2 |
  | Entered pipeline | 33 = 33 | 33 = 33 | 33 = 33 | 33 = 33 |
  | Shortlisted, open (vs board) | 29 = 29 | 29 = 29 | 29 = 29 | 7 = 7 |
  | Time-to-hire, median days | 0.1 = 0.1 | 0.1 = 0.1 | 0.1 = 0.1 | 0.1 = 0.1 |
  | Added in the period | 13 = 13 | 44 = 44 | 7 = 7 | 7 = 7 |

  The India-time count of candidates added equals a plain count over the same window, which confirms the UTC reading of `createdAt`.
- **Fixed while testing:** time-to-hire under a day showed "0d". It now shows "<1d", with "less than a day" in the hover (`ConversionFunnelCard.jsx`).
- **`jdGates.test.js`:** 13/13, including the new N38 case (a 15-day window drops the candidate added 20 days ago; 30 days keeps them).
- **Screens:** new view-only spec `frontend/e2e/section-e.spec.js`, 7 passed, 1 skipped.

  | Check | Result |
  |---|---|
  | Board labels, hover text and legend | Pass (no old labels anywhere) |
  | Assessment cards vs the drawer's invite state | Pass |
  | Dashboard: 7 / 30 / 90 days, MRF filter, definitions note | Pass |
  | Recent upload opens the candidate, with "Back to Dashboard" | Pass |
  | Positions: rows, sort, All filter, CSV download, row opens the funnel | Pass |
  | JD "Added within": 5 options; 15 days is sent; summary says "only candidates added in the last 15 days" | Pass |
  | Keyword "Last 10 days" | Pass |
  | Upcoming interview opens the board | Skipped: none booked in the next 7 days on staging |

- **Email check after the run:**
  - `rpa_email_log` and `rpa_email_messages` have no rows since testing began, so nothing was sent;
  - `rpa_notifications` has 4 (in-app only), none for saukumar@;
  - the recipient settings are unchanged.

## To clean up before production (found 19 Oct, not changed)
- Three staging settings still list saukumar@: `email_recipients.mrfApproval.to`, `email_recipients.mrfSubmitHrNotify.to` and `email_recipients.mrfOutcome.to`.
  - Section D thought these were removed on 16 Oct; something has written them back.
  - Harmless on staging, because the mail redirect replaces them. Check that the production values are right before the final release.

## Staging steps (dev → staging)
1. **No DDL** and no Prisma change. No settings SQL.
2. **Deploy.** Then run the cross-check script and the JD integration file above, and do the screen checks.
3. **Tell RT:**
   - the new board labels and the "What do these mean?" button
   - why the dashboard numbers changed (the note on the page says it too)
   - the Positions tab
   - "Added within" on JD screening

## Final production release (add to the single list)
- Deploy.
- In `frontend/src/components/dashboard/DefinitionsUpdatedNote.jsx`, set `DEFINITIONS_UPDATED_ON` to the production release date (it shows for 14 days from that date).
- Run `NODE_ENV=production node scripts/check-dashboard-vs-analytics.mjs` (read-only).
- RT briefing on the labels.

## Rollback
- **Code only:** rolling back the build is enough. Nothing is written by these changes apart from Redis cache entries, which expire within an hour.
