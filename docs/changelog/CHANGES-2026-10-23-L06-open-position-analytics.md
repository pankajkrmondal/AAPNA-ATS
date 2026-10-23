# L06 · Open-position analytics (date range & Total Applied)

**Date:** 22–23 Oct 2026 · **Plan:** `PLAN-Phase3-in-Phase4.md` L06, re-planned with Harish on 22 Oct around open MRFs. The design ("ATS L06 & L07 designs" canvas) was approved with every recommended option: D1–D10 A, Tier 1 (W1–W4) kept, Tier 2 (W5–W8) deferred to L06b.
**Absorbs:** Phase 3 UAT row 15 (per-role Total Applied, Moved Forward and shortlisting ratio, Sanghamitra).
**Sources:**
- CEO, 28 Sep demo: "list of all open positions… how many raw data came in", raw vs qualified.
- Anuj: the journey of a position from open to close, and a daily status.
- Naveen (UAT): 30 / 60 / 365 / all and custom dates, in Analytics.
- Harish, 22 Oct: a Total Applied column, and a last-7-days view of an open role.

**Status:**
- **Tested on 22–23 Oct:**
  - unit tests: all of `tests/unit/` plus `analyticsParams` and `pipelineAnalytics`, 691/691. New files: `openPositions.test.js` 9, `roleSummary.test.js` 3, range cases in `analyticsParams.test.js` 4;
  - services run against the staging database: board, role view, candidates behind a number, Role Summary, the pulse, and Pipeline Insights and the Zeko tiles with and without a range;
  - `scripts/check-dashboard-vs-analytics.mjs`: all OK after moving the applicant helpers;
  - the frontend builds.
- **Not checked in the browser yet:** no test login is configured.
- **No DDL.** One new setting, `position_target_days` (default 45).
- Nothing is deployed or committed.

## What users see
- **Analytics range bar:**
  - presets 7 / 30 / 60 / 90 / 365 days and All, plus custom dates; defaults to the last 7 days;
  - "Showing … · compared with …" under it;
  - every tab follows it. Numbers marked **now** / **NOW** are a live snapshot.
- **Open Positions (the first tab):**
  - **Tiles:** open positions, need attention (at risk / watch), applied with the change against the previous period, responded, shortlisted, in pipeline (now).
  - **One row per MRF:**
    - health dot (At risk / Watch / On track, with reasons);
    - role, opened, days open, filled;
    - Applied: the change on the row, sources on hover;
    - Responded, Shortlisted, Rejected, On hold (now), In pipeline (now), Moved forward, Offers, Joined;
    - Shortlist % and Response %.
  - **Interaction and filters:**
    - flag chips under each open role;
    - Open is the default filter; Closed and All remain;
    - the CSV carries the range in its file name.
- **Role view (a click on a role):**
  - the "This week" sentence with **Copy for HM update**;
  - seven KPIs against the previous period;
  - **Needs attention** (stuck, feedback overdue, offers awaiting approval, responded but not reviewed, interviews today);
  - applications per day (or per week past two months) stacked by source, with a table view;
  - the funnel since opened;
  - upcoming interviews (7 days);
  - what happened in the range;
  - the open-to-close journey;
  - **Download role report** (CSV).
- **Candidates behind a number (W1):** every underlined number opens a side list. Each row opens the Pipeline drawer, or the profile when there is no journey. The list can be searched and exported as CSV.
- **Role Summary:**
  - one row per MRF (same-name requisitions no longer merge);
  - new **Total applied**, **Moved fwd** and **Shortlist %** columns;
  - "Total Candidates" is now "Total screened";
  - open roles come first;
  - it follows the range, and so does its CSV.
- **Other tabs:**
  - **Headline tiles:** follow the range (decision date; Zeko by date sent / score received).
  - **Pipeline Insights:**
    - the funnel counts journeys started in the range;
    - Rejection reasons follow the range (their 7/30/90 select is gone; All = all time);
    - the four tiles are marked "now".
  - **Recruiter Insights:** vendor and source counts cover journeys started in the range; time-to-hire covers hires closed in it.
  - **Email Delivery:** follows the range (All = its longest window, 365 days).
- **Dashboard:**
  - **Open positions · last 7 days** strip: health, a sparkline, applied against the week before, in pipeline, attention. It replaces "Top Roles & Skills" for staff.
  - **Needs your attention** gains "Roles needing attention".
- **Candidate Pipeline:** with a requisition chosen in Position, a slim header shows its health, applicants in 7 days and in pipeline, with "View role analytics →". `/pipeline?mrf=<id>` opens the board filtered to that requisition.
- **MRF details:** a "View analytics" button for submitted MRFs.
- **Settings (admin):** a new **Open position target** card (days, default 45).

## Restyle to the app's design (23 Oct, Harish)
The first build copied the design canvas's own look. The screens now use the app's design system:
- **Board summary tiles and role-view KPIs:** the shared `KpiCard` strip (Analytics headline style).
- **Role-view panels:** `.panel-shell` cards with the Analytics `SectionTitle` (moved to `components/analytics/openPositionsShared.jsx`, shared with `Analytics.jsx`).
- **Funnel:** the Pipeline Insights bar style, with conversion tags.
- **Daily chart:** Recharts with the Dashboard's `.dash-chart-tip` tooltip.
- **Journey:** antd `Steps`.
- **Drawer headers:** follow `PipelineDrawer`.
- **Colours:**
  - health uses the KPI semantic tokens (`--kpi-d`, `--kpi-e`, `--kpi-c`);
  - sources use the app's avatar colours (olive, blue, magenta, gold), re-validated with the dataviz checker, with dark-mode steps;
  - the summary note uses `--gold-bg`.

## Rules
| Number | Rule |
|---|---|
| Applied (D2) | Tagged to the MRF (tag date), or for untagged CVs a matching Position Applied (CV added date), counted under the latest same-name MRF raised before the CV arrived (refined during the build: a CV from June cannot have applied to an MRF raised in August) |
| Source | Tag source; untagged CVs with a vendor name are vendor; else "Mailbox, website & older uploads" |
| Responded (D3) | `details_completed_at`; for forms before 14 Oct with no date, `details_requested_at`; a complete profile never asked counts on its added date. **Chhaya to confirm** (closes N37) |
| Shortlisted | Journeys started in the range |
| Rejected | Rejection events or rejected closures in the range, plus screening rejections (no journey) |
| Moved forward | Journeys arriving in a stage after the first, in the range |
| Health (D9) | At risk: open longer than the target, or 0 applicants in 7 days with fewer than 3 in the pipeline. Watch: stuck, feedback overdue, a dry week, or applicants down more than 50%. Always on the last 7 days |
| Ratios (D4) | Shortlisted ÷ Applied; Responded ÷ Applied |

## Code
**Backend**
- New files:
  - `utils/analyticsRange.js`
  - `utils/roleSummary.js`
  - `services/openPositions.helpers.js` (pure)
  - `services/openPositions.service.js`
  - `services/mrfApplicants.service.js` (the applicant links; the Dashboard's `cvLinkedToMrf` and friends moved here)
  - `exports/roleReport.export.js`
- Changed:
  - `parseAnalyticsParams` adds `range`;
  - `getPipelineAnalytics` and `getZekoPipeline` take a range;
  - email monitoring takes `from` / `to`;
  - the Positions and Role Summary CSVs, and the analytics export file names, include the range.
- **Endpoints:**
  - `GET /api/pipeline/analytics/positions[/:mrfId[/candidates|/export]]`
  - `GET /api/screening/analytics/role-summary`
  - `GET /api/dashboard/open-positions`
  - `GET` and `POST /api/settings/position-target`

**Frontend**
- New files:
  - `components/analytics/AnalyticsRangeBar.jsx`
  - `components/analytics/RoleDetailDrawer.jsx`
  - `components/analytics/MetricCandidatesDrawer.jsx`
  - `components/analytics/openPositionsShared.jsx`
  - `components/dashboard/OpenPositionsPulse.jsx`
  - `components/pipeline/PipelineRoleHeader.jsx`
  - `components/settings/PositionTargetCard.jsx`
- Reworked:
  - `components/analytics/PositionsTab.jsx` (now the board)
  - `pages/Analytics.jsx`
- Changed:
  - `Dashboard.jsx`, `ActionCenterCard.jsx`, `Pipeline.jsx`, `MRF.jsx`, `Settings.jsx`, `DeliveryMonitoring.jsx`
  - `metricDefinitions.js`
  - colour tokens in `theme/index.css` (palette validated with the dataviz validator, light and dark)

## Release steps
1. No DDL. The target setting is created on first save; until then, 45 days is used.
2. Deploy the backend, then the frontend.
3. Run `node scripts/check-dashboard-vs-analytics.mjs` on the target environment.

## Known
- **Responded before 14 Oct is approximate:** it is counted on the request date.
- **Applied is only as good as the links:** Position Applied is free text, and JD tags began on 21 Oct.
- **Not built yet:**
  - the role report is CSV, not Excel;
  - Tier 2 (coverage, funnel leak, source quality, response speed) is L06b.

## Still to test (browser)
- **Range:** each preset and a custom range, on every tab.
- **Board and role view:**
  - the board rows match the role view;
  - each number lists exactly that many candidates;
  - Copy works;
  - the role report downloads.
- **Elsewhere:**
  - the Dashboard strip and its links;
  - `/pipeline?mrf=` and its header;
  - the MRF "View analytics" button;
  - the Settings card.
