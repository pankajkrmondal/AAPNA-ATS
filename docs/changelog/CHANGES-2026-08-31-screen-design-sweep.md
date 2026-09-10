# Screen-by-screen design sweep: auth, nav, font, dashboard, shell

**Date:** 2026-08-31 · **Modules:** Frontend (auth pages, shell, dashboard, design system)
**Follows:** [CHANGES-2026-08-31-design-lab-parity.md](./CHANGES-2026-08-31-design-lab-parity.md)
**Per-change detail:** every item below also has a full entry in `frontend/UI-CHANGELOG.md`.
**Continued in:** [CHANGES-2026-09-01-screen-design-sweep-mrf.md](./CHANGES-2026-09-01-screen-design-sweep-mrf.md) — screen 6, `/mrf`.

## Why

The parity work above closed the *composition* gap — every route got a `PageHeader`, every
primitive got rolled out. What it could not catch was everything a check does not assert.
So this was run differently: **one screen at a time, reported by eye, then measured before
anything was changed.**

That method is the point of this document. Of the eleven defects found, **the automated
suite was green for every single one** — 9 to 10 checks passing throughout. Several had been
live since the V3 rollout.

## The defects this started from

Grouped by how they hid, because that is the reusable lesson.

### Silent — a rule or a key that simply stopped matching

| | Found | Why nothing caught it |
|---|---|---|
| Dashboard cards ragged | Equal-height rule read `.ant-card`; the rollout had replaced every dashboard `<Card>` with `<Surface>`. **0 `.ant-card` in the bands vs 13 `.ui-surface`** | A dead selector raises nothing. Its own comment promised to prevent exactly the reported defect |
| Role filter empty | `GET /screening/roles` returns `{ id, role, … }`; the label chain read `role_name \|\| PositionApplied \|\| name \|\| label` — **`role` was the one key missing**. Every row mapped to `''` and was filtered out | The API was fine, the UI was fine, only the join between them was wrong |
| Nav on legacy geometry | `DesignScope` switches the preset geometry on and wraps **pages**, never `MainLayout` — so the shell never entered the V3 rollout at all | No check covers the shell's own chrome |
| Second selected-rail | `index.css` and `aurora-glass.css` both paint `.ant-menu-item-selected::before` at **identical (0,2,0) specificity**; the glass one wins only because `main.jsx` imports it second | One import-order edit from silently reverting |

### Measurable, but nothing was measuring it

| | Found |
|---|---|
| Tooltip text below AA | Light-mode fill was `--brand-primary` with a white label — **3.51:1**, under 4.5:1. `.mi-note` painted `--text-2` (`#5f6664`) on that green, ≈**1.7:1** |
| Topbar icons mismatched | Bell glyph **14px** against the theme toggle's **22px** sun — a 57% gap between two icons side by side |
| Auth form type | Labels 13px, inputs 14px — *below* the 15px body role, on a screen where the form is the only content |
| Nav radius | 8px against the system's `--radius-ctl` 15px, visibly squarer than every other control |

`contrast.mjs` never saw the 3.51:1 tooltip **because a tooltip only exists on hover.** That
is a real coverage hole, flagged not fixed.

### Functional

- **Navigation never reset scroll.** No `ScrollRestoration`, no `scrollTo` anywhere. The
  window is the scroll owner; leaving a route at scrollY 1200 arrived at **1015**, and only
  moved that far because the shorter page clamped the maximum.
- **⌘K worked on one route.** `CommandPalette` was fully built and mounted by `Dashboard`
  alone.
- **Duplicate JSX attribute.** The submit `<Button>` carried `emphasis="solid"` twice on all
  four auth pages.

## What changed

### Auth pages — type and rhythm

All in `src/ui/ui.css`, one block, already systemised by Stage 5.2. Labels
`--fs-subhead` → `--fs-callout`; inputs and subtitle `--fs-callout` → `--fs-body`; field gap
`--space-5` → `--space-4`; label gap 8px → 4px, following the `.screening-filter` precedent.
Ramp steps only. Lands on all four auth pages via `.auth-form-inner` — each was measured.

### Left nav — onto the design system, glass included

`shell.css` gains one scoped block: radius → `--radius-ctl`, height →
`--control-h-relaxed`, label → `--fs-callout` (same 14px, now *derived*), weight 500 / 600
selected. `inlineIndent={16}` on the `<Menu>` fixes the asymmetric 24/16 padding **at its
cause** — AntD writes that as an inline `padding-left`, so no stylesheet could win.

Glass: hover had **no material response at all** (`box-shadow: none`, measured). Now a
three-rung ladder — rest flat → hover `--depth-1` → selected `--glass-hilite`. Deliberately
not the catch-light on hover; that is what says *selected*.

**Not touched, on purpose:** the light-mode sidebar is opaque white with
`backdrop-filter: none`, and Part I says in so many words not to "fix" it back to glass.

### Inter + Sora shipped — `theme/fonts.js`, one line

`DEFAULT_FONT_PACK_ID: 'system-native' → 'inter-sora'`. `fonts.js` was built for exactly
this: verified zero hardcoded font stacks in any `.jsx`, every stylesheet `font-family`
through a token.

Two files were pinned to the old pack and had to move with it, and they fail differently:
`composition.mjs`'s `RAMP` carried system-native's metrics (25/33/46) and would have gone
**red** on inter-sora's 44; `parity.mjs`'s `AXES` pinned `font: 'system-native'` on both
sides and would have stayed **green while testing a font the app no longer ships**.

`index.html` had been fetching Inter + Sora + DM Mono on every page load all along while
`system-native` rendered — so this costs no new request; it starts using what was already
paid for.

### Dashboard — three defects

Equal-height selector now includes `.ui-surface` (`.ant-card` kept, so it cannot break twice).
`role` added to the label chain. Tooltip fill moved to `--brand-solid` and `.mi-note` to
`--brand-on-solid` — the pair `theme/index.css` documents for precisely this
("a shade below `--brand-primary` … so a white label clears 4.5:1").

### Shell — command bar and scroll

`useLayoutEffect` on `pathname`, **skipped on POP** so Back restores rather than zeroes, and
**never keyed on `location.search`** or every filter change would jump to the top.

The topbar title duplicated the page header (character-identical on `/candidates` and
`/settings`). Replaced by the breadcrumb trail — `Breadcrumb` was already imported and never
rendered, `BREADCRUMB_MAP` already held the labels. `CommandPalette` and its ⌘K listener
lifted from `Dashboard` into the shell. The bell glyph now takes the `--fs-title-3` that
`.cmp-icon` already declared and was being outranked on.

## Verification

`npm run lint` **0 errors** throughout (94 warnings, all in the two retired files). `npx vite
build` clean. `npm run verify:design` final run **144 PASS / 2 FAIL** — both the pre-existing
`/dashboard` parity rows (`button radius` 17.86 vs 15px, `button height` 38 vs 36px), proved
unrelated by reverting and re-running parity alone.

Everything was measured in **both themes**, with 0 page errors: dashboard band gaps
22/23/105/315/76px → **all 0**; role options 1 → **8**; tooltip 3.51:1 → **4.85:1** light,
11.29:1 dark, and `.mi-note` ≈1.7:1 → **4.85 / 13.62:1**; bell 14px → **20px**; nav measured
across expanded + collapsed × light + dark; auth pages across all four routes; PUSH 1400 → 0
with Back restoring to 360.

### Two traps that cost real time — record these

1. **A pruned playwright exits 0 with zero checks run.** `npm run lint` and `npm run build`
   prune the `--no-save` install; the next `verify:design` prints "playwright is not
   installed" and **exits 0**, which reads as a fully green suite. It produced one false
   "verified" report in this session. **Count PASS lines; never trust the exit code.**
2. **`composition.mjs` is flaky under load.** Three consecutive runs failed a *different* set
   of routes on "renders exactly one page header" — first `/settings` + `/email`, then five
   others, then none. A moving failure set is the signature. Probing all 11 routes directly
   with a poll instead of its fixed `waitForTimeout(3000)`, **every one renders exactly one
   header**.

## Files

**Frontend**
- `src/ui/ui.css` — auth type and rhythm
- `src/styles/shell.css` — nav items, breadcrumb, omnibar, bell glyph; `.ml-page-title` retired
- `src/theme/aurora-glass.css` — nav hover material; dashboard equal-height selector
- `src/theme/index.css` — duplicate selected-rail retired (commented, dated)
- `src/theme/themeConfig.js` — tooltip fill/label take the contrast-bearing brand pair
- `src/theme/fonts.js` — `DEFAULT_FONT_PACK_ID` → `inter-sora`
- `src/styles/components.css` — `.mi-note` colour on the tooltip surface
- `src/layouts/MainLayout.jsx` — scroll reset, breadcrumb, omnibar, palette mount, `inlineIndent`
- `src/pages/Dashboard.jsx`, `src/components/dashboard/DashboardHero.jsx` — palette wiring
  removed, role label chain, hero search retired
- `src/pages/{Login,AdminLogin,ForgotPassword,ResetPassword}.jsx` — duplicate `emphasis` removed
- `frontend/UI-CHANGELOG.md` — five entries

**Tests**
- `scripts/verify/composition.mjs` — `RAMP` moved to the inter-sora metrics
- `scripts/verify/parity.mjs` — `AXES.font` tracks the default pack

**No schema change.**

## Still open

- **The two `/dashboard` button parity rows** (`button radius`, `button height`) — pre-existing,
  now the oldest untouched finding in the sweep.
- **`composition.mjs`'s fixed 3000ms wait should become a poll.** It is currently capable of
  failing five routes that are fine.
- **`contrast.mjs` does not cover hover-only surfaces** — it never saw the 3.51:1 tooltip.
- **The module-permission check now exists in four places** (`App.jsx:186`, `App.jsx:296`,
  `Dashboard.jsx:126`, `MainLayout`). A shared helper is the right cleanup, deliberately left
  as its own change.
- **Topbar hit boxes still differ** — bell 38px, theme toggle 36px, avatar 32px.
- **Stretched dashboard cards top-align their content** — Live Activity has ~338px of empty
  space below its idle state. Distributing it means per-widget `flex: 1` plus relaxing
  `.dash-feed`'s `max-height: 320px`.
- **`/admin/dashboard` remains unaudited** — the audit account cannot reach it, and the
  Admin Portal button could not be verified for the same reason.
- **Turnstile is on a testing-only site key** on the login page. Configuration, not design.
