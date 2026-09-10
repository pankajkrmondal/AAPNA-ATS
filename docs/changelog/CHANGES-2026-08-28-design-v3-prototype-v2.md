# Design System V3 — prototype v2: restored elements, native type, richer material, motion

**Date:** 2026-08-28
**Status:** Prototype iteration. Still no route converted; every shipped screen is
unchanged. Follows `CHANGES-2026-08-28-design-v3-foundation.md`.

---

## Why

v1 of the prototype was reviewed and came back with six corrections. Three of them
were things v1 had dropped that should never have been dropped; three were the design
itself not landing.

| Feedback | Diagnosis |
|---|---|
| "I don't want to lose these" | `StatTile` had dropped the 4px coloured top rail and the full-bleed sparkline; the hero had dropped the Period/roles filters and the second CTA |
| "Animation is not exists" | v1's motion was entrance-only. It plays once and stops, so a still frame — and a screenshot — shows nothing moving |
| "I want the watermark that already exists" | The lab hand-copied four aurora gradients and nothing else. No rotor, no grain |
| "Font still not fantastic" | Direction chosen: the native OS face (iOS / Segoe), not a webfont |
| "Glass morphism still dull" | Direction chosen: richer *without* new blur — the measured perf rule stands |
| "Button radius can still be enhanced" | 14px was too conservative for the iOS register |

The watermark and the "dull glass" complaint turned out to share a root cause, which
is why one change addresses both: **glass is only as interesting as what shows through
it, and nothing was showing through.**

## What changed

### Restored

- **Coloured top rail** on `StatTile`, driven by `--ui-accent`. Rendered under *every*
  preset including `flat-slate`, because it encodes which metric a card is — it is
  data, not decoration.
- **Full-bleed sparkline**, reusing `components/dashboard/Sparkline.jsx` unchanged. It
  is already the good version: draws a flat baseline for a genuine zero week so every
  card keeps the same silhouette, uses `useId` for unique gradient ids, and portals
  its tooltip out of the `overflow: hidden` 56px band.
- **Hero `filters` slot and second CTA.** `PageHeader` had an `actions` slot only,
  which is why both the Period/roles controls and "Screen Candidates" vanished.
  Filters are a separate slot from actions on purpose — controls that change what the
  page *shows* are a different kind of thing from controls that change what it *does*.
- `metric` prop wired through to `MetricInfo`, optional.

### Typography — `system-native` is now the default pack

SF Pro on Apple, Segoe UI Variable on Windows 11, Roboto on Android.

**This cannot be a webfont.** SF Pro is licensed to Apple platforms and Segoe UI to
Windows; neither may be self-hosted or CDN-served. The native stack is the only
sanctioned route. **The consequence, stated so it is a choice and not a surprise: the
product renders in a different typeface per platform, so any pixel comparison has to
be pinned to one OS and a design review has to say which one it was done on.**

Stack order is load-bearing — `Segoe UI Variable *` does not exist on macOS so the
stack falls through to `-apple-system` and lands on SF Pro; `-apple-system` is not a
recognised family on Windows so it is skipped and Segoe wins. Each OS resolves its own
face with no UA sniffing.

**All three Segoe optical cuts are used**, which is most of what separates this from a
generic `system-ui` stack: Display for large sizes, Text for reading, Small for
captions and footnotes. That required a new `small` role in the font-pack contract and
in `resolveTokens`. Verified resolving on this machine — see below.

The scale was retuned: SF and Segoe are spaced tighter than Sora out of the box, so
v1's `-0.04em` display tracking read as cramped and comes back to `-0.022em`. Weights
drop a step for the same reason — Segoe Variable's 700 is optically heavier than
Sora's 800, and asking for 800 produced a smear at display size.

### Material — richer, no new blur

Blur stays on chrome and overlays only; the measured rule at `aurora-glass.css:256` is
untouched.

- **The real `AmbientBackdrop`** now serves `src/ui`, via a scope widening in
  `aurora-glass.css` from `.ats-v2` to `:is(.ats-v2, .ats-v3)`. `:is()` takes the
  specificity of its most specific argument and both are single classes, so the 12
  shipped V2 routes cannot shift from it. A widening, not a copy — the canvas carries
  a measured performance contract and a second copy is a second place for it to rot.
- **Grain** is the specific fix for flatness, and it arrived with the above.
- **Deeper ground** — the lab stage uses `--brand-canvas-deep`. A white pane on a
  near-white page has nothing to separate against.
- **Specular split from rim.** v1 tied the rim's opacity to `--flag-specular`, so
  softening the sheen also softened the rim — and the rim is what defines the pane's
  *edge*, exactly what a translucent surface loses on a light ground. Now
  `--material-specular` and `--material-rim` / `--material-rim-opacity`.
- **Brand tint on the fill** plus a stronger bottom inner shadow, so a pane has
  thickness rather than reading as a flat tinted rectangle.

### Motion

v1 had entrance motion and nothing else. Three layers added, all reusing keyframes
that already existed rather than inventing new ones:

- **Ambient, continuous** — rotor 140s and aurora breathe 26s (free with the backdrop),
  plus a conic hero sweep at 22s on the `ui-hero` variant.
- **State** — `.ui-live-dot`, `.ui-attention`, `.ui-sheen`, `.ui-flash`.
- **Interaction** — press, hover lift, icon-tile spring.

**A Motion section in the lab with a Replay control.** An entrance animation is
invisible one second after it runs, which is precisely why the feedback said motion did
not exist. Without a way to re-trigger it, motion cannot be reviewed at all.

### Geometry

`--radius-btn` 14 → **18px**, `--radius-card` 22 → 24px, `--radius-ctl` 12 → **15px**.
The control radius moves with the button deliberately: a 12px field beside an 18px
button reads as a mistake rather than a hierarchy, and the two sit on the same row
constantly. A live 14 / 18 / pill comparison is in the lab.

## Bugs found and fixed during this pass

1. **The rail rendered as a floating hairline ring.** `.ui-stat-card::before` silently
   inherited `padding: 1px` and `mask-composite: exclude` from `.ui-surface::before`,
   which owns the rim. Pseudo-element budgets are a real constraint on a composable
   surface — `.ui-surface` spends `::before` on the rim and `::after` on the sheen, so
   the rail became a real element (`.ui-stat__rail`), which is honest about what it is
   and cannot collide.
2. **The bloom would have deleted the sheen.** v1's `.ui-surface--bloom::after` resized
   `::after` to a 320px circle. Once `::after` also carried the specular, that would
   have silently removed the sheen from exactly the cards that get a bloom. Both are
   now backgrounds on one layer — also one fewer composited element.
3. **The hero sweep drew a hard diagonal line** across the hero, reading as a rendering
   artefact rather than as light. A two-stop conic wedge draws its own boundary; it now
   has five stops plus a radial mask so it never terminates against the hero's edge.

## Second review pass — four more fixes

1. **The hero had no AAPNA mark.** The shipped dashboard hero carries the rotor
   cropped by its bottom-right corner (`.dash-hero__mark`); the `ui-hero` variant had
   the mesh and sweep but not the mark. Added via `AapnaLogo tone="mono"` at 10%
   opacity (14% in dark). Deliberately **static** — the page-scale rotor on the
   ambient canvas already carries the rotation, and two marks turning at once reads
   as decoration rather than depth. Same reasoning the V2 hero records.

2. **The table's score column was 25px against 13px rows.** Every other cell measured
   correctly at `--fs-subhead`; the outlier was `.t-metric-sm`, a KPI-card display
   size, sitting in a table row. A figure in a table needs to align and be scannable,
   which is tabular numerals and a little extra weight — not extra size. New
   `.ui-table__num` at row size, 600 weight, `tabular-nums`.

3. **`lg` buttons were a slab.** The first cut compounded three increases at once —
   46px height, 32px side padding, 17px text. Presence comes from the taller tap
   target; the label does not need to shout as well. Now 46px / 24px / 15px, so `lg`
   reads as one step up from `md` rather than as an unrelated control.

   Measuring that also exposed a related flaw: a flat 18px radius is a *different
   shape* at every size — on a 30px `sm` it is 18 of a possible 15 (a full pill),
   on a 46px `lg` only 18 of 23 (78% of one). The radius is now capped against the
   height, `min(var(--radius-btn), calc(height * 0.47))`, so the corner character is
   constant across the family. It also self-corrects when density moves the control
   heights — verified at 14.1 / 17.86 / 18px for compact / default / relaxed, which a
   hardcoded per-size value would not have done.

4. **StatTile had no bottom padding without a sparkline.** `.ui-stat` sets
   `padding-block-end: 0` because the band bleeds to the card edge and supplies its
   own floor — but with no band the footnote sat flush against the edge. Fixed with
   `.ui-stat:last-child`, so the card is correct in both shapes without the caller
   passing a flag saying which one it is.

## Third review pass — the hero's empty half

The hero was rendering as a narrow left column with the entire right half empty.

**Cause, measured rather than guessed:** `.ui-page-header` is a flex row, but both
children sat at `flex: 0 1 auto`, so each claimed its *content* width — 698px of title
against 571px of controls, 1293px total, into ~1230px available. Sixty-three pixels
short, so it wrapped, and a wrapped two-column header is a one-column header with dead
space beside it.

**Two fixes, because it had two causes:**

1. **Layout.** The text column is now `flex: 1 1 min(100%, 22rem)` with `min-width: 0`,
   so it absorbs the leftover space instead of demanding its content width. Controls
   are `flex: 0 0 auto` — never squeezed, because compressing a row of real hit targets
   is worse than wrapping it. Below ~900px the whole control block goes full width and
   left-aligns rather than shrinking. Verified degrading correctly at 900px.
2. **Scale.** `--fs-display` resolved to 47.5px at 1440 — tuned in isolation, before
   the hero had controls beside it, and oversized for a dashboard greeting regardless.
   Retuned across all three packs to `clamp(30px, 2.8vw, 44px)`, which fits the
   greeting on one line beside the controls.

The result is 1246px of used row against 1246px available, and hero height fell from
279px to 151px. That overshot — 151px reads as a toolbar strip, not a hero — so block
padding went back to `--space-6`. The air belongs around a single row, not in a third
empty column.

**The mark was also mis-sized for the new proportion.** At 210px with a −52px offset
inside a 151px-tall band, the entire rotor sat within the hero and read as a stray arc
behind the buttons. Now 300px pushed further out (−74 / −128), so what shows is one
clean sweep of the curve — a cropped brand mark rather than a floating shape.

This change touches every `PageHeader`, not just the hero: the detail screen's header
now puts its title left and its actions right for the same reason.

## Fourth review pass — the orphaned emoji and the cropped mark

**The wave emoji was dropping to its own line.** Not cosmetic and not an edge case:
the text column's flex-basis (22rem) was small enough that the flex container kept
both columns on one row and squeezed the title instead of wrapping the controls. A
sweep across viewport widths found the failure band was **1160-1340px** — which is
most common laptop widths, so it was the normal case. Raising the basis to 36rem
makes the container break first, which is the better degradation anyway: a full-width
title with controls beneath it, rather than a cramped title beside them. Verified one
line at every step from 980px to 1920px. `text-wrap: pretty` added as well, for the
case a genuinely long name still wraps.

**The mark is now shown whole.** Two earlier attempts cropped it, and both read as a
broken graphic: first the entire rotor sat inside the band and looked like a stray arc
behind the buttons, then it was pushed so far out that only disconnected blade tips
showed. The reason cropping fails here is specific to this mark — it is a radially
symmetric pinwheel, so a partial one has no silhouette left to recognise, unlike a
wordmark where a cropped letter still reads.

It is now sized from the hero's own height via block insets plus `aspect-ratio: 1`,
so it stays square and rescales when density or content changes the band height —
no magic pixel value to re-tune. Verified fully inside the hero on all four edges.
Opacity raised to 0.13 / 0.16: on a light ground an olive mark needs more alpha than
instinct suggests to register at all, which is the same finding the light-mode aurora
pass recorded.

**Unrelated, found while looking for the logo asset:** `frontend/public/brand/` is
empty, so the favicon and apple-touch-icon in `index.html` both point at a
`/brand/aapna-mark.jpg` that does not exist. Pre-existing and outside this work, but
it means every deployed environment falls through to the SPA catch-all for the icon —
the exact failure the comment above those tags describes as already fixed once.

## Verified

`npm run build` clean. The production bundle hash is **unchanged** from the previous
entry, which is the correct signal: the lab is dev-only and emits nothing in
production. No console or page errors under either preset or theme. (One pre-existing
AntD deprecation warning surfaces from `Sparkline`'s `overlayStyle` — not introduced
here, and left alone rather than touching a working shared component mid-prototype.)

**Non-regression on unconverted routes** — `/login` reports `--radius-sm` 8px,
`--radius-md` 10px, `--radius-lg` 14px, `--border-radius` 8px, `--border-radius-lg`
14px, `--transition-fast` `0.15s cubic-bezier(0.22, 1, 0.36, 1)`. All pre-V3. This is
re-run after every change because leaking into legacy token names was exactly the v1
bug.

**Font resolution on this machine (Windows 11)**, asserted on `getComputedStyle` — a
stack that silently falls through to a generic is the failure mode here and is
invisible by eye:

| Role | Resolved |
|---|---|
| display | `Segoe UI Variable Display` |
| body | `Segoe UI Variable Text` |
| caption | `Segoe UI Variable Small` |
| mono | `ui-monospace` |

**Ambient canvas** — watermark present, opacity 0.075, `atsRotorSpin` at 140s; grain
present at 0.03 with the fractal-noise data URI; `uiHeroSweep` running.

**Swap matrix**, all five axes, on computed styles: preset (24/18px → 6/4px, press
0.96 → 1), font (Segoe → Figtree), brand (`#7a922e` → `#3b5bdb`), mode, density
(`--ctl-h` 38 → 30/46px). `flat-slate` renders with the top rail intact and the
glow/sweep/bloom absent.

**Scroll perf** — continuous rAF, one `scrollBy` per frame, 240 frames:

| Config | Median | p95 | Frames >20ms |
|---|---|---|---|
| liquid-glass light (grain + rotor + sweep) | 16.7ms | 16.8ms | 1.3% |
| liquid-glass dark | 16.7ms | 16.8ms | 1.7% |
| flat-slate (no ambient) | 16.7ms | 16.8ms | 0% |

60fps with the full ambient stack, inside the ~3% baseline the design doc records.
`flat-slate` at 0% confirms the ambient layers are the (small) delta.

**Caveat on that number:** the lab pins `AmbientBackdrop` to `position: absolute` so it
stays inside the demo stage, whereas the app uses `position: fixed` — which is the
*cheaper* configuration, since a fixed plane is excluded from scroll repaint. The lab
figure is therefore a conservative indication, not the real-route measurement. A real
probe has to wait for the first converted route.

## Still not done

No route converted. `LEGACY_GEOMETRY` in `themeConfig.js` still pins AntD's metrics for
all 24 screens. `MetricInfo` is wired but not switched on by default — it was not in
the must-keep list.
