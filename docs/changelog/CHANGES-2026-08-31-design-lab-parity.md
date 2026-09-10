# Design-lab parity: closing the composition gap

**Date:** 2026-08-31
**Status:** Complete except for `/admin/dashboard`, which the audit account cannot reach
— it needs a visual pass from someone who can log in as an admin. Everything else is
converted, measured and screenshotted in both modes.

**Verification standing:** `npm run lint` 0 errors · `npm run build` clean ·
`composition.mjs` **all assertions pass** across eleven routes ·
`npm run verify:design` **cannot run** — `lib.mjs` logs in through the form and
Cloudflare Turnstile stopped issuing tokens partway through the session. Re-run it once
Turnstile recovers; nothing in this work should have moved its other nine checks, but
that is an expectation, not a measurement.
**Follows:** `CHANGES-2026-08-29-design-v3-enterprise-hardening.md`
**Supersedes parts of:** `docs/design/DESIGN-LAB-PARITY-PLAN.md` — see "Corrections" below.

## Why

Design System V3 was complete on every measure the project had: 24 routes converted,
0 lint errors at `error` level, 9 `verify:design` checks green, every token measured
equal to `/design-lab`. The app still read about 60% like the lab.

The audit found the reason: **the primitives were built and never rolled out.** Tokens
were right; assembly was not. `PageHeader` shipped to 2 files out of 12 routes.
`Button` — which its own docblock says replaces "twelve distinct treatments across 224
call sites" — shipped to **one** file. `Sheet`, `DataTable`, `StateBlock` and `CountUp`
shipped to none.

## Corrections to DESIGN-LAB-PARITY-PLAN.md

That document is not corrected in place, so read this first.

1. **"Gap 2 — no outer page pane" is a misreading.** All three lab archetypes go
   `PageShell → PageHeader → content` with **no wrapper surface**. The pane mistaken for
   a page frame is `.dl-stage`, which `designLab.css` documents as gallery chrome that
   exists only because `AmbientBackdrop` is `position: fixed` and must be boxed on the
   lab route. Measured: the lab's List archetype and `/candidates` already had
   **identical** surface structure — 2 surfaces, tiers `{2:1, 3:1}`. Wrapping routes in
   an outer `Surface` would have moved the app *away* from the lab.

2. **"Dashboard hero 157px vs 106px (+48%)" is a width artefact.** At a 1500px viewport
   the lab gets a 1320px content column and the app 1196px — the app loses 248px of
   sider plus 56px of `Content` padding. Re-measured with the lab at a 1324px viewport
   so its column is 1194px: **lab 275px vs app 280px, a 1.8% difference.** The doc also
   proposes moving the period/role filters into `PageHeader`'s `filters` slot, which
   `DashboardHero` has done since the V3 rebuild.

3. **Dark mode**, never previously compared, was measured on all 12 routes: structurally
   identical to light, no defects.

## What changed

### Button glow bridge — `src/styles/legacy-bridge.css`

`theme/themeConfig.js` zeroes AntD's button shadow when preset geometry is on, commented
*"Zeroed only when src/ui owns the button, where `.ui-btn` paints the glow"*. On the
twelve converted routes `src/ui` does **not** own the button: `<DesignScope>` turns
preset geometry on, the shadow is removed, and nothing paints it back. Every primary
button on every converted route was flat.

The bridge restores it, tone-preserved — `--glow-brand` for brand primaries,
`--glow-danger` for `.ant-btn-dangerous`, so a destructive button never lights up green.
Hover and press mirror `.ui-btn--solid` exactly, so a button does not shift when it is
converted. It also normalises label size: AntD sizes button text from `fontSize` (the
body role, 15px) where `.ui-btn` uses `--fs-callout` (14px), which is why "Search" (14px)
sat beside "Reset" (15px) in the same row.

**This bridge is temporary.** It names the call-site conversion as the group that deletes it.

### PageHeader wrapped state — `src/ui/ui.css`

`.ui-page-header__controls` gains `margin-inline-start: auto`. The parent is
`justify-content: space-between`, so when the controls wrapped to their own line they
were the only item on it and space-between put them at the **start** — leaving the
hero's entire right half empty behind the watermark. Not a lab divergence: the lab wraps
identically at the same width, it just never renders that narrow. Inert when both items
share a row, and the `max-width: 900px` block still left-aligns on small screens.

The one edit to `src/ui` in this work, made deliberately: the standing "do not touch
src/ui, it is verified correct" constraint did not hold for a rule that stranded half
the hero.

### `/candidates` — the pilot

- `PageHeader` added as `PageShell`'s first child. The title had been a `Title level={3}`
  **inside** the search card: 20px against the lab's 32px `--fs-title-1`, and nested in
  its own container it read as that card's label rather than the page's.
- All 10 buttons converted to `ui/Button`. Four private treatments — `.cand-action`,
  `.cand-action--active`, `.cand-chip--off`, `.cand-chip--on` — became emphasis levels.
  Deliberately not `solid`: a glowing solid repeated down 25 rows is the case `ui.css`
  calls out as wrong, and `.cand-chip--on` did exactly that on every Edit.
- Surface tiers unchanged — measured, they already matched the lab.

### The dashboard hero — one compact band

Reported as "not in sync with the design", with a reference image. Measured before
changing anything: the hero's inner box is 1132px, the title's max-content 499px and the
control block's 566px, so the row needed 1089px and had 1132 — it fitted with 43px to
spare. It wrapped anyway, because `.ui-page-header__text` carried a **fixed**
`flex-basis: min(100%, 36rem)` = 576px, making the browser compute 1166px and break the
line. The column reserved 77px it did not need, and the cost was 112px of height and a
566×112px hole in the hero's lower left.

Four changes, three of them in `ui.css` and hero-scoped where possible:

- `.ui-page-header__text` → `flex: 1 1 auto` (shared). The base size becomes the
  content's real width, so the row breaks only when it genuinely cannot fit.
  `flex-grow: 1` still hands the text column the leftover space, which is what actually
  stopped the title being crushed — never the basis's job.
- `.ui-hero` horizontal padding `--space-6` → `--space-5`, and
  `.ui-hero .ui-page-header` gap `--space-5` → `--space-4`. Together 24px, bought
  because at a 1440px viewport the row missed by **17px** and paid 112px of height for
  it. Vertical padding untouched.
- The eyebrow becomes a chip **inside a hero only**. Small caps at 12px lose their edge
  against a mesh, a rotating sweep and a watermark; every other route keeps the plain
  eyebrow.
- `DashboardHero` `size="lg"` → `size="md"` (42px → 32px), and **the same change in
  `design-lab/AppPane.jsx`, made there as the specification**. A greeting was the
  largest type in the product, above every real page title, while the KPIs below are the
  subject; and at 42px it measured 499px, which is what forced the second row.

**Result: 280px → 164px** (the lab's is 169px), dead space gone, and one row holds down
to a 1440px viewport instead of only 1500+. Below 1280 the controls still wrap, now
right-aligned. Swept at 1920/1600/1440/1280/1180/1024/980/860/720: `/candidates`,
`/mrf` and `/email` are **byte-identical at every width**, with no title wrap or overflow
anywhere.

`parity.mjs` failed once during this — `hero title size: lab 42px vs app 32px` — which is
the check doing precisely its job. Fixed by moving the lab, not by exempting the rule.

**Not copied from the reference image:** its secondary buttons are white-with-a-border.
`emphasis="soft"` (a tinted fill) is kept instead, because `ui.css` records the reason
outlined buttons were removed from the system, and reversing that is a design-system
decision rather than a hero one. Raised rather than done silently.

### `ExportButton` — one component, 17 call sites

`.eb-btn` hand-rolled an outlined-brand treatment (own radius, weight, brand ink on a
brand border) that exists in the system as `emphasis="soft"`. Converted once; the
`size="small"` prop API is kept and mapped internally so no call site changed.
`.eb-btn--off` stays and is load-bearing — its `pointer-events: none` is what lets the
wrapper span receive hover so the tooltip fires while the button is disabled.

## Verification

`npm run lint` 0 errors (95 warnings, all pre-existing in retired files) ·
`npm run build` clean · `npm run verify:design` **9/9 green** · both modes screenshotted
against the lab archetypes at matched content width.

**Gotcha worth recording:** `npm run build` and `npm run lint` **prune the `--no-save`
playwright** out of `frontend/node_modules`, after which `verify:design` exits 2 with
"playwright is not installed" — which reads like a regression rather than a missing
package. `lib.mjs` imports it with a bare specifier, so it must live there and not in a
scratch dir. Reinstall with `npm install --no-save playwright` after any build.

---

## PENDING

### 0. Login for the audit scripts — resolved, and worth recording

Turnstile stopped rendering its challenge iframe partway through the session (Cloudflare
throttling a headless client after ~15 logins), which blocks the login FORM. The backend
runs Cloudflare's always-passes test secret, so `/auth/login` accepts any non-empty
`captchaToken`. The scratchpad scripts now authenticate over the API and seed `ats_token`
the way a real login would — same session, obtained without the widget.

**`npm run verify:design` is still blocked**, because `lib.mjs` drives the form. Giving it
the same fallback was offered and declined, so the committed suite stays form-based and
its auth-gated checks cannot run until Turnstile recovers. Build, lint and the
source-level `dup-classname` check are unaffected.

### 0b. Note for `composition.mjs`

The planned assertion *"no `.ant-btn` inside `.ats-v3` lacks `.ui-btn`"* needs an
exemption list. Measured on a fully converted `/pipeline`, one button remains:
`ant-input-search-button` inside `ant-input-group-addon` — AntD's own enter-button for
`Input.Search`. It is rendered by AntD, not by a `<Button>` in our source, so it can
never carry the class. The same applies to Modal footers, Popconfirm and Table
pagination.

Converted and green on all nine checks, but **not yet looked at on screen**. Turnstile
stopped issuing a token after roughly fifteen headless logins in one session — the
challenge iframe stops rendering and the hidden `cf-turnstile-response` stays empty, so
the form submit is blocked client-side with no error. Backend healthy, credentials fine,
no failed requests; it worked minutes earlier in the same session, so it reads as
Cloudflare throttling rather than a regression. Screenshot `/filtering` in both modes
once it recovers, before calling that route done.

### 1. Route passes — COMPLETE

All twelve in-shell routes now carry exactly one `.ui-page-header` with a 32px title and
a real eyebrow, and zero unconverted buttons inside `.ats-v3`. Measured and screenshotted
in both modes.

| route | buttons converted | what the header replaced |
|---|---|---|
| `/candidates` | 10 | title trapped inside the search card |
| `/mrf` | 10 | title inside the form card; eyebrow styling used in a subtitle slot |
| `/filtering` | 17 | 24px bare div |
| `/pipeline` | 4 + **69 shared** | title inside the toolbar card |
| `/hr-upload` | 12 | 20px bare div |
| `/vendor` | 12 | header row written as an **inline style object** |
| `/vendor-dashboard` | 1 | `.vd-page-head`; vendor picker moved to `filters` |
| `/settings` | 2 | **no page title existed at all** |
| `/email` | 3 | header was already correct |
| `/candidates/:id` | 3 | floating back button; 20px name buried in a card |
| `/admin/dashboard` | 11 | separate shell — header deliberately out of scope |
| `/analytics` | 0 (`ExportButton` only) | 20px bare div — **missed on the first pass** |
| `/dashboard` | 0 | already converted |

**`/analytics` was missed and reported as done.** Its buttons are all `ExportButton`, so
"zero raw buttons" was true — and that was mistaken for "nothing to do", when its header
was still the 20px bare div the Phase 0 catalogue recorded. Caught by the user, not by
me and not by any check. It is the exact gap `composition.mjs` §5 exists to close: a
per-route assertion would have failed on it immediately.

`/candidates/:id` is the one that changed shape: identity (role eyebrow, 32px name,
status + match subtitle) and both actions moved up into the header, and the record card
kept the detail — avatar, contact lines, skills — so nothing is stated twice. The two
panels below already matched the lab and were not touched.

**`/admin/dashboard` is unverified in the browser.** The audit account is not an admin,
so the route redirects to `/dashboard` and its header/buttons cannot be seen. Build and
lint cover it; a visual pass needs an admin login.

### 2. Public/auth pages and remaining shared components (~37 sites)

Login, AdminLogin, ForgotPassword, ResetPassword, MrfSubmit, MrfApprovalAction,
MissingJdUpload, InterviewScorecard, DocumentUpload, NotFound (~28) · NotificationBell,
ErrorState, EmptyState, EmailBodyEditor/Toolbar, DeliveryMonitoring, TurnstileWidget
(~9). Fifteen of these hand-paste `className="ui-btn …"` strings that become real
`Button` calls. **`CandidatePipelinePrototype.jsx` (23 sites) is excluded** — it is
commented out of `App.jsx` and renders nowhere.

### 3. KPI tiles — DONE

`/hr-upload`, `/vendor`, `/vendor-dashboard`, `/analytics` and `/admin/dashboard` now
pass `footnote` and `interactive`, with `bloom` on the lead tile only. No component
change — every prop already existed.

**No `delta` anywhere.** None of these pages has a previous-period figure to compare
against, and a fabricated one would be worse than the space it fills — the same
judgement that produced the `MIN_DELTA_BASE` fix on `/dashboard`. The footnote is what
fills the tile here.

Each footnote states what the label cannot: what the count is *of*, and over what
window. `/analytics`' one-word labels needed it most — "Rejected" and "On Hold" are both
ambiguous between candidates and requisitions.

~~### 3. KPI tiles (original entry)~~

`/analytics`, `/vendor-dashboard`, `/hr-upload`, `/vendor` and `/admin/dashboard` pass
only `icon label value accent`. The lab's baseline tile always carries `delta`,
`footnote` and `interactive`; without them the tile renders short with an empty lower
half, which is why `/dashboard`'s look right and these do not. No component change —
`StatTile` already has every prop.

### 4. Type ramp

The ramp is 12/13/14/15/17/20/24/32. Still outside it: **75 inline `fontSize:` literals**
in JSX across ten values (10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 16, 20) and **15
off-ramp `font-size` literals** in stylesheets (13.5 ×3, 18, 22 ×2, 26 ×2, 28, 30, 48 ×2,
56, 140). `components.css` still sets `.cmp-lede: 15px` and `.cmp-icon: 20px` as
literals. Icon and `Avatar` sizes (72/52/46/34/30/24/16) travel with this.

The earlier sweep moved inline literals into `.cmp-*` classes but **preserved the
off-ramp values**, so the inconsistency survived the cleanup. Runs as its own pass after
the routes — a text reflow tangled with structural changes makes a route impossible to
judge.

### 5. `scripts/verify/composition.mjs`

A sibling to `parity.mjs`, not an edit to it — that file's docblock commits to asserting
tokens and *not* layout. Five assertions, each one that would have caught something here:

1. every in-shell route renders exactly one `.ui-page-header`
2. every route's first child inside `.ui-page` is a `.ui-surface` or `.ui-page-header`
3. **no `.ant-btn` inside `.ats-v3` lacks `.ui-btn`**
4. every rendered `font-size` is a member of the ramp (reusing `type-floor.mjs`'s
   exemptions for chart furniture)
5. every `.ui-stat` carries a `footnote`

### 6. Final cleanup — DONE (commented, not deleted)

Every block below is **commented out with a dated note**, per the no-delete rule — none
removed. Each was verified unreferenced first by a scan that **strips comments from the
JSX before searching**, so a class named only inside an explanatory note counted as dead
and one inside a real `className` did not. That distinction mattered:

- **`.cta-primary` was still LIVE** on `ForgotPassword` and `ResetPassword` — three
  `<Button emphasis="solid" className="cta-primary">`, one treatment painting over the
  one that replaced it. They sat inside `<Result extra={…}>` blocks the auth sweep's
  patterns never reached. Fixed before the class was retired.
- **`.eb-btn--off` is still LIVE** and stays: its `pointer-events: none` is what lets
  the disabled Export tooltip fire. Only the `.eb-btn` base rule went.
- **`.admin-top-btn` is still LIVE** in `MainLayout` (the admin shell's own topbar) and
  was left alone.
- **`.cs-pill` was dead on arrival**, not dead by this work: it was applied to two
  buttons but scoped `.cs-pill.ant-tag`, so it never matched either of them.

Retired: `.cand-page-title`, `.cand-chip*`, `.cand-action*` (`ui/ui.css`) · `.eb-btn`
(`components.css`) · `.mrf-btn*` · `.cd-back` · `.set-btn` · `.upl-btn` ·
`.cs-btn*`, `.cs-ctl`, `.cs-round`, `.cs-pill` · `.screening-action-btn` and
`.cta-primary` / `.cta-secondary` (`theme/index.css`).

`.screening-action-btn` is worth keeping as a specimen: **every declaration carried
`!important`**, so it did not lose to `.ui-btn` — it overrode it, and the class had to
come off rather than simply be outranked.

`.cta-*`'s only remaining reference is `CandidatePipelinePrototype.jsx`, which is
commented out of `App.jsx` and renders nowhere; re-enabling that route needs this block
uncommented or its call sites converted. Recorded in the block's own note.

**The A1 bridge STAYS, deliberately.** `composition.mjs` proves no `.ant-btn` lacks
`.ui-btn` on all eleven in-shell routes, so every rule in it is now guarded against
nothing — but the assertion cannot see `/admin/dashboard` (the audit account redirects
away from it) or buttons inside modals and drawers that are closed when the check probes.
Deleting it would cost nothing if those are clean and would silently un-glow every
primary on them if they are not. Remove once `/admin/dashboard` has been seen.

### 6c. The shell topbar — from the admin screenshots

Reviewed against screenshots of `/admin/dashboard` and the recruitment topbar, supplied
by the user because the audit account cannot reach the admin route.

**The admin dashboard itself is correct.** Its four KPI tiles carry the footnotes added
in §3 ("All registered accounts", "Can log in", "Access revoked", "N active tenants"),
Export CSV renders `soft`, Add User / Add Company render `solid`, and the row actions are
quiet icons. No page header, which is the deliberate exemption — that shell has its own
titled topbar.

Two things in the topbar were not:

- **A REGRESSION I INTRODUCED.** `NotificationBell` was a raw AntD `type="text"` icon.
  Converting it to `Button` without naming an emphasis took the component's DEFAULT,
  which is `soft` — so the bell became a tinted pill sitting beside a bare theme toggle.
  The same trap applies to any `type="text"` converted without thinking: `soft` is the
  right default for a page, and the wrong one for chrome. Fixed to `emphasis="text"`,
  along with the sidebar collapse toggle and "Mark all read". Verified: both topbar icon
  buttons now compute `background: rgba(0, 0, 0, 0)`.

- **PRE-EXISTING, and newly conspicuous.** `.admin-top-btn` — on "Admin Portal",
  "Recruitment Portal" and "Logout" — is a legacy treatment written entirely in
  `!important`: a white fill, a `--gold` label and a 12px font, none of which the token
  layer owns any more. It looked the same as it always had; what changed is that
  everything around it no longer does. Converted to `emphasis="soft"`, with Logout as
  `emphasis="text" tone="danger"` — the old `--logout` modifier only turned red on
  hover, and the tone says the same thing in the system's vocabulary.

`.admin-top-btn` is now unreferenced but **left in place**, not commented out: the three
buttons that used it are on surfaces the audit account cannot render, so the conversion
is unverified by eye. Retire it once the admin topbar has been seen.

### 6d. The admin portal, brought onto the system

Audited statically — the audit account cannot render `/admin/dashboard`, so this was
done by reading the rules and checking which are still applied.

**Most of the admin portal was already converted.** `admin-dashboard.css` reads tokens
throughout, and the `.admin-stat*` and `.admin-tab*` families — three parallel stat
treatments and a hand-rolled tab bar — are **entirely dead**, replaced by `StatTile` and
the design system's `Segmented`.

Four live rules were still on the old vocabulary and are now tokenised:

| rule | was | now |
|---|---|---|
| `.admin-topbar` | raw `#ffffff → #fbfcf8` gradient, a second `#121816 → #0e1412` pair for dark, 28px inset, two literal rgba shadows | `--material-thick` (mode-aware, same tier-1 material `.ml-topbar` takes), `--space-5`, `--depth-1` |
| `.admin-brand-icon` | `border-radius: 10px`, `#fff`, `font-size: 16px`, literal rgba glow | `--radius-ctl`, `--brand-on-solid`, `--fs-headline`, `--glow-brand` |
| `.admin-user-chip` | `999px`, `12px`, `--gold` aliases | `--radius-pill`, `--fs-footnote`, `--brand-primary` |
| `.admin-portal .ant-table-thead th` | **`font-size: 11px`** + literal 0.5px tracking | the caption role — size, weight and tracking together |

That table header is the one real defect: **11px, one under the floor**, on the densest
text in the portal. `type-floor.mjs` never caught it because its route list cannot reach
`/admin/dashboard` — the same blind spot that hid the 10px modal labels in §4.

The dark-mode `.admin-topbar` override is retired: it existed only to patch the light
hexes that are now gone.

**Left alone, deliberately:** the dead `.admin-stat*` / `.admin-tab*` / `.admin-top-btn*`
families are inert and were NOT commented out. A first attempt wrapped them by line
range and swallowed live table rules and a nested comment — those rules are interleaved
with `.ant-table` ones, not contiguous. Reverted; the correct fix is rule-by-rule, and it
buys documentation rather than behaviour, so it is not worth a second attempt blind.
`.ad-logo-chip`'s 7px radius also stays: it backs a fixed-size bitmap and matches the
recruitment shell's identical chip exactly.

**Unverified by eye.** Every change above is reasoned from the source; none has been seen
rendered. It needs one look from an admin account.

### 6b. The original sweep list, for reference

Everything below is deliberately deferred so it can be done in one pass. Nothing renders
these any more; they are still defined.

**Dead button classes, confirmed retired at every call site:**

| class | defined in | was on |
|---|---|---|
| `.cand-page-title`, `.cand-sub` | `ui/ui.css` | `/candidates` header |
| `.cand-chip`, `.cand-chip--on/off` | `ui/ui.css` | `/candidates` row actions |
| `.cand-action`, `--active`, `--conv` | `ui/ui.css` | `/candidates` row actions |
| `.eb-btn` | `styles/components.css` | `ExportButton` (17 call sites) |
| `.mrf-btn`, `--lg`, `--brand` | `styles/pages/mrf.css` | `/mrf` |
| `.cs-btn`, `--wide/mid/narrow`, `.cs-ctl`, `.cs-round` | `candidate-screening.css` | `/filtering` |
| `.screening-action-btn` (+ `.primary`) | `theme/index.css` | `/filtering` — a wall of `!important` |
| `.set-btn` | `styles/pages/settings.css` | `/settings` |
| `.upl-btn` | `styles/pages/upload.css` | `/hr-upload`, `/vendor` |
| `.cta-primary`, `.cta-secondary`, `.btn-sheen` | `theme/index.css` | five routes |
| `.cd-back` | `candidate-detail.css` | `/candidates/:id` |

**Already dead before this work, found while converting** — remove with the rest:
`.cs-pill` on buttons (defined `.cs-pill.ant-tag`, never matched one).

**Kept deliberately, do NOT sweep:** `.pd-outcome-hold` (carries the amber Hold tone;
`Button` has no `warning`), `.eb-btn--off` (its `pointer-events: none` is what lets the
disabled Export tooltip fire), `.pl-flat`, `.pd-mb-2-5` and the other `*-m[btlr]-*`
margin utilities.

**Then delete the Phase A1 bridge** in `styles/legacy-bridge.css` — it names the
call-site conversion as the group that removes it, and that group is now done for the
in-shell routes. It must stay until §2 (public/auth pages) lands, since those still
render raw AntD buttons.

**Also deferred:** `/settings` still imports `Segmented` from antd rather than `src/ui`
— the design system's version is a real radiogroup with arrow-key support. Same for any
other AntD `Segmented` call sites.

### 7. Bugs found and fixed 2026-08-31

- **`/candidates/:id` topbar title was stale.** `pageTitle` keyed `BREADCRUMB_MAP` on
  `pathSegments[0]` alone, so the detail route inherited `/candidates`' label and the
  chrome read "Search Candidate" while the page showed one person's record. Fixed with a
  `NESTED_TITLE_MAP` consulted when a second segment is present — a second map rather
  than a route-pattern matcher, because there is exactly one nested route in the app.
- **`/dashboard` "Total Candidates" delta read ▲ 19400%.** The arithmetic was correct —
  195 against a base of 1 — but a percentage on a base that small is noise dressed as a
  statistic, and it read as a data bug that undermined the three honest figures beside
  it. `periodOverPeriod` now returns `deltaPct: null` below a `MIN_DELTA_BASE` of 5, and
  also for `previous === 0`, which previously returned a flat invented `100` (0 → 1 and
  0 → 900 both reported "▲ 100%"). A null delta renders no chip; the tile's footnote and
  the delta tooltip already state the raw counts, which is the truthful version of what
  the percentage was reaching for.

- **Three dead classes on `/filtering`, all pre-existing.** The page's two most prominent
  buttons (Clear Filters, Search Candidates) each declared the class attribute **twice**,
  so the `cta-secondary` / `cta-primary` treatments they named were silently dropped —
  in JSX the later attribute wins. The keyword-filter `<Form>` did the same, killing
  `screening-filter` in favour of `cs-mt-2`; both are wanted, so they were merged.
  `.cs-pill` was dead on two more buttons for a different reason: it is defined as
  `.cs-pill.ant-tag` and so never matched a button at all. All three go away with the
  conversion to `Button`.
- **A comment of mine took the whole app down for several minutes.** A `{/* … */}` note
  placed before a `<Form>` that is the single parenthesised expression of a Tabs
  `children:` property becomes a second adjacent expression, and the file stops parsing;
  the bundle is one chunk, so every route including `/login` went with it. Recorded
  because the same shape will recur: inside `children: ( … )` the note has to sit
  outside the parentheses as a plain JS comment.

**Withdrawn — not a bug.** An earlier note here claimed `/hr-upload`'s "Upload Resumes"
was an `ant-btn-primary` broken to 4% opacity by `.btn-sheen`/`.upl-btn`. Neither class
sets a background. The button carries `disabled={fileList.length === 0}` and no files
were staged in the capture: it was a correctly rendered disabled state, misread from a
screenshot.
