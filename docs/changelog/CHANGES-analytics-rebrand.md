# Analytics Page Rebrand

Scope: `frontend/src/pages/Analytics.jsx` (route `/analytics`), a curated
rebuild that drops operational tooling and adds new mock recruiter-insight
content, plus the naming cleanup that motivated it. The pre-rebrand page is
fully preserved as a legacy fallback. This is explicitly an **interim**
change — both pages are expected to be deprecated once Phase 3 Module 1
ships the real Pipeline Tracker and live pipeline analytics
(`docs/phase3/03-DEVELOPMENT-PLAN.md`).

---

## 1. Why

The old Analytics page mixed two things that don't belong together:
genuine analytics (stat tiles, role-grouped stats, pipeline funnel/stuck-
candidate insights, email delivery tracking) and pure operational tooling
(search/edit a candidate's status, assign/schedule/cancel Zeko interviews,
read Outlook conversation threads). Naming was also inconsistent and
repetitive:
- The page was titled **"Recruitment Screening Analytics"** and its first
  tab was literally **"Analytics Summary"** — "Analytics" said twice.
- Three different display strings existed for the same page: sidebar
  "Analytics", breadcrumb/page-heading "Recruitment Screening Analytics",
  Dashboard card / command palette "Screening Analytics".
- The **"Candidate Pipeline (Preview)"** tab collided with the standalone
  **"Candidate Pipeline"** page (`/candidate-pipeline-prototype`). The
  RT-approved UX spec (`docs/phase3/Phase 3 - prototype.html`) calls this
  *"a new 'Pipeline' tab"* — the collision was introduced when the
  standalone page was renamed to "Candidate Pipeline" in a prior session
  and this tab's label was updated to match it.

## 2. Preserved legacy page

`frontend/src/pages/Analytics.jsx` → `frontend/src/pages/AnalyticsLegacy.jsx`
(via `git mv`, history preserved). Byte-for-byte the old page — same title,
same 6 tabs (Analytics Summary, All Candidates, Zeko Interview Schedule,
Zeko Cancel Interview, Candidate Pipeline (Preview), Email Delivery), same
functionality — only the default export renamed `Analytics` →
`AnalyticsLegacy`, plus a header comment marking it as the preserved
pre-rebrand version.

Wired in as a secondary, clearly-marked route:
- `frontend/src/App.jsx`: new `<Route path="/analytics-legacy" element={<AnalyticsLegacy />} />`.
- `frontend/src/layouts/MainLayout.jsx`: sidebar entry "Recruitment
  Analytics (Legacy)" directly under the main entry; breadcrumb
  `'analytics-legacy': 'Recruitment Screening Analytics (Legacy)'`.
- **Not** added to `Dashboard.jsx` quick actions, `AdminDashboard.jsx`
  module registry, or `CommandPalette.jsx` — sidebar-reachable only, not a
  primary-surface shortcut.

## 3. Rebuilt `Analytics.jsx` — curated, analytics-only

Route `/analytics` and export name `Analytics` stay put. Kept only what's
genuinely analytics; dropped everything operational; added new mock content.

**Kept** (real data, from `fetchMainData()` / `screeningService.getZekoPipeline()`):
- 6 stat tiles (Shortlisted / Rejected / On Hold / Total / Zeko Sent / Zeko Passed).
- **Role Summary** tab (renamed from "Analytics Summary") — same
  role-grouped stats table, **minus the "View Candidates" action column**
  (its target, the "All Candidates" tab, no longer exists on this page —
  the column still works unchanged on the Legacy page).
- **Pipeline Insights (Preview)** tab (renamed from "Candidate Pipeline
  (Preview)") — same `<CandidatePipelineAnalyticsPreview />` render,
  resolving the naming collision described in §1.
- **Email Delivery** tab — unchanged, `<DeliveryMonitoring />`.

**Dropped entirely**, along with every piece of state/handler/column/modal
that existed only to support it (still live, unchanged, on
`AnalyticsLegacy.jsx`):
- **All Candidates** tab — search/status-edit state and columns.
- **Zeko Interview Schedule** tab — job-assignment state, schedule modal.
- **Zeko Cancel Interview** tab — cancel-reason modal.
- The **Outlook conversation viewer** and **candidate detail-card modal**
  (both were only reachable from the three dropped tabs' row actions).
- Now-dead imports cleaned up accordingly (`Form`, `DatePicker`, `Avatar`,
  `Spin`, `Tooltip`, `useAuth`, `CandidateDetailCard`, `StatusBadge`, and
  the icon set that only served the dropped UI) — file dropped from ~1500
  lines to under 350.

**New: "Recruiter Insights (Preview)" tab** — a local component in
`Analytics.jsx`, styled consistently with the existing
`CandidatePipelineAnalyticsPreview` pattern (warning `Alert` banner stating
it's mock/illustrative data, not wired to live records). Three panels:
1. **Time-to-hire** — average days per stage + overall average days to hire.
2. **Source-of-hire breakdown** — HR upload / Placement vendor / Email
   intake: submitted, shortlisted, rejected, on-hold, shortlist-rate%.
3. **Vendor performance leaderboard** — per-vendor submissions/shortlist
   rate (reuses existing mock vendor names — "TechBridge Solutions",
   "Talent Hive" — for continuity with `CandidatePipelinePrototype.jsx`).

**Final tab order:** Role Summary → Pipeline Insights (Preview) →
Recruiter Insights (Preview) → Email Delivery — candidate flow → pipeline
health → hiring trends → communications.

**Page header:** title "Recruitment Screening Analytics" → **"Recruitment
Analytics"**; subtitle rewritten (the old text described capabilities that
no longer live on this page) to *"Track recruitment performance and hiring
trends across roles, sources, and vendors."*

## 4. Consistent naming app-wide

"Recruitment Analytics" is now the one display string used everywhere this
page is referenced. The underlying RBAC/module key `screening_analytics` is
**unchanged** everywhere — only human-facing labels moved:
- `MainLayout.jsx`: sidebar "Analytics" → "Recruitment Analytics";
  breadcrumb "Recruitment Screening Analytics" → "Recruitment Analytics".
- `Dashboard.jsx`: quick-action card "Screening Analytics" → "Recruitment Analytics".
- `AdminDashboard.jsx`: module registry "Recruitment Screening Analytics" →
  "Recruitment Analytics"; desc "Track recruitment performance and
  analytics" → "Track recruitment performance and hiring metrics" (drops
  the redundant trailing "analytics").
- `CommandPalette.jsx`: "Screening Analytics" → "Recruitment Analytics".

## 5. `docs/phase3/Phase 3 - prototype.html` synced

This static RT-walkthrough mockup (referenced by `03-DEVELOPMENT-PLAN.md`
as the UX spec for Phase 3 Module 1) still carried the pre-rename/pre-
rebrand naming. Updated to match, label text only — no structural, JS, or
RT-answer content changed:
- `<title>` and header logo: "Pipeline Tracker" → "Candidate Pipeline"
  (matching the standalone page's v7 rename, never previously synced here).
- Nav tab "Analytics" → **"Pipeline Insights"** — this demo tab only ever
  showed the funnel/stuck-candidates/rejection-reasons panels, i.e.
  precisely what shipped as "Pipeline Insights (Preview)", not the full
  curated Recruitment Analytics page (Role Summary, Email Delivery, etc.
  aren't part of this Pipeline-focused walkthrough).
- The explanatory note under that tab rewritten from *"in the real build
  this becomes a new 'Pipeline' tab inside the existing Analytics page"* to
  accurately name the shipped result: *"this is the 'Pipeline Insights
  (Preview)' tab inside the Recruitment Analytics page."*
- Footer: "Phase 3 Interview Pipeline Tracker" → "Phase 3 Candidate Pipeline".
- Internal JS hooks (`data-view="analytics"`, `id="view-analytics"`, etc.)
  left untouched — only visible button text and prose changed, so the
  interactive demo still works exactly as before.

## Files touched

| File | Change |
|---|---|
| `frontend/src/pages/Analytics.jsx` | Rebuilt: curated tab set, new Recruiter Insights (Preview) tab, renamed title/subtitle/tabs |
| `frontend/src/pages/AnalyticsLegacy.jsx` (new, via `git mv`) | Preserved old page, component renamed only |
| `frontend/src/App.jsx` | Import + route for `/analytics-legacy` |
| `frontend/src/layouts/MainLayout.jsx` | Sidebar + breadcrumb entries for both pages |
| `frontend/src/pages/Dashboard.jsx` | Quick-card label |
| `frontend/src/pages/AdminDashboard.jsx` | Module registry label + desc |
| `frontend/src/components/dashboard/CommandPalette.jsx` | Palette entry label |
| `docs/phase3/Phase 3 - prototype.html` | Naming sync (§5) |

## Verification

- `npm run build` (Vite production build) completes cleanly.
- All 7 touched JS/JSX files pass an esbuild syntax + import-resolution
  check (`--bundle --loader:.jsx=jsx --jsx=automatic --packages=external`).
- `grep -rn "screening_analytics" frontend/src` confirms the module/
  permission key is unchanged everywhere — only display strings differ.
- **Not done:** logged-in click-through of the sidebar/MainLayout (auth-
  gated, no dev credentials available in this session) — worth a manual
  pass to confirm both "Recruitment Analytics" and "Recruitment Analytics
  (Legacy)" render as expected.
