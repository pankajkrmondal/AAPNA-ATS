# Aurora Glass — App-Wide Design Rollout

> **Also available as a formatted page:** [`aurora-glass-rollout.html`](./aurora-glass-rollout.html) — same content,
> self-contained (no build step, no network). Open it directly in a browser. Use whichever you prefer; this
> Markdown file is the canonical source and the one to edit if the plan changes.

**Audience:** the developer executing this. You should be able to run any single phase end to end from this document without asking questions.
**Supersedes:** the "Phases 1–6" list recorded in `frontend/UI-CHANGELOG.md` under the 2026-08-13 Phase 0 entry. That plan is discarded — see *Why this replaces the old plan*.
**Status of the codebase:** ✅ **ALL NINE PHASES ARE SHIPPED** (verified against source 2026-08-21; one commit per phase, `2c50d27` → `9029207`, plus cleanups `1f3e76b` and `d0e4173`). `V2_ROUTES` in `MainLayout.jsx` now lists all 12 routes, and no converted route still carries a bare `.glass` class — the failure mode Part I warns about. **This document is now a design reference, not a to-do list.** Its three "Open items" are all resolved: the prototype was converted (not retired), the public-page scope was settled in Phase 9, and antd is on `^5.29.3`. The one piece of debt the rollout left behind is ~7 raw brand hexes on the visible half of `CandidateScreening.jsx` (`:1466-1473`), including `#7a922e` — see I.2.

*(Superseded: "`/dashboard`, `/candidates/:id` and `/filtering` are converted. Nothing else is. No Phase 2 work has been done." — true when written, false since.)*

---

## Context

The dashboard went through three design passes (V2 "Aurora Glass" pilot → V3 composition/brand → light-mode settle) and came out as a genuinely enterprise-grade screen: an ambient canvas, a three-tier glass material system, a brand-derived token layer, real metric tooltips, and measured 60fps scroll performance. Phase 0 then added CSS groundwork and Phase 1 converted two routes.

The rest of the app has not moved. Today the product is **3 converted routes against 14 unconverted ones**, which is worse than either extreme — a user crossing from `/dashboard` to `/mrf` watches the chrome stay glass while the content drops to flat 2019-era cards. The old phase list was also written to a narrower brief ("widen a boolean, fix what breaks") and has since drifted from the code: it schedules a page that no longer exists, and it defers the single largest visual gap in the app indefinitely.

**The brief for this plan is different and explicit: never trade design quality for rollout speed.** Where the old plan deferred something awkward, this one schedules it. The intended outcome is that every surface a user can reach — page, dialog, control, empty state, public token page — reads as one deliberately designed enterprise product, in both themes, with no half-converted screens at any point in the sequence.

### Why this replaces the old plan

Four findings from this survey, each of which the old plan got wrong or omitted:

1. **40 dialogs were deferred indefinitely.** 37 `<Modal>` + 3 `<Drawer>` across the app (`PipelineDrawer.jsx` alone has 10 modals + 1 drawer). They portal into `document.body`, structurally outside `.ats-v2`, so the old plan's answer was "leave AntD's default chrome untouched app-wide … open question". On a glass app that means every dialog opens as a flat white box. This is now **Phase 1**, not an open question.
2. **`AnalyticsLegacy.jsx` does not exist.** The old Phase 3 targets `/analytics-legacy`; there is no such route or file. Only `/analytics` is live.
3. **`.glass-3` has zero JSX consumers.** The tier-3 class has never been used by any page — the "Recent Candidates" table it was written for was replaced by `LatestUploads`. Its `.ant-table` rules are **unverified against a real table**. The first phase that uses it must verify them.
4. **Every `.glass-card` in the app is silently blurring.** `aurora-glass.css:256` documents "NO backdrop-filter on scrolling content surfaces", but the base `.glass-card` rule at `index.css:850` sets `backdrop-filter: blur(12px)` and the `.ats-v2` override never cancels it. The documented design and the shipped code disagree today.

Also corrected: `package.json` pins `antd ^5.17.0` but **5.29.3 is installed**. This matters — the overlay tier in Phase 1 depends on `ConfigProvider`'s `modal`/`drawer` config, verified present in the installed `config-provider/context.d.ts` (`ModalConfig`, `DrawerConfig`, both with `classNames`/`styles`).

---

# PART I — The Design System

This is the durable reference. Phases in Part II apply it; they do not re-invent it. All of it lives in `src/theme/`.

## I.1 Material tiers

The system's core idea: **a surface's translucency is a function of its information density**, not its importance. A hero and a 100-row table want opposite things from glass.

| Tier | Name | Used for | Fill | `backdrop-filter` |
|---|---|---|---|---|
| 1 | Chrome | Sidebar, topbar | `--glass-1-bg` | **Yes** — the only tier that blurs |
| 2 | Feature | Hero, KPI cards, widget/panel cards, board columns | `--glass-2-bg` | No |
| 3 | Data | Tables, dense lists, rows nested inside a tier-2 card | `--glass-3-bg` (0.90/0.92) | No |
| 4 | **Overlay** (new, Phase 1) | Modals, drawers, popovers, dropdowns | `--glass-4-bg` | **Yes** — floats above the whole page |

**Rules that follow from the table, and are not negotiable per-page:**

- **A surface nested inside a tier-2 card is tier 3.** Already established by `.dash-uploads__row` and `.quick-action-row` on the dashboard, and by `.cand-card` in Phase 1.
- **Only tiers 1 and 4 blur.** Tier 1 is sticky (rasterized once, never scrolls). Tier 4 is transient and sits above everything. Tiers 2 and 3 scroll — a `backdrop-filter` on a scrolling surface re-blurs its backdrop every frame, and this backdrop is soft gradients with 3% grain, so blur buys nothing visible there. This is measured, not assumed (see `aurora-glass.css:256`).
- **Light mode's chrome is opaque white, not tinted glass.** A translucent pane is only ever as neutral as what shows through it; this cannot be achieved by lowering alpha. Already implemented — do not "fix" it back to glass.

**Phase 0 fix, do this first (one line, in Phase 1):** add `backdrop-filter: none; -webkit-backdrop-filter: none;` to the `.ats-v2 .glass-card` rule in `aurora-glass.css:269`, so the code matches the documented design and the ~8 board columns Phase 4 adds don't each blur. This touches `/dashboard` and both Phase 1 routes, so it gets its own before/after screenshot in both themes.

## I.2 Token layers

Three layers, already built. Understand the direction of dependency before adding anything.

```
brands.js  ──emits──▶  --brand-*  (light/dark PAIRS)
                            │
                     aliased down to
                            ▼
              --gold / --ink / --aurora-* / --glass-N-*
                            │
                       consumed by
                            ▼
              .ats-v2 rules in aurora-glass.css
```

- **Never write a raw hex in a component.** Per-org theming (`theme/brands.js`, `context/BrandContext.jsx`) works by swapping the brand layer; a hardcoded `#7a922e` is invisible to it. The survey found **~250 raw hex values still in page files** — worst offenders `CandidatePipelinePrototype.jsx` (57), `CandidateScreening.jsx` (39), `Analytics.jsx` (37), `Pipeline.jsx` (32), `AdminDashboard.jsx` (25). Each phase clears the hexes in the files it touches. No phase leaves a file it edited with a raw brand hex.
- **Brand tokens are emitted as `-light`/`-dark` pairs and selected by CSS**, never written inline on `<html>` for the active mode only. Writing only the active mode breaks `<ForceLight>`, and the public token pages would render dark-mode brand colours in a dark session. This is a solved bug — don't reintroduce it.
- **Depth ramp:** `--depth-1/2/3`. In light mode these are mixed from `--shade-rgb`, a *saturated brand mid-tone*, never black. Grey shadows on a light ground read as dirt; brand-hued ones read as glow. This was the single biggest win of the light-mode pass.
- **Radius:** `--radius-card` (16px) for cards, one larger value for the hero. Overlay tier gets its own (I.5). Five competing radii were collapsed once already; do not add a sixth.

## I.3 The inline-style law

**This is the rule that determines the effort of every phase, so read it once carefully.**

An inline `style={{ background: … }}` **cannot be overridden by any stylesheet** without `!important`, and `!important` in a stylesheet beats a non-important inline declaration. That asymmetry produces two distinct failure modes, and you need to recognise both:

- **Failure A — the slab.** A page card carries `.glass-card`, but a panel inside it paints an inline `--ink-3` fill. The card goes translucent; the panel stays a flat grey rectangle stuck to the glass. This is what Phase 1 hit on *every* nested surface of both its pages.
- **Failure B — the silent kill.** A stylesheet rule using the `border` shorthand with `!important` overrides an inline `borderInlineStart` that was carrying *data* (a status colour). The information disappears with no error. **Phase 4 will hit this on `.cp-candidate-card`, whose left border encodes candidate status.**

**The remedy, in the order you should reach for it:**

1. Move the inline declaration into a class in `index.css` whose values are **byte-identical** to what they replace, so nothing outside `.ats-v2` shifts by a pixel. Only then can the `.ats-v2` rule restyle it. (Established precedent: `.premium-stat-card`'s background/border-top.)
2. If the value is **data-derived** (a status colour, a metric hue, an avatar colour), pass it as a **CSS custom property** and let CSS own the property. Established twice already: `--stat-color` on `StatCard`, `--kpi-color` on `KpiCard`. This is the correct fix for Failure B.
3. Never use the `border` shorthand in an `.ats-v2` rule on a surface whose border encodes meaning. Set `border-block` / `border-inline-end` and leave the meaningful side alone.

**Inline-style debt per file** (`background`/`boxShadow`/`borderRadius`/`border` declarations) — this is your effort estimate:

| File | Inline | Raw hex |
|---|---|---|
| `CandidateScreening.jsx` | 88 | 39 |
| `Candidates.jsx` | 78 | 12 |
| `AdminDashboard.jsx` | 61 | 25 |
| `MRF.jsx` | 47 | 13 |
| `Settings.jsx` | 29 | 0 |
| `Analytics.jsx` | 28 | 37 |
| `EmailManagement.jsx` | 24 | 3 |
| `MrfApprovalAction.jsx` | 22 | 12 |
| `VendorPortal.jsx` | 19 | 23 |
| `MrfSubmit.jsx` | 19 | 9 |
| `MissingJdUpload.jsx` | 18 | 8 |
| `VendorDashboard.jsx` | 13 | 19 |
| `HRUpload.jsx` | 12 | 16 |
| `Pipeline.jsx` | 7 | 32 |

**Three shared style constants are high leverage** — fixing each converts several surfaces at once:
- `PANEL_STYLE` — `Analytics.jsx:78` and `components/email/DeliveryMonitoring.jsx:35` (duplicated; consolidate)
- `SECTION_CARD_STYLE` — `VendorDashboard.jsx:41`

## I.4 Shared-class couplings (the non-regression law)

**Any phase touching a shared base class must re-check every other page using that class.** Known couplings, verified in this survey:

| Class | Consumers | Note |
|---|---|---|
| `.glass-card` | Dashboard widgets, `CandidateDetail`, `CandidateScreening`, `LoadingSkeleton` | Base rule is **unscoped** in `index.css:848` |
| `.glass` (bare, no suffix) | `Analytics.jsx:875`, `MainLayout` topbar, `EmailManagement` (×3) | **Landmine:** styled by `index.css:840`, *never* touched by `aurora-glass.css`. Converting `/analytics` without renaming this leaves its main tab container flat while its chrome goes glass. |
| `.screening-tabs` | `CandidateScreening` **and** `Analytics.jsx:877` | Phase 1 already styled this. It is inert on Analytics today and will activate the moment `/analytics` joins. Do not "clean it up" without checking both. |
| `.cp-candidate-card`, `.cp-avatar`, `.cp-progress-seg` | `Pipeline.jsx` **and** `CandidatePipelinePrototype.jsx` | Scoped `.ats-v2` rules are inert on the prototype until it joins |
| `.ant-descriptions-bordered` | `CandidateDetail`, `PipelineDrawer`, `HRUpload`/`VendorPortal`, `MrfApprovalAction` | Already scoped; safe |
| `.kpi-card` | `VendorDashboard`, `HRUpload`, `VendorPortal`, prototype | Phase 0 pre-styled it; **still inert**, activates in Phase 5 |
| `.upload-page` | `HRUpload`, `VendorPortal` | Identical structure — convert as one unit |

## I.5 The overlay tier (Tier 4) — new

40 dialogs cannot be converted by hand without drift, and they are unreachable from `.ats-v2`. Both problems have one solution.

**Mechanism** (verified against installed antd 5.29.3, `config-provider/context.d.ts`):

```jsx
// App.jsx — inside the existing <ConfigProvider theme={currentTheme}>
<ConfigProvider
  theme={currentTheme}
  modal={{ classNames: { content: 'ats-overlay', mask: 'ats-overlay-mask' } }}
  drawer={{ classNames: { content: 'ats-overlay', mask: 'ats-overlay-mask' } }}
>
```

Every `<Modal>` and `<Drawer>` in the app then carries the class, wherever it portals to — **no per-file JSX edits, no `getContainer` changes.** One definition in `aurora-glass.css`, written **unscoped** (deliberately, like `.glass-3`'s base) because portals are outside `.ats-v2` by construction. Document that exception in the file header next to the existing ones.

**Design of the tier:** elevated pane (`--glass-4-bg`, more opaque than tier 2 — a dialog must be readable over arbitrary content), a real `backdrop-filter` (it floats above everything and is transient, so the blur both reads and costs nothing on scroll), the gradient rim, `--depth-3`, and a brand-tinted scrim replacing AntD's flat black mask.

**Respect what already exists.** Three dialogs have bespoke treatments that must survive: `.conv-modal` (`index.css:1809`), `.dash-cmdk` (`index.css:2636`), and the global `.ant-modal` viewport caps at `index.css:1741` (`max-width: calc(100vw - 32px)`, body `max-height`) — those caps are a real fix for unreachable footer buttons on small laptops. Do not regress them.

**Also in scope for tier 4:** `Select` dropdowns, `Dropdown` menus, `Tooltip`, `Popover`, `DatePicker` panels — all portal to body, all currently flat. `ConfigProvider` exposes config for each (`SelectConfig`, `TooltipConfig`, `PopoverConfig`, `DatePickerConfig` all confirmed present). Same one-shot mechanism.

## I.6 Primitives to build once, then reuse

The dashboard invented these; the rest of the app re-implements them ad hoc. Building them in Phase 2 is what stops the later phases from drifting.

| Primitive | Status | Action |
|---|---|---|
| `MetricInfo` + `metricDefinitions` | Built, dashboard-only | **Extend the registry** as later phases surface new metrics. Every number a user sees gets an entry: plain-language meaning, how it's counted, source, what the chart plots, caveats. Analytics/Vendor KPIs currently have none. |
| `StatCard` / `.premium-stat-card` | Built | Adopt on `/analytics` (Phase 6) in place of its ad-hoc `tile.bg`/`tile.color` tiles — gains tooltips they lack today |
| `KpiCard` / `.kpi-card` | Built, glass rules **inert** | Activates in Phase 5 with zero JSX change |
| `PageHeader` | Exists, `components/common/PageHeader.jsx` | Audit and standardise — title/subtitle/actions rhythm is currently hand-rolled per page |
| **Empty states** | Ad hoc | One component. Every table/board/list owns an empty state that explains *why* it's empty and offers the next action. A bare "No data" is not acceptable on an enterprise screen. |
| **Loading states** | Mixed `<Spin>` / `LoadingSkeleton` | Skeletons that match the shape of what's loading, not a centred spinner that collapses layout. `LoadingSkeleton` already uses `.glass-card`. |
| **Error states** | Ad hoc `<Alert>` | One component; actionable message + retry. |
| **Density scale** | Undefined | Define once (control heights, table row padding, card padding). Table sizes and button heights currently vary per page for no reason. |

**Motion:** every animation is `transform`/`opacity` only (compositor work, no paint). Never animate `background-position` — the old `meshDrift` did and repainted each frame. Never use `mix-blend-mode` on a full-viewport layer: measured at **23% of frames over 20ms**, vs ~3% without. The app-wide `prefers-reduced-motion` guard in `index.css` zeroes all of it for free — new keyframes inherit that automatically.

## I.7 Accessibility — applies to every phase, not a final pass

- `prefers-reduced-transparency: reduce` — canvas removed, every surface opaque. **Each phase adds its own new surfaces to the existing block at `aurora-glass.css:873`.** Carve-outs are allowed only where translucency carries the *only* cue for state (precedent: selected `.cand-card` keeps a solid brand border).
- `@supports not (backdrop-filter)` — chrome and overlays go opaque.
- `prefers-reduced-motion` — inherited app-wide; verify, don't rebuild.
- Contrast must hold in **both** themes. The 2026-07-10 dark-mode sweep fixed ~200 hardcoded colours; every phase re-checks its own screens in dark mode before calling done.
- Keyboard reachability for any new affordance (`MetricInfo` is already keyboard-reachable — match it).

---

# PART II — Execution Phases

Sequencing logic: **system before surfaces, then routes in ascending order of structural risk.** Phase 1 removes the app's biggest visual gap and unblocks every later phase. Phase 2 builds the primitives so phases 3–8 apply rules instead of inventing them. Routes then convert in dependency order, with the two structural departures (admin shell, public pages) last.

The gate is `V2_ROUTES` at `MainLayout.jsx:108` plus the `/candidates/:id` regex at `:193`. **Advance the rollout by adding to that array; revert any phase by removing its entry.** Note: once `/candidates` is added (Phase 3), the regex at `:193` becomes redundant — remove it and update the comment, which exists only to explain the split.

### Definition of done — every phase, no exceptions

1. `npm run build` clean.
2. Verified in **both** themes.
3. New surfaces added to the `prefers-reduced-transparency` block.
4. Inline-style audit of every file touched (I.3) — no Failure A slabs, no Failure B silent kills.
5. Raw brand hexes in touched files replaced with tokens.
6. Shared-class non-regression per I.4 — assert on **computed styles**, not screenshots alone.
7. Scroll-perf probe for any table/list/board: **continuous rAF, one `scrollBy` per frame**. A wheel-then-wait probe reports phantom drops here — this is a documented trap, don't fall in it.
8. `UI-CHANGELOG.md` entry, newest first, stating what was built, what was deliberately left, and what was verified.

---

## Phase 1 — The overlay tier (40 dialogs) + the blur fix

**Why first:** biggest visual gap in the app, and every later phase inherits it instead of re-deferring it.

**Files:** `App.jsx` (ConfigProvider config), `theme/aurora-glass.css` (tier-4 block, unscoped), `theme/index.css` (`--glass-4-*` tokens, both themes).

1. Add `--glass-4-bg` / `--glass-4-border` / `--glass-4-blur` / scrim tokens for light and dark.
2. Add `modal` + `drawer` config to the existing `<ConfigProvider>` in `App.jsx:264`.
3. Write the unscoped `.ats-overlay` / `.ats-overlay-mask` block; document the scope exception in the file header.
4. Extend to `Select` / `Dropdown` / `Tooltip` / `Popover` / `DatePicker` panels.
5. **Apply the `.glass-card` blur fix** (I.1) — `backdrop-filter: none` on `.ats-v2 .glass-card`.
6. Confirm `.conv-modal`, `.dash-cmdk` and the `.ant-modal` viewport caps still win.

**Verify:** open a dialog from a converted route (`/dashboard` command palette) *and* an unconverted one (`/mrf`) — both get the overlay tier, since it's global by design. Walk `PipelineDrawer`'s 10 modals + drawer. Confirm footer buttons remain reachable at 1366×768. Before/after screenshots of `/dashboard` for the blur change, both themes.

**Risk:** touches every dialog at once. Mitigation: it's one config object plus one CSS block — revert by deleting them.

## Phase 2 — Primitives and the token sweep

**Why second:** phases 3–8 get materially cheaper and cannot drift once these exist.

**Files:** `components/common/` (empty/loading/error primitives, `PageHeader` audit), `constants/metricDefinitions.js`, `theme/index.css` (density scale).

1. Build the empty / loading / error primitives (I.6).
2. Audit and standardise `PageHeader`.
3. Define the density scale as tokens.
4. Consolidate the duplicated `PANEL_STYLE` (`Analytics.jsx:78` + `DeliveryMonitoring.jsx:35`) into one shared class.
5. Extend `metricDefinitions` for the metrics phases 5–6 will surface.

**Verify:** no visual change to converted routes (this phase is additive). Build clean. Primitives render correctly in both themes in isolation.

## Phase 3 — `/candidates`

**Files:** `pages/Candidates.jsx` (78 inline, 12 hex), `MainLayout.jsx:108`.

- Search card (`:517`) → `glass-card spotlight` — tier 2, this page's feature surface, matching how Phase 1 gave `/candidates/:id`'s header card the spotlight and how the dashboard spends it on exactly one surface. Drop the inline `borderRadius`/`boxShadow`; **drop the `borderTop: 4px solid #7a922e`** — a flat green rail under a gradient rim is the old vocabulary showing through.
- Table card (`:590`) → `glass-3 no-lift` — **first real consumer of `.glass-3` in the app.**
- **Verify the untested `.glass-3 .ant-table` rules** (`aurora-glass.css:727`). Also handle what they don't cover: `.ant-table-placeholder` (empty state), row hover, pagination.
- Action-column buttons (`:475–507`) — replace raw `#7a922e` with brand tokens.
- Remove the now-redundant `/candidates/:id` regex at `MainLayout.jsx:193`.
- 3 modals: already handled by Phase 1.

## Phase 4 — `/pipeline`

**Files:** `pages/Pipeline.jsx` (7 inline, **32 hex**), `theme/aurora-glass.css`.

- Header + `LastUpdated`/Refresh/Export + NL search + filters → one tier-2 toolbar card. Currently bare on the page; AntD's opaque control fills would float unanchored on the aurora.
- Stage columns (`:548`) → `glass-card no-lift pipeline-column`. **Cancel the hover lift** (mirror `.dash-chart-card`, `aurora-glass.css:350`) — a whole column bouncing as the pointer crosses it is wrong, and the base `.ant-card:not(.no-lift):hover` at `index.css:1716` lifts them today.
- Candidate cards → tier 3 (nested-in-tier-2 rule, I.1).
- **Failure B lives here.** `.cp-candidate-card`'s inline `borderInlineStart` encodes candidate status (`Pipeline.jsx:132`). Move it to a `--cp-accent` custom property (I.3 remedy 2) and never use the `border` shorthand on this class. Preserve the accent on hover — `index.css:2982` currently overrides it with `--gold-light !important`.
- `STAGE_ACCENT` / `AVATAR_PALETTE` (`:56–66`) — 32 raw hexes → tokens.
- Shared-class audit: `.cp-*` are shared with the prototype (Phase 8) — scoped rules stay inert there. Document it.
- Board scroll arrows portal to `body`, outside `.ats-v2` — intentionally keep their brand gradient.
- **Perf probe scrolls the board container horizontally**, not the window.

## Phase 5 — `/hr-upload`, `/vendor`, `/vendor-dashboard`, `/mrf`

**Ship as one unit.** Per `VENDOR_ALLOWED_PATHS` (`MainLayout.jsx:98`), `/vendor` and `/vendor-dashboard` are the *entire* reachable app for the `vendor` role — converting one alone flips a vendor's chrome between glass and flat on every click.

- `HRUpload` and `VendorPortal` share `.upload-page` and are near-identical — one treatment, applied twice.
- **`.kpi-card` glass rules activate here for the first time** (Phase 0 groundwork, inert since). Should light up with no JSX change; verify that claim.
- `SECTION_CARD_STYLE` (`VendorDashboard.jsx:41`) → shared class.
- Records tables → `.glass-3`, reusing exactly what Phase 3 verified.
- Vendor/HR hex debt: 23 + 19 + 16.

## Phase 6 — `/analytics`

**The page that breaks the "just widen the boolean" premise.** Mandatory rework:

- **Rename `Card className="glass"` → `glass-3`** at `Analytics.jsx:875`. Bare `.glass` is styled by `index.css:840` and *never* touched by `aurora-glass.css` — widen the gate without this and the main tab container stays flat under glass chrome.
- `PANEL_STYLE` (`:78`) → the shared class from Phase 2.
- Ad-hoc `tile.bg`/`tile.color` KPI tiles → shared `StatCard`/`.premium-stat-card`; **they gain `MetricInfo` tooltips they lack entirely today.**
- `.screening-tabs` (`:877`) — Phase 1's rules **activate here**. Verify against `/filtering`, which shares the class.
- 37 raw hexes → tokens.
- 5 inner `<Table>`s (`:337`, `:411`, `:533`, `:581`, `:913`) → tier 3.

## Phase 7 — `/settings`, `/email`

Lowest traffic; both are net-new or near-new.

- `Settings.jsx` — no existing glass classes; 29 inline, 0 hex (clean).
- `EmailManagement.jsx` — three `glass no-lift email-pane-card` (`:313`, `:424`, `:522`) → `glass-3 no-lift`; the existing `no-lift` already signals tier-3 intent.
- CodeMirror already theme-aware — verify, don't rebuild.

## Phase 8 — Admin portal + the prototype

**Biggest structural departure, deliberately last so every CSS pattern is proven elsewhere first.**

- `MainLayout.jsx`'s `isAdminPath` branch (`:239–330`) is a **separate shell**: its own `admin-topbar`, **no Sider**, its own `.admin-stat` KPI family, its own `--admin-bg`. Widening `isV2` does nothing here — the branch never applies `.ats-v2` nor mounts `<AmbientBackdrop/>`.
- Approach: keep the header-only shell (adding a Sider is a *nav* redesign, out of scope), mount `<AmbientBackdrop/>`, add `.ats-v2` to the admin `<Layout>`, give `admin-topbar` tier-1 chrome, add an `.ats-v2 .admin-stat` block mirroring the `.kpi-card` approach.
- `AdminDashboard.jsx`: 61 inline, 25 hex, 4 modals. Its scoped `.admin-portal .ant-table-*` rules (`index.css:2187`) need a tier-3 reconciliation.
- `CandidatePipelinePrototype.jsx` (57 hex, 7 modals + 1 drawer): the `.cp-*` rules from Phase 4 activate when it joins. **Confirm it should be converted at all** — it's a demo page, off the sidebar, kept for client walkthroughs. If it stays, it must not look abandoned next to the real board.

## Phase 9 — Public pages and auth (scope decision required)

**Currently out of scope of the glass system, by construction:**
- **Public token pages** (`/mrf-submit`, `/mrf/:id/approve`, `/missing-jd-upload`, `/documents/:token`, `/scorecard/:token`) render outside `MainLayout` under `<ForceLight>`; `.ats-v2` structurally cannot reach them. `PublicPageShell` deliberately mirrors the branded *email* shell so the click-through feels continuous — **that is a correct design decision and glass would break it.** Recommendation: leave the shell, but bring typography, spacing, density and the Phase 2 empty/loading/error primitives into line. These are the only AAPNA surface most external people ever see.
- **AuthLayout** (`/login`, `/admin/login`, `/forgot-password`, `/reset-password`) — a distinct tree, and the pilot's own `/login` pixel-diff non-regression anchor. Changing it means re-baselining that anchor; do it knowingly or not at all.

---

## Verification

**Per phase:** the 8-point Definition of Done above.

**Tooling that already exists and should be reused** — this is how Phase 1 verified 44 checks:
- Playwright against the live backend, asserting **computed styles** resolve to the exact token (e.g. page shells `--glass-2-bg` = `rgba(255,255,255,0.62)` light / `rgba(19,26,23,0.72)` dark; tier 3 = `0.90`/`0.92`; card radius 16px).
- **CDP media emulation** for `prefers-reduced-transparency` — Playwright cannot emulate it directly.
- The continuous-rAF scroll probe (`perf2.mjs`). **Run it on an idle machine.** A previous session returned ~99% dropped frames on *every* arm including the no-glass control — that was a throttled host (0 bytes free on C:), and it measures nothing. Uniform results across all arms means the host, not the design.
- `frontend/.claude/skills/verify/SKILL.md` — the project's own verification skill.

**Known-unmeasured, worth closing:** the light-mode chrome `saturate(220%)` figure has never been measured on a quiet machine. It's a one-token change (`--glass-1-blur`) if it proves costly.

**Final acceptance, after Phase 8:** walk every sidebar route in both themes, in one sitting, opening at least one dialog per screen. No screen may read as belonging to a different product than the one before it. That walk is the actual acceptance test — the per-phase checks only guarantee no single phase regressed.

---

## Explicitly out of scope

No phase touches data fetching, aggregation, permissions, pagination, scoring, the shortlist/reject flow, or email sending. **Every phase in this plan is visual.** `Pipeline.jsx` in particular persists real data and sends real candidate emails — visual-only changes there, no exceptions.

## Open items for the team

1. **Phase 8 — convert the prototype, or retire it?** It's a demo page kept for client walkthroughs and cited as a design reference by several components. Converting costs a phase; leaving it makes it look abandoned beside the real board.
2. **Phase 9 — how far into the public pages?** Recommendation above is typography/spacing/primitives only, keeping the email-mirroring shell.
3. **`package.json` pins `antd ^5.17.0`; 5.29.3 is installed.** The overlay tier needs ≥5.19 for the `modal`/`drawer` ConfigProvider config. Bump the pin to match reality before Phase 1, or a clean `npm install` on another machine breaks it.
4. **Pre-existing bug, unrelated but unfixed** (spotted during Phase 1, still open): `/candidates/:id` renders a raw JSON blob in Professional Summary for some records — the `summary` column holds serialised data rather than prose. Needs a look at what writes it during resume parsing.
