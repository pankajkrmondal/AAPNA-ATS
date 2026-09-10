# UI / Theme Change Log

A running log of UI, theme, and UX changes to the AAPNA-ATS frontend.
Newest entries first. **Every UI change should be recorded here.**

---

## 2026-09-01 — /mrf-submit: the fields stop shouting, and get their left gutter back

Two follow-ups on the same screenshot: *"the field fonts are also too big"* and *"when I am
typing the field, there is no left padding."*

### The left-padding complaint was a corner-radius bug

The gutter was never wrong. Input, select and picker all carried AntD's 11px. Measured:

| Control | padding-left | radius | radius − padding |
|---|---|---|---|
| text input | 11px | **24px** | **+13px** |
| select | 11px | **24px** | **+13px** |
| datepicker | 11px | 15px | +4px |

`<Form size="large">` makes AntD reach for `borderRadiusLG`, and `resolveTokens` maps that to
`--radius-surface` — a **card** radius on a **control**. At 24px on a 44px-tall box the corner arc
spans half the height, so a glyph 11px in still sits inside the curve and reads as flush against
the border. The datepicker beside it looked right because it already rendered at 15px, which is
also why the fields looked mismatched. `--radius-ctl` (15px) plus a 16px gutter puts the text
clear of the arc — radius − padding is now **−1px** on every control.

The dead `.mrfs-input` rule (ui.css) had been reaching for exactly this radius since it was
written. It never matched: `mrfs-input` only ever lands on the Upload `<Button>`, which is
neither `.ant-input` nor `.ant-select-selector`. Commented out per the no-delete rule.

### 17px fields above 15px labels

`size="large"` also maps `fontSizeLG` to `--fs-headline`, so every field rendered **larger than
its own label**. `--fs-body`, following `.auth-form-inner` — the app's other relaxed form — and
`.screening-filter`, which fixed this identical pair and wrote down why.

**The height pin is the part that matters.** An input is sized by its content, so 17px → 15px
took it from 46.1px to 43.3px while Selects took `controlHeightLG` and stayed at 46 — the fix
would have *introduced* a stagger. Pinning to `--control-h-relaxed` surfaced a second thing:
`.ats-v3` sets that token to **44px** (index.css:193) while AntD's JS `controlHeightLG` still
resolves to **46px**, so a large Select sits 2px proud of every input next to it. The CSS token
wins here — it is the one that tracks a density change. All five control types now measure 44px.

`.mrfs-form` also had to match AntD's own selector *shape* to reach Select and InputNumber at
all: `.ant-select-single.ant-select-lg:not(.ant-select-customize-input) .ant-select-selector` is
(0,4,0) and `.ant-input-number-lg input.ant-input-number-input` is (0,2,1), against a two-class
scope at (0,2,0). Until that was fixed the select kept its 24px radius, 11px gutter and 17px text
while everything around it had moved.

### Rhythm, and one less hack

24px between fields plus 8px under every label — the same "tall, loose stack" the auth pages
answered — on a form many times longer. Now 16px/4px per `.auth-form-inner`.

The gap used to have three owners: an inline `marginBottom: 4`, the Form.Item's 24px, and
`.mrfs-hint-tight`'s `margin-block-start: -12px` clawing part of it back. That negative margin was
calibrated against the 24px it cancelled, so it would have broken silently the moment the rhythm
moved. One owner now: `.mrfs-field`.

### Card padding was doubled

`.mrfs-body` sits on the `.ant-card` element, so its `8px 32px 32px` stacked on
`.ant-card-body`'s own 24px — a **56px** inset per side. Moved onto the body; the values are
unchanged, they just apply now, and the fields gained 48px of width.

### Scope

Everything is under `.mrfs-form` / `.mrfs-field` / `.mrfs-body`; no token moved and no other route
can. `.mrfs-form` rather than `.mrfs-body` is deliberate: the previous-submission dropdown is a
sibling of the `<Form>` inside the same Card, and `.mrfs-body .ant-select-selector` would have
swept it up. It keeps its 38px secondary geometry — verified as a regression guard, along with
prefill (populates and toasts) and every control type. Live submit deliberately not exercised: it
writes an MRF and emails Management. The success branch shares no selector with anything here.

---

## 2026-09-01 — /mrf-submit: the header title was never white

Reported against a screenshot of the public MRF form: the band title read near-black on the
olive brand fill, while every other public page carries white on the same green.

`.mrfs-band-title` had `color: var(--brand-on-solid)` all along. It never applied. The class
sits on a Typography `<Title level={3}>`, and AntD styles headings as `h3.ant-typography` —
specificity (0,1,1), which outranks a bare class at (0,1,0). AntD's `colorTextHeading`
(`rgba(0,0,0,0.88)`) won on `color`, and on `font-weight` (600, not the intended 800) and
`margin-bottom` with it. Only `letter-spacing` — which AntD does not set — ever landed, which
is why the rule looked live.

The fix is the `.ant-typography` qualifier this codebase already uses on every other styled
Typography node (`.cs-page-title`, `.vd-title`, `.upl-title`, ~20 more). One selector:

```css
.mrfs-band-title.ant-typography { ... }
```

Computed after the fix: `color: rgb(255,255,255)`, `font-weight: 800`, `margin-bottom: 0px`
on `--brand-solid` `#66792a` — **4.85:1**, AA at any size. Dropping the inherited bottom
margin also re-centres the title against the logo in the flex band.

No token changed, and no other `.mrfs-` rule is affected: the rest sit on plain `div`/`span`,
and `.mrfs-muted` (on a `<Text>`) sets only `font-size` and `opacity`, which AntD's base
`.ant-typography` does not touch.

---

## 2026-09-01 — /pipeline: the toolbar folds, the blockage banner closes

Reported against a screenshot with both regions bracketed in red: *"these 2 popups are
occupying the space."* Neither is a popup — they are the filter toolbar and the
unresolved-interview banner — but the complaint is exact.

Measured at 1560x900, board top before the board's first pixel:

| | Board starts at | Reclaimed |
|---|---|---|
| Before | 559px of 900 | — |
| Filter pane collapsed | 459px | 100px |
| ...and banner dismissed | 313px | **246px** |

559 of 900 left 341px for the columns — less than one card row plus the column header, on
a kanban board. Both folded, the board opens in 587px.

### The filter pane collapses, and starts collapsed

`.pipeline-toolbar` splits into a row that is always useful and a pane that is used
occasionally.

| | Always visible | Folded |
|---|---|---|
| Left | Updated · Refresh · Export CSV · **Filters** | — |
| Right | *N* candidates · Clear filters | — |
| Pane | — | Ask the board · Position · Source · 5 checkboxes |

**The badge on the `Filters` button is the load-bearing piece.** Collapsed with a filter
still applied, it is the only thing on screen saying the board is showing a subset — which
is why the count and `Clear filters` moved *out* of the pane and into the header row. A
collapsed pane must never be able to leave the board filtered with no cue and no undo.

Collapsed is the default (`pipeline_filters_open` in localStorage, alongside the sidebar's
own flag); expanding it is remembered per browser, so anyone who filters all day opens it
once. The pane is conditionally rendered, not `display:none` — seven focusable controls
have no business in the tab order of a screen deliberately showing less. It fades and
lifts 4px on open, and not at all under `prefers-reduced-motion`.

### The banner closes, but the blockage cannot be lost

`closable` on the `Alert`, with the dismissal **keyed to the set of unresolved interview
IDs** rather than to a boolean. That distinction is the whole fix:

- Closing acknowledges *the rounds currently listed*.
- The next round to end unconfirmed produces a different key, and the banner returns by
  itself.
- While dismissed, a `N awaiting confirmation` chip sits in the toolbar's status group and
  puts it back.

A plain hidden flag would have swallowed every future blockage, and this banner is the
only place one is reported — nothing else on the board says a round is stuck because no
one recorded whether it happened. Permanent is not the same as important: a banner that
cannot be put away is one a recruiter learns to read past.

The IDs are sorted into the key, so the same rounds returned in a different order by the
60s poll do not silently un-dismiss it.

**Files:** `src/pages/Pipeline.jsx`, `src/styles/pages/pipeline.css`. No backend, no
schema change. Verified with `npx eslint src/pages/Pipeline.jsx` and a clean `npx vite
build`; still wants a manual click-through of the fold, the badge with a filter on, and
the dismiss/restore round trip.

---

## 2026-09-01 — /filtering: the tab strip stops failing AA, and the keyword fields join the ramp

Screen 7 of the sweep. Reported by eye in two lines: *"tab switching is not following our
theme"* and *"keyword filtering is not following our design-lab theme fields."* Both
reproduced. `/analytics` was converted with it — `.screening-tabs` was on both, the
coupling §I.4 says not to clean up one-sided.

### The tab strip was a `<Tabs>` in a segmented costume

| | Before | After | Ramp |
|---|---|---|---|
| Track radius | 10px | 999px | `--radius-pill` |
| Item radius | 8px | 999px | `--radius-pill` |
| Item height | 35.3px | 30px | `calc(--ctl-h - 8px)` |
| Label type | 15px / 600 | 13px / 600 | `--fs-subhead` |
| Gap below | 18px / 20px inline | 24px | `--space-5` |
| **Active label, light** | **3.51:1** | **5.81:1** | floor 4.5 |
| Active label, dark | 8.97:1 | 11.88:1 | floor 4.5 |
| Tab stops | 2 + 4 | 1 + 1 | — |

**The 3.51:1 is the finding, and it was invisible.** The active tab painted its label raw
`--brand-primary` on an opaque white pane — under AA, in the product's own brand, on the
control that tells you which mode you are in. `ui/Segmented.jsx` documents this exact
failure in its source (*"the identity colour on an opaque light pane measured 3.25:1"*) and
had already fixed it with `--brand-ink`. The screen never adopted the component.

The retired `.ats-v2` block named its own failure too: *"translucent track, near-solid thumb
— the selected tab has to stay the most solid thing in the control."* Measured, its track
was `rgba(255,255,255,0.9)` and its thumb `rgb(255,255,255)` — **10% apart**, which is why
the selected pill barely read.

**New primitive: `src/ui/SegmentedTabs.jsx`** — `Segmented` plus pane wiring, one copy for
both screens. **It reproduces AntD's mounting semantics deliberately** (mount on first
activation, then stay mounted). Rendering only the active pane was simpler and would have
silently reset `/analytics`' table pagination and remounted `/filtering`'s keyword `<Form>`.
Verified both ways: a sentinel typed into the keyword form survives a round trip to JD and
back, and a table left on page 2 is still on page 2 after visiting another tab.

### The keyword fields predated the token contract

| | Before | After |
|---|---|---|
| Label | 11px / 700 | 12px / 600 (`--fs-caption`) |
| Hint | 11px, lh 15.4 | 12px, lh 16.8 (`--fs-footnote`) |
| Control radius | 10px `!important` ×6 | 15px (`--radius-ctl`) |
| Collapse item | 12px | 15px |
| Input text | 17px | 15px (`--fs-body`) |
| Hover / focus border | `--green` = `rgb(74,124,89)` | `--brand-primary` |
| Focus ring | `rgba(122,146,46,0.14)` raw hex | `--glow-focus` |
| **Sub-12px elements** | **14** | **0** |

Three things only measurement gave up. The focus ring was a **raw brand hex** and therefore
dead to both tenant theming and dark mode — proof: it measured *byte-identical in light and
dark*. The hover/focus border was `--green`, which is `#4a7c59` — **a different green from
the brand olive** — so a focused input wore two unrelated greens. And 17px input text
(derived, via `fontSizeLG` → headline, but the largest body text on the screen) went to
`--fs-body`, following `.auth-form-inner`.

Height **stays 46px** to match the role Select on the JD tab, rather than dropping to the
lab's 38px — the two tabs have to agree with each other first.

### A regression this pass introduced, caught by measuring after

Shrinking the input font 17 → 15px took the three text inputs from 46.1px to **43.3px**
while the Selects and InputNumbers beside them stayed at 46 — an affix wrapper is sized by
its content. A 2.7px stagger across one filter row, invisible in a screenshot, green in
every check. Pinned with `min-height` exactly as `.auth-form-inner` already does. Now
46.0 / 46.0 / 46.0 in both themes. Recorded rather than quietly fixed: it is the argument
for measuring afterwards.

### Why nothing caught any of it

`type-floor.mjs` scans `/filtering` and would have flagged both 11px sizes instantly. **It
never saw them:** AntD `<Tabs>` mounts only the active pane and the tab defaults to `'jd'`.
Measured — **0** sub-12px elements on load, **14** the instant Keyword is clicked (7 labels
+ 7 hints). `contrast.mjs` missed the 3.51:1 for a sibling reason: it measures only what
`/design-lab` renders, and the lab renders `Segmented`, which was already right.

The swap does **not** fix this — `SegmentedTabs` is still lazy on purpose. Teaching the
scans to walk every pane is carried as its own change, and will find more than this screen.

### Couplings

- **`functional.mjs:153` drove the `/analytics` tabs by `.ant-tabs-tab`** — dead after the
  swap, and wrapped in `.catch(() => {})`, so it would have stayed on the default tab and
  failed three panel assertions as if the `Surface` work had broken. Now `getByRole('radio')`
  and asserted, not caught.
- **The collapse radius had to move at both ends** — `aurora-glass.css` loads after
  `index.css`, so its 12px `!important` silently beat the retokened 15px.
- **The `prefers-reduced-transparency` rule is a selector list** — commenting out its last
  entry would have left a trailing comma and dropped the rule for **eleven other surfaces**
  with no error. Comma kept inside the comment; verified by parsing the built CSS, 14
  selectors in and 14 out.

**Verified:** `verify:design` 152 PASS / 2 FAIL (both the documented `/dashboard` button
rows), lint 0 errors, `vite build` clean, 0 page errors, light and dark, both tabs,
accordion open and closed.

**Deliberately left:** the screen's 88 inline styles and ~39 raw hexes; the AI drawer's own
`<Tabs>` (a genuinely different control); `Input.Group compact`'s antd 5.29 deprecation; and
`.screening-summary-bar` / `.screening-selectall-bar`, whose off-ramp radii sit on the
results list this sweep did not measure.

---

## 2026-09-01 — /mrf: view mode stops being the disabled state

Screen 6 of the sweep. Reported by eye: "when I open a submitted MRF everything is
disabled — it should be like view mode, not disabled mode." It reproduced, and measured
worse than it looked.

### The record was the least legible thing in the dialog

The detail modal expressed "you are reading, not editing" with AntD's **disabled** state:
`disabled={!isEditing}` on both forms plus nine fields hard-wired `readOnly disabled`.
Measured on #181, tier-4 overlay, aapna brand:

| | Before | After | Floor |
|---|---|---|---|
| Value text, light | `rgb(180,188,186)` — **1.84:1** | `--text` — **14.01:1** | 4.5:1 |
| Value text, dark | `rgb(69,78,75)` — **1.91:1** | `--text` — **14.56:1** | 4.5:1 |
| Its own label | 5.35 / 5.46:1 | unchanged | 4.5:1 |
| Disabled inputs in view | 53 of 53 | **0** | — |
| `cursor: not-allowed` | 53 | **0** | — |

The label naming a value was **three times more legible than the value**, and the content
only became readable once the user was allowed to type into it — the same field measured
`#2b2b2b` the instant Edit was pressed. Disabled is a statement about permission; view
mode is a statement about mode. The page had only the first word.

**Fix:** a new `src/ui` primitive, `FieldValue` — the read side of a field, next to
`Field`. It takes `value` and swallows the `onChange` that `Form.Item` clones onto its
child, so it drops in as the control of a **named** Form.Item:

```jsx
<Form.Item name="role">{isEditing ? <Input /> : <FieldValue />}</Form.Item>
```

That shape is the point: the form store, `Form.useWatch`, `isFieldsTouched()` and
validation all survive the mode switch untouched — no re-seeding, and no value dropped on
the floor. Verified: entering edit shows **28 pre-filled inputs** and `sampleValue:
"Harish"`. `min-height` is `--ctl-h`, so the dialog does not jump between modes.

Both `<Form disabled={!isEditing}>` props were **kept**: a field missed by the swap
degrades to the old behaviour rather than silently becoming editable.

Seven fields that were `readOnly disabled` in *both* modes (Form Submission Date, Date of
Request, and the five AI-parsed JD rows) are now `FieldValue` unconditionally — they are
facts, not fields. The AI "Roles & Responsibilities" answer had been a 3-row disabled
TextArea you scrolled inside; it now reads as a paragraph.

Two follow-ons the change surfaced:

- **Required asterisks in view mode** — an instruction with nothing to act on.
  `requiredMark={isEditing}` on both modal forms. The rules stay, so saving still
  validates, and `functional.mjs`'s "MRF required markers still render" check is untouched
  (it counts markers on the page-level new-request form, which never gets the prop).
- **`JD Document Link` wrapped to seven lines of SharePoint query string** — an input had
  been hiding that behind a single-line scroll. It renders as a link in view mode, which
  is what `MrfApprovalAction.jsx:189` already does with the same column.

### The status filter was not the finalised control

`Radio.Group buttonStyle="solid"`, never converted. Measured before → after:

| | Before | After |
|---|---|---|
| Item radius | `15px 0px 0px 15px` (joined slab) | `999px` |
| Item type | 15px / 400 | 13px / 600 |
| Active fill | `rgb(122,146,46)` raw solid brand | `--material-thick` + `--brand-ink` |
| **Tab stops** | **6** | **1** |
| Group role | none | `radiogroup`, labelled |

Swapped to `src/ui`'s `Segmented`. Values are unchanged, so `loadRecords` and the CSV
export query are untouched; `handleStatusFilterChange` takes the value rather than an
event. Verified the filter still fires (All → Closed: 10 rows → 0, active pill follows).

### The modal scrolled sideways

`styles={{ body: { padding: '20px 0 0 0' } }}` — an inline-style-law violation, and
`Row gutter={16}` lays columns out with a −8px inline margin, so a body with **zero**
inline padding is overflowed by exactly the half-gutter. Measured `scrollWidth 760` vs
`clientWidth 752` in both themes. Now a class at `--space-5 --space-3 0`; overflow **0**.

**The first version of that rule did not work**, and the symptom was identical to the
inline style it replaced: antd 5.29 paints
`:where(.css-<hash>).ant-modal .ant-modal-body { padding: 0 }` — `:where()` costs nothing
but the two real classes still make it **(0,2,0)**, so a lone `.mrf-modal-body` at (0,1,0)
lost and computed to 0px. Fixed with specificity, `.ant-modal .ant-modal-body.mrf-modal-body`,
not `!important` — the modal has to stay restylable.

### Why nothing caught any of it

- **No check asserts that a non-editing detail view uses read-only presentation.** The
  suite has no concept of "view mode", so a screen expressing it as `disabled` is, to every
  check, a correctly-rendered form.
- **`contrast.mjs` only measures `/design-lab`.** These values live in a modal on `/mrf`
  behind a row click, so a 1.84:1 field was never in the sample. `.ui-value` and
  `.ui-value__empty` were added to its `TARGETS` **and** to `SystemPane`, because that
  check can only see what the lab renders. They now measure 13.1 / 4.75 (light) and
  16.11 / 6.23 (dark), across both brands.
- **Nothing counts tab stops outside `.ui-segmented`.** `a11y.mjs` checks one tab stop per
  segmented group — a control that is *not* a Segmented is invisible to it, so six tab
  stops in a filter bar raised nothing.
- The 8px overflow was inside a modal that is 3400px tall and scrolls vertically anyway.

**Verification:** `verify:design` 152 PASS / 2 FAIL — both the documented pre-existing
`/dashboard` button parity rows (`radius` 17.86 vs 15, `height` 38 vs 36). `npm run lint`
0 errors. `npx vite build` clean. Measured and screenshotted in light and dark, in view and
edit state, and across all six filter tabs.

**Files:** `src/ui/FieldValue.jsx` (new), `src/ui/ui.css`, `src/ui/index.js`,
`src/pages/MRF.jsx`, `src/styles/pages/mrf.css`, `src/pages/design-lab/SystemPane.jsx`,
`scripts/verify/contrast.mjs`.

---

## 2026-08-31 — Topbar becomes a command bar, and navigation finally scrolls to the top

Screen 5 of the sweep. Two unrelated shell problems.

### Navigation never reset scroll

There was **no scroll reset anywhere in the app** — no `ScrollRestoration`, no
`window.scrollTo` on route change; the only `scrollTop` in the codebase is a conversation
pane in `CandidateScreening`. Measured: the **window** is the scroll owner
(`window.scrollY` 1200 while `.ant-layout-content`, `.ml-main` and `body` all read 0), and
leaving a route at 1200 arrived at **1015** — it moved only because the shorter page
clamped the maximum, not because anything reset it.

`useLayoutEffect` in `MainLayout`, with three deliberate choices:

- **`useLayoutEffect`, not `useEffect`** — runs before paint, so the new route is never
  shown at the old offset and then yanked.
- **`location.pathname` only, never `location.search`** — filters, tabs and pagination are
  query params on several screens. Keying on the whole location would scroll the user to
  the top on every filter change, which is worse than the original bug.
- **Skipped on `POP`** — sending someone back to the top of a list they just backed out of
  is wrong; the browser’s own `history.scrollRestoration` returns them where they were.

Verified: PUSH 1400 → **0**; Back parked-at-900 → **360, restored not zeroed**; a
query-param change held at 1015.

### The topbar was repeating the page back to itself

The composition rollout put a `PageHeader` on all 12 routes, but the topbar still printed
the page title 12px above it. Measured topbar vs page-header title: `/candidates` "Search
Candidate" / "Search Candidate", `/settings` "Settings" / "Settings" — character-identical.
`/mrf` differed ("MRF" vs "New MRF Request"), which is arguably worse. Meanwhile ~700px of
the bar’s centre was empty at 1500px.

Three things already in the tree made this cheap:

| Already there | Was |
|---|---|
| `Breadcrumb` | imported in `MainLayout` and **never rendered** |
| `BREADCRUMB_MAP` + `NESTED_TITLE_MAP` | held every label already |
| `CommandPalette` | fully built, mounted by **`Dashboard` alone** |

So the change is mostly relocation, not new code:

- **Left** — the trail replaces the title. On `/candidates/:id` it now reads
  `Search Candidate › Candidate Details`, with the parent a real link (proper `href`,
  intercepted to stay an SPA navigation). A single title could never say that.
- **Centre** — a search control that opens the palette. **`CommandPalette`, its `cmdOpen`
  state and its ⌘K key listener all moved from `Dashboard.jsx` to `MainLayout.jsx`**, so a
  shortcut that reads as global now works on every route instead of one. Verified opening
  on `/settings`.
- **Right** — unchanged.
- The hero’s now-duplicate Search button (`DashboardHero.jsx`) is retired.

The control is a real `src/ui` `<Button>`, restyled to read as a recessed field:
`composition.mjs` asserts "no un-systemised button" on all 11 routes, so anything else
would have turned every route red at once.

`onOpenCommand` and the `SearchOutlined` import stay in `DashboardHero` on purpose — the
commented-out block references them, and the no-delete rule only works if a restore is a
pure uncomment.

**Noted, not fixed:** the module-permission check is now in **four** places (`App.jsx:186`,
`App.jsx:296`, `Dashboard.jsx:126`, and `MainLayout`). A shared helper is the right cleanup
and is deliberately left as its own change rather than smuggled in here.

### The two icons beside each other were not the same size

Reported while the above was in flight, and measured: the notification glyph rendered
**14px** against the theme toggle’s **22px** sun — a 57% mismatch between two icons sitting
side by side.

Not a missing size, an outranked one. `NotificationBell` already asks for `.cmp-icon`
(`--fs-title-3`, 20px), but that selector is (0,1,0) and lost inside `.ui-btn`, so the
glyph fell back to inheriting the button’s **label** size. One scoped rule lets the
declared intent land rather than inventing a number:

| | Before | After |
|---|---|---|
| Bell glyph | 14px | **20px** |
| Sun / moon visual | 22px | 22px (light) / 23.9px (dark), unchanged |

20px against a sun whose rays are hairlines reads level. The theme toggle was left alone —
it is a deliberate custom control and 22px is its designed size.

**Noted, not fixed:** the three controls in that cluster still have three different hit
boxes — bell 38px, theme toggle 36px, avatar 32px. Invisible at a glance next to the icon
mismatch, but it is the same class of inconsistency.

### Verification

Both themes, 0 page errors: no `.ml-page-title` anywhere; crumbs correct flat and nested;
⌘K opens the palette on a non-dashboard route; hero button gone. `npm run verify:design`
— **144 PASS, 2 FAIL**, and both failures are the known pre-existing `/dashboard` parity
rows (`button radius`, `button height`). `npm run lint` **0 errors**. `npx vite build` clean.

Incidentally this run had **zero composition timing failures**, on the same code that
produced 4 and then 13 of them earlier today — further confirmation that those rows are
load-dependent and that `composition.mjs`’s fixed 3000ms wait should become a poll.

**Mid-edit slip worth recording:** commenting out the hero button first left the JSX
comment unterminated, swallowing the closing tags and orphaning its `<Tooltip>`. Caught by
reading the region back rather than by any check — the same shape of trap `docs/` warns
about, where a comment wrapper ends in the wrong place.
---

## 2026-08-31 — Dashboard: three defects, two of them silent

Screen 4 of the sweep. Reported: inconsistent container heights, a role filter that showed
"No data", and unreadable tooltip hint text. All three were real; none of the three raised
an error, a warning, or a failing check.

### 1. Ragged card heights — a rule the V3 rollout silently killed

`aurora-glass.css` carried this, with a comment promising exactly what was reported:

```css
/* Equal-height cards within a band, so a short widget cannot leave a ragged bottom
   edge beside a tall one. */
.ats-v2 .dash-band > .ant-col > .ant-card,
.ats-v2 .dash-band > .ant-col > div > .ant-card { height: 100%; }
```

The rollout replaced every dashboard `<Card>` with `<Surface>`, which renders
`.ui-surface`. Measured live: **0 `.ant-card` inside `.dash-band` against 13
`.ui-surface`** — the rule had matched nothing since the rollout. The AntD columns do
stretch (Row is flex); it was the card inside that never filled its column.

| Band | Ragged gap before | After |
|---|---|---|
| 0 — four KPI tiles | 0 | 0 |
| 1 — Hiring Trends / Action Center | 22px | **0** |
| 2 — Funnel / Talent / Upcoming | 23px, 105px | **0** |
| 3 — Recruiter / Live Activity | **315px** | **0** |
| 4 — Latest Uploads / Quick Actions | 76px | **0** |

`.ui-surface` selectors added; the `.ant-card` ones kept so the rule cannot break a
second time if a Card returns.

### 2. Role filter listed nothing — one missing object key

`GET /screening/roles` returns rows shaped `{ id, role, number_of_positions, created_at }`.
`DashboardHero.jsx` mapped a label with
`r?.role_name || r?.PositionApplied || r?.name || r?.label` — **`role`, the actual key, was
the one name missing.** Every row mapped to `''`, `.filter(Boolean)` dropped them all, and
the Select was left holding only "All roles"; typing any real role showed AntD's "No data"
even though the API had returned it. Options went **1 → 8**, "AI Engineer" among them.

### 3. Tooltip text failed WCAG AA

`themeConfig.js` set `colorBgSpotlight: primary` in light mode, so tooltips were `#7a922e`
with a white label — **3.51:1, under the 4.5:1 floor for normal text**. `theme/index.css`
documents the pair that exists to prevent this: `--brand-solid` is *"the solid-button FILL
(a shade below --brand-primary in light so a white label clears 4.5:1)"* and
`--brand-on-solid` is that label. The tooltip now takes both.

Worse, `.mi-note` painted `var(--text-2)` (`#5f6664`) on that green — page text tokens on
an inverted surface, computing to roughly **1.7:1**. Those are the hint lines
("How it’s counted:", "The graph shows:", "Where it comes from:"), so the least readable
text in the product was the text explaining the numbers. Now `--brand-on-solid`, scoped to
`.ant-tooltip-inner` and deliberately unscoped from `.ats-v2` because AntD portals tooltips
to `document.body`.

| | Before | After (light) | After (dark) |
|---|---|---|---|
| Tooltip fill | `#7a922e` | `#66792a` | `#26302c` (unchanged) |
| Label | 3.51:1 | **4.85:1** | **11.29:1** |
| `.mi-note` ×3 + bold labels | ~1.7:1 | **4.85:1** | **13.62:1** |

**Coverage hole, flagged not fixed:** `contrast.mjs` passed through all of this and never
saw the 3.51:1 tooltip, because a tooltip only exists on hover.

### composition.mjs is flaky under load — flagged, not fixed

Three consecutive suite runs failed a **different set** of routes on "renders exactly one
page header": first `/settings` + `/email`, then `/candidates`, `/mrf`, `/hr-upload`,
`/vendor`, `/vendor-dashboard`, and earlier none at all. A moving failure set is the
signature of timing, not regression. Probing all 11 routes directly, polling for the header
instead of sleeping a fixed 3000ms, **every one renders exactly one page header**. The
check uses `page.waitForTimeout(3000)` rather than waiting for a condition; under load that
is not enough and it reports false failures. Worth converting to a poll.

### Verification

Both themes, 0 page errors: band gaps all 0; role options 8 including "AI Engineer";
tooltip contrasts as tabled above. `npm run lint` **0 errors** (94 warnings, all in the two
retired files). `npx vite build` clean. `npm run verify:design` — **140 PASS**, with the two
known pre-existing `/dashboard` parity rows (`button radius`, `button height`) and the
timing-only composition rows described above.

**Known and deliberately left:** stretched cards align at the edges but top-align their
content — Live Activity has ~338px of empty space below its idle state inside a 569px card.
Distributing it means per-widget `flex: 1` plus relaxing `.dash-feed`'s `max-height: 320px`.
---

## 2026-08-31 — Inter + Sora is the shipped font

**Verification standing:** font rendering, lint, build and the public-route type ramp are
all green and measured. The **11 auth-gated routes are NOT yet re-verified** — the backend
on :5000 was down and booting it starts cron jobs that can send real mail, so it was left
to the operator. Re-run `npm run verify:design` once the backend is up; `composition`'s
"type is on the ramp" is the row this change could legitimately break.

### One line, because fonts.js was built for it

`theme/fonts.js` had already consolidated the Google Fonts `<link>`, the `--font*` tokens,
the AntD `fontFamily` literals and 36 hardcoded JSX stacks into a single pack axis.
Confirmed before touching anything: **zero** hardcoded font stacks remain in any `.jsx`,
and every `font-family:` in every stylesheet resolves through a token. So:

```js
DEFAULT_FONT_PACK_ID = 'system-native'  ->  'inter-sora'
```

`system-native` and `figtree` stay switchable, and an explicit `/design-lab` choice still
wins via `resolveFontPackId()`.

### The pack carries the SCALE, not just the families

By design — a scale is not portable across families. Body/callout/subhead/footnote/caption
sizes are identical between the two packs. What moved app-wide:

| Role | system-native | inter-sora |
|---|---|---|
| display | w700, `-0.02em` | w800, `-0.035em` |
| title1 | 32px w700 | 32px **w800** |
| title2 | 24px w600 | 24px **w700** |
| title3 | 20px w600 | 20px **w700** |
| metricLg / Md / Sm | 46 / 33 / 25px w700 | **44 / 32 / 24px** w800 |

Headings are heavier and tighter; every KPI number is ~2px smaller.

### Two verify scripts were pinned to the old pack

Both are pack-specific and had to move with the default, and they fail differently:

- **`composition.mjs` RAMP** was `[12,13,14,15,17,20,24,32,25,33,46]` — system-native's
  metrics. Inter-sora renders 44/32/24; 24 and 32 were already present, so the one new
  value is **44**, and without it every route rendering a `metricLg` would have been
  reported off-ramp. Now `[12,13,14,15,17,20,24,32,44]`. **A red row — loud.**
- **`parity.mjs` AXES** pinned `font: 'system-native'` on BOTH sides, so it would have kept
  passing while testing a font the app no longer ships. **Blindness — silent.** Now tracks
  the default, with a comment saying it must.

### The webfont was already being downloaded and thrown away

`index.html`'s static `<link>` has always fetched Inter + Sora + DM Mono on every page
load, while the shipped pack was `system-native` (`href: null`). This change costs **no new
network request** — it starts using what the app already paid for. The comment at
`index.html:12` claiming inter-sora was the default was wrong, and is now correct.

### Expect one font flash for existing users, once

`applyFontStylesheet()` writes `ats_font_href` on every mount, not only on an explicit
choice, so every current user has `''` cached. On their first load after this the
anti-FOUC script sees `''` (not `null`) and removes the link pre-paint; React then mounts,
resolves the new default and recreates it. **One flash, self-healing, never repeats.** Not
a bug — recorded so it is not chased as one.

### Measured

On `/login` and `/design-lab`, both themes: `document.fonts.check` **true for Inter, Sora
and DM Mono** — they render, rather than degrading silently to the fallback stack, which
is the failure mode that looks almost right. `--fs-metric-lg` 46px → **44px**. Auth title
now **Sora 24px w700**; auth labels **Inter 14px**, inputs **15px** — the sizes set two
entries ago are unchanged. Every size rendered on `/design-lab` is on the new RAMP.

`npm run lint` **0 errors** (94 warnings, all in the two retired files). `npx vite build`
clean.

**One pre-existing off-ramp node found, not fixed:** `kbd.dl-kbd` (the ⌘K hint) renders
11px, below the 12px floor. It is design-lab gallery chrome on a route neither
`composition.mjs` nor `type-floor.mjs` scans, and no font pack has an 11px role, so it
predates this change. `dash-kbd`, its app-side equivalent, is already in TYPE_EXEMPT.

**Also still open:** the two `/dashboard` button parity rows (`button radius`,
`button height`), unrelated and outstanding since 2026-08-31.
---

## 2026-08-31 — The left nav joins the design system (and the shell finally does too)

Screen 2 of the screen-by-screen sweep. Reported: "check if the font is matching", plus
"ensure it follows the glass morphism design".

### The font DOES match — nothing else did

The nav renders `Segoe UI Variable Text`, identical to `--font` and to page content. That
one property is correct and was deliberately left alone. Everything else was AntD default
leaking through, because **the shell was the last surface in the app still running on
`LEGACY_GEOMETRY`**: `DesignScope` is what switches the preset geometry on, and it wraps
*pages*, never `MainLayout`. The sidebar never entered the V3 rollout at all. No
`font-family`, `font-size` or `font-weight` rule targeted `.ml-menu` anywhere.

| | Before | After |
|---|---|---|
| Radius | 8px (`borderRadius: 8`) | `--radius-ctl` **15px** |
| Row height | 48px (AntD default) | `--control-h-relaxed` **46px** |
| Padding | 24px left / 16px right | **16/16** symmetric |
| Label size | 14px (AntD `fontSize`) | `--fs-callout` 14px — same number, now derived |
| Weight, resting | 400 | **500** |
| Weight, selected | 400 — no signal | **600** |

### Glass: two real gaps, and two things deliberately NOT touched

Measured in both themes first. **Light-mode chrome is opaque white with
`backdrop-filter: none`, and that is correct** — Part I says so explicitly; it was not
"fixed" back to glass. **Dark mode is already true tier-1 glass** (`rgba(16,22,20,0.62)` +
`blur(30px) saturate(1.5)`). The selected item already carried the full signature: brand
gradient, `--glass-hilite` catch-light, gradient rail with a brand glow.

**1. Hover had no material response at all** — measured `box-shadow: none` in both themes.
A pointer got a flat tint and a 3px slide while every other surface in the system answers
with material. It was the only stateless surface in the shell. Now a three-rung ladder:
rest flat → hover lifts on `--depth-1` → selected settles on `--glass-hilite`. `--depth-1`
and **not** the catch-light, because the catch-light is what says *selected*.

**2. Two rules painted the selected rail, at identical specificity (0,2,0).**
`aurora-glass.css:249` paints a gradient with a glow; `index.css:1497` painted a flat
`--gold` with none. The glass one wins *only* because `main.jsx` imports `aurora-glass.css`
after `index.css` — one import-order edit from silently downgrading the selected item
app-wide. Provably dead as written (one `<Sider>` in the app, always inside `.ats-v2`), so
the `index.css` block is commented out with a dated reason per the no-delete rule.

The 8px radius was a *glass* defect too, not only a geometry one: `--glass-hilite`'s
`inset 0 -14px 24px -16px` bottom shade is tuned for the system's 15–16px radii and bunched
at 8px. The radius fix improved the material as well as the shape.

### Two things I got wrong first, and how they showed up

**`--control-h-comfy` does not exist.** The ladder is `--control-h-compact` /
`--control-h` / `--control-h-relaxed`. My probe read it with a `||` fallback, which
returned 46px from the *next* token and hid the fact. `height: var(--control-h-comfy)`
with no fallback computes to `auto`, so the items rendered **18px tall** — and this is a
silent failure: no error, no warning, just a collapsed nav. Now `--control-h-relaxed`.

**AntD writes `style="padding-left: 24px"` inline on every menu item.** The inline-style
law arriving from the library rather than from us, so `padding-inline` from a stylesheet
could never win. Rather than reach for `!important`, the `<Menu>` now passes
`inlineIndent={16}`, which sets that inline value at its source. Collapsed mode drops the
inline padding entirely and is unaffected — measured 15/15 before and after.

### Also

`.ml-product-label` (the "ATS PLATFORM" divider in the brand block) carried an inline
`borderLeft` + `paddingLeft`. eslint never flagged it because the rule matches `border`,
not `borderLeft`. Moved into the existing class as logical properties.

### Verification

Measured in **four states — expanded + collapsed × light + dark**, all four identical on
geometry and type: radius 15px, height 46px, 16/16 expanded, 14px, 500/600. Collapsed icons
centred (1px offset). Rail gradient and glow confirmed still painting in both themes after
the `index.css` block was retired; selected brand colour and catch-light both intact;
hover resolves `--depth-1` in both themes. 0 page errors across all eight renders.

`npm run lint` **0 errors** (94 warnings, all in the two retired files). `npx vite build`
clean. `npm run verify:design` — **no new failures**; the same two pre-existing `parity.mjs`
rows (`button radius`, `button height`, both on `/dashboard`) and nothing else.

The **vendor role** shares this CSS by construction: `VENDOR_MENU_ITEMS` is two flat items
of the same shape through the same `<Menu className="ml-menu">`, and there is no
`children:` anywhere in the nav, so no `.ant-menu-submenu` exists to style separately.

**Still open:** those two `/dashboard` button parity rows are now the oldest untouched
finding in the sweep.
---

## 2026-08-31 — Auth screens: tighter form rhythm, one step up the type ramp

First screen of the screen-by-screen design sweep. Reported from the login screen: the
form read too airy and its text too small. Both were true, and both were already
systemised in `.auth-form-inner` (Stage 5.2), so this is a token swap in one block of
`src/ui/ui.css` — no inline style added, no `:root` token touched.

### Measured before → after (1500px, both themes identical)

| | Rule | Before | After |
|---|---|---|---|
| Field label | `.auth-field-label` | `--fs-subhead` 13px | `--fs-callout` **14px** |
| Input + placeholder | `.auth-form-inner .ant-input…` | `--fs-callout` 14px | `--fs-body` **15px** |
| Subtitle | `.auth-form-subtitle` | `--fs-callout` 14px | `--fs-body` **15px** |
| "Forgot password?" | `.auth-link` | `--fs-subhead` 13px | `--fs-callout` **14px** |
| Gap between fields | `.auth-form-inner .ant-form-item` | `--space-5` 24px | `--space-4` **16px** |
| Label → input gap | AntD default | 8px | **4px** (new rule) |

Every size is an existing step on the ramp in `theme/tokens.css` — no off-ramp value was
invented, and nothing moved toward the 12px floor. The 4px label gap follows the
precedent `.screening-filter` set at `theme/index.css:1705` for a dense vertical form.

`.auth-field-label--caps` (the AdminLogin uppercase modifier) deliberately stays at
`--fs-caption` 12px: it is a caps eyebrow, a different role, and already at the floor.

### This lands on FOUR pages, not one

`.auth-form-inner` is rendered once, by `layouts/AuthLayout.jsx:81`, and wraps every auth
route — the same four this log recorded under Stage 5.2. The shared-class coupling law
applies, so all four were measured and screenshotted in both modes rather than assumed:

| Route | label | input | gap | note |
|---|---|---|---|---|
| `/login` | 14px | 15px | 16px | — |
| `/admin/login` | 12px | 15px | 16px | `--caps` modifier intact, badge unaffected |
| `/forgot-password` | 14px | 15px | 16px | — |
| `/reset-password` | 14px | 15px | 16px | needs `?token=` to render its form at all |

No horizontal overflow and no page errors on any of the eight renders.

### The duplicate that was on all four

The submit `<Button>` carried `emphasis="solid"` **twice** — once as the first attribute,
again on the `size="lg"` line — on `Login`, `AdminLogin`, `ForgotPassword` and
`ResetPassword`. Identical values, so nothing rendered wrong; JSX keeps the last. The
leading one is removed on all four.

### Verification

`npm run lint` **0 errors** (94 warnings, all in the two retired files —
`CandidatePipelinePrototype` and `StatCard`). `npm run verify:design` ran green except
for two `parity.mjs` rows, **both pre-existing and unrelated**: `button radius` (lab
17.86px vs app 15px) and `button height` (lab 38px vs app 36px), measured on `/dashboard`.
Proved pre-existing by reverting this change and re-running parity alone — byte-identical
failures. They are the next thing to fix, and are recorded here so the red rows are not
mistaken for this work.

**Still open on this screen:** Turnstile is running a *testing-only* site key ("For
testing only. If seen, report to site owner"). That is configuration, not design, and it
is why `verify:design` could not log in on 2026-08-31. Left alone deliberately.
---

## 2026-08-29 — Stage 6: the shared-component sweep, and two functional regressions

Debt **302 → 95**, and all 95 that remain are in the two *retired* files
(`CandidatePipelinePrototype` 85, `StatCard` 10). **Every live file is at zero.**

### Two functional regressions I had shipped

Both were invisible to every check that existed, and both came from the same habit —
moving a value out of an inline style without checking what else depended on it.

**The sidebar had stopped sticking.** `position: sticky` was an inline style, so it won.
Moving it to a class made it lose to `aurora-glass.css`'s
`.ats-v2 > .ant-layout-sider { position: relative }` — **the `.ats-v2` leak for the
fourth time**, and the first that broke behaviour rather than appearance. What makes it
nasty: `height` and `overflow` from the same class landed correctly. Only `position`
lost. A half-applied class is invisible in a screenshot.

**Six `/analytics` panels were bare opaque Cards.** I had converted 5 of 12 and stopped
— the half-conversion trap, for the third time. They rendered opaque white with no
shadow inside a glass container: Failure A.

### Three guards, committed rather than thrown away

- **`functional.mjs`** — 14 assertions: board scroll, drawer outcome tones, the Hold
  dialog, email scrollers and iframe height, Surface-as-Card slots, MRF required
  validation, sticky chrome, the bulk dock. **Stub-by-default**: reads pass through,
  every write is captured and answered in the browser. Zero writes reach the backend.
- **`type-floor.mjs`** — the 12px floor, across 11 routes. It found **223 nodes below
  the floor on four routes** *after* the rollout was called complete.
- Both wired into `verify:design`, now 9 checks.

The functional probe's first run "failed" nine assertions because the write guard
swallowed the **login POST** — no session, so every assertion measured the login screen.
My test was wrong, not the app. Same for an `/analytics` assertion that checked the
wrong tab. Both were checked before anything was "fixed".

### Two colour palettes that could never have been tokens

`SkillTags` (8 hues) and `StatusBadge` (9 statuses) were literal hexes **because the
code made them impossible to tokenise**: it built its surfaces by concatenating alpha
onto a hex (`${c}30`, `${c}10`), which a CSS variable structurally cannot satisfy.
`color-mix()` does the same job on a token. Six of the nine statuses now alias tokens
that already existed, so a change to `--red` or the brand reaches them.

Measured adapting: skill hue `rgb(122,146,46)` light → `rgb(168,194,74)` dark.

Also tokenised: `ROLE_COLORS` and the ActionCenter row hues (both reuse `--skill-1..8`
rather than inventing a third and fourth set of eight), the Recharts brand fills, and
`--meta name="theme-color"`, which now reads `--brand-primary` from computed style so a
tenant brand reaches the mobile browser chrome.

### One loading treatment, was five

The same "this pane is loading" moment was written five ways: `.em-loading` at 40px,
`.vd-loading` at 80px, an inline `60px 0`, an inline `100vh` flex ×4 in App.jsx, and —
worst — the four public token pages used **`.pps-actions`, an actions-row class**, to
centre a spinner. Now one treatment, measured identical at `48px 0` / `min-height 180px`.

Deliberately **not** switched to `StateBlock`: its loading variant renders skeleton
rows, which is right for a pane whose shape is known and wrong for a boot state that
fires before any layout exists. The in-pane cases still want it.

### Graduated to `error`

Every live file is now eslint `error`-level (verified: severity 2 on live files, 1 on
the two retired). **This is step 6 of the rollout recipe, which was written down and
never performed for a single group** — the whole app sat at `warn` while twelve routes
were converted, so any of them could have regressed silently.

### Documented exemptions, not silenced warnings

`PublicPageShell`'s frozen `BRAND` and `ThemeContext`'s two-hex fallback are exempted
from the hex rule **with reasons**: both are consumed where a CSS variable cannot
resolve — outside a React tree (the email layout keeps in step with it) and before
first paint. The live path in both reads tokens.

### Not done, deliberately

`LEGACY_GEOMETRY`, the 13 per-route `DesignScope` wrappers, the six legacy radius rules
and the motion aliases are all still live. None changes anything a user sees; the motion
change touches 119 rules and is the single most likely thing to break something quietly.
Recorded in the plan rather than rushed.

**Verified:** 9/9 checks, build clean, no duplicate classNames across 4,011 tags.

---

## 2026-08-29 — Stage 5.8 + the shell: every route converted

`CandidateScreening` 438 → 0, `PipelineDrawer` 120 → 0, `PipelineConfigPanel` 40 → 0,
`MainLayout` 27 → 0. Debt **927 → 302**.

**All 24 routes are converted.** What remains is shared components (217) and the
retired prototype (85), which the plan excluded from the target from the start.

### The worst type scale in the app

`CandidateScreening` set **9px and 9.5px** labels, some of them at 0.6–0.7 opacity —
below the scale's floor AND dimmed, which is the exact combination the contrast work
exists to prevent. The floor is 12px and it exists because the app ran 9–13; this file
is where the 9 came from. Three uppercase label variants for one role, all caption now.

### Five tones, written four times

The AI drawer computed verdict colours in JS as `rgba()` strings and bare hexes —
`#4a7c59`, `#c0392b`, `#6d7e3d`, `#3d6b8a`, `#e67e22` — each spelled three times
(border 30–35%, fill 6–8%, text) and the whole ladder repeated **four times** across
verdict badges, score badges, parameter rows and skill chips. The JS picks a tone NAME
now; `.cs-tone--*` owns the colour and mixes it from tokens. Verified in dark, which is
where the literals would have failed and did not.

### The shell flips, last

Twelve routes converted underneath familiar chrome, so every intermediate state stayed
coherent and a shell regression would have been one revert rather than a permanent
backdrop. `V2_ROUTES` and `isV2` are **retired** — the gate was true everywhere and
described nothing. `.ats-v2` is unconditional now and the ambient canvas mounts on
every screen (measured: it did not, before, on any route outside the list).

Its product label was **9.5px**, the smallest type in the app.

### A comment I wrote, then measured false

I wrote that removing the topbar's inline background "lets the tier-1 blur take
effect". Measured: light chrome is `rgb(255,255,255)` with **no backdrop**; only dark
is `rgba(16,22,20,0.62)` with `blur(30px)`. That is a deliberate, documented decision
in `aurora-glass.css` — a translucent pane is only ever as neutral as what shows
through it, so a neutral nav cannot be had by lowering alpha. **The code was right and
my comment was wrong**; the comment is corrected in place rather than the behaviour
changed. Third time in this rollout that a claim in a comment failed measurement.

### The AdminDashboard mistake, once more

`OUTCOME_BUTTONS` carried `style: { color: '#d4a017', ... }`. I renamed it to
`className` — but the render reads `btn.style`, and `className` was only wired for the
primary button. The Hold button silently lost its amber. **Same root cause as the three
AdminDashboard defects: changing a property without checking how it is consumed.**
Caught by looking at the screen, not by any check. Now measured: light
`rgb(212,160,23)`, dark `rgb(240,180,41)` — a distinction the hardcoded hex never had.

### Reuse instead of a fourth copy

`PipelineConfigPanel`'s info/warn callouts are the same eight-property shape as
Settings', and it renders inside /settings, so they take `.set-callout` rather than a
fourth hand-written copy.

**Verified:** /filtering driven end to end — role selected, ranked list rendered,
AI-profile drawer opened — in both modes; /pipeline drawer opened in both modes; the
shell smoke-tested on three routes. Suite passes, build clean.

---

## 2026-08-29 — Stage 5.7: the admin portal, and the last two families

`AdminDashboard` 221 → 0, plus MainLayout's `isAdminPath` branch (17 of its 44).
Debt **1,165 → 927**. Thirteen routes converted; **63% of the original debt cleared.**

### Both remaining families retired

`StatTile`'s docblock named three parallel stat families. `StatCard` went in Stage 5,
`KpiCard` in 5.5, and **`.admin-stat` goes here** — 32px/700 with `--shadow-md`, a 13px
icon radius and a -3 lift, doing the same job as the other two with a third set of
numbers and no stated reason for any of them. Four cards, four `accent` names.

`Segmented`'s docblock named `.admin-tab` as one of the two ad-hoc tab bars it exists
to replace, and this is that. It was three `<Button type="text">` carrying a
conditional class — **not a radiogroup**: no arrow keys, and every pill its own tab
stop. It is a real roving-tabindex radiogroup now.

### A palette the theme layer should have owned

`MODULES_INFO` carried **nine raw hexes**, one identity hue per module. Two consequences:
no tenant could re-theme them, and **they had no dark-mode pair** — the light values
were carried straight onto a dark ground, where `#1890ff` and `#722ed1` both go muddy.
They are `--module-*` tokens now, with lifted dark values, on the same reasoning as the
avatar palette that already existed: they only have to stay distinguishable from each
other, not carry meaning.

While adding them a stray character corrupted one value to `#f濃`, which is not a
colour. A validation pass over every `--module-*` value caught it before the build.

### One state, written six times

Each module-access row expressed enabled/disabled as **six conditionals across two
elements** — background, border colour, icon fill, icon border, badge tint, badge
colour — with the badge tints as raw `rgba()` pairs. One modifier class carries all of
it now, and the tints mix from tokens.

The panels also hand-wrote `0 1px 3px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.06)`
four times. That is what `--depth-*` already expresses, and unlike a literal it changes
with the mode.

### The admin shell converts here, not last

`MainLayout`'s admin branch is a **separate shell** — its own topbar, no Sider, its own
background — reachable only from `/admin` and sharing nothing with the other 23 routes.
Converting it now does not disturb them, so the main shell still goes last and every
intermediate state stays coherent.

Its dark-mode logo chip was a spread `...(isDark && { ... })` inline object. That reads
the mode from React state, which no stylesheet can see; it is a `[data-theme='dark']`
rule now, so the cascade decides — the same correction the `-light`/`-dark` pair
convention exists to enforce.

### Three defects shipped, found on review — all one mistake

I could not render this route at first: `AdminRoute` gates on
`user.role ∈ {admin, superadmin}` and the only dev credentials are a non-admin
account. I recorded that as unverified and moved on. Review came back with two
screenshots, and re-verification found a third.

The route IS renderable — the role comes from `getCurrentUser`, so a Playwright
`route()` interceptor can raise it in the browser without touching `src/`. That
harness now exists (`scratchpad/adminshot.mjs`). **"I cannot verify this" was wrong;
what was true is that I had not found a way to.** The automated checks all passed on
the broken build, which is exactly why the recipe says look at the screen.

What was broken, and why each one is the same error:

1. **`.ad-user-row` lost its padding.** The inline object held
   `padding: '12px 16px'` alongside the state conditionals. I replaced the whole
   object with a class carrying only the state, and the avatars went flush against
   the panel edge.
2. **`.ad-topbar` was a bare flex row.** `.admin-tabbar` had been a tier-2 PANE —
   gradient fill, border, 16px radius, shadow, `padding: 10px 16px`. The tabs floated
   unanchored on the canvas. It is a `Surface` now, the same treatment /pipeline's
   toolbar gets.
3. **The admin shell had NO content padding at all.** Measured: `0px` padding and a
   **0px gap under the header**, against `24px 28px 40px` and a 24px gap on every
   other route. The old `.admin-portal` div supplied `28px 24px` itself; when the page
   moved to `PageShell` — which owns the page COLUMN, not the shell's inset — nothing
   was left holding it. This is the double-padding problem inverted: the rule is that
   the shell owns the inset and the page owns the column, and admin was the one shell
   that had never held up its end.

**The single root cause: replacing a whole style object with a class means accounting
for every property that object held, not just the ones that motivated the change.**
Three times in one file, because this file had the most conditional-heavy objects and
I was reading them for their conditionals. The lint rule cannot catch it — `padding`
is not a banned property, so those declarations were never the target; they were
collateral.

Audited the other eight converted routes for the same class of error: every other
whole-object replacement carried its layout properties across (`.vd-card-body` 24/28/28,
`.em-list-body` 16/0, `.pl-column-card` 10, the Settings callouts 12/16 and 16/20).
AdminDashboard was the outlier.

---

## 2026-08-29 — Stage 5.6: the board, and a regression test for Failure B

`Pipeline` 27 → 0. Debt **1,192 → 1,165**. Twelve routes converted.

The smallest group by count and the one the plan flagged as highest-risk, because
**`.cp-candidate-card`'s leading border is the candidate's status** — data, and the
only cue for that state on the board. Any rule writing the `border` or `border-color`
shorthand sets all four sides and erases it. The page still renders. That already
shipped once, when the hover rule used `border-color`.

`--cp-accent` was already in place from an earlier phase, so the fix held. What this
group added is the **guard**: `scripts/verify/status-border.mjs`, now in the suite. It
asserts three things a screenshot cannot — the leading border is non-zero, different
statuses render different colours, and hovering does not change the colour. Currently
**4 distinct colours across 29 cards**, unchanged on hover.

### The `.ats-v2` leak, third occurrence

`aurora-glass.css` paints `.ats-v2 .cp-candidate-card { background: var(--glass-3-bg)
!important }`, and a converted route still sits inside `.ats-v2`. Same failure as the
upload dropzone. By now the fix is known rather than discovered: `!important` AND an
extra class, because the rule being overridden is `!important` and ties on
specificity. Both, or neither works.

### I nearly shipped the exact bug this rollout started with

I wrote `border-radius: var(--radius-sm)` in the new page stylesheet. `--radius-sm` is
the **legacy** name — aliasing it is what restyled all 24 routes at the start of this
work and is why the V3 scale deliberately uses names nothing else consumes. Caught
before the build by checking the token actually resolved in `resolveTokens.js`, which
is a habit that has now paid for itself twice.

### The arrows are outside the scope

The board's scroll arrows are portaled to `<body>` so their `position: fixed` anchors
to the real viewport — an ancestor `transform` would otherwise become their containing
block. That also puts them **outside `.ats-v3`**, so a scoped rule could never reach
them. Their styling is deliberately global, and only the measured viewport offset stays
inline, because it is computed from the board's bounds at runtime. Same for the
stale-board scrim.

That inline block also held `border: '2px solid #fff'`, a `#7a922e`/`#92a63c` gradient
fallback and `rgba(122,146,46,0.30)` — none of which could follow a theme.

### Three duplicate classNames, caught by the check

Replacing `style={{...}}` with `className="..."` on elements that already had one —
including the board scroller, whose `className` sat on the line above the style. The
guard added in 5.3 found all three. It is now the third group in a row where that
check has caught something I would not have seen.

**Verified:** both modes, no page errors, status accents measured distinct and
hover-stable, suite passes, build clean.

---

## 2026-08-29 — Stage 5.5 complete: the metric group, and the end of the third stat family

`CandidateDetail` 98 → 0, `Analytics` 69 → 0, `DeliveryMonitoring` 17 → 0.
Debt **1,376 → 1,192**. Eleven routes converted; **53% of the original debt cleared.**

### KpiCard is gone, and the bridge rule with it

The rollout had three stat families doing the same job with different numbers.
`StatTile` replaced `StatCard` on /dashboard in Stage 5; this closes `KpiCard` across
**all four consumers at once** — Analytics, VendorDashboard, HRUpload, VendorPortal —
which is why it waited for this group rather than being done piecemeal in 5.3.

The API change is the point: `color` + `tint` + `accent` (three values, one of them a
gradient string) becomes **one `accent` naming a token**. The old triple was
structurally incapable of following a tenant brand.

`index={i}` is gone too. The stagger is `.ui-stagger` on the row, so the delay comes
from `nth-child` instead of every call site passing its own position — and passing it
would have landed an unknown `index` attribute on the DOM through StatTile's `...rest`.

**The `legacy-bridge.css` KpiCard rule is removed** — which is what a bridge rule is
supposed to do. It was added in 5.3, named 5.5 as the group that would delete it, and
5.5 deleted it. The file stays; 5.7 and 5.8 will need it for the same reason.

### A new accent, because the vocabulary was missing one

/analytics' "Total" tile used `ACCENT.neutral`. Every entry in StatTile's accent list
carries a verdict, so the only options were to invent one or paint a plain total
brand-green — which makes it read as a positive result. `neutral` is now part of the
vocabulary, and it is the one accent that deliberately recedes.

### `<Surface as={Card}>`

/analytics' twelve panels use `title`, `extra` and `loading`. Those are real
behaviours, not decoration — the loading skeleton in particular, since a confident
"0" mid-fetch is a wrong answer and not a slow one. Hand-building twelve heads would
have traded one duplication for another and dropped the skeleton.

`Surface` already had an `as` prop, so the combination just needed to be made honest:
`.ant-card` paints its own opaque `colorBgContainer` and draws its own border and
radius, which on a Surface is Failure A. It ties with `.ui-surface` on specificity and
AntD injects its styles at runtime, so **source order would have decided and could not
be relied on.** Stated explicitly in ui.css instead. /admin and /screening will want
the same adapter.

### Raw colour, found in quantity

This group had the most literal colour of any so far, and all of it was tokens written
longhand:

- `#2f6f9f,#4f93c4` and `#c0392b,#e0654f` — the two DeliveryMonitoring accent
  gradients, which are `--kpi-b`/`--kpi-b-2` and `--kpi-d`/`--kpi-d-2`.
- Five `tone:` hexes on the delivery tiles — `--kpi-b`, `--kpi-c`, `--kpi-d`, brand.
- `rgba(192,57,43,0.10)`, `rgba(122,146,46,0.12)`, `rgba(182,136,58,0.14)`,
  `rgba(74,124,89,0.12)` — four conditional tag tints, all near-duplicates of the
  `--kpi-*` tints that already existed.
- `#4a7c5920` / `#d4a01720` on the match-score tag — a token at 12.5% opacity spelled
  as an eight-digit hex.
- Three Timeline dot colours, one of which (`#92a63c`) is exactly
  `--brand-primary-hover`.

None of these could follow a theme, and in dark mode the tokens move while the
literals would not have. Every one is a `color-mix()` on a token now, so the tint is
derived rather than guessed.

I also caught myself writing `var(--brand-primary-2, ...)` with a fallback for a token
that does not exist — the fallback would have hidden that permanently. Checked the
brand file; the value wanted was `--brand-primary-hover`.

### Two things I got wrong and measured

**The stat rail.** I read the /analytics screenshot as showing square-cornered accent
bars overhanging the 24px cards and started to fix it. Measured first:
`.ui-stat-card` has `overflow: hidden`, so the rail is already clipped correctly. No
change made. The screenshot was too low-resolution to judge a 4px bar by eye.

**The real defect was next to it** — five tiles at 162px and one at 181px, because
"Zeko Score Received" is the only label that wraps. AntD's Col stretches but the
Surface inside does not fill. Fixed in the page stylesheet, not the component:
reserving two label lines is a fact about THIS row's content, and /dashboard's four
tiles would gain a band of empty space from the same rule.

### JSX comments, twice

Moving a comment out of a style object and into markup put it in the first-child
position of a `&&` branch and a ternary branch, which is a parse error both times —
once in 5.4 on EmailManagement, once here. Second occurrence, same cause: the comment
has to go outside the expression, not inside the branch.

**Verified:** all routes render logged-in in both modes with no page errors, suite
passes, build clean.

---

## 2026-08-29 — Stage 5.4 complete: the panel/form group

`Settings` 123 → 0, `VendorDashboard` 59 → 0, `EmailManagement` 23 → 0.
Debt **1,581 → 1,376**. Nine routes converted; **46% of the original debt cleared.**

### Settings: one callout, written six times

The page is six panels of three shapes. The explanatory callout was hand-written
**six times** as an identical eight-property object, differing only in whether it drew
from the `--info-*` or `--warn-*` family. That is a class and a modifier now. The same
uppercase label appeared at 10px, 11px and 12px — one role, three sizes, none of them
a decision.

Four labels carried a **second required marker** (`* DAILY TRIGGER TIME *`) on top of
AntD's own. Same defect as MRF, found the same way: check the starred set against the
`required: true` set before touching either. They matched exactly, and the one
unstarred label was the one not required.

### VendorDashboard: stage colour as data

The pipeline tiles wrote `border: 1px solid ${st.color}33` inline — a border shorthand
encoding stage identity where no stylesheet can reach it, which is **Failure B**
exactly. The hue is data, so it arrives as `--vd-stage` and the rule owns the border,
the background and the text colour. This is the prescribed exception in
`src/ui/index.js`, and the same shape as `--stat-color`.

`.section-card` did **not** carry over. `aurora-glass.css` states it declares an opaque
`--colorBgContainer` fill; on a Surface that is Failure A.

The gradient rail across the pipeline card's top edge needed its own top corners: a
`padding="none"` Surface does not clip children, so the rail's square ends sat proud of
the 24px radius and read as a bar laid over the card. Matching the radius rather than
clipping the Surface — `overflow: hidden` there would also cut the rim and bloom.

### EmailManagement: the last PageHeader consumer

This page was the only remaining consumer of `components/common/PageHeader`, so the
swap to `src/ui`'s retires it. The import is commented with a dated note and the
component file carries a header saying nothing imports it — both kept, per the
no-delete rule.

Its three panes were AntD Cards using `title` and `styles.body`, neither of which
Surface has. The head is real markup now and the body layout is a class. Two rules in
`theme/index.css` targeted `.ant-card-head` / `.ant-card-body` and would have gone dead
in the swap; they are reproduced against the new structure and the originals commented,
rather than left as selectors matching nothing.

`.email-pane-card` was on all three panes and **matched no rule anywhere** — a class
name that had outlived its stylesheet. I had also written, in this group's own new
stylesheet, that the class lived in `theme/index.css`. It did not. Corrected in place
rather than quietly dropped, for the same reason the radius-leak comment was.

I nearly stopped after converting only this page's container and header — the third
time in this rollout — and the screenshot is what caught it: the two panes still had
16px corners against a 24px shell.

### Smaller things

- The active/inactive dot on each template had a conditional inline background. That is
  a **boolean**, so it is a modifier class; the `--ui-accent` custom-property pattern is
  for continuous data like a stage hue, not an on/off state.
- Four more prose subtitles were set in `fontFamily: 'monospace'`.
- Settings and VendorDashboard both stacked their own page padding on MainLayout's.

**Verified:** all three routes render logged-in in both modes with no page errors —
including the editor pane with a template selected, which is where the new head markup
actually shows. Suite passes, build clean.

---

## 2026-08-29 — Stage 5.3 complete: the list/table group

`MRF` 232 → 0, `VendorPortal` 76 → 0, `HRUpload` 59 → 0. With `/candidates`, the
group cleared **677 violations**. Debt **2,258 → 1,581** — 38% of the original gone.

### Page rules moved out of the component stylesheet

`ui/ui.css` had accumulated three page-specific blocks (`.pps-*`, `.mrfs-*`, `.cand-*`)
during 5.2 and MRF would have made a fourth. Page rules now live in
`src/styles/pages/`, imported by the page after `../ui` so they win on equal
specificity. The three earlier blocks stay where they are on purpose: their section
headers don't match their contents — the `.pps-*` rules sit under an "AUTH SHELL"
header — so moving them means slicing a mislabelled region. That is endgame cleanup,
not something to attempt mid-group.

### One stylesheet for the two upload routes

They already shared `.upload-page` and were listed as a single unit for that reason.
The pairing earned itself immediately: the "same" note panel used
`var(--border-light)` on HRUpload and a hardcoded `rgba(0,0,0,0.07)` on VendorPortal.
The literal is a black tint, so in dark mode that border rendered as nothing — and
looking at either page alone would never have shown it.

### A bug from Stage 5.2, found by accident, now gated

Two `<Button>`s on `MrfApprovalAction` carried **two `className` attributes each**.
React keeps only the last, so `btn-reject-secondary` / `btn-approve-secondary` had been
silently dropped and both "Instead" toggles rendered as the same solid brand button —
the approve/reject colour distinction gone from a page external approvers act on. The
page rendered fine, which is why nobody saw it.

Then a scripted edit in this group reintroduced it four more times within the hour,
because replacing `style={{...}}` with `className="..."` on an element that already has
one produces exactly this.

So it is a check now: **`scripts/verify/dup-classname.mjs`**, in the suite. The first
version was a regex and it **silently skipped every element nesting braces three deep**
— `styles={{ body: { padding: 0 } }}`, which is how every AntD Card here sets body
padding. It reported two hits and missed two more on the same page. It walks matched
delimiters now; 4,025 tags scanned, source-level, no server needed.

The dropped classes encoded tone at soft emphasis, so they came back as
`ui-btn--soft ui-btn--danger` / `--success` rather than as a second class. Their CSS is
commented out with a dated note, per the no-delete rule.

### The `.ats-v2` leak, hitting for real

The plan flagged this as a trap to watch whenever a token is added. It bit with no token
added at all: `aurora-glass.css` has
`.ats-v2 .upload-page .ant-upload-drag { background: var(--glass-3-bg) !important }`,
and a converted route still sits inside `.ats-v2`. Inside V3 that resolved to
`rgba(255,255,255,0.9)` with a border at `rgba(255,255,255,0.62)` — **a 90% opaque
white slab with an invisible border, on glass. Failure A and Failure B on one element.**

Two corrections, both measured rather than reasoned:

1. Higher specificity alone changed nothing — `!important` doesn't lose to specificity.
2. `!important` alone tied, because the V2 selector has the same class count.

The fix needs both. Same story for `KpiCard`'s 16px corners sitting beside 24px
Surfaces on the same screen.

### `styles/legacy-bridge.css`

`KpiCard` has four consumers. Converting it here would restyle Analytics and
VendorDashboard, which nobody has reviewed — the shared-class trap. Leaving it alone
means two corner radii on one screen, which is the original complaint. So there is now
a bridge file: `.ats-v3`-scoped rules doing the minimum to make a legacy shared
component agree with its neighbours, each naming the group that deletes it.
`StatTile` replaces `KpiCard` wholesale in 5.5, all consumers at once.

**Still on these routes:** `KpiCard` itself, deferred to 5.5 as above. Flagged rather
than quietly skipped.

### Smaller things

- MRF wrote the same uppercase label three ways — 25× at 10px, 9× at 12px, 2× at 11px.
  One role, three sizes, none deliberate. All caption now; 10px and 11px were under the
  scale's 12px floor.
- Seven MRF fields showed **two required markers** (`* FIRST NAME *`) — AntD's own plus
  a literal one in the label text. Verified the starred set matched the `required: true`
  set exactly before removing the literals.
- Three page subtitles were full English sentences set in `fontFamily: 'monospace'`.
  Data cells keep the mono face; prose does not.
- VendorPortal's upload button restated its own `disabled` prop as a conditional
  background.

**Verified:** all four routes render logged-in in both modes with no page errors, the
full suite passes, `npm run build` clean.

---

## 2026-08-29 — Stage 5.3 (part 1): `/candidates`

**310 → 0 violations.** Debt 2,258 → **1,948**. The file repeated three styles 92 times
between them: a form label 45 times, `borderRadius: 6` 41 times, and `height: 38/42` on
every control. Those are three classes now.

**The labels were 11px** — below the type scale's 12px floor. That floor exists precisely
because the app was set at 9-13px, and this file was one of the larger reasons; they take
the caption role now, which is what they already were semantically (uppercase, 600 weight).

Also retired here: two hand-written `"'Sora', sans-serif"` stacks and two bare
`fontFamily: 'monospace'` — four of the 36 hardcoded stacks that defeat the font-pack axis.

The row action button carried a literal `#fff` label with a comment explaining it was "the
foreground ON the brand fill, not a brand colour itself". That reasoning was right, and
`--brand-on-solid` is exactly the token for it — which also fixes the 3.51:1 contrast the
literal white produced.

### I made the /dashboard mistake again

The first pass cleared all 310 lint violations and I nearly moved on — but the page was
still built from `glass-card` and `glass-3`, not `Surface`. Lint debt and structural
conversion are different jobs, and a clean lint count says nothing about the second. The
search card is now a tier-2 `Surface` and the table a tier-3, inside `DesignScope` +
`PageShell`.

`PageShell` also removes this page's `padding: 24px`, which sat on top of the layout
Content's own `24px 28px 40px` — one of the four pages that were ~48px inset while
/dashboard sat at 24.

**Verified:** renders logged-in with no page errors, 78 assertions pass, build clean.

**Still open in 5.3:** `MRF` (232), `VendorPortal` (76), `HRUpload` (59) — the last two
share `.upload-page` and convert as one unit.

## 2026-08-29 — Stage 5.2 complete: the five public token pages

`MrfSubmit`, `MrfApprovalAction`, `MissingJdUpload`, `InterviewScorecard`,
`DocumentUpload` — **all five at zero violations** (from 167). With the auth group, Stage
5.2 is done: **debt 2,539 → 2,258**.

These are the only screens most external candidates and approvers ever see, and they had
drifted furthest. What came out:

**Two more private palettes.** `MrfSubmit` carried `HELP = 'rgb(12, 136, 42)'` and
`REQUIRED = '#bc2f32'` — a third green and a fourth red, defined in one page file and
invisible to the brand axis. Now `var(--green)` and `var(--red)`. Both constants are kept
commented per the no-delete rule. A `#fffbe6` / `#ffe58f` alert was AntD's default warning
palette hardcoded, when `--warn-bg` / `--warn-border` already existed.

**`BRAND.accent` used as text.** Section headings set it at 16px on white — 3.51:1, under
AA, the same failure already fixed on the buttons. They use `--brand-ink` now, which is the
same colour at a value that reads.

**Three more button geometries retired** — `height: 44/borderRadius: 8`,
`height: 48/borderRadius: 10` and a `height: 44/borderRadius: 10` variant, several of them
forcing `background: BRAND.accent` inline over an AntD primary. All are the system button
now. `MrfApprovalAction`'s reject button also stops being `type="primary" danger` and
becomes `tone="danger"`, so approve and reject are the same kind of thing with different
tone rather than two different controls.

**The half-pixel type finally dies here.** These pages set 11 / 12 / 12.5 / 13 / 13.5 / 15
inline; they now map onto the two roles that exist at that end of the ramp.

**A stateful dropzone** in `DocumentUpload` expressed its selected state as
`background: stagedFile ? 'rgba(122,146,46,0.04)' : '#fff'` with a matching literal border.
It is a `--staged` modifier now, so the state follows the brand.

**Verified:** all five render with no page errors, 78 assertions pass, build clean.

## 2026-08-29 — Stage 5.2: the auth shell and its four pages

`AuthLayout` + `Login` / `AdminLogin` / `ForgotPassword` / `ResetPassword` — **all five now
at zero lint violations** (from 35 + 23). Debt 2,539 → **2,425**.

Every value in `AuthLayout` was an inline style, so no preset, brand or density could
reach any of it. The four pages then repeated the same six inline styles per field — an
alert margin+radius, a bold 13px label span, a Form.Item margin, a tinted icon prefix, and
`borderRadius: 10, height: 46` on every input. Those are now a scoped block that reads
tokens, and the inputs take `--control-h-relaxed`, which is what the hardcoded 46 was
reaching for without being able to say so.

The submit buttons were `cta-primary` plus an inline `height: 48, borderRadius: 10` — two
more of the six button heights. They are the system button now. Login and AdminLogin also
carried `opacity: captchaPending ? 0.55 : 1`, which existed **only** to signal disabled
through `.cta-primary`'s `!important` gradient; `.ui-btn` has a real `:disabled` state, so
the workaround went with the class it was working around.

### Three contrast findings on the brand panel

The panel's gradient was three literal hexes with `#7a922e` in the middle — white on that
is 3.51:1, under AA for the 15.5px lede sitting on it. It now derives from `--brand-solid`,
the contrast-checked fill, so it also follows a tenant brand.

Then the faded text failed on its own: the lede at `color-mix(… 88%, transparent)` measured
**4.17:1** and the footer at 72% measured **3.36:1**. Both are at full opacity now — fading
body text to create hierarchy is the most common way contrast quietly gets lost, and the
headline already outranks them by size and weight.

**The logo chip was near-black in dark mode.** It used `--brand-surface`, which follows the
theme — but the chip exists to give the full-colour AAPNA mark a light ground, and the
panel behind it is the brand gradient in *both* modes. It now uses `--brand-on-solid`,
which is by definition the colour that reads against the brand fill.

### The contrast checker had a blind spot, and then I broke it

`scripts/verify/contrast.mjs` only parsed `rgb()`. A `color-mix()` resolves to
`color(srgb …)` in Chromium, so **every token built with color-mix silently reported as
"not on page" instead of being checked** — which is most of the tinted text in the system.
It now parses both, and composites semi-transparent text over its background before
measuring: the auth lede reads 4.85 ignoring alpha and 4.17 with it, and only the second
number is real.

Fixing the parser immediately produced six failures at 1.15:1 for text that plainly reads.
The opacity guard inside `solidBg` still used the old regex, so it began stopping at a
*translucent* glass surface and treating it as the ground. The guard and the parser have to
agree; a checker that cries wolf gets ignored. **48 contrast assertions now pass, up from
42** — the extra six are the color-mix values that were never actually being checked.

**Verified:** 78 assertions pass, build clean, no page errors on any of the four screens in
either mode.

## 2026-08-29 — Stage 5.2a: closing the design-lab / app gap

A side-by-side review found the converted `/dashboard` did not match the design lab.
Measured on identical viewports and axes, every `src/ui` component rendered **identically**
in both — stat padding `22px 22px 0`, value 33px, label 12px, band 56px. The gap was two
causes, both now fixed and both now checked.

### 1. Every card was 16px in the app and 24px in the lab

`aurora-glass.css` sets `--radius-card: 16px` on `.ats-v2`. `MainLayout` puts that class
on the outer Layout and `DesignScope` nests `.ats-v3` **inside** it — a custom property
set on a descendant wins for its subtree, so every V3 surface on a converted route
silently rendered at the old radius.

**A comment in `resolveTokens.js` had argued this exact case was safe** ("converted-to-V2
routes keep their 16px"), and that reasoning was wrong in both directions: a *converted*
route is precisely the one that should take the new value. The comment is corrected in
place rather than quietly removed.

The V3 token is now **`--radius-surface`** — a name nothing else consumes, which is the
rule already followed everywhere else in the token layer (`--radius-ctl` is deliberately
not `--radius-sm`). `--radius-card` belongs entirely to V2 again.

### 2. `/dashboard` was still rendering the V2 hero

`DashboardHero` was untouched by the conversion — 34px title against the lab's 42px, 22px
radius, its own padding. It now composes `PageHeader hero`, keeping every feature it had
(live clock, ⌘K trigger, PERIOD ⓘ, brand eyebrow, role filter) and taking the display type
scale, radius, conic sweep and AAPNA mark from the system. Its `New MRF Request` button
loses an inline `height: 44, borderRadius: 10, paddingInline: 20` — a one-off geometry
that existed nowhere else and that no other page could have matched.

The previous render is kept in full at the foot of the file, per the no-delete rule. It had
to be preserved as line comments rather than a block comment: the JSX contains `{/* … */}`,
whose `*/` closes a wrapping block comment early and broke the build.

### 3. A parity check, so this cannot recur silently

`scripts/verify/parity.mjs` loads the lab's dashboard and the real one and asserts the same
computed values on both — radius, type sizes, control height, padding, band height, font.
It asserts **design tokens, not layout**: a mock may show different content, never be styled
differently. It reads the dev login from `.env.development` and skips cleanly when absent.

It would have caught the 16px leak the moment it appeared. Nothing else did — build, lint
and all 67 prior assertions passed, because the page rendered perfectly, just wrong.

**Verified:** 78 assertions pass (up from 67), all 11 parity properties match, build clean,
debt 2,546 → 2,539.

## 2026-08-29 — Stage 5.2 (part 1): prototype retired, and the banned animation found

**Nothing was deleted.** Per this repo's no-delete convention, retired code is commented
in place with a dated note and restore instructions.

**`/candidate-pipeline-prototype` retired.** The route in `App.jsx` and its `V2_ROUTES`
entry are commented out; `pages/CandidatePipelinePrototype.jsx` is untouched on disk. It
now falls through to 404. The reason is not tidiness: the demo shares `.cp-candidate-card`,
`.cp-avatar` and `.cp-progress-seg` with the REAL board, so any V3 rule written for
`Pipeline.jsx` in Stage 5.6 would have landed on a mock-data screen nobody reviews. Taking
it out of service frees 5.6 to change those classes.

### The banned animation — and a correction

The plan said `AuthLayout` still animated `background-position` via `gradientShift`. **That
was wrong, and the correction is recorded in the CSS rather than quietly fixed:**
`.auth-background` is dead — no component references it. `AuthLayout` uses `.auth-split`
and `.auth-brand-panel`, and two pages carry comments saying they were moved off that
shell years ago. The rewrite there is precautionary.

**The live offender was `meshDrift` on `.dash-hero__mesh`** — rendered by
`DashboardHero.jsx:58`, on `/dashboard`, the route just converted. It animated
`background-position` across a four-gradient, 8px-blurred, oversized layer: a full repaint
every frame, 18s a cycle, forever, on the app's landing screen. The rollout plan names this
exact element as an offender and it had survived every prior pass.

It now drifts itself with a `transform` — compositor work, no paint — needing no extra
layer, since the element was already `inset: -40%` and `pointer-events: none`. Look
unchanged. `/dashboard` idle frames: median **16.7ms**, p95 17ms, **0.4%** over 20ms.

Both `gradientShift` and `meshDrift` keyframes are kept, commented as unused with a note
not to wire anything new to them.

## 2026-08-29 — Stage 5 begins: /dashboard and the public shell converted

First routes onto `src/ui`. Two mechanisms had to exist before any route could convert:

**`DesignScope`** — the per-route seam. AntD's tokens are global, so a converted route
could not take the preset's geometry without changing all 24 at once (the whole-app
restyle that was already shipped and reverted). A converted route now wraps in its own
nested provider; everything outside keeps `LEGACY_GEOMETRY`. Convert by adding the
wrapper, revert by removing it. Both are deleted when the last route lands.

**`ForceLight` is now `DesignScope mode="light"`** rather than a parallel hand-rolled
wrapper. As separate code it did NOT pass preset geometry, so a converted public page
would have had V3 surfaces around legacy-sized AntD controls.

**`/dashboard`** — `StatCard` → `StatTile`, hand-rolled container → `PageShell`, and its
11 raw hexes replaced with tokens (the quick-action colours already went through a
`--qa-color` custom property; the values just weren't tokens). `PageShell` now forwards
refs — `usePointerSpotlight` attaches to the page root, and without it the spotlight
would have silently stopped tracking.

**`PublicPageShell`** — the Arial one. Composition deliberately unchanged, because
mirroring the branded email is the whole point of that component; what changed is that
Arial, its private frozen palette and its raw black shadow became tokens.

### A bug this surfaced in index.css

`--font`, `--font-heading` and `--mono` were declared inside the
`:root, [data-theme='light']` block. Harmless for app-wide light mode (same values), but
`DesignScope mode="light"` re-declared them for its subtree and silently reset `--font`
to the hardcoded Inter stack — so the public pages rendered in Inter while the rest of
the app was in Segoe UI Variable. Typography is not mode-dependent and now sits in a
plain `:root` rule that a mode-scoped subtree cannot override.

### 5.1 completed, and a bug it shipped with

The first pass converted the KPI row and the shell but left the eight widget cards on
`.glass-card`, so one page carried two corner radii — the half-converted screen the
rollout plan explicitly warns about. All nine now use `Surface tier={2}`.

**Three of the four KPI tiles were rendering the wrong colour.** A scripted edit matched
only the card followed by `delta:`; the other three kept `color:` from StatCard's API, so
`accent` arrived undefined and silently fell back to brand — the whole row went green and
nothing errored. Caught by review, not by any check.

`StatTile` now warns in development when it receives a `color` prop or an unknown accent.
Four more routes have `StatCard`s to migrate and the failure mode is invisible, so it is
worth making loud rather than trusting the next scripted edit to be complete.

Also fixed: `Sheet` used `destroyOnClose`, renamed in the installed antd 5.29 and warning
on every mount.

Verified against the running app with dev credentials: `/dashboard` renders in both modes,
four distinct KPI accents, four sparklines, `Segoe UI Variable Text` resolving, no page
errors. 67 assertions pass, build clean, debt 2,576 → **2,546**.

## 2026-08-29 — Design System V3: accessibility fixes, flag wiring, and enforcement

Write-up: [CHANGES-2026-08-29-design-v3-enterprise-hardening.md](../docs/changelog/CHANGES-2026-08-29-design-v3-enterprise-hardening.md).

An enterprise-readiness audit before Stage 5. The architecture held up; the disciplines
around it did not, and there were three real accessibility defects.

**Contrast.** The primary action failed WCAG AA in both modes — 3.51:1 light and 2.00:1
dark — caused by a hardcoded white label in `ui.css`. Three brand-owned tokens now carry
it, so a tenant declares its own label colour rather than a button assuming one. A first
attempt flipped the dark label to near-black; it passed at 12:1 and looked like a
highlighter, and was rejected in review. The shipped fix deepens the fill and keeps a white
label in both modes, letting the glow supply prominence.

**`Segmented` was a broken radiogroup** — every option a tab stop, `role="radio"` with no
arrow keys. Now a roving tabindex with arrows and Home/End.

**Reduced motion was silently dead:** `--press-scale` is written inline on `<html>` and an
inline declaration beats a media query. Motion tokens now use the same `-motion` pair
convention as light/dark, so the cascade can win.

**Preset behaviour was coupled to a preset's name.** Two `[data-preset='flat-slate']`
selectors meant a third preset would inherit the wrong material; the `flags` block existed
to prevent exactly that and had never been read, because a CSS variable cannot drive a
selector. Flags are now `data-flag-*` attributes, proven with a synthetic preset whose name
the CSS has never seen.

**Enforcement, which had never existed.** `eslint` was a devDependency with no config and
no script. Now `npm run lint` (design-contract rules — warn app-wide, error in `src/ui`),
`npm run lint:count` (a burndown: **2,576** violations today), and `npm run verify:design`
(non-regression, swap matrix, a11y, contrast; exits non-zero). The suite immediately caught
a contrast failure I had missed by hand.

## 2026-08-28 — Design System V3 prototype v2: native type, richer material, real motion

Write-up: [CHANGES-2026-08-28-design-v3-prototype-v2.md](../docs/changelog/CHANGES-2026-08-28-design-v3-prototype-v2.md).

**Still no shipped screen changes appearance.** Prototype iteration only.

Six pieces of review feedback on v1. Three were elements v1 had dropped:

- **The 4px coloured top rail** is back on `StatTile`, and renders under every preset
  including `flat-slate` — it encodes which metric a card is, so it is data, not
  decoration.
- **The full-bleed sparkline** is back, reusing `Sparkline.jsx` unchanged.
- **The hero's Period/roles filters and second CTA** are back. `PageHeader` gained a
  `filters` slot; it had `actions` only, which is why they disappeared.

### The watermark and "dull glass" were the same bug

The lab hand-copied four aurora gradients and nothing else — no rotor, no grain. Glass
is only as interesting as what shows through it, and nothing was. `AmbientBackdrop` now
serves `src/ui` through a scope widening in `aurora-glass.css`, `.ats-v2` →
`:is(.ats-v2, .ats-v3)`. `:is()` takes the specificity of its most specific argument and
both are single classes, so the 12 shipped V2 routes cannot shift. Plus: deeper ground,
a brand tint on the fill, a stronger bottom inner shadow, and the specular split from
the rim (v1 tied them to one token, so softening the sheen also softened the edge).

### Type is now the native OS face

`system-native` is the default pack — SF Pro on Apple, **Segoe UI Variable on Windows**,
Roboto on Android. This cannot be a webfont: neither face may be self-hosted or
CDN-served. All three Segoe optical cuts are used (Display / Text / Small), which needed
a new `small` role in the font-pack contract; verified resolving on this machine.
**Consequence worth knowing: the product renders in a different typeface per platform**,
so a pixel comparison has to be pinned to one OS.

### Motion exists now, and can be reviewed

v1's motion was entrance-only — it plays once and stops, which is why a still frame
showed nothing. Added continuous ambient (rotor 140s, aurora 26s, hero sweep 22s), state
motion (`.ui-live-dot`, `.ui-attention`, `.ui-sheen`, `.ui-flash`), and a **Motion
section in the lab with a Replay control** — an entrance animation is invisible a second
after it runs, so without replay it cannot be judged at all.

Buttons 14 → **18px**, inputs 12 → 15px so they stay in family, cards 22 → 24px.

Three bugs caught and fixed in the same pass: the rail was inheriting the rim's
`mask-composite` and rendering as a floating hairline; the bloom would have deleted the
specular from the cards that had one; and the hero sweep drew a hard diagonal that read
as an artefact rather than as light.

Second review pass fixed four more: the hero was missing the static AAPNA mark
(present on the shipped hero, added at 10% opacity and deliberately not rotating —
the canvas rotor already carries that); the table's score column was rendering at
25px against 13px rows because it used a KPI-card metric class, now a tabular
row-size treatment; `lg` buttons compounded height, padding and type all at once and
read as a slab; and StatTile lost its bottom padding when no sparkline followed.

Measuring the button fix exposed a related flaw — a flat 18px radius is a different
*shape* at every size (a full pill at 30px, 78% of one at 46px). Radius is now capped
against the height, so the corner character stays constant and self-corrects when
density moves the control heights.

Third pass fixed the hero's empty right half. Both flex children sat at
`flex: 0 1 auto`, so each claimed its content width — 698px of title plus 571px of
controls into ~1230px — and wrapped 63px short, leaving a one-column header with dead
space beside it. The text column now absorbs the remainder (`flex: 1 1 min(100%, 22rem)`,
`min-width: 0`) while controls never shrink. `--fs-display` was also oversized at 47.5px,
tuned before the hero had controls beside it; retuned to `clamp(30px, 2.8vw, 44px)` across
all three packs. Hero height went 279px → 151px, which overshot into toolbar territory, so
block padding came back. Affects every `PageHeader`, not just heroes.

Fourth pass: the wave emoji was orphaning onto its own line — the text column's
flex-basis was small enough that the row squeezed the title instead of wrapping the
controls, and a width sweep put the failure band at 1160-1340px, i.e. most laptops.
Basis raised so the container breaks first; verified one line from 980px to 1920px.
The AAPNA mark is now shown whole rather than cropped — a radially symmetric pinwheel
has no silhouette left when partial — sized from the hero's height via `aspect-ratio`
so it rescales with density instead of needing a fixed value.

Noted while looking for the logo asset: `public/brand/` is empty, so `index.html`'s
favicon and apple-touch-icon point at a file that does not exist. Pre-existing,
untouched here.

Perf: 60fps with the full ambient stack (median 16.7ms, 1.3% of frames >20ms), inside
the ~3% baseline the design doc records.

## 2026-08-28 — Design System V3: the configuration layer, `src/ui`, and `/design-lab`

Write-up: [CHANGES-2026-08-28-design-v3-foundation.md](../docs/changelog/CHANGES-2026-08-28-design-v3-foundation.md).

**No shipped screen changes appearance from this entry.** Stages 1-2 build the layer; the
24 routes are converted in Stage 5, after the prototype is reviewed.

### The swap contract — five orthogonal axes

`mode` and `brand` already existed. Three are new, and each changes the look without
touching a page: **`preset`** (`liquid-glass` | `flat-slate`), **`font`** (`inter-sora` |
`figtree` | `system`, each owning its own type scale), **`density`** (`compact` | `default`
| `relaxed`). `DesignContext` resolves `preset x fontPack x brand x mode x density` into
CSS custom properties on `<html>` and feeds the same resolved object to AntD.

### A type scale, which the app did not have

13 roles from `display` to a **12px floor**, each carrying size + weight + tracking +
line-height. It replaces 28 distinct inline font sizes (including seven half-pixel values)
and the practice of hand-assembling a heading from a size and a guess at a weight. The
scale belongs to the font pack, not the preset — a ramp tuned for Sora reads wrong on
system-ui.

### `theme/themeConfig.js` rewritten as `buildAntdTheme()`

It held 91 frozen hex values, so `BrandProvider` — which only writes CSS variables — could
never reach AntD's generated styles. Switching to the `midnight` brand repainted every CSS
surface blue and left every AntD button, input ring, tag, tab ink bar, menu selection,
switch, checkbox, slider and date picker olive green. Per-tenant theming was half true.
Now verified by scanning AntD's own injected stylesheets: 23 occurrences of AAPNA olive and
zero blue under `aapna`, exactly reversed under `midnight`.

### `src/ui` — a component layer with real prop APIs

`Button` (`size` x `tone` x `emphasis`), `Surface` (`tier` x `material` x `padding`),
`PageShell`/`PageHeader`, `StatTile`, `DataTable`, `Field`, `Sheet`, `Segmented`,
`StateBlock`, `CountUp`. Every value reads a token; the only inline style permitted is a
data-derived CSS custom property, the escape hatch the design law already prescribes.
`StatTile` merges the three stat-card families (38/34/32px values, three shadows, three
icon radii, three hover lifts) and takes its accent as a **token name** rather than the hex
`StatCard` used to default to.

### `/design-lab` — dev-only

A live control bar for all five axes over two panes: every component at every state, and
the language applied to three rebuilt ATS screens (dashboard, list/table, detail + sheet).
Gated as `import.meta.env.DEV ? lazy(...) : null` so Rollup drops it entirely — gating only
the `<Route>` still emitted a ~27 kB chunk into `dist/`.

### The V3 scale is deliberately namespaced away from the legacy one

The first cut repointed `--radius-sm/md/lg`, `--border-radius*`, `--transition-*` and
`--ease-out-quint` at the new values, so existing CSS would pick up the new look for free.
It did — and measured on `/login`, that silently took `--radius-sm` from 8px to 12px,
`--radius-lg` from 14px to 22px, and AntD's base font from 14px to 15px across all 24
unconverted routes. Those names have 100+ consumers and the values are written inline on
`<html>`, where they beat every selector.

The V3 scale now uses names nothing else reads (`--radius-ctl`, not `--radius-sm`), and
AntD geometry is opt-in via `buildAntdTheme({ presetGeometry })` — default `false`, with
`/design-lab` nesting its own provider that sets it `true`. Confirmed by probe: `/login`
reports the pre-V3 values for every legacy token. Colour derivation is *not* gated, since
for the default brand it resolves to the values that were already hardcoded.

## 2026-08-27 — Conversation reply box: plain text → rich text

Backend write-up: [CHANGES-2026-08-27-conversation-reply-rich-text.md](../docs/changelog/CHANGES-2026-08-27-conversation-reply-rich-text.md).

`PipelineDrawer.jsx`'s "Conversation with candidate" panel (shipped earlier the same day) had a
single-line plain-text reply box. It now uses the same rich-text editor as every other
email-composing surface in the app — Editor / HTML Code / Live Preview tabs, with a
Bold/Italic/Underline/lists/link/image toolbar — rendered as a bare, undecorated body (no branded
AAPNA header/footer, since a reply shouldn't look like a shortlist notice). Enter now inserts a
newline instead of sending; the "Reply" button, moved below the editor, is the only way to send.

## 2026-08-27 — Pipeline board: rejected filter, real conversations, my candidates

Backend write-up: [CHANGES-2026-08-27-pipeline-gap-closeout.md](../docs/changelog/CHANGES-2026-08-27-pipeline-gap-closeout.md).

### `Pipeline.jsx` — three new filter-bar controls

- **"Rejected only"** checkbox, alongside "On Hold only" (the two are mutually exclusive — checking
  one unchecks the other, since both read the same underlying stage-status column).
- **"Show closed"** now shows a count — `Show closed (48)` — so the hidden history is discoverable
  instead of a checkbox with no indication of what it reveals.
- **"My candidates"** toggle — filters to journeys shortlisted by the current user. A view, not a
  permission: clearing it always shows the full shared board. The card's secondary line now also
  shows who shortlisted them (`position · source · owner`).

### `PipelineDrawer.jsx` — reject-and-close, and a real Conversations panel

- The outcome modal's Reject flow gained a **"Close this candidate's record as Rejected"**
  checkbox — defaults on for a normal interview round, off for the Zeko screening rounds. Saves a
  separate trip to the standalone "Close this candidate's record" button for the common case.
- A new collapsed-by-default **Conversation with candidate** panel shows the real Outlook thread
  (every message, every address on file), distinct from the existing "Emails in this round" log,
  which stays exactly as it was — it answers "did the system send it," not "what did they say."
  Includes a reply box wired to the same Graph-backed endpoint Candidate Screening's Conversations
  modal uses.

## 2026-08-26 — Candidate closure: the actions that were missing, and the copy that was wrong

Backend write-up: [CHANGES-2026-08-26-candidate-closure-graceful-exit.md](../docs/changelog/CHANGES-2026-08-26-candidate-closure-graceful-exit.md).
Source: [PHASE3-CLOSURE-AUDIT-2026-08-26.md](../docs/PHASE3-CLOSURE-AUDIT-2026-08-26.md).

### Closure is reachable from every stage — `PipelineDrawer.jsx`

`setClosureOpen(true)` was called from exactly **one** place in the whole drawer: inside
`OfferActions`, which renders only when `selectedStageKey === 'offer'`. Every other stage got the
generic Approve / Reject / Hold bar and no closure path at all.

So **five of the eight closure outcomes were unreachable**, and a candidate who withdrew at Tech 2
could not be closed. The recruiter's only options were to *reject* them — wrong outcome, wrong email,
and it starts a 6-month cooling-off they did not earn — or leave the journey open forever. The API
and the templates had supported any stage all along; only the button was missing.

- A **Close this candidate's record** action now renders in the generic stage panel, opening the same
  8-outcome modal the Offer stage uses.
- Kept deliberately **quieter** than the outcome buttons: a small link-style danger button under a
  muted caption, not a fourth peer of Approve/Reject/Hold. Closure is the rarer, heavier action; the
  stage decision is still the normal path.

### The closure modal was lying in both directions

It told recruiters *"A closure email is sent only if a template is mapped to the status you pick."*
Written before the closure templates were seeded, it had since become wrong **both ways**: three
outcomes now **always** send via the generic fallback whether or not anyone mapped anything, and five
**never** send however they are mapped.

It now states the answer **per outcome, as you pick it** — because the honest general statement is
"it depends", which helps nobody at the moment of choosing.

### Reopen a closed record — the action that was named but never existed

`assertJourneyOpen` has told users *"Reopen it before you…"* since Module 1. **No route or service
could do it** — the only undo was a hand-written database update. Tolerable while closure was
Offer-only; surfacing it at every stage makes a mis-close far likelier.

- A **Reopen record** action now sits beside the purple `Closed — …` tag, which is the only place it
  could go: every other affordance in the drawer is suppressed once an outcome exists.
- A reason is **mandatory**, and the modal is explicit that no email is sent, the closure stays in the
  history, and any requisition seat the closure filled or freed is recounted.
- Unlike closure, re-opening **does not dismiss the drawer** — the journey is live again and the
  recruiter almost always wants to act on it immediately.

### Pause a journey — a column that had been read-only for a month

`is_paused` was on every board card payload and in the CSV export, and **nothing anywhere wrote it**.
It is the lever RT asked for on 2026-07-14 for candidates left stranded when their role fills.

- **Pause / Resume journey** in the drawer, offered only on an **open** journey — a closed one is
  already stopped, and two flags meaning "not running" would have to be reconciled.
- An orange **Paused** tag on the board card, sitting next to *Role filled* because that is the case
  it exists for. Its tooltip names exactly what stops: interview reminders, occurrence chase-ups and
  assessment deadline bells.

### One leak fixed: Evalground Re-invite survived closure

`showInviteButton` was the **only** action in the drawer missing the `!outcomeEvent` guard that
Schedule, Cancel, Client-round and Documents all carry. It survived both an ordinary reject and a
closure — so a recruiter could email a fresh assessment invite to a candidate whose record was
already closed. Fixed at both call sites.

### Analytics role table — a **Closed** column

Closure now writes terminal statuses to `pipeline_status`, and the four-bucket status strip would
have silently stopped adding up (the exact defect fixed for `future_prospect` earlier the same day).
All three readers — the table, the CSV export and the backend counts — now end in a **catch-all**
branch, so the columns sum to Total *by construction* and a status invented later cannot vanish.

---

## 2026-08-18 — Aurora Glass rollout, Phase 9: public pages + FINAL ACCEPTANCE

**The rollout is complete.** Nine phases, every route converted.

### Public token pages — one language, not three

These render outside `MainLayout` under `<ForceLight>`, so `.ats-v2`
structurally cannot reach them, and **glass would be wrong here anyway**:
`PublicPageShell` deliberately mirrors the branded *email* a candidate clicks
through from, and that continuity is a correct design decision. Per the plan,
the shell is untouched.

What was wrong was consistency. Of five public pages, **two used the shell and
three hand-rolled their own logo header, footer and `auth-background`** — three
visual languages on the surface most external people ever see of AAPNA.

- `MissingJdUpload` and `MrfApprovalAction` (4 states each) now render through
  `PublicPageShell`. Their hand-rolled copyright lines are gone — the shell
  already renders one, so those pages had **two footers**.
- `MrfSubmit` **keeps its own layout deliberately**: it is a long sectioned form
  whose accent runs through section rules and required marks, and the shell's
  narrow card is the wrong container. What it did get is the shared brand: its
  local `#92a63c` was a **near-miss of the real brand green**, carried over from
  the n8n form, so its header band was a visibly different green from the email
  that links to it. Now imports `BRAND` from the shell.
- **`AuthLayout` deliberately untouched**, per the plan — it is the pilot's own
  pixel-diff non-regression anchor, and changing it means re-baselining that.

### Fixed: dark theme leaked into the public pages

Caught by rendering a public page in a dark session rather than by reading code.
**`<ForceLight>` was not actually pinning AntD to light.** A nested
`<ConfigProvider>` *inherits the parent's algorithm* when it does not declare
one, and `lightTheme` declared none while `darkTheme` sets
`algorithm: theme.darkAlgorithm`.

The CSS custom properties were correctly light the whole time (`--text` resolved
to `#2b2b2b`), which is why this survived: **the variables looked right and the
components did not.** AntD emitted a dark-derived class, so a candidate opening
an emailed link while an operator's session was dark got an `<Alert>` with
**near-black text on a near-black fill** — unreadable. One line:
`algorithm: theme.defaultAlgorithm` on `lightTheme`, with a comment saying why
it must not be deleted as redundant.

---

## FINAL ACCEPTANCE

The plan's own acceptance test: *"walk every sidebar route in both themes… no
screen may read as belonging to a different product than the one before it."*

Mechanised rather than eyeballed, because that is what the walk is actually
looking for: **every converted route loads**, and **every surface class in the
app is rendered together on one page** so a drift between two of them shows up
as a mismatch instead of needing thirteen screenshots compared from memory.

- Tier 2 — `glass-card`, `premium-stat-card`, `kpi-card`, `pipeline-column`,
  `admin-stat` — all assert to the same `--glass-2-bg`.
- Tier 3 — `glass-3`, `panel-shell`, `cp-candidate-card`, `cand-card` — all
  assert to the same `--glass-3-bg`.
- Tier 4 — the overlay — asserts to `--glass-4-bg`, and is the **only**
  content-side surface allowed to blur.
- Every page-level card asserts to `--radius-card`.
- No tier-2 or tier-3 surface blurs.

**52/52, both themes.** And it found a real one:

> **`.premium-stat-card` was rendering at 18px while every other card was 16px.**
> A hardcoded `border-radius: 18px !important` sat *after* the radius-scale rule
> and silently beat it, so the dashboard's four KPI cards were 2px rounder than
> the widget cards beside them. This is precisely the drift the scale was
> collapsed to prevent, and it is invisible at a glance — 16 vs 18px is not
> something the eye catches, it is something a walk across screens registers as
> inconsistency without being able to name it. Removed, not re-escalated.

### Full suite

All nine phase suites re-run after that fix, on the final build:

| phase | assertions |
|---|---|
| 1 — overlay tier + blur fix | 64/64 |
| 2 — primitives + tokens | 48/48 |
| 3 — `/candidates` | 34/34 |
| 4 — `/pipeline` | 34/34 |
| 5 — vendor/HR/MRF unit | 54/54 |
| 6 — `/analytics` | 30/30 |
| 7 — `/settings`, `/email` | 32/32 |
| 8 — admin + prototype | 42/42 |
| 9 — public pages | 56/56 |
| **final acceptance** | **52/52** |

**446/446, both themes, on one build.**

---

## 2026-08-18 — Aurora Glass rollout, Phase 8: the Admin portal + the prototype

The biggest structural departure, deliberately last so every pattern was proven
elsewhere first. **With this in, every route the sidebar can reach is converted.**

### The admin portal is a separate shell

`MainLayout`'s `isAdminPath` branch has its own `admin-topbar`, **no Sider**, its
own `.admin-stat` card family and its own `--admin-bg`. Widening `V2_ROUTES`
never did anything for it, because the branch **never rendered `.ats-v2` and
never mounted the canvas** — which is why it is not in `V2_ROUTES` even now; the
branch applies the class itself.

- `.ats-v2` on the admin `<Layout>` + `<AmbientBackdrop/>`, and both the Layout
  and Content go `background: transparent` — the `--admin-bg` fill would
  otherwise sit on top of the canvas. Content is `z-index: 1` over the fixed
  backdrop.
- **The header-only shape is kept on purpose.** Adding a Sider is a *navigation*
  redesign; this is a visual rollout.
- `admin-topbar` → tier-1 chrome, including the light-mode rule the rest of the
  app follows: **opaque white, not tinted glass**.
- `.admin-stat` → tier 2, mirroring the `.kpi-card` approach. It is a *third*
  stat-card component after `.premium-stat-card` and `.kpi-card`; they are not
  unified here, because consolidating three components is a refactor and this is
  the last phase before acceptance. What matters for the acceptance walk is that
  it now *matches* them.
- The portal's scoped `.admin-portal .ant-table-*` rules are **reconciled**, not
  removed: fills go transparent, but the uppercase tinted header survives
  because it is the portal's own voice.
- **~23 raw hexes → tokens.** The nine per-module identity colours are
  **deliberately left as hex and documented**: they are arbitrary hues whose only
  job is to be distinguishable from each other, they carry no semantic meaning,
  and a tenant-tinted set would collapse toward one hue and stop working.

### The prototype: converted (decision recorded)

The plan left "convert or retire?" as a team decision. **Decision: convert.** It
stays live at `/candidate-pipeline-prototype` for client walkthroughs, and a
walkthrough that crosses from the real board to a flat demo shows two products.

- The Phase 4 `.cp-*` rules **activate on it as predicted**, so the board
  material came free; the columns needed the same
  `glass-card no-lift pipeline-column` classes the real board carries.
- **Failure B is fixed here too.** The prototype had the identical inline
  `borderInlineStart` carrying chip status, so it had the identical silent-wipe
  bug. Same `--cp-accent` remedy, verified with the same hover assertion.
- Its `STAGE_ACCENT`, `CHIP_ACCENT` and `AVATAR_PALETTE` now use the shared
  Phase 4 tokens, so the demo and the real board **cannot drift apart on
  colour** — and both get dark-mode values that stay legible at a 3px rule.
- **All 26 bare hexes gone** (values already written as `var(--token, #fallback)`
  were left alone — those are correct).

### Verified

`npm run build` clean. **42/42 computed-style assertions, both themes.** The
load-bearing ones: the canvas is actually mounted on a shell that had none; the
admin topbar is **opaque white in light and blurred glass in dark**, asserted
per theme rather than with one loose check; the admin table header keeps its
tint while every other fill goes transparent; the prototype's column and card
land on the same tiers as the real board; and **Failure B is re-asserted on the
prototype**, at rest, on hover, and under `prefers-reduced-transparency`.

---

## 2026-08-18 — Aurora Glass rollout, Phase 7: `/settings`, `/email`

- **`/settings`** — four settings panels → `glass-card` (tier 2: they are the
  page's content, not dense data). Inline radius/shadow dropped, and the two
  `borderTop: 4px solid var(--gold)` rails go the same way the ones on
  `/candidates`, `/mrf` and the upload screens did. The plan called this file
  clean at 0 hexes; that held.
- **`/email`** — the three `email-pane-card`s carried the **same bare-`.glass`
  landmine `/analytics` had**, which the plan flagged for `/analytics` but not
  here. All three renamed to `glass-3 no-lift`; the `no-lift` already present
  had been signalling tier-3 intent that the bare class never delivered.
- **Empty state**: "No templates found." became the shared `EmptyState` in its
  two shapes — search/category excluded everything (offers to clear them) vs.
  genuinely no templates (explains what templates are for).
- **CodeMirror: verified, not rebuilt**, per the plan. `EmailEditorTabs` already
  passes `theme={isDark ? 'dark' : 'light'}` through to the editor.
- The one `#7a922e` left in `EmailManagement.jsx` is **deliberately literal**:
  it is inside a sample HTML email body that renders in a mail client, where a
  CSS custom property would not resolve.

### Verified

`npm run build` clean. **32/32 computed-style assertions, both themes** — the
landmine asserted both ways again, all three email panes asserted to agree with
each other, the settings green rail asserted gone (4px → the 1px transparent
border the gradient rim hangs on), and `prefers-reduced-transparency` opaque on
both pages.

---

## 2026-08-18 — Aurora Glass rollout, Phase 6: `/analytics`

The page the plan singles out as breaking the "just widen the boolean" premise.
It was right.

### The `.glass` landmine

The main tab container carried `className="glass"`. Bare `.glass` is defined in
`index.css` and is **never touched by `aurora-glass.css`** — so adding
`/analytics` to the route gate and doing nothing else would have left the
page's principal container **flat under glass chrome**, which is worse than
leaving the route alone. Renamed to `glass-3` (it holds five tables, so tier 3
is also the correct tier), and its inline radius/border/shadow dropped since the
class owns them. The verification renders **both** classes side by side and
asserts they resolve differently, so the rename is a checked fact rather than a
claim in a changelog.

### `.panel-shell` earns its keep

Phase 2 moved the duplicated `PANEL_STYLE` object into a shared class, and the
argument for doing so was "a stylesheet can reach it later". Later is now: **one
rule gives 16 surfaces the tier-3 material** — four of this page's five tables
plus both `DeliveryMonitoring` tables and their panels. That would have been 16
inline objects to edit otherwise.

The rule set is the one Phase 3 verified for `.glass-3` (table root, header
cells, body cells, placeholder, row hover), rewritten against `.panel-shell`
because these tables are not inside a `.glass-3` element — the panel *is* the
surface.

### `.screening-tabs`, the shared class

Shared with `CandidateScreening` (`/filtering`), where Phase 1 styled it. Those
rules were **inert on this page and activate now**. Nothing new was written for
it deliberately: a per-page tab treatment is exactly the drift a shared class
exists to prevent. Verified by computing the strip on both screens and asserting
they are identical.

### Metrics: the tiles answer a hover for the first time

The plan called for swapping ad-hoc `tile.bg`/`tile.color` tiles for `StatCard`.
That premise is out of date — the tiles already use the shared `KpiCard`. What
they genuinely lacked was the **explanation**: not one of the ten numbers on
this page could say what it counted.

- **`KpiCard` gained an optional `metric` prop**, rendering the same
  `MetricInfo` affordance `StatCard` has had. Optional, so every existing caller
  is unchanged — but it now exists for the vendor and upload KPIs too.
- **Ten metric definitions wired up**: the six headline tiles (new, written this
  phase) and the four Pipeline Insights KPIs (written in Phase 2, unused until
  now). The headline tiles' caveats say the counts are lifetime totals that do
  **not** follow the page's date controls — the tile is what gets screenshotted
  into a status report.

### Tokens

**14 raw hexes → the `--kpi-*` palette from Phase 5.** The page's own `ACCENT`
map was a sixth copy of the same six accents; it now aliases the tokens, so a
tile, a tag and a table cell for one concept cannot drift apart *and* the page
finally has dark-mode values for them.

### Verified

`npm run build` clean. **30/30 computed-style assertions, both themes** — the
landmine both ways, the shared tab strip identical across two screens, all four
AntD fills inside `.panel-shell` transparent, row hover translucent, and
`prefers-reduced-transparency` opaque on both the panels and the tab container.

---

## 2026-08-18 — Aurora Glass rollout, Phase 5: `/hr-upload`, `/vendor`, `/vendor-dashboard`, `/mrf`

**Shipped as one unit, deliberately.** Per `VENDOR_ALLOWED_PATHS`, `/vendor` and
`/vendor-dashboard` are the *entire* reachable app for the `vendor` role —
converting either alone would flip a vendor's chrome between glass and flat on
every click. The gate comment now says so, so a later phase does not split them.

- **`.kpi-card`'s glass rules activate here for the first time.** They were
  written in Phase 0 and have been inert since — no converted route used the
  class. The plan predicted they would light up with **zero JSX change**; that
  is now verified rather than assumed (see below).
- `HRUpload` and `VendorPortal` share `.upload-page` and are near-identical, so
  they got **one treatment applied twice**: tier-2 dropzone card, tier-3 records
  table. Both lose the same `borderTop: 4px solid #7a922e` rail `/candidates`
  lost in Phase 3.
- **The dropzone is tier 3** by the nesting rule, and stays clearly readable as
  a target rather than dissolving into the pane — it is the one thing on the
  page the user aims at.
- `VendorDashboard`: pipeline summary → tier 2, recent submissions → tier 3.
- `MRF`: request form → tier 2, records table → tier 3, reusing exactly what
  Phase 3 verified.

### A specificity tie worth stating out loud

`.section-card` (added in Phase 2) declares an **opaque** `--colorBgContainer`
fill, and both `VendorDashboard` cards now carry it *alongside* a glass class.
Two single-class selectors **tie** on specificity, so source order would have
decided which fill won — not something to leave to chance across future edits.
`.ats-v2 .section-card.glass-card` / `.glass-3` now name the winner explicitly,
and it is asserted in both themes.

### Token sweep

**~58 raw hexes across the four files → named tokens**, all with dark-mode
values:

- **`--kpi-a…e`** (colour / `-2` / `-tint`). The same four KPI accents were
  re-declared as twelve hex literals *per screen*, in three screens. Semantic,
  not brand — blue is "in flight", green is "done", red is "failed" — except
  `--kpi-a`, which aliases the brand on purpose.
- `VendorDashboard`'s five pipeline-stage tiles now use the **`--status-*`
  palette from Phase 4**, so "On Hold" is the same amber on the vendor summary
  as on the real board. They were four unrelated hexes with no dark values.
- Assorted one-offs → `--brand-primary`, `--red`, `--border`, `--border-light`,
  `--info-strong`, `--gold-bg`, `--gold-dark`.

### Verified

`npm run build` clean. **54/54 computed-style assertions, both themes.** The
load-bearing ones: **`.kpi-card` resolves to `--glass-2-bg` at `--radius-card`
with no blur and a real shadow** — the inert-rules claim, tested; the
`.section-card`/glass tie resolves to glass in both directions; all six page
surfaces land on their intended tier; every new token is asserted to *resolve*
(an unset custom property paints nothing, which is invisible in a screenshot);
and the dark palette is asserted **different** from the light one, so "lifted
for the dark board" is a checked claim rather than a comment.

One test bug found and fixed while writing it: the dropzone carries a 0.3s
`background` transition, so sampling 150ms after toggling
`prefers-reduced-transparency` caught it mid-fade and reported a translucent
value for a rule that does land.

---

## 2026-08-18 — Aurora Glass rollout, Phase 4: `/pipeline`, and the Failure B fix

`/pipeline` joins `V2_ROUTES`. This does **not** pull in
`/candidate-pipeline-prototype`, which shares the `.cp-*` classes — the scoped
rules stay inert there until Phase 8 decides its fate.

### Failure B: the status border that was being silently erased

`.cp-candidate-card`'s leading border **encodes candidate status**. It is data,
not decoration. It was painted as an inline `borderInlineStart`, and the hover
rule in `index.css` answered it with the **`border-color` shorthand plus
`!important`** — which set all four sides and **wiped the status colour off
every hovered card**. No error, no console warning, nothing on screen to say
that information had gone missing. The rollout plan predicted this exact failure
on this exact class; it was already happening in production.

- The accent is now a `--cp-accent` custom property and **CSS owns the
  property** (`border-inline-start` in the base rule). Same pattern as
  `--stat-color` / `--kpi-color`.
- The hover rule sets `border-block-color` and `border-inline-end-color` — the
  three decorative sides — and never touches the leading edge. A comment on the
  rule says why, because the next person to write `border-color:` here would
  reintroduce it.

### The board

- **One tier-2 toolbar card** now holds the header, freshness/refresh/export, NL
  search and filters. These sat bare on the page; that was fine on a flat
  background, but on the aurora each AntD control paints its own opaque fill, so
  a dozen of them floated unanchored over the gradient.
- **Columns → `glass-card no-lift pipeline-column`.** `no-lift` is load-bearing:
  the base `.ant-card:not(.no-lift):hover` rule raises the card, and a whole
  column bouncing as the pointer crosses it is wrong — the cards inside are the
  hoverable things.
- **Candidate cards → tier 3** by the nesting rule, and they are the densest
  thing on the board (~20 per column).
- **Loading → a board-shaped skeleton**, so the columns' horizontal rhythm
  exists before the data does. **Error → `ErrorState` with a retry** (was a
  full-width `<Alert>`). **Empty columns → `EmptyState`** that distinguishes
  "your filters excluded everyone" from "nobody has reached this stage".
- **32 raw hexes → a named palette.** New `--status-*` (5) and `--stage-*` (10)
  and `--avatar-*` (6) tokens, **in both themes**. These are deliberately
  **semantic, not brand**: "Rejected" is red because it is rejected, and a tenant
  whose brand is red would otherwise turn every card's status the same colour.
  Dark values are **lifted, not the light hexes at lower alpha** — a 3px rule in
  `#2f54eb` is nearly invisible on the dark board, and being readable at a glance
  across a column is the entire point of the rule.
- Board scroll arrows keep their brand gradient: they portal to `body`, outside
  `.ats-v2`, and that is intentional per the plan.

### Verified

`npm run build` clean. **34/34 computed-style assertions, both themes**, with a
card rendered per status so a regression in one branch cannot hide. The
load-bearing ones: each accent resolves to its own `--status-*` token; the other
three sides are asserted **different** from the accent (a shorthand would make
them equal); **the accent survives hover** while hover still recolours the other
sides; and under `prefers-reduced-transparency` the **accent survives** —
it is the only cue for status, so translucency goes and the cue stays.

**Scroll perf — and a measurement trap worth recording.** The board scrolls
horizontally, so the probe scrolls the *board container*, not the window. First
runs reported 8.3ms for the control and 16.7ms for glass and I read that as an
8.4ms regression. It was not. Medians only ever landed on **exactly 8.3 or
exactly 16.7 with nothing between** — including for arms that were byte-identical
— which is a variable-refresh display halving from 120Hz to 60Hz, one discrete
step, not paint cost accumulating. An idle blank page measured 8.3ms, confirming
120Hz; a later run of the same probe reported the display itself at 60Hz.

Re-run with the arms interleaved and repeated, counting **how often each arm held
the display's full rate**: control 5/5, glass 5/5. A 9-arm bisect (rim, sheen,
shadows, opacity, aurora, grain) put **full glass at 5/5** and the only dropped
passes on arms that *remove* glass — i.e. random. No measurable cost.

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
