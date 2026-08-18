# UI / Theme Change Log

A running log of UI, theme, and UX changes to the AAPNA-ATS frontend.
Newest entries first. **Every UI change should be recorded here.**

---

## 2026-08-18 — Aurora Glass rollout, Phase 3: `/candidates`, and `.glass-3` finally rendered

`/candidates` joins `V2_ROUTES`. The route gate's separate `/candidates/:id`
regex is gone — the prefix match covers the detail view now, which is why the
regex existed only as a workaround for the split.

- **Search card → `glass-card spotlight`** — tier 2, and this page's one feature
  surface, matching how `/candidates/:id` spends the spotlight on its header
  card. Its inline `borderRadius`/`boxShadow` are dropped (the class owns both).
  **The `borderTop: 4px solid #7a922e` rail is dropped too** — a flat green bar
  under a gradient rim is the pre-glass vocabulary showing through.
  `usePointerSpotlight` is wired to the page root; safe here because the
  component has a single return, unlike `CandidateDetail` where the loading
  branch has to return an identical root or the listener detaches.
- **Table card → `glass-3 no-lift`** — tier 3, the dense-data tier. `no-lift`
  cancels the base `.ant-card:not(.no-lift):hover` rise; a records table bobbing
  as the pointer crosses it is wrong.
- **Empty state** adopts the Phase 2 `EmptyState`, in its two real shapes: a
  search that matched nothing (recoverable — offers Reset) versus a genuinely
  empty database (nothing to recover, so no button that would do nothing).
- **The initial-load `<Spin>` became a table skeleton.** The spinner occupied
  ~100px and the table then shoved the page down several hundred.
- **12 raw brand hexes → tokens.** The two remaining `#fff` are the foreground
  *on* a brand fill, which is how the app writes it throughout, and are
  commented as deliberate.
- **New `--violet` token** (both themes). `#7c3aed` was a lone hex on the
  Conversations action with no dark-mode pair, so it sat near-black on a dark
  ground. Semantic, not brand — it does not move when a tenant swaps palette.

### `.glass-3` was never rendered before this phase

It was written in Phase 0 for a "Recent Candidates" card that was replaced by
`LatestUploads` before shipping, so **no AntD table had ever been rendered
against it.** Rendering one turned up two things:

1. **The rules covered two surfaces out of six.** AntD paints an opaque fill on
   the table root, header cells, **body cells, the hover row, the empty
   placeholder and the pagination** — each from a different token. Only the
   first two were handled; the rest would each have been a white block floating
   on the tinted pane. All six are now transparent, row hover is a brand tint at
   7% (AntD's default `colorFillAlter` is an opaque grey bar over the pane), and
   the empty placeholder no longer highlights on hover — an empty table
   suggesting a clickable row is a lie.
2. **`.glass-3`'s `border-radius: 18px` was dead the day it was written.** The
   radius-scale rule sets `--radius-card` (16px) on `.glass-3` with `!important`
   and wins. With no consumer, nothing ever rendered to reveal the contradiction.
   16px is correct — the scale exists so cards don't drift — so the dead
   declaration was removed rather than escalated.

### Verified

`npm run build` clean. **34/34 computed-style assertions, both themes**, against
real AntD table DOM: tier-3 pane resolves to `--glass-3-bg` (0.90 light / 0.92
dark) and does not blur; tier 2 and tier 3 assert they *share one radius*; all
six AntD fills assert transparent; row hover asserts translucent (read from
`color(srgb … / a)`, which is how Chrome serialises a `color-mix` — an
rgba-only check reports a tint as opaque). Under
`prefers-reduced-transparency`, hover **survives as a cue** and only loses its
translucency — it is a real affordance on a clickable row.

**Scroll perf, continuous rAF, one `scrollBy` per frame** (the wheel-then-wait
probe reports phantom drops here), 100-row table, two arms:

| arm | median | p95 | dropped |
|---|---|---|---|
| control (no glass) | 8.3ms | 8.8ms | 1/235 (0.4%) |
| tier-3 glass | 8.4ms | 16.9ms | 4/235 (1.7%) |

The control being healthy at 0.4% is what makes the comparison meaningful — a
previous session's ~99%-on-every-arm result was a throttled host measuring
nothing. Glass costs 1.3 percentage points here, inside frame budget.

### Fixed along the way

**Four files were briefly corrupted by a PowerShell `Set-Content -Encoding
utf8`**, which double-encoded every non-ASCII character (em-dashes → `â€"`) and
added a BOM. Repaired by inverting the cp1252/UTF-8 round trip and verified
against the pre-damage commit: the diff is now exactly the intended edits and
nothing else. `VendorDashboard.jsx` was restored from git instead, since it had
not been mojibake and the repair would have damaged it.

---

## 2026-08-18 — Aurora Glass rollout, Phase 2: primitives and the token sweep

Additive by design — no converted route changes appearance. This phase exists so
phases 3–8 apply rules instead of inventing them.

### Empty and error states — one shape each

The app had ~30 ad-hoc empty states, most of them a bare `<Empty description="No
data" />`. That is not an answer on an enterprise screen: it says nothing about
*why* the list is empty (nothing uploaded yet? a filter excluded everything?) and
offers no way forward.

- **`components/common/EmptyState.jsx`** — icon, title, a body line saying why,
  and an action. The body is not decoration: the component's docblock spells out
  the two shapes it exists for ("nothing exists yet" vs "your filters hid it").
- **`components/common/ErrorState.jsx`** — the same block with the accent
  switched to `--red`, so a failed panel and an empty one read as one system
  rather than two. `onRetry` is the point of it; an error you cannot act on is a
  dead end. A raw exception is accepted but rendered only as small print, since
  "Request failed with status code 500" tells a recruiter nothing.
- Both are `.state-block` in `index.css` and are **deliberately not
  translucent** — they render inside an already-glass card, and glass over glass
  reads as a smudge.

### Loading skeletons shaped like what is arriving

`LoadingSkeleton` gained `list`, `board`, `chart` and `form` alongside the
existing `table` / `cards` / `detail`. The app still has ~25 centred `<Spin>`s
that collapse the layout and snap it back; the shapes they need now exist, so
converting a page is a swap rather than an invention. The chart skeleton is a
bar silhouette, not one grey rectangle — a flat block reads as a broken image.

### PageHeader, audited

It existed but **one page used it**, which is why title sizes and header spacing
varied per route. The layout was a single inline style object, which no
stylesheet can override — the exact trap the rollout plan calls Failure A. Now
`.page-header` in CSS, values unchanged except the bottom margin (28px →
`--space-6`/32px) so it lands on the scale. Also changed `Typography.Title
level={3}` to a plain `<h2>`: `level={3}` emitted an `<h3>` while acting as the
page's top heading.

### Density scale

`--control-h-compact/·/-relaxed`, `--row-py-*`, `--row-px`, `--card-pad-*`.
Table sizes and control heights were being chosen per page, so the same table
rendered at three different row heights depending on the screen. Theme-independent,
so they are defined once and not repeated in the dark block.

### Shared shells (the inline-style sweep)

- **`PANEL_STYLE` was duplicated byte-for-byte** in `Analytics.jsx` and
  `email/DeliveryMonitoring.jsx`. Both deleted; **14 call sites** now use
  `.panel-shell`.
- **`SECTION_CARD_STYLE`** (`VendorDashboard.jsx`, 2 sites) → `.section-card`.

Both classes carry values identical to the objects they replaced, so nothing
moves today — and Phase 6 can restyle them, which it could not have done while
they were inline.

### metricDefinitions extended

Ten entries added for metrics phases 5–6 will surface: the four `/analytics`
tiles (`activeInPipeline`, `awaitingFeedback`, `onHoldOverThreshold`,
`offersPending`) and the vendor/HR KPIs. **None of these numbers explains itself
anywhere in the product today**, and the vendor screens are the entire reachable
app for the `vendor` role. Written for recruiters, with provenance kept in
`// dev:` comments, per the file's existing convention.

### Verified

`npm run build` clean. **48/48 computed-style assertions, both themes.** The
load-bearing ones: `.panel-shell` and `.section-card` are asserted *identical to
the inline objects they replaced*, property by property, rendered side by side —
that equivalence is the whole safety argument for the swap. Density tokens are
asserted ordered compact < default < relaxed. Primitives are checked for
resolved (not fallen-back) colours in both themes, and PageHeader for the 24px/700
title, 4px subtitle gap and 32px bottom margin. Screenshots of the primitives
inside a real tier-2 card, both themes.

### Deliberately left

The primitives are **built, not yet adopted** — the ~30 existing `<Empty>` call
sites and ~25 `<Spin>`s are replaced by the phase that converts each route, so
this phase stays additive and no converted screen shifts. `PageHeader` is
likewise not retro-fitted onto pages that hand-roll their headers; each route
phase does its own.

---

## 2026-08-18 — Aurora Glass rollout, Phase 1: the overlay tier (tier 4) + the glass-card blur fix

Follows `docs/design/AURORA-GLASS-ROLLOUT-PLAN.md`. Phase 1 of 9.

### Tier 4 — one material for every dialog, dropdown and popover

The app has ~40 dialogs (37 `<Modal>` + 3 `<Drawer>`; `PipelineDrawer.jsx` alone
has 10 + 1). Every one of them portals into `document.body`, which is
structurally outside the `.ats-v2` wrapper — so no route gate reached them and
no scoped rule could style them. On a glass app they all opened as flat white
boxes. That was the single largest visual gap in the product.

- **`OVERLAY_CONFIG` in `App.jsx`** stamps `ats-overlay` / `ats-overlay-mask` /
  `ats-overlay-popup` / `ats-overlay-tip` onto every instance via
  `ConfigProvider` — modal, drawer, select, datePicker, dropdown, tooltip,
  popover, popconfirm. **No per-file JSX edits and no `getContainer` changes.**
  Slot names were verified against the installed antd (`content`/`mask` on
  rc-dialog + rc-drawer, `classNames.popup.root` on Select/DatePicker).
- **`dropdown` is a plain `ComponentStyleConfig`** (className only, no slots) —
  the plan assumed slots. Its className lands on the popup root, which is the
  element we wanted, so the same mechanism works.
- **The tier-4 block in `aurora-glass.css` is deliberately UNSCOPED**, the third
  documented exception in that file, for the portal reason above. The file
  header now lists all three rather than claiming one.
- **`Modal.confirm`/`.warning` bypass ConfigProvider entirely** (9 call sites,
  static methods, no context). They are matched directly via
  `.ant-modal-confirm .ant-modal-content` so they don't stay flat.
- **Tooltips deliberately opt out of the material** and stay a solid chip. A
  tooltip is a two-line label under the cursor over arbitrary content;
  translucency there costs legibility and buys no depth cue at that size. It
  takes the tier's radius and shadow, not its fill.
- The mask is now a scrim mixed from `--shade-rgb` (the brand mid-tone the depth
  ramp already uses) instead of AntD's flat black 45%, so the page recedes
  rather than dimming. Dark mode's goes near-black — a brand-tinted scrim over
  an already-dark ground reads as green fog.
- Drawers keep the edge they are anchored to square, per placement.

### The `.glass-card` blur fix

`aurora-glass.css` documented "NO backdrop-filter on scrolling content
surfaces", but the unscoped base rule at `index.css:850` set
`backdrop-filter: blur(12px)` and the `.ats-v2` override never cancelled it —
**every tier-2 card in the app was quietly blurring**, paying for a blur the
design had explicitly declined. Cancelled on `.ats-v2 .glass-card` (not in
index.css, so surfaces outside the scope keep what they shipped with).

### Fixed along the way

**`.ant-modal-content` carried `border-radius: … !important`** (`index.css`),
which outranked every per-modal radius below it. `.dash-cmdk`'s 16px had
therefore *never* applied — it had been rendering at `--border-radius-lg` since
it was written. The `!important` had nothing to fight (AntD sets that radius
through a low-specificity token rule), so it was removed; the bespoke radii and
the tier-4 radius both apply now. Found by the verification below, not by eye.

**`package.json` pinned `antd ^5.17.0` while 5.29.3 was installed.** The overlay
tier needs ≥5.19 for the `modal`/`drawer` ConfigProvider config, so a clean
`npm install` on another machine would have silently produced an app with no
overlay tier. Pin bumped to `^5.29.3` to match reality.

### Verified

`npm run build` clean. **64/64 computed-style assertions, both themes**
(Playwright + real AntD DOM against the shipped stylesheet): tier-4 fill
resolves to `--glass-4-bg` on modal / drawer / confirm / select / dropdown /
popover / picker; header, footer and drawer body transparent; radius 18px;
drawer edge square; tooltip confirmed opaque; mask is not black-45.
Non-regression: `.conv-modal` and `.dash-cmdk` keep `padding: 0` and their own
radii, and the `.ant-modal` viewport caps still hold at 1366×768
(`max-width: 1334px`, body `max-height: 548px`, `overflow-y: auto`) — the fix
that keeps footer buttons reachable on a small laptop. Blur fix asserted both
ways: `.glass-card` inside `.ats-v2` is `none`, the same class outside it still
blurs. `prefers-reduced-transparency: reduce` (via CDP — Playwright cannot
emulate it) confirmed opaque with no blur on overlays, popups, confirms and the
mask. Screenshots of the tier over a live aurora canvas in both themes.

### Deliberately left

Tier 4 is global by construction, so dialogs on **unconverted** routes get it
too — intended, not a leak: it is the one tier where half-conversion is
impossible. `PipelineDrawer`'s 10 modals and the other in-app dialogs inherit it
with no file edits, so they were not walked one by one; the material is proven
at the CSS contract instead. Everything else in the plan (primitives, routes)
is phases 2–9.

---

## 2026-08-13 — Dashboard: card graphs follow the filters, and hover text written for users

Two reported faults on the redesigned `/dashboard`, both fixed here.

### 1. The KPI card graphs never changed

The four sparklines were built as `sparkSeries(normCandidates, 7)` — a **hardcoded 7 days**
off the **unfiltered** candidate list. Moving the range control between 7d/30d/90d, or
picking a role, redrew Hiring Trends and left all four card graphs identical. Worse, Total
Candidates and Today's Uploads were handed *the same variable*, so two of the four were
literally the same line. A filter that visibly does nothing reads as a broken page.

- `pages/Dashboard.jsx` — every card series, delta and footnote now derives from
  `rangeDays` and `role`. The MRF series filters on `mrf.role`, the shortlist series on
  the pipeline's `job_title`.
- **Total Candidates now plots a running total** (`cumulativePoints`) rather than a rate,
  so it no longer duplicates Today's Uploads and the line is finally the headline number's
  own history. Guarded two ways: it falls back to the per-day rate unless the candidate
  sample reaches back past the window start (`sampleCoversWindow`) and no role filter is
  narrowing it against an all-roles total.
- Footnotes distinguish figures that ARE role-filtered (`· Java Developer only`) from the
  server-side counts that are not (`· all roles`). Labelling a global count as one role's
  would have been a plain untruth.
- `weekOverWeek` → `periodOverPeriod(items, days)`: the delta chip compared 7 days against
  7 while the reader had 90 selected. `weekOverWeek` remains as a thin wrapper.
- New in `utils/dashboardAggregations.js`: `sparkPoints`, `cumulativePoints`,
  `sampleCoversWindow`, `periodOverPeriod`.

### 2. Hover text was missing, or written for developers

The `<MetricInfo>` panel ended every definition with a monospaced `GET /dashboard/stats ·
rpa_cv`, explained counts as `approval_status in (pending, waiting, approved)`, and carried
roadmap notes ("server-side aggregation is planned") — a developer's answer to a recruiter's
question, and the roadmap note actively undermined the number it described.

- `constants/metricDefinitions.js` rewritten in plain English throughout. Endpoint and table
  names moved to `// dev:` comments beside each entry. Labels changed from `How:` / `Chart:`
  to `How it's counted:` / `The graph shows:` / `Where it comes from:` / `Good to know:`.
- `MetricInfo` gained a `chart` prop, because a fixed definition cannot describe a graph
  that follows a live date range — each card passes a sentence naming its own quantity and
  the selected period.
- **The KPI sparklines answer a hover for the first time.** They were the only charts on the
  page that named nothing. The readout is an AntD tooltip driven by Recharts' hit-testing,
  not a Recharts tooltip: the band is 54px and `overflow: hidden` (it bleeds to the card's
  rounded corners), so a Recharts tooltip would be clipped inside it. It tracks the hovered
  point horizontally via `align.offset`.
- Hover text added or rewritten across the rest of the page: hero greeting, clock, live
  badge, both CTAs, both global filters (each says what it changes **and** what it doesn't —
  the card totals stay put, which otherwise looks like the control is broken), the stat
  values and delta chips, funnel stages and step-conversion markers, recruiter bars, talent
  bars, live-feed rows, latest-upload rows, interview rows, and the action-centre rows and
  all-clear state. Row tooltips recover what the row truncates: full names, roles, emails,
  exact times.
- `ConversionFunnelCard` had a definition in the registry it never rendered — the one widget
  describing the whole hiring process was the only one you couldn't hover for an
  explanation. `RecruiterBreakdownCard` had its own hand-written duplicate explanation;
  both now render `<MetricInfo>`.
- The range control gained a "PERIOD" label (`.dash-hero__filter-label`) — the 7d/30d/90d
  pills sat unlabelled next to a role dropdown with nothing saying they were global filters.

**Verified:** `npm run build` clean; the new aggregation helpers exercised against a
40-day fixture (cumulative series lands exactly on the real total and never goes negative;
period deltas correct at 7d and 30d; empty and no-prior-period inputs return `null` rather
than a fake 0%). **Not verified in a browser this pass** — no browser tooling in this
environment; the running dev server on :5173 will have hot-reloaded it.

---

## 2026-08-13 — Aurora Glass rollout, Phase 1: `/candidates/:id` and `/filtering`

The first two routes to actually join `.ats-v2`, per the phase list in the Phase 0 entry
below. Both were chosen to lead because their page-level cards already carried
`.glass-card`, so the tier-2 pane, gradient rim, specular sheen and depth ramp arrived
with no JSX change at all.

**The gate is now a list, not a prefix** (`MainLayout.jsx`). `isV2` was
`location.pathname.startsWith('/dashboard')`; it is now a module-level `V2_ROUTES`
array plus one regex. The regex exists for a specific reason: Phase 1 takes the candidate
**detail** view but *not* `/candidates` itself, which is the records table and belongs to
Phase 2. A plain prefix match would have dragged it in and given it glass chrome above
flat, un-converted cards — the exact half-converted state the phased rollout exists to
avoid. So `/candidates/:id` is matched as `/^\/candidates\/[^/]+/` rather than by listing
the prefix.

### Widening the boolean was the small half of the job

The claim in the Phase 0 entry — that a route "just works" once its cards carry the right
class names — held for the two page shells and for nothing nested inside them. Both pages
put their real content in surfaces that painted **opaque fills inline**, and an inline
style cannot be overridden by any stylesheet. Unfixed, each would have stayed a flat grey
slab bolted onto a glass pane:

| Surface | Was |
|---|---|
| Results list (`.cand-card`, up to 100 rows) | `--gradient-card !important` — tier-2 weight for a dense list |
| Search-summary bar | inline `--ink-3` |
| Select-this-page bar | inline `--ink-4` |
| Education accordion (×3) | inline `--ink-3` |
| Role JD context panel | inline `--color-primary-bg` |
| Segmented tab track | opaque `--ink-3` capsule (`index.css`) |
| Professional Summary callout | inline `--gold-subtle` |
| `Descriptions bordered` | AntD's opaque `colorFillAlter` label column + solid container |

Each inline case moves into a class in `index.css` whose declarations are **byte-identical
to the values it replaces**, so nothing outside `.ats-v2` shifts by a pixel; only then can
the `.ats-v2` block in `aurora-glass.css` restyle it. This is the same move already made
for `.premium-stat-card`'s inline background and border-top, and for the same reason.
`!important` is used on both sides so the two rules are settled by specificity rather than
by cascade order against AntD's runtime-injected styles.

**The results list is tier 3, not tier 2** — the one question the phase plan explicitly
asked to confirm. A hundred-row stack is precisely the case tier 3 exists for: near-opaque,
no `backdrop-filter`, `--depth-1` instead of `--depth-2`. Selected rows keep a brand tint
over that tier rather than the base rule's opaque `--ink-2` gradient, so a selected row
still reads as the same material as its neighbours.

**The bordered `Descriptions` table** was the largest opaque rectangle on the detail page.
Its container now goes fully transparent — the glass card beneath it *is* the surface — and
the label column keeps a 7% brand tint so the label/value rhythm survives without a hard
fill.

### Shared-class audit (the non-regression the rollout requires)

Every phase that touches a shared base class has to re-check the other pages using it:

- **`.cand-card`** — CandidateScreening only. Safe.
- **`.screening-tabs`** — also used by `Analytics.jsx`. Analytics is Phase 3 and not in
  `.ats-v2`, so the new rule is inert there today; when Phase 3 lands it inherits the same
  segmented treatment for free, which is the wanted outcome. **Known coupling — do not
  "clean up" this rule during Phase 3 without checking both pages.**
- **`.ant-descriptions-bordered`** — also used by `PipelineDrawer` (a portal, structurally
  outside `.ats-v2`), `HRUpload`/`VendorPortal` (Phase 4) and `MrfApprovalAction` (a
  `ForceLight` public page outside `MainLayout`). Scoped rule ⇒ no effect today.
- The five new class names appear nowhere else in `src/`, which is asserted at the DOM on
  `/login` rather than argued.

### Deliberately left alone

- **Everything inside the drawer and the two modals.** `CandidateScreening.jsx:1844`
  onwards is `createPortal` / `Drawer` / `Modal` — all render into `document.body`, so
  `.ats-v2` structurally cannot reach them. That includes the floating shortlist dock and
  the ~10 `--ink-3`/`--ink-4` panels in the candidate drawer. Consistent with the standing
  decision to leave AntD's modal/drawer chrome untouched app-wide until Phase 5 resolves it.
- The 64px `--gold-subtle` disc in the screening empty state — a decorative brand mark, not
  a surface; it reads correctly on glass as-is.
- `CandidateDetail`'s read-only `--ink-4` inputs, which live in the edit modal (portal).

### Also

- **The header card on `/candidates/:id` gains the cursor spotlight**, this page's
  hero-analog, matching how the dashboard spends it on exactly one feature surface.
- That required moving the loading skeleton **inside** the page root rather than returning
  it early. `usePointerSpotlight` binds its delegated listener to `rootRef.current` once and
  re-runs only when the *ref* identity changes, never when the DOM node behind it does. Two
  identical roots at the same position let React reuse the node across the loading→loaded
  flip; a Fragment or a different element type in either branch would leave the listener
  bound to a detached div and the spotlight silently dead. Noted in the code, because it is
  the kind of thing a later tidy-up breaks without any visible error.
- Every new surface is added to the `prefers-reduced-transparency: reduce` fallback. One
  exception is carved out there: the selected `.cand-card` keeps a solid brand border rather
  than going fully flat, because that border is the **only** cue for which rows are in the
  bulk shortlist/reject set.

**No changes to data fetching, screening/scoring logic, permissions, pagination, or the
bulk shortlist/reject flow.** This phase is visual.

**Verified:** `npm run build` clean, plus **44 automated checks green** against the live
backend in both themes, asserting on computed styles rather than screenshots alone. Every
surface resolves to its exact token — page shells `--glass-2-bg`
(`rgba(255,255,255,0.62)` light / `rgba(19,26,23,0.72)` dark), results list, summary bar,
select-all bar and tab track all `--glass-3-bg` (`0.90` / `0.92`), card radius 16px =
`--radius-card`. Also asserted: the bordered `Descriptions` container computes
`rgba(0,0,0,0)`; the spotlight publishes `--mx` on pointer move; `/dashboard` still carries
exactly one `.ats-v2`; **`/candidates` carries none and mounts no `AmbientBackdrop`**, with
its table still rendering; the portal shortlist dock is unaffected; and `/login` contains
none of the five new class names. Under CDP-emulated `prefers-reduced-transparency: reduce`
the aurora is gone and the shell computes a flat `rgb(255,255,255)`.

Scroll performance on `/filtering` with a full result set, measured with the continuous
rAF `scrollBy`-per-frame probe (a wheel-then-wait probe reports phantom drops here):
**16.6ms median / 5% of frames >20ms in light, 16.7ms / 7.2% in dark** — 60fps, in line
with the dashboard's post-fix 5.3% figure. Tier 3 carries no `backdrop-filter`, which is
what keeps a 100-row list cheap.

**Spotted while verifying, NOT fixed (pre-existing, unrelated to this phase):** on
`/candidates/:id` the Professional Summary card renders a raw JSON blob —
`{"EmailID":"…","id":290}` — for at least some records, i.e. the `summary` field holds
serialised data rather than prose. The card is doing its job; the value it is handed is
wrong. Needs a look at what writes `summary` during resume parsing. The same record also
shows "0% Match" and an empty Notice Period.

**Not built this pass:** Phases 2–6 (Candidates/Pipeline, both Analytics pages, the
vendor/HR batch, Settings/Email/prototype, admin portal). Phase 0's `.kpi-card` block
remains inert — re-confirmed that its five consumers (`Analytics`,
`CandidatePipelinePrototype`, `HRUpload`, `VendorDashboard`, `VendorPortal`) all belong to
later phases and none is in `V2_ROUTES`.

## 2026-08-13 — Aurora Glass rollout, Phase 0: `.kpi-card` glass tier (foundation only)

First step of taking Aurora Glass beyond `/dashboard` app-wide (see the two Aurora Glass
entries below for the pilot and its scope). Rather than widening `isV2` in one shot, the
rollout is phased route-by-route — `.glass`/`.glass-card` are already reused unscoped by
several screens with no aurora canvas behind them, so a naive one-shot widening risks
silently inconsistent pages (chrome goes glass, cards don't). This entry is Phase 0: CSS
only, no route's `isV2` gate touched.

**`.ats-v2 .kpi-card`** (`src/theme/aurora-glass.css`) — a second, older KPI-card component
(`components/common/KpiCard.jsx`, shared by Vendor Dashboard, Vendor/HR upload and the
Pipeline prototype) had zero rules in `aurora-glass.css`; only `.premium-stat-card`
(Dashboard's own KPI cards) had been given the glass treatment. Added the same tier-2 glass
background/border/shadow plus a metric-colour tint, keyed off the component's existing
`--kpi-color` custom property. One structural difference from `.premium-stat-card`:
`.kpi-card` is a bare div, not an antd `Card`, so there's no `.ant-card-body` to hang the
tint on, and its own `::before` is already spoken for (the sweeping top accent bar) — so the
tint overlay uses `::after` instead, and the accent bar plus the four content spans get
`z-index: 1` to sit above it. Their existing `position` values are left untouched, since
`.kpi-card__glow` depends on its own absolute top/right offsets. Also added `.kpi-card` to
the shared `--radius-card` list and to the `prefers-reduced-transparency: reduce` fallback
block, alongside the other glass surfaces.

**Currently inert.** No page renders `.kpi-card` under `.ats-v2` yet — `KpiCard` doesn't
appear on `/dashboard`, and none of its four consumer routes have joined `isV2`. This simply
pre-clears the CSS so a later phase can widen `isV2` for those four routes with no further
JSX change, the same way `.glass-card` already restyled Dashboard's widgets for free because
they already carried the right class name.

**Verified:** `npm run build` clean, no CSS errors; confirmed `KpiCard` is unused in
`Dashboard.jsx` (so `/dashboard` is unaffected). **Not built this pass:** every other phase
of the rollout (route-by-route `isV2` widening for Candidates/CandidateDetail/
CandidateScreening/Pipeline/Analytics/AnalyticsLegacy/HRUpload/MRF/VendorPortal/
VendorDashboard/Settings/EmailManagement/CandidatePipelinePrototype, plus a separate pass for
the admin portal) is deliberately deferred to later sessions.

### The full rollout plan (phases 1–6, not started — recorded here for continuity)

The mechanism: `MainLayout.jsx:183`, `const isV2 = location.pathname.startsWith('/dashboard')`,
puts `.ats-v2` on the outer `<Layout>` (Sider + Header + `<Outlet/>` together) and mounts
`<AmbientBackdrop/>`. Widening it only "just works" for a route whose cards already carry the
exact class names `aurora-glass.css` targets (`.glass-card`, `.glass-3`, `.premium-stat-card`,
`.dash-hero`, `.spotlight`, now `.kpi-card` too); elsewhere it needs per-page work first.

**Verified landmine:** bare `className="glass"` (no `-card`/`-3` suffix) is styled by a
separate, non-aurora rule in `index.css:840` and is *never* touched by `aurora-glass.css`.
`Analytics.jsx` (lines 464, 496) and `AnalyticsLegacy.jsx` (lines 995, 1027) both use it —
widening `isV2` for those routes as-is would re-theme their chrome while those specific cards
stayed flatly unchanged.

- **Phase 1** — `/candidates/:id` (`CandidateDetail.jsx`), `/filtering`
  (`CandidateScreening.jsx`). Both already use `.glass-card` correctly; widen `isV2`, then
  audit for inline `style`/`bodyStyle` that would shadow the new rules (the exact bug the
  topbar's `background: isV2 ? undefined : ...` guard at `MainLayout.jsx:481` avoids), and
  confirm `CandidateScreening`'s results list is `.glass-3` (tier 3) not `.glass-card`.
- **Phase 2** — `/candidates` (`Candidates.jsx`), `/pipeline` (`Pipeline.jsx`). No existing
  glass classes — net-new JSX: table container → `.glass-3`, non-scrolling toolbar →
  `.glass-card`. `Pipeline.jsx` is the real Module-1 board (persists to `/api/pipeline`,
  sends real emails) — visual-only changes, no touching data/permission logic.
- **Phase 3** — `/analytics`, `/analytics-legacy`. Mandatory rework (see landmine above):
  rename the tab-shell `Card className="glass"` to `glass-3`; consolidate the ad-hoc
  `tile.bg`/`tile.color` KPI tiles onto the shared `StatCard`/`.premium-stat-card` pattern
  (gains `MetricInfo` tooltips they currently lack); strip inline `border`/`boxShadow`/
  `background` overrides that would otherwise shadow the new class.
- **Phase 4** — `/hr-upload`, `/mrf`, `/vendor`, `/vendor-dashboard`. Ship together: per
  `VENDOR_ALLOWED_PATHS` in `MainLayout.jsx`, `/vendor` and `/vendor-dashboard` are the
  *entire* reachable app for the `vendor` role, so converting only one would flip a vendor's
  chrome between glass/non-glass every click. Thanks to this Phase 0 entry, their `.kpi-card`s
  should light up with no JSX change; only the records tables need `.glass-3` added.
- **Phase 5** — `/settings`, `/email`, `/candidate-pipeline-prototype`. `Settings.jsx` is
  net-new (no existing classes); `EmailManagement.jsx` already uses
  `"glass no-lift email-pane-card"` — rename to `glass-3 no-lift` (the pre-existing `no-lift`
  already implies tier-3 intent). `CandidatePipelinePrototype.jsx` has 7 modals + 1 drawer
  with no established glass treatment anywhere in the app — leave AntD's default modal/drawer
  chrome untouched app-wide rather than inventing a tier under time pressure; open question.
- **Phase 6** — Admin portal (`/admin/dashboard`, `AdminDashboard.jsx`). Biggest structural
  departure: `MainLayout.jsx`'s `isAdminPath` branch (lines 229–329) has its own
  `admin-topbar` header, no `Sider` at all, and its own independent `.admin-stat` KPI family.
  Widening `isV2`'s path check does nothing here by itself — the admin branch never applies
  `.ats-v2` or mounts `<AmbientBackdrop/>` today. Planned approach: keep the header-only shell
  (no Sider — that's a nav redesign, not a visual one) but mount `<AmbientBackdrop/>`, add
  `.ats-v2` to the admin `<Layout>`, give `admin-topbar` the tier-1 chrome treatment, and add
  an `.ats-v2 .admin-stat` block mirroring this entry's `.kpi-card` approach. A full
  Sider-based admin nav is a larger, separate structural change, deferred beyond this.

**Out of scope for the whole rollout:** AuthLayout (`/login`, `/admin/login`,
`/forgot-password`, `/reset-password`) — a distinct tree `isV2` never reaches, and the
pilot's own `/login` pixel-diff anchor. Public `ForceLight` pages (`/missing-jd-upload`,
`/mrf-submit`, `/mrf/:id/approve`, `/documents/:token`, `/scorecard/:token`) — rendered
outside `MainLayout` entirely, so `.ats-v2` structurally cannot reach them regardless.

Sequencing rationale: 1 (audit-only, lowest risk) → 2 (new tier-3 JSX, biggest tables) → 3
(the two pages that actually break the "just widen the boolean" premise) → 4 (batched,
one role's whole UI) → 5 (lowest traffic, surfaces the modal/drawer question) → 6 (biggest
structural departure, saved for last so the CSS patterns are fully proven elsewhere first).
Every phase repeats this entry's verification set: both themes, CDP
`prefers-reduced-transparency` emulation (Playwright can't do it directly), the app-wide
`prefers-reduced-motion` guard, a shared-class non-regression diff generalized from the
`/login` pixel-diff (any phase touching a shared base class must re-diff every other page
still using that class unscoped), an inline-style audit, and — for any table/list — the
continuous rAF `scrollBy`-per-frame perf probe (a wheel-then-wait probe reports phantom drops
from rAF scheduling gaps, not real paint cost, per the entries below).

## 2026-08-13 — Light mode settled (white chrome), and four data-integrity bugs

Closes out the V3 entry below. The light-mode iteration had over-corrected into a
mid-olive page; this fixes that in one pass and then stops. Dark mode is untouched
throughout — it was signed off as correct and is guarded by `[data-theme='dark']`
overrides on every surface this touches.

### Light mode: near-white ground, WHITE nav and topbar

- Ground `#fbfcf7`, corner field alphas halved again to `0.13 / 0.11 / 0.08 / 0.06`,
  hero pane raised to 0.92 white with its mesh at 0.28 opacity. Measured: page
  `rgb(249,249,244)`, hero `rgb(244,247,238)`, nav `rgb(255,255,255)`.
- **The nav and topbar are opaque white in light mode**, not tinted glass. This could
  not be achieved by lowering alpha — a translucent pane is only ever as neutral as
  what shows through it, so it needed an explicit fill. The blur goes with it (there
  is nothing to blur through an opaque surface), which is also a small perf saving.

### Four bugs, all visible in a screenshot of real production data

**1. "MRFs pending approval: 50" was both mislabelled and truncated.** The dashboard
derived it from `GET /api/mrf?status=pending&limit=50` and took `array.length`. Two
independent defects:
- **Wrong column.** `buildMrfWhere()` maps `status=pending` onto **`mrfstatus`** — the
  manager's *submission* state (`pending` / `pendingfromleader`) — not
  `approval_status`. A row labelled "pending **approval**" was counting requisitions
  that had not been submitted yet. This is why the dashboard could show "Active MRFs
  21" beside "50 pending approval": the two figures were reading different columns.
- **Truncated.** `.length` of a page capped at `limit=50` can never exceed 50, so the
  number silently plateaus at 50 forever once there are 50+ matches. The endpoint does
  return `pagination.total`; the hook discarded it.

Fixed by counting it server-side in `getStats()` as `pendingApprovalMRFs`
(`approval_status = 'pending'`, same `filled_at` exclusion as `activeMRFs`, so the two
are consistent by construction) and reading that. Relabelled "awaiting approval".

**2. Two different "Shortlisted" numbers on one screen** (74 in the KPI card, 78 in the
funnel). `getStats` had two predicates both surfaced as "Shortlisted": the KPI counted
`pipeline_status in (shortlisted, selected)`, the funnel counted "every shortlist row
not explicitly rejected" — which also swept in on-hold and in-progress rows and
overstated the funnel. Both now use the same count.

**3. One job title appeared as several bars in Talent Insights.** `topByField` grouped
on the trimmed raw string, so "Product Sales Executive", "product sales executive" and
"Product  Sales  Executive" counted as three roles — the duplicate
"Product Sales Executi…" rows in the screenshot. It now groups on a normalised key
(lower-cased, internal whitespace collapsed) while displaying the first spelling
encountered, so the label still reads the way recruiters typed it. Verified: three
spellings of one title collapse from 6 bars to 4.

**4. The greeting name, in two stages.**
- It was `user?.firstName || user?.username`. **`firstName` (camelCase) does not
  exist** — `/auth/me` spreads the raw `rpa_users` row, so the fields are `first_name`
  and `last_name`. The condition therefore always fell through and rendered the raw
  login handle: "Good evening, harish.mopuri".
- Reading `first_name` then exposed a second issue: some records store an abbreviated
  first name (one real account holds `"Har"`), so greeting on that field alone still
  looked cut off. The greeting now uses **first + last**, which shows everything the
  row contains.

**Confirmed NOT a display bug.** Before changing anything a second time, the frontend
was tested against four name shapes including a 41-character one: in every case the
DOM's `textContent` held the complete name, horizontal overflow was 0px, and the
heading computes `white-space: normal` / `overflow: visible` / `text-overflow: clip`.
No `slice`, `substring` or CSS ellipsis touches a name anywhere in `src/` — the only
`[0]` uses are deliberate avatar initials. So a short greeting means a short value in
the user record; correct it in **Admin Portal → Users → First Name**.

**Also:** the "Based on the 200 most recently added candidate profiles" line was
removed from under two card titles and now surfaces through those cards' `MetricInfo`
caveats instead — still stated, no longer printed as a standing apology. **The
underlying sampling bug is unchanged and still outstanding.**

**Environment note:** the machine hit 0 bytes free on C: mid-session, which is what
made several commands fail and what produced the nonsense perf readings (~99% dropped
frames on *every* arm including the no-glass control). ~3.6 GB was reclaimed from the
npm cache. **The `saturate(220%)` chrome-blur figure remains unmeasured** — see the
caveat in the V3 entry; light mode's opaque chrome now skips that blur entirely in the
common case, which likely makes the question moot.

**Verified:** 9 checks green, asserting on the exact production numbers that exposed
these bugs (both MRF figures agree at 6; 74 appears twice and 78 not at all; 4 bars
with one sales label; greeting reads "Harish"), plus sampled pixels for the white nav
and near-white page and hero, in both themes.

## 2026-08-12 — Design V3: real brand mark, composed dashboard, per-org theming, records view

Follow-up to the Aurora Glass pilot below, which was judged "not awe-inspiring". Fair: it
made the surfaces prettier without fixing what the screen *is*. This pass attacks structure,
brand and data honesty.

### The AAPNA rotor as vector — and why it took four attempts

Source: `C:\Users\hmopuri\Pictures\AAPNA Log.jpg`, a 200×200 white-background JPEG. Now
`src/components/common/AapnaLogo.jsx`, traced with potrace and **verified against the original
at 3.2% pixel disagreement**. Four defects were found by measuring rather than eyeballing, each
worth knowing if this is ever regenerated:

1. **Rotation centre.** The ink bounding box is 181×153 and off-centre, because the solid green
   wedge overshoots the ring. Framing on the bbox would make the mark wobble when rotated. The
   true centre of rotational symmetry is (88,102), found as the largest circle inscribed in the
   central hole. The exported viewBox is square and centred on it, so `rotate()` needs no
   `transform-origin`.
2. **`fill-rule`.** The three outline blades are hollow and wound for `evenodd`. With the
   default `nonzero` they filled solid — **43% disagreement vs 3.2%**. `fillRule="evenodd"` on
   the SVG is load-bearing, not decoration.
3. **Upscaling order.** Classifying at 200px then replicating pixels 4× gave potrace 4×4
   staircases to trace faithfully: 28KB of path data. Scaling bicubically *first*, then
   thresholding, plus a low-pass to kill the JPEG's edge ringing, got the same fidelity in
   **7.3KB**.
4. **A phantom dark rim.** The green test was `G > R+15 AND G > B+40`. Where green blends into
   white, R and G both converge on 255, so `G > R+15` fails — and those antialiased edge pixels
   fell into the *dark* mask. The trace grew a thick dark outline around the wedge that does not
   exist in the logo. `(G − B) > 22` separates cleanly across the whole blend ramp.

A from-scratch geometric rebuild was also tried (390 bytes, four arcs) and **rejected at 24%
disagreement** — the crescent end-caps are chord cuts, not radial, and fitting them wasn't worth
the remaining error.

**Where the vector is used:** the background rotor, the hero corner accent, and the collapsed
72px rail. It does **not** replace the official bitmap in the expanded brand slot or the admin
topbar. The rail case is not a compromise — the rotor device at the left of the official logo is
the very mark being traced.

**Backdrop:** the rotor at 70vmin bleeds off the bottom-right corner, turning once per ~140s.
The mark is a pinwheel, so rotation is the shape's own logic rather than an effect imposed on it.

### The brand slot said the company name twice

- The logo bitmap already reads "aapna", and the label beside it repeated **"AAPNA"** over
  "ATS PLATFORM". Dropped to a single "ATS Platform" product label behind a divider.
- **The logo was cropped mid-badge.** `objectFit: 'cover'` at `width: 74` sliced the Great Place
  To Work badge off and left "CMMIDEV/3 CERTIFIED" dangling — it read as broken, not certified.
  Now `contain`, with the logo taking all flexible width (`flex: 1`) and the label only what its
  text needs, so the mark is as large as the sidebar allows.
- **Dark mode inverted a colour badge.** Un-cropping exposed a latent bug: `invert(1)` turned the
  GPTW badge's red to cyan. It now sits on a light chip — the same approach `AuthLayout` already
  used for this logo on a dark panel.
- Collapsed rail showed an unreadable "aa" fragment; now the square rotor.

### Per-organization theming (groundwork, `theme/brands.js` + `context/BrandContext.jsx`)

Two orthogonal axes: `mode` (light/dark, user's choice, already shipped) × `brand`
(organization's choice, new). Verified end-to-end: flipping a `localStorage` brand flag repaints
primary colour, aurora, gradients and product label with **zero code edits**.

- `--gold` / `--ink` and friends **keep their names** and are aliased onto `--brand-*`. Those
  names appear in hundreds of places; renaming them would be repo-wide churn for no user benefit.
- Brand tokens are emitted as `-light`/`-dark` **pairs** and CSS selects between them. Writing
  only the active mode's values inline on `<html>` would have overridden the `<ForceLight>`
  wrapper, so the public token-link pages (`/mrf-submit`, `/mrf/:id/approve`,
  `/missing-jd-upload`) would render with dark-mode brand colours in a dark session.
- Next session is additive: store a theme JSON per company (`rpa_settings` takes
  `theme.company.<id>` with no migration) and pass it to `BrandProvider` as `overrides`.

### Composition, not decoration

Four ad-hoc row shapes (16/8 → 8/8/8 → 24 → conditional 8/16) replaced by consistent 24-column
bands. Widgets previously moved between rows depending on whether data existed, so the page's
shape changed with the data; they now have fixed homes and own their empty states. Also fixed:

- Quick Actions' **permanent empty grid cell** (7 items in 2 columns) — now a single-column
  launcher, which has no hole at any count.
- Five competing corner radii → one `--radius-card`.
- **Square corners.** The specular sheen is a pseudo-element on `.ant-card-body`, and
  `border-radius: inherit` inherited the *body's* radius, which AntD leaves at 0 — so it painted
  a square whose corners poked past the card's rounded edge. The KPI cards masked it with
  `overflow: hidden`; the widget cards can't (it would clip Recharts tooltips). Now an explicit
  `calc(var(--radius-card) - 1px)`, nested inside the 1px border.
- Y-axis role labels clipped ("enior React Engineer") — widened, plus ellipsis truncation.
- Sidebar "Recruitment Analyti…" → "Analytics (Legacy)".

### KPI cards: graphs back, with real series for all four

Every card now has identical anatomy — icon, delta, label, value, footnote, **sparkline** —
where an earlier revision of this pass had dropped the graphs because only the two
candidate-derived metrics had a client-side series. Rather than drop them or fabricate data,
MRF and shortlist series are derived from batches the page already fetches.

**The line is a rate, the number is a total.** Those are different quantities, so every metric's
definition states what its line plots rather than letting the reader assume it's the total's
history.

### Light mode — and the wrong diagnosis I had to reverse

Dark mode was already right. Light mode read flat, and my first diagnosis was **value
contrast**: near-white cards on a near-white page have nothing to separate against. So I
darkened the ground (a dedicated `--brand-canvas-deep`, scoped to the dashboard backdrop so no
other screen shifted) and added an edge vignette.

**That was wrong, and it was reverted.** It bought separation at the cost of the airiness the
design wants, and it still didn't feel premium — because the problem was never brightness, it
was **chroma**. A light-mode glass reference (the Spinova prototype) makes the opposite choice
and gets there: its ground is `hsl(228 34% 96%)` — almost white, but heavily *saturated*. Three
techniques ported from it (technique, not hue — that design is blue/violet, this one olive):

1. **Coloured shadows.** Its `--shade` token is a saturated mid-tone, never black, and every
   shadow is mixed from it. Grey shadows on a light ground read as dirt; brand-hued ones read as
   glow. This was the single biggest change — `--shade-rgb` now drives the whole light depth ramp.
2. **High `saturate()` through the pane** — `blur(34px) saturate(220%)` in light against dark
   mode's `165%`. Over a light ground the colour behind glass needs amplifying, not just admitting.
3. **A much more transparent fill** (`0.56` for features, `0.55` for chrome, down from `0.70`),
   so the colour field actually reaches the surface — paired with a **full-opacity white inner
   top edge**, which is what keeps the pane's edge crisp at that transparency.

The ground went back to near-white-but-saturated (`#f6f9ec`), and the edge vignette was replaced
by a **centre bloom** that *adds* light at the core rather than removing it at the rim. Per-card
metric tint went from a perceptually-absent 9% to 13%, so the four KPI cards stop reading as four
identical white rectangles without becoming solid colour blocks.

**Two further corrections after seeing it on real data**, both of which came from *measuring*
rather than looking:

- **The field was ~3× too strong.** Chasing chroma, I had pushed light aurora alphas to
  0.76/0.56/0.46/0.64. The reference field uses **0.26/0.22/0.17/0.12**. At my values the
  background stopped being light at all — it rendered as a mid-olive wash. Light mode also gets
  its own aurora *construction*: four shallow percentage-ellipses pinned near the corners on a
  single element (as the reference does), rather than the four large circles dark mode uses. The
  blob geometry covers most of the page, which glows on a dark ground and muddies a light one.
  Leaving the centre clean is what keeps it airy. Bonus: one composited layer instead of four.
- **The hero was a mid-olive slab, and no single layer was to blame.** Sampling it gave
  `rgb(219,226,193)` against a page of `rgb(246,249,236)` — 27 points darker. The cause was
  cumulative: pane + mesh + conic sweep + specular sheen + the new inset shade all stacking on one
  surface. Raising the pane to 0.82 and easing the mesh (opacity 0.9 → 0.5) and sweep (14% → 7%)
  lands it at `rgb(231,236,215)` — brand-tinted, unmistakably light.

**Dark mode is explicitly preserved.** It was judged correct, so it keeps its own aurora
construction, hero mesh strength and hero fill via `[data-theme='dark']` overrides; every light
change above is scoped away from it, and it was screenshot-compared before and after.

### The sampling disclaimer moved into the tooltip

"Based on the 200 most recently added candidate profiles, not the full database" was printed as
body copy under two card titles. It is still true and still stated — it now lives in those cards'
`metricDefinitions` caveats, surfacing through `MetricInfo` like every other metric's provenance.
A permanent apology under the title read as clutter and pulled the eye off the data. **The
underlying correctness bug is unchanged and still outstanding** (see the bottom of this entry).

### KPI graph bands, fixed properly

`Sparkline` bailed with `return null` when a series was empty or all-zero, so any quiet metric
left a bare gradient band — visually identical to a broken chart, which is why the row didn't
look right on all four cards. A genuine zero week is information: it now renders as a flat
baseline, so every card has the same silhouette regardless of its data. Also fixed: the
gradient's SVG `id` was derived from the colour, so two cards sharing a colour would emit
duplicate ids and the second would reference the first's gradient — now per-instance via `useId`.
Added a "now" dot on the final point (suppressed on flat series, where it would imply a reading
worth noting).

### Hero eyebrow and the greeting

- The eyebrow read "AAPNA RECRUITMENT OPERATIONS", restating context you already have. Now
  "AAPNA ATS Platform", sourced from `brands.js` (`heroEyebrow`) rather than hardcoded, so a
  tenant theme replaces it too.
- **The greeting showed the raw login handle** — "Good evening, harish.mopuri" — because it fell
  back to `user.username` whenever a first name wasn't mapped. It now prefers the real name
  fields and, failing those, takes the first dot/underscore-separated token and capitalises it.

### `/candidates` is now the records view for all ~4k

**No backend work needed** — `candidate.service.search()` already supported free-text `search`
across name/email/skills, position/location/status filters, `sort`/`order` and real
`page`/`limit`. The page simply never called it that way. It used to refuse to render any rows
until you typed a term, then fetch ≤200 rows and slice them client-side, reporting *rows
fetched* as the total.

- Browses by default; real server-side pagination (25/50/100) with the true match count.
- One debounced quick-search box on `search`; the three identifier fields move into Advanced
  filters, joined by position and location.
- **Sorting is server-side, and only on columns the API can actually sort.**
  `resolveSortField()` maps name/email/position/modifiedAt and silently falls back to
  `createdAt` for anything else — so Location and Gender show no sort arrow. A sort arrow that
  quietly reorders by date is worse than none. The manual "⇅" glyphs (which appeared on
  unsortable columns too) are gone.
- The dashboard's heavy 10-row table is replaced by a 5-row `LatestUploads` strip on
  `/dashboard/recent-uploads` — an endpoint that already existed, was purpose-built for this
  (it even returns relative "2 hours ago" timestamps), and was called by nothing.

### Tooltips: one registry (`constants/metricDefinitions.js` + `common/MetricInfo.jsx`)

`KPI_TOOLTIPS` was a local const in `Dashboard.jsx` keyed by display string, other widgets
hardcoded `<Tooltip title="…">`, and `LiveActivityFeed` explained nothing. Every number now has
one entry — plain-language meaning, formula, data source, what its chart plots, and any caveat —
rendered through a single keyboard-reachable affordance.

### Performance: a measurement that was wrong, then right

The Aurora Glass entry below claims glass costs nothing on scroll. That measurement used a
wheel-then-wait probe and was **noise-dominated** — it also reported that *removing* layers made
the page slower, which is impossible. With a continuous rAF-driven scroll (one `scrollBy` per
frame, arms interleaved, median of 3 reps) the real finding is:

- The full-viewport **`mix-blend-mode` grain** cost ~23% of frames over 20ms, because a blend
  layer must recompute across the whole viewport whenever anything beneath it changes — and the
  rotor now turns continuously beneath it. Removed: **23.5% → 5.3%**, median 16.7ms (60fps)
  throughout. At 3–6% opacity plain alpha compositing is indistinguishable.
- Content cards carry no `backdrop-filter`; blur is spent only on the sticky chrome. Blur only
  reads as blur when there's high-frequency detail behind it, and this backdrop is soft gradients.

**If you profile this page, scroll continuously.** A wheel-then-wait probe reports large drops
here that are rAF scheduling gaps, not paint.

**Caveat on the numbers above:** 23.5% → 5.3% was measured on a quiet machine and is the last
reading I trust. A later attempt (after light mode raised the chrome blur to `saturate(220%)`)
returned ~99% dropped frames on *every* arm including the no-glass control, with a 24.7ms median
throughout — uniform across all six arms means the host was throttled, not the design, so it
measures nothing. **The `saturate(220%)` increase is therefore unmeasured.** Re-run
`perf2.mjs` on an idle machine before trusting any figure; if the chrome blur does prove costly,
it is a one-token change (`--glass-1-blur`).

### Also
- `useCountUp` existed in **three** copies (shared hook, StatCard, VendorDashboard); only
  StatCard's respected `prefers-reduced-motion`. Its implementation was promoted to
  `hooks/useCountUp.js` and the other two deleted — so `KpiCard` and `VendorDashboard` stop
  animating numbers for users who asked for no motion. `VendorDashboard` also had a duplicate
  local `KpiCard`, now importing the shared one.
- `AapnaMark.jsx` (a hand-drawn wordmark approximation from the previous pass) deleted,
  superseded by the traced mark.
- **Source files repaired:** several PowerShell `Get-Content | Set-Content` round-trips corrupted
  every em dash in `index.css`, `aurora-glass.css` and `Dashboard.jsx` (93 sequences) — PS 5.1
  reads BOM-less UTF-8 as CP1252. Repaired by reversing the bad decode, and BOMs stripped.

**Verified:** 22 automated checks green (both themes, equal card heights, brand slot on one line,
4,000-row records view asserting on intercepted request params, brand axis, `/login`
non-regression), plus magnified corner crops and the scroll-perf A/B.

**Not built this pass:** the backend insight endpoints (velocity / pipeline health / offer
analytics / source effectiveness) and the **P0 correctness fix** where Hiring Trends, Top Roles
and Skills are still computed from only the 200 newest candidates client-side — the charts say so
in their own subtitles. Specced in the plan; they need a live database to verify.

## 2026-08-12 — Design V2 "Aurora Glass": Dashboard + app shell pilot

A new visual language, piloted on **one screen** so it can be judged before rollout:
`/dashboard` plus the shell chrome around it. Everything else is untouched.

**Why the old glassmorphism was never glass.** The tokens existed (`--glass-bg`,
`--glass-blur`, `.glass-card`) but had nothing to work on: the app canvas was a flat colour
(inline `background: var(--ink)` on both `<Layout>`s) and `--gradient-card` was
`rgba(255,255,255,0.95) → 0.7`, i.e. opaque. `backdrop-filter` over a flat colour returns
that flat colour. The topbar was the clearest case — it carried `className="glass"` and then
an inline `background: var(--colorBgContainer)` that overrode it. So the fix is not "more
blur", it is *putting something alive behind the glass*.

**New: the ambient canvas** (`src/components/common/AmbientBackdrop.jsx`)
- One `position: fixed` plane holding four drifting aurora blobs, the AAPNA wordmark as a
  large faint watermark, and a fractal-noise grain that kills gradient banding.
- Blobs animate `transform` only (compositor work, no paint) — deliberately *not*
  `background-position` like the hero's older `meshDrift`, which repaints each frame.
- Blob offsets are shallow on purpose. Parking them fully off-canvas — the instinctive
  choice — leaves only their faint outer falloff on screen, and the glass above has nothing
  to refract, so surfaces read as flat white cards. That was the first draft's actual bug.
- Aurora palette is olive-led (brand `#7a922e`, teal-forest companion, warm accent) so it
  reads as AAPNA rather than as generic AI-product violet.

**New: brand wordmark as vector** (`src/components/common/AapnaMark.jsx`)
- Geometric `AAPNA` lockup + single-letter monogram, drawn as inline SVG paths filled with
  `currentColor` so it tints per theme.
- **Scope is deliberately narrow:** this is an *approximation* of the official typography, so
  it is only ever used as low-opacity texture (backdrop watermark, hero corner accent). The
  remote `aapna-gptw-black.png` remains the mark of record everywhere a user reads it —
  sidebar brand, admin topbar, public token pages. A real vector logo replaces the paths in
  this one file.

**New: three glass tiers** (`src/theme/aurora-glass.css`, tokens in `src/theme/index.css`)
- Tier 1 chrome (sidebar, topbar) · tier 2 features (hero, KPI, widgets) · tier 3 data
  (tables, dense lists). A data table and a hero want opposite things from transparency.
- Only **tier 1** carries `backdrop-filter`. Tiers 2–3 get their depth from translucency, a
  masked gradient rim, a specular sheen and layered (ambient + direct + contact) shadows.
  Profiling with a continuous rAF-driven scroll showed 16.7ms median / ~16.9ms p95 and zero
  dropped frames whether the content cards were blurred or not — the blur was neither costing
  nor buying anything visible over a soft-gradient backdrop, so it is spent only where it
  reads. **Caution for future profiling:** a probe that fires a wheel event then waits will
  report ~10% frame drops on this page; those are rAF scheduling gaps, not paint.
- The rim and sheen are `::before`/`::after` on the surface classes, so all seven existing
  dashboard widget cards inherit the full treatment with **no JSX changes** — they already
  carried `className="glass-card dash-chart-card"`.

**New: cursor spotlight** (`src/hooks/usePointerSpotlight.js`)
- One delegated `pointermove` listener on the page root (not one per card), rAF-coalesced,
  publishing `--mx`/`--my` on the hovered `.spotlight` surface for a radial highlight.

**Scope containment — the constraint that shaped all of the above.** `.glass-card` and
`.glass` are *not* dashboard-only: they are also used by `CandidateDetail`,
`CandidateScreening`, `LoadingSkeleton`, `Analytics` and `AnalyticsLegacy`, none of which
have an aurora behind them. Restyling those classes globally would have washed out five
screens nobody asked us to touch. So every new rule is scoped under **`.ats-v2`**, which
`MainLayout` puts on its outer `<Layout>` for the dashboard route only; because that element
wraps the Sider, Header *and* the `<Outlet />`, one boolean scopes chrome and page together.
Verified: `/login` is pixel-identical before and after, and the only unscoped rules in
`aurora-glass.css` are two documented base definitions (`.premium-stat-card`, `.glass-3`).
Rolling out app-wide means widening that route check — not touching the scope.

**Also changed**
- `StatCard.jsx` — the surface wash and coloured top edge moved from inline styles to CSS
  keyed off the `--stat-color` custom property it still sets. An inline background cannot be
  overridden by a stylesheet, which would have forced `!important` on every V2 rule; the 4%
  `color-mix` reproduces the previous `${color}0a` exactly.
- `Dashboard.jsx` — spotlight root; Recent Candidates moved onto tier 3 (its hardcoded inline
  background/border/shadow removed). **No changes to data fetching, aggregation, permissions,
  KPI wiring or table columns.**
- `DashboardHero.jsx` — conic light sweep, monogram bleeding off the bottom-right corner, and
  the greeting on a gradient-ink span. The monogram replaced a full wordmark that got clipped
  mid-letter by the hero's `overflow` and read as a smudge behind the filters.
- `main.jsx` — imports `aurora-glass.css` *after* `index.css`; cascade order is what lets the
  V2 rules override the base glass classes without `!important` everywhere. Deleting that one
  import reverts the pilot.

**Accessibility.** `prefers-reduced-transparency: reduce` drops the canvas entirely and makes
every surface opaque (verified via CDP media emulation — Playwright cannot emulate it).
Motion is already covered by the app-wide `prefers-reduced-motion` guard, which the new
keyframes inherit for free. `@supports not (backdrop-filter)` makes the chrome opaque.

**Kept intentional:** the admin-portal branch of `MainLayout` is untouched; chart cards still
cancel their hover-lift so Recharts tooltips read cleanly; the `~3 MB` single-chunk build
warning is pre-existing.

## 2026-08-11 — QA test-pass: interviewer name, document acknowledgement, reminder copy

Three UI changes from the team's test pass. Two of them exist because a working feature
*looked* broken — worth noting as a pattern: both were reported as missing functionality when
the actual gap was that the UI never said what it was doing.

**Schedule interview modal** (`src/components/pipeline/PipelineDrawer.jsx`)
- New **Interviewer name** field above Interviewer email(s), prefilled from the MRF hint already
  shown read-only directly above it. Optional; blank means the invite opens "Hi there,".
- Helper text switches to *"With more than one interviewer the invite opens 'Hi all,'"* once the
  email field holds a comma, so the greeting is predictable before sending.
- The name is in the **preview** query as well as the submit payload. This is not redundancy —
  the modal posts its compiled panel body back and the server prefers it, so a name absent from
  the preview would be absent from the email that actually goes out.

**Public document upload page** (`src/pages/DocumentUpload.jsx`)
- New **submitted** state. Previously the page only congratulated the candidate once HR had
  *verified* every document — an action that can take days — so immediately after submitting
  they saw the same checklist and a greyed-out *"Choose your files to continue"*, the toast
  already gone. It read as though nothing had happened; QA filed it as a missing submit button.
- The acknowledgement sits **above** the checklist rather than replacing it, so a later rejection
  flips one row back to actionable and the candidate can still find it. The disabled button now
  reads *"Nothing left to send"*.

**Documents panel** (`src/components/pipeline/PipelineDrawer.jsx`)
- States the automatic reminder cadence (chased after two days, then daily, up to three times),
  matching how the Offer panel already advertises its own schedule. The sweep has run since
  Phase 3 M4; showing only a *"Send reminder"* button made it look manual.
- Button reworded to *"Send a reminder now"* — an override, not the only mechanism.

## 2026-08-11 — MRF details modal: Export CSV in the footer

The MRF page had one Export, on the Records toolbar, and it exported the **list**. The
details modal — which is where the New MRF Request fields and the Hiring Manager's
submitted MRF actually live — had no way out.

**Change** (`src/pages/MRF.jsx`, `src/services/mrfService.js`)
- `ExportButton` added to the modal footer, left of `Edit` / `Close`. Same shared component
  as every other export surface, so the olive styling, the loading state and the error toast
  are unchanged — no new visual vocabulary.
- **View mode only.** The edit-mode footer (`Cancel` / `Save Changes`) deliberately does not
  carry it: the file is built server-side from the database, so exporting mid-edit would hand
  back a file that silently disagrees with the unsaved values on screen.
- Toast reads *"Exported CSV."* rather than *"Exported 61 rows."* — the backend suppresses
  the row-count header for this endpoint, because a "row" in a per-record file is a field,
  not a record. No change to `ExportButton` itself; it already falls back when the header is
  absent.

**Kept intentional:** the toolbar Export above the Records table stays as-is. The two are
different jobs — the filtered list vs. the one requisition you have open.

## 2026-07-10 — Dark-mode contrast fix sweep (all screens)

Follow-up to the theme system below: real usage in dark mode surfaced unreadable text
(light-on-light and dark-on-dark). Fixed app-wide with **zero visible change to light mode**.

**Systemic root causes**
- `darkTheme` never set `algorithm: theme.darkAlgorithm` (`src/theme/themeConfig.js`) — AntD
  derived *light* status backgrounds (pale `colorErrorBg` etc.) while `colorText` was near-white
  → invisible Alert text (Login "Invalid credentials", upload alerts), light Tag presets and
  disabled fills. One line fixes every derived token; the explicit curated dark palette still
  overrides where set.
- Several CSS vars were used but never defined — `--color-primary(-bg/-border)` (the invisible
  "Matching and scoring candidates…" overlay text), `--text-secondary`, `--text-1`, `--olive`,
  `--border-secondary`, `--box-shadow-secondary`, `--warning`, `--gold-dark`. All now defined as
  theme-flipping aliases/values in `src/theme/index.css`.

**New semantic tokens** (`:root` + `[data-theme='dark']`): `--warn-bg/-border/-text`,
`--success-text`, `--info-strong`, `--overlay-scrim`, `--color-primary-border`. Light values
match the previous hardcoded hexes exactly.

**Public token-link pages forced always-light** — `/mrf-submit`, `/mrf/:id/approve`,
`/missing-jd-upload` are external candidate/approver forms with no theme toggle. New
`ForceLight` wrapper in `src/App.jsx` (nested light `ConfigProvider` + `data-theme="light"`
scope); enabled by widening the token selector to `:root, [data-theme='light']`.

**Per-screen fixes**
- `CandidateScreening.jsx` — both full-screen loading overlays: white card →
  `var(--colorBgElevated)`, white scrim → `var(--overlay-scrim)`; JD skill-status chip text →
  semantic tokens.
- `HRUpload.jsx` / `VendorPortal.jsx` — dragger title `#2b2b2b` → `var(--text)`; disabled
  "Upload Resumes" button now uses AntD disabled styling (was a hardcoded olive block); modal
  panels/labels tokenized. `index.css`: dropzone hover/drag-over got dark overrides; the
  `.kpi-card__glow` solid disc (read as an odd dark box on dark cards) is now a soft radial
  gradient with a dark-mode opacity cap.
- `EmailManagement.jsx` — Raw-HTML CodeMirror now gets `theme={isDark ? 'dark' : 'light'}`
  (oneDark) with matching `[data-theme='dark'] .email-html-editor` CSS; mail-client preview
  shell stays intentionally white, its labels pinned to slate.
- `AdminDashboard.jsx` — Module Access rows: off-state Switches no longer hardcoded `#d9d9d9`
  (AntD handles off state per theme), white module-icon tiles → `var(--colorBgContainer)` /
  `var(--ink-3)`, Enabled/Restricted pills → translucent green/red tints with theme text;
  stat-card greens `#166534` → `var(--success-text)`; dark-olive `#5c6f1f` modal labels →
  `var(--gold-dark)`; redundant `#7a922e` overrides removed from `type="primary"` buttons.
- Mechanical hex→token sweep (~200 replacements) across `Candidates.jsx` (81), `MRF.jsx`,
  `CandidateDetail.jsx`, `VendorPortal.jsx`, `VendorDashboard.jsx` (incl. the invisible gauge
  % label and SVG `trailColor`), `Analytics.jsx`, `Dashboard.jsx`. Mapping: `#374151/#1f2937/
  #111827` → `var(--text)`, `#4b5563` → `var(--text-2)`, `#6b7280/#9ca3af/#6b7561/#8a9270` →
  `var(--text-3)`, light panels `#f9fafb/#f3f4f6/#f5f5f0` → `var(--ink-3/4)`, `#e5e7eb` →
  `var(--border-light)`, cream warnings → warn tokens, `#eef3da/#b8cc6e` → gold tokens.

**Kept intentional**: colored icon tiles, brand accents, status tags, email preview/editor
iframes + mail shell (emails render on white), logo chips.

**Verified**: headless (Edge + Playwright) — dark login Alert dark-red/readable, light Alert
unchanged, `/mrf-submit` renders fully light under a dark stored theme, both boots error-free.

- Files: `src/theme/themeConfig.js`, `src/theme/index.css`, `src/App.jsx`, and the pages above.

---

## 2026-07-10 — Light/Dark/System theme system (fixes "app randomly black")

**Root cause of the long-standing bug:** `ThemeContext` fell back to the OS
`prefers-color-scheme` when no `ats_theme` key existed **and then persisted that value**,
permanently pinning OS-dark users to dark. The sun/moon toggle was scaffolded but never
rendered, so there was no way back.

**New behavior**
- Three modes — **Light / Dark / System** — stored in `localStorage['ats_theme']`.
  **Default is Light**; the OS is honored only when the user explicitly picks System
  (with a live OS-change listener attached only in that mode).
- **Anti-FOUC**: inline script in `index.html` applies `data-theme`, native `color-scheme`
  (scrollbars/inputs) and the mobile `theme-color` meta before first paint.
- **Switcher in two places**: animated sun↔moon morph button (`src/components/common/
  ThemeToggle.jsx`, pure CSS — rays spin out, orb carves into a crescent) in the main header
  and admin top bar; an **Appearance** card (Light/Dark/System `Segmented`) at the top of
  Settings.
- **Circular-reveal switch animation** (`src/utils/themeTransition.js`): View Transitions API
  radial wipe expanding from the clicked control; graceful ~300ms cross-fade fallback
  (Firefox); instant under `prefers-reduced-motion`. Uses `flushSync` so the AntD token swap
  and CSS-var flip land in one snapshot frame.
- **Dark polish**: defined the previously-missing `--colorBgContainer/-Elevated/-Layout`
  aliases (≈15 surfaces were rendering transparent); refined dark AntD tokens (Modal, Drawer,
  Tooltip, links, placeholders, masks); `Sider` no longer hardcoded `theme="light"`; admin
  top-bar chrome tokenized with dark overrides.
- Files: `index.html`, `src/context/ThemeContext.jsx` (rewritten), `src/utils/
  themeTransition.js` (new), `src/components/common/ThemeToggle.jsx` (new),
  `src/layouts/MainLayout.jsx`, `src/pages/Settings.jsx`, `src/theme/themeConfig.js`,
  `src/theme/index.css`.

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
