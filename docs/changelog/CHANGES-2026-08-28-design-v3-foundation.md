# Design System V3 — configuration layer, `src/ui` component layer, `/design-lab`

**Date:** 2026-08-28
**Status:** Stages 1–2 shipped. Stage 2 ends at an approval gate — no route has been
converted yet, and no existing screen changes appearance from this work.
**Plan:** "Design System V3 — Liquid Glass — Prototype First, Then App-Wide"

---

## Why

The Aurora Glass rollout (all nine phases shipped 2026-08-21) succeeded at *material*:
every one of the 12 `V2_ROUTES` gets the same glass fill, rim, sheen and depth ramp.
What it could not reach was everything living in **1,915 inline `style={{}}` objects**,
because an inline declaration cannot be overridden by any stylesheet. A survey of the
current tree found:

| Axis | State before this change |
|---|---|
| Inline font sizes | **28 distinct values**, incl. 9.5 / 10.5 / 11.5 / 12.5 / 13.5 / 14.5 / 15.5px |
| Most-used sizes | 11px (194×), 13px (147×), 12px (117×), 12.5px (110×), 10px (57×), 9px (21×) |
| Font stacks | **8 stacks for 3 loaded families**; 30 bare `fontFamily: 'monospace'`; `PublicPageShell` on Arial |
| Buttons | 224 instances, **22 classed**; 6 heights (38/40/42/44/46/48), 4 radii, 12 treatments |
| Inline radii | 13 distinct values; **6px the most common radius in the app, and not in the token scale** |
| Page containers | 13 conventions; 4 pages double-pad to a 48–52px inset vs the dashboard's 24px |
| Card padding | 4 values for one job (22 / 18 / 12 / 24) |
| Stat cards | 3 parallel families with different value sizes, weights, shadows, icon radii, hover lifts |
| Motion | 8 durations against 3 tokens; **4 `:active` states app-wide** |
| Primitive adoption | `PageHeader` 1 consumer of 22; `StatCard` 1; `ErrorState` 2 |

Separately, the framework itself was not enterprise-grade in four specific ways, all of
which this change addresses: no component layer (raw AntD at 393 call sites, no
`size`/`tone`/`variant` prop anywhere); single-configuration primitives (`StatCard`
defaulted `color = '#7a922e'` and built surfaces by string-concatenating alpha onto that
hex, so it could never accept a token); a broken brand axis below the CSS line; and zero
enforcement (no ESLint config, no Stylelint, no test runner, no gallery).

## What shipped

### Stage 1 — the configuration layer

Five orthogonal visual axes, each swappable on its own without touching a page:

```
mode     ThemeContext    light | dark
brand    BrandContext    aapna | midnight
preset   DesignContext   liquid-glass | flat-slate        <- new
font     DesignContext   inter-sora | figtree | system    <- new
density  DesignContext   compact | default | relaxed      <- new
```

New files:

| File | Role |
|---|---|
| `frontend/src/theme/presets/liquid-glass.js` | Preset #1 — iOS geometry, thin/regular/thick materials, glow, spring motion |
| `frontend/src/theme/presets/flat-slate.js` | Preset #2 — opaque, square, no glow. The decoupling proof |
| `frontend/src/theme/presets/index.js` | Registry + resolvers |
| `frontend/src/theme/fonts.js` | Font packs, each owning its own type scale |
| `frontend/src/theme/resolveTokens.js` | `preset × fontPack` → flat token map; and the AntD input subset |
| `frontend/src/context/DesignContext.jsx` | Applies tokens to `<html>`; exposes the switchers |
| `frontend/src/hooks/useDesign.js` | Consumer hook |
| `frontend/src/theme/tokens.css` | Mode/density selection, fallbacks, and the `.t-*` type classes |

Changed: `theme/themeConfig.js` (rewritten as `buildAntdTheme()`), `App.jsx`, `main.jsx`,
`index.html`.

**The type scale is new** — nothing like it existed. 13 roles from `display` down to a
**12px floor**, each carrying size + weight + tracking + line-height so a heading can no
longer be hand-assembled from a size and a guess at a weight. It lives on the *font pack*
rather than the preset, because a ramp tuned for Sora reads wrong on system-ui.

**The brand → AntD break is fixed.** `themeConfig.js` previously held 91 frozen hexes, so
`BrandProvider` — which only writes CSS variables — could never reach AntD's generated
component styles. Switching to `midnight` repainted CSS surfaces blue and left every AntD
button, input ring, tag, tab ink bar, menu selection, switch, checkbox, slider and date
picker olive green. `buildAntdTheme()` now derives from the same brand/preset/font sources
the CSS variables come from. Verified below.

### Stage 2 — `src/ui`

`Button`, `Surface`, `PageShell`/`PageHeader`, `StatTile`, `DataTable`, `Field`, `Sheet`,
`Segmented`, `StateBlock`, `CountUp`, plus `ui.css`. Each reads tokens only and exposes
variants. `StatTile` merges the three stat-card families; its accent is a **token name**,
never a hex.

`hooks/useCountUp`, `usePointerSpotlight`, `MetricInfo`, `metricDefinitions`,
`AmbientBackdrop`, `EmptyState`, `ErrorState`, `LoadingSkeleton`, `LoadingOverlay` and
`pipeline/modalWidths.js` are reused, not reimplemented.

### `/design-lab`

A dev-only route with a live control bar for all five axes, in two panes: the system
(every component × size × tone × state, the type ramp, the scales) and the language
applied to three rebuilt ATS screens (dashboard, list/table, detail + sheet).

It is gated as `import.meta.env.DEV ? lazy(…) : null` — wrapping the `lazy()` call, not
just the `<Route>`, so Rollup folds the whole expression to `null` in production and emits
nothing. Confirmed: gating only the route still shipped a ~27 kB JS + 21 kB CSS chunk to
`dist/`; it now emits zero.

## A bug this work introduced and then fixed

Worth recording, because the fix is the reason the "no visual change" claim above is
true rather than merely intended.

The first cut of `resolveTokens.js` deliberately repointed the **legacy** token names
at the new scale — `--radius-sm/md/lg/overlay`, `--border-radius`,
`--border-radius-lg`, `--transition-fast/normal/slow`, `--ease-out-quint` — on the
reasoning that existing CSS would then inherit the new look for free. It did, and that
was the defect: those names have 100+ consumers across `index.css` and
`aurora-glass.css`, and the values are written inline on `<html>`, where they beat every
selector. The same applied to AntD, whose tokens are global to one `ConfigProvider`.

Measured on `/login` before the fix:

| Token | Shipped value | After the first cut |
|---|---|---|
| `--radius-sm` | 8px | **12px** |
| `--radius-md` | 10px | **12px** |
| `--radius-lg` | 14px | **22px** |
| `--border-radius-lg` | 14px | **22px** |
| AntD `fontSize` | 14px | **15px** |
| AntD `borderRadius` | 8px | **12px** |
| AntD `controlHeight` | 40px | **38px** |

That is a whole-app restyle landing before a single route had been reviewed — the exact
outcome the staged rollout exists to prevent, and one that cannot be verified
route-by-route because it is not route-scoped.

**The fix, in two parts:**

1. The V3 CSS scale uses names nothing else consumes. `--radius-ctl` is specifically
   *not* called `--radius-sm` for this reason. `--transition-*` and `--ease-out-quint`
   are no longer emitted at all. `--radius-card` is the one shared name and is safe:
   `aurora-glass.css` sets it on `.ats-v2`, and a property set on a descendant wins for
   that subtree, so V2 routes keep their 16px.
2. AntD geometry became opt-in — `buildAntdTheme({ presetGeometry })`, default `false`.
   The app-wide provider in `App.jsx` uses `LEGACY_GEOMETRY`; `/design-lab` nests its own
   provider with `presetGeometry: true`. Stage 5 flips each route as it converts, and
   `LEGACY_GEOMETRY` is deleted when the last one lands.

**Colour is deliberately *not* gated.** The brand derivation applies app-wide, because
for the default `aapna` brand it resolves to the same values that were previously
hardcoded — so nothing moves — while making a tenant swap actually reach AntD, which is
the bug the rewrite exists to fix. One intentional difference: `colorPrimaryBgHover` was
the literal `#e3ecc8` and is now `rgba(122,146,46,0.14)`, so it follows a tenant brand
instead of staying olive.

## Verified

`npm run build` clean (the ~3 MB single-chunk warning is pre-existing). No console or page
errors on `/design-lab` in either theme, under either preset.

**Swap matrix**, asserted on computed styles via Playwright/Edge at 1440×1000:

| Axis switched | Observed |
|---|---|
| preset → `flat-slate` | radius card 22→6px, btn 14→4px, control height 38→32px, press-scale 0.96→1, surface bg `rgba(255,255,255,.62)` → opaque `rgb(255,255,255)`, glow → plain border |
| font → `figtree` / `system` | `--font` and the computed `font-family` on a real `.ui-btn` both change |
| brand → `midnight` | `--brand-primary` `#7a922e` → `#3b5bdb`; glow follows automatically |
| mode → `dark` | brand → `#a8c24a`, glow widens 22%→30%, materials darken |
| density → `compact` / `relaxed` | `--ctl-h` 38 → 30 / 46px |

**Non-regression on unconverted routes**, probed on `/login`: `--radius-sm` 8px,
`--radius-md` 10px, `--radius-lg` 14px, `--border-radius` 8px, `--border-radius-lg` 14px,
`--transition-fast` `0.15s cubic-bezier(0.22, 1, 0.36, 1)` — all identical to the
pre-V3 values, while `--radius-ctl` (12px) is present but unread by any legacy rule.

**The AntD half, tested unambiguously** by scanning AntD's own injected
`<style data-css-hash>` elements (19 tags, ~200 kB) rather than any element `ui.css` also
touches:

| Brand | AAPNA olive occurrences | Midnight blue occurrences |
|---|---|---|
| `aapna` | **23** | 0 |
| `midnight` | 0 | **23** |

Preset geometry reaches AntD too — `border-radius: 14px` (the preset's `--radius-btn`) and
`height: 38px` (its `--control-h`) both appear in AntD's generated CSS.

## Deliberately not done

- **No route converted.** Stage 2 is an approval gate. The 24 pages, the 1,915 inline
  styles and the ~150 raw hexes are untouched; every existing screen looks exactly as it
  did. That is why this entry records no visual change to the shipped app.
- **The font-drift sweep** (30 bare `fontFamily: 'monospace'`, the hardcoded `'Sora'` and
  `'DM Mono'` stacks, `PublicPageShell`'s Arial) is specified but not yet applied — it
  belongs with the routes that carry it, in Stage 5.
- **Enforcement** (ESLint/Stylelint rules banning inline surface styles and raw hex) is
  Stage 4. Until it lands, the swap contract is kept by review alone.

## Notes for whoever picks this up

- `flat-slate` is not decoration. A design system with one theme has never been *shown* to
  be themeable — coupling only surfaces when you try the second. It stays in the registry
  as the regression test, exactly as `midnight` does for the brand axis.
- Mode-dependent preset values are emitted as `-light` / `-dark` **pairs** selected by
  `tokens.css`, never written for the active mode alone. An inline value on `<html>` beats
  the `[data-theme='light']` re-scoping that `<ForceLight>` uses for the public token-link
  pages, and a candidate opening an emailed link during a dark session would get dark
  surfaces on a page that must be light. `theme/brands.js` records this as a bug already
  found and fixed once.
- A preset can change surfaces, type, radii, glow, motion and density. It **cannot** change
  layout — sidebar placement, dashboard column counts, information hierarchy. Those live in
  `src/ui` and the pages, and no token layer would make them swappable.
