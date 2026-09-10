# Design System V3 — enterprise hardening: a11y fixes, flag wiring, enforcement

**Date:** 2026-08-29
**Status:** Prototype still; no route converted. Closes the blockers found by the
enterprise-readiness audit before Stage 5 begins.

---

## Why

The design was approved, and the question asked before converting 24 routes was whether
this is genuinely an enterprise-grade framework. Audited against the code rather than
against intent. Verdict: the architecture held up; the disciplines around it did not,
and there were three real accessibility defects.

## Accessibility — measured, fixed, now gated

| Element | Before | After |
|---|---|---|
| Solid primary button, light | **3.51:1** | 4.85:1 |
| Solid primary button, dark | **2.00:1** | 4.70:1 |
| Soft button, light | **3.25:1** | 5.81:1 |
| Segmented active, light | **3.25:1** | 5.25:1 |
| Stat footnote (`--text-3`), light | **2.93:1** | 4.75:1 |
| Stat footnote, dark | **4.27:1** | 6.23:1 |

Cause was `--ui-tone-contrast: #fff` hardcoded in `ui.css` — a raw hex in the layer that
forbids one, and an assumption the component layer is not entitled to make. A brand knows
whether its own primary needs a light or a dark label; a button does not. Three
brand-owned tokens now carry it: `--brand-solid` (the solid FILL), `--brand-on-solid`
(its label), `--brand-ink` (the brand colour at a value safe as text on a tint).

**A first attempt at the dark fix was rejected in review, and rightly.** Flipping the
label to near-black on the bright `#a8c24a` passes at ~12:1 and looks like a highlighter.
Accessible and ugly is half a fix. The shipped answer deepens the *fill* instead and keeps
a white label in both modes, letting `--glow-brand` supply prominence on a dark ground —
which is the premise of the direction anyway.

**`Segmented` was a broken radiogroup.** Every option was a tab stop (eight consecutive
Tab presses landed inside segmented groups), and `role="radio"` was declared with no
arrow-key handling — a contract claimed and not honoured. Now a roving tabindex: one stop
per group, arrows move selection, Home/End jump to the ends, disabled options skipped.

**`--press-scale: 1` under reduced motion never applied.** `DesignContext` writes the
token inline on `<html>`, and an inline declaration beats a media query, so the
neutralising block in `tokens.css` was dead code. Motion values are now emitted under a
`-motion` suffix and selected in the cascade — the same pair convention the light/dark
tokens use, and the same class of bug already fixed once for modes.

> **A finding I reported and then retracted:** the rotor watermark appeared to keep
> spinning under reduced motion. It does not. I had probed `animationName` instead of
> `animationDuration`; the global `*` guard at `index.css:1981` freezes it correctly.

## The system now obeys its own contract

**Preset behaviour was coupled to a preset's NAME.** `ui.css` carried two
`[data-preset='flat-slate']` selectors, so any third preset would silently inherit Liquid
Glass's squircle and overlay blur regardless of what it declared. The `flags` block exists
in every preset precisely to prevent this and was **never read** — because a CSS custom
property cannot drive a selector, which is why `--flag-*: 0` could never turn a rule off.
Flags are now published by `DesignContext` as `data-flag-*` **attributes**. Verified with
a synthetic third preset whose name the CSS has never seen: it renders correctly from its
declared flags alone.

**Dead tokens removed:** `--ease-exit`, `--font-body`, `--font-display`, and four
`--flag-*` custom properties. `--row-px` appeared in the dead list and is **not** dead —
`LoadingSkeleton.jsx:114` consumes it; the original scan only covered three directories.

**Literals promoted:** page widths (1000 / 1320 / 1560) to `--page-w-*` tokens, and two
off-scale font sizes onto the type scale.

## Enforcement — the part that had never existed

`eslint` had been a devDependency with no config and no script; it had never run once.

- **`eslint.config.js`**, core rules only, no plugins. Bans inline style properties that
  bypass tokens, raw hex in pages and components, and bare `fontFamily: 'monospace'`.
  Warn-level app-wide — erroring on ~2,400 pre-existing violations would only result in
  the config being deleted — and **error-level in `src/ui`**, which is new code with no
  debt to grandfather. A no-op `react-hooks` stub registers the rule names used by 11
  existing disable comments so lint can reach exit 0 and the design rules are the only
  signal in the output.
- **`npm run lint:count`** turns it into a burndown: **2,576 warnings** today — 2,405
  inline style props, 139 raw hexes, 32 bare monospace — with a per-file ranking. A
  warning nobody counts is a warning nobody fixes.
- **`npm run verify:design`** — the probes promoted out of a temp directory into
  `frontend/scripts/verify/`: non-regression, swap matrix, accessibility, contrast.
  Exits non-zero on any failure. Every claim previously made about this system was
  produced by throwaway scripts nobody else could run and nothing re-ran.

Stylelint was planned and deliberately **not** added: a dependency-free check in the same
harness does the job without another install and another lockfile entry.

## Verified

`npm run verify:design` — all checks pass:

- **Non-regression:** `/login` holds every pre-V3 token value.
- **Swap matrix:** all five axes independent; behaviour flag-driven, not name-driven.
- **A11y:** one tab stop per group (7 across 7), arrows move selection, reduced motion
  neutralises `--press-scale` while normal motion does not.
- **Contrast:** 48 assertions across 2 modes x 2 brands, all at or above AA.

The suite immediately found a failure I had missed by hand — `segmented active` at 3.25:1
under `aapna`, which passed under `midnight` only because that blue happens to be darker.
That is exactly the accident a second brand exists to expose, and exactly why these checks
belong in the repo rather than in someone's scratch directory.

`npm run build` clean.

## Not done, deliberately

`Input`, `Select`, `Tag` and `Avatar` are still raw AntD at call sites — coverage was
scoped out. Stage 5 hits them on the first form-heavy route; that is the moment to decide,
not before. Part III of the canonical design doc is still outstanding.
