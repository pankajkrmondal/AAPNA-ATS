# UI / Theme Change Log

A running log of UI, theme, and UX changes to the AAPNA-ATS frontend.
Newest entries first. **Every UI change should be recorded here.**

---

## 2026-06-29 — KPI card premium refresh

Reworked `StatCard` for a richer, more elegant feel and to fix the unbalanced look (only
some cards had a floating sparkline):
- **Header row** — icon tile on the left, a compact week-over-week **trend chip** on the
  right (replaces the wide "479% vs last week" pill; full label moved to the chip tooltip).
- **Value** now uses the heading typeface (Sora) with tabular-nums for an editorial,
  premium number style (was monospace).
- **Full-bleed gradient band** at the bottom of *every* card for a consistent rich finish;
  a live sparkline overlays the band where a real series exists, so cards without a series
  no longer look unfinished.
- Softer corner aura (less fuzzy), equal-height cards retained.
- Files: `src/components/common/StatCard.jsx`, `src/theme/index.css`.

---

## 2026-06-29 — Advanced Dashboard (recruiter command center)

Major dashboard upgrade — **frontend-only**, built entirely on existing endpoints
(`dashboard/stats`, `candidates/search`, `mrf/list`, `screening/analytics/pipeline`,
`screening/roles`) + the shared socket. `recharts` (already a dependency) powers the charts.
Existing behavior preserved: KPIs, funnel data, quick actions, and the recent-candidates
table (kept with its own pagination + download logic).

**New data layer**
- `src/hooks/useDashboardData.js` — orchestrates all dashboard fetches in parallel with
  per-source `try/catch` (one failing endpoint never blanks the page).
- `src/hooks/useLiveActivity.js` — subscribes to socket `upload:job` / `review:new`,
  exposes a capped live feed + running "duplicates to review" count.
- `src/utils/dashboardAggregations.js` — pure client-side helpers: `bucketByDay`,
  `topByField`, `topSkills`, `conversionStages`, `weekOverWeek`, `sparkSeries`,
  `medianTimeToHire`, `upcomingInterviews`.

**New widgets** (`src/components/dashboard/`)
- `DashboardHero` — animated gradient-mesh hero, live clock/pulse, CTAs, global
  **date-range + role** filters, and the ⌘K trigger.
- `Sparkline` + `StatCard` enhancement — KPI cards gain an optional sparkline + a
  week-over-week delta badge (backward-compatible new props).
- `HiringTrendsCard` — animated gradient area chart (new candidates/day over the range).
- `ConversionFunnelCard` — funnel with stage-to-stage conversion % + time-to-hire (when derivable).
- `TopRolesSkillsCard` — top roles / in-demand skills bars (toggle), client-aggregated.
- `ActionCenterCard` — "Needs your attention": pending MRFs, duplicates to review (live),
  awaiting screening (`sourced − aiScreened`), interviews today — rows deep-link.
- `LiveActivityFeed` — real-time socket feed with a "listening" idle state.
- `UpcomingInterviews` — next-7-days agenda from the Zeko pipeline.
- `CommandPalette` — ⌘K / Ctrl-K launcher: fuzzy nav + debounced candidate quick-search.

**CSS** — `src/theme/index.css` gained a scoped "Advanced Dashboard" block (hero mesh,
delta badges, action/feed/agenda rows, chart tooltip, ⌘K palette). Chart/widget cards are
explicitly **opted out of the global hover-lift** (`.dash-chart-card:hover { transform:none }`)
so charts and their tooltips stay stable.

**Honest scope notes**
- Trends are **client-bucketed** from a 200-candidate batch by `createdAt` ("new candidates
  added") — the only time-series derivable frontend-only.
- **"My stats"** (personal uploads/shortlists) was dropped — the candidate payload exposes
  no uploader attribution. *Future backend item:* add `created_by`/uploader to enable it.
- Duplicates-to-review count is **live via socket** (starts at 0 until events arrive).
- **Bundle size** grew (~2.08 → ~2.49 MB) since recharts now loads with the app. *Follow-up:*
  consider `React.lazy` code-splitting the dashboard charts to trim initial load.

---

## 2026-06-29 — Hover consistency + icon tooltips

### Global card hover-lift
- Added a baseline hover to every antd card so all screens respond like the dashboard:
  ```css
  .ant-card:not(.no-lift):hover { transform: translateY(-3px); box-shadow: var(--shadow-lg); }
  ```
  - File: `src/theme/index.css`.
  - Component cards (`.premium-stat-card`, `.glass-card`, `.admin-stat`, `.kpi-card`)
    already define a matching lift; this covers plain `<Card>`s on Candidates, MRF,
    Settings, Analytics, Candidate Screening, Email Templates, Candidate Detail.
  - Add the `no-lift` class to any full-width container card that shouldn't lift.
  - Suppressed automatically under `prefers-reduced-motion`.

### Tooltips on icon-only buttons
- Audited every screen for icon-only buttons (no visible label) lacking hover text.
- Added hover text to the two that were missing it:
  - `CandidateScreening.jsx` — wrapped the bulk-action "Clear selection" button
    (`CloseCircleOutlined`) in a `Tooltip`.
  - `Candidates.jsx` — added `title="Remove"` to the employment-row delete button
    (`DeleteOutlined`), matching this file's existing native-`title` pattern.
- Already covered, left as-is: CandidateScreening action cluster
  (`.screening-action-btn`), Analytics row actions (Tooltip / native `title`),
  AdminDashboard user + company row actions (Tooltip-wrapped), VendorDashboard,
  MRF, EmailManagement, CandidateDetail — these either already had a `Tooltip`/`title`
  or a visible text label.

---

## 2026-06-29 — Entrance animation consistency

### Page transitions replay on every navigation
- `MainLayout` wraps the routed `Outlet` in `<div className="page-enter">`, but that
  wrapper persisted across routes so the CSS animation only fired on first load.
- Fix: keyed the wrapper by `location.pathname` (both the main and admin branches) so it
  remounts and replays the `fadeInUp` entrance on every navigation.
  - File: `src/layouts/MainLayout.jsx`.

### `stagger-children` utility
- New utility that rises a container's **direct children** in sequence — the lively
  entrance the dashboards had, without hand-tagging each card:
  ```css
  .stagger-children > * { animation: fadeInUp 0.5s var(--ease-out-quint) both; }
  /* nth-child 1..6 → 0.04s…0.34s, then capped at 0.40s */
  ```
  - File: `src/theme/index.css`.
- Applied to the roots of Candidates, MRF, Settings, CandidateScreening, Analytics,
  EmailManagement, and CandidateDetail (replacing their flat `animate-fade-in` /
  redundant per-page `page-enter`, since the layout now provides the page-level entrance).

---

## 2026-06-29 — Theme polish (elegant / professional, premium feel retained)

Two files: `src/theme/themeConfig.js` (antd tokens) and `src/theme/index.css` (CSS vars,
global styles). Brand hue `#7a922e` unchanged — only *how* it's used changed.

### Elevation — neutral, not green-tinted
- Replaced the green-tinted shadow ramp (`rgba(122,146,46,…)`) with a neutral ink ramp
  `--shadow-xs … --shadow-xl`; added `--glow-accent` so green is reserved for intentional
  accents (primary buttons). Neutralized `--glass-shadow`.
- Mirrored in `themeConfig.js`: `boxShadow`, `boxShadowSecondary`, `Card.boxShadowTertiary`
  (neutral); `Button.primaryShadow` kept green via the accent-glow value.
- Re-pointed `.kpi-card` / `.pipeline-tile` / `.stat-tile` hover shadows and the
  `.cta-primary` glow at the new tokens; softened the largest hover lifts a notch.

### Radius scale (one family)
- Added `--radius-sm: 8 / --radius-md: 10 / --radius-lg: 14 / --radius-pill: 999`;
  aliased the old `--border-radius*` names to them. Swept ad-hoc radii (KPI card 16→lg,
  icon tile 13→lg, screening pill 7→sm, action button 9→md).
- `themeConfig.js`: `borderRadiusLG: 14`, `borderRadiusSM: 8` (light + dark);
  `Card.borderRadiusLG: 14`.

### Accessibility / readability
- App-wide keyboard `:focus-visible` ring (keyboard nav only, not mouse).
- Bumped low-contrast text: light `colorTextTertiary` `#808785 → #6f7671`.
- `Table.cellPaddingBlock: 12` for more breathing room.

### Spacing scale
- Added `--space-1 … --space-8` (4px base) for future consistency (no page edits).

### Dark-mode parity (inert while dark background is removed)
- Added `[data-theme='dark']` variants for previously light-only colors: conversation
  badges (`.conv-b-opened/.conv-b-delivered/.conv-msg-count`), the conversations-modal
  header border, and role pills (`.role-badge--admin/--recruiter/--vendor`).
- Note: dark mode is currently disabled in the app, so these rules are inert; kept for
  when dark is re-enabled.

---

## Conventions

**Animation utilities** (in `src/theme/index.css`):
- `page-enter` — page-level `fadeInUp`; applied by `MainLayout`, keyed by route.
- `stagger-children` — add to a page root/container to rise its direct children in sequence.
- `.ant-card:hover` — global card lift; opt out with `no-lift`.
- All motion is guarded by `prefers-reduced-motion`.

**Tokens** — use CSS vars / antd tokens, don't hardcode:
- Color: brand `--gold` (`#7a922e`); depth is neutral (`--shadow-*`), green only for
  intentional accents (`--glow-accent`).
- Radius: `--radius-sm/md/lg/pill`. Spacing: `--space-1…8`.

**Tooltips** — icon-only buttons must have a `Tooltip` with a concise verb-first label.

**Logging** — record every UI/theme change in this file (newest first).
