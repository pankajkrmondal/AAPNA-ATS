# Closing the design gap: app → /design-lab

**Date:** 2026-08-29
**Status:** Open. Written after the Design System V3 rollout was complete.
**Reference:** `/design-lab` → "Applied to real screens" (`src/pages/design-lab/AppPane.jsx`)
**Follows:** `AURORA-GLASS-ROLLOUT-PLAN.md` (the rollout this plan comes after)

## Context

The design-system rollout is complete: all 24 routes converted, debt 2,576 → 95 (all 95
in retired files), every live file locked at eslint `error`, 9 verification checks green.

**And the app still only reads ~60% like the lab.** That judgement is correct, and the
reason it was not caught is important:

> **Every token-level property matches exactly.** Measured on /dashboard vs the lab's
> Dashboard mock: hero title `43.68px` = `43.68px`, stat value `33px` = `33px`, stat
> card `220px` ≈ `221px`, sparkline band `56px` = `56px`.

The `parity.mjs` check passes because I wrote it to assert **tokens, not layout** — it
says so in its own docblock: *"a mock is allowed to show different content, never to be
styled differently."* It was built to miss exactly this class of gap.

**So the gap is COMPOSITION, not the design system.** The tokens, the primitives and the
material are right. What differs is how screens are *assembled*.

---

## The two systematic gaps

Both are visible in all three lab archetypes (Dashboard, List / table, Detail + sheet)
and absent from almost every real route. These are the whole gap; everything else is a
consequence.

### Gap 1 — No page header. **9 of 12 routes.**

The lab opens every screen with the same three-part header inside the content area:

```
SENIOR DATA ENGINEER        ← eyebrow, uppercase, brand-coloured
Priya Raman                 ← large title
In the Interview stage…     ← one-line subtitle      [Email] [Advance stage] ← actions
```

Only **three** files in the app use `PageHeader`: the lab's own mock,
`EmailManagement`, and `DashboardHero`. Everywhere else the page title exists *only in
the topbar chrome* — so a screen begins with no title, no context line, and no anchor.
That is the single biggest reason the app reads "dislocated": content starts abruptly.

`PageHeader` already exists in `src/ui/PageShell.jsx` with `eyebrow` / `title` /
`subtitle` / `actions` / `filters` slots. **It is built and unused.**

### Gap 2 — No outer page pane

Every lab archetype wraps the *entire* screen in one tier-2 glass pane, with the
watermark inside it and ~40px of padding. Cards are then nested surfaces within that
frame.

The app has **no route doing this**. Cards float individually on the ambient canvas.
That is why the eye finds no edge and the screens feel unanchored — there is no page,
only floating panels.

### The consequence, measured

| | Lab | App |
|---|---|---|
| Hero height | 106px | **157px** (+48%) |
| Surfaces on screen | 10 | **13** |

The dashboard hero is half again as tall because it carries the period selector, role
filter, ⌘K and live clock that the mock omits, and there is more on screen below.

---

## Plan

### 1. Add the page pane + header to one route first — `/candidates`

Do **one** route end to end and look at it before touching the other eight. `/candidates`
is the best pilot: it maps directly onto the lab's List/table archetype, so the
comparison is exact.

- Wrap the page content in `<Surface tier={2} padding="relaxed">` inside the existing
  `PageShell`.
- Add `<PageHeader eyebrow="Candidates" title="Search Candidate" subtitle="Every
  candidate across every open requisition." actions={…} />` as its first child.
- The existing search `Surface` and table `Surface` become **tier 3** (nested inside a
  tier-2 is tier 3 — that rule is already in `Surface`'s docblock and `ui.css`).

**Then screenshot it beside the lab tab and judge.** If the frame reads right, roll it
out; if it reads heavy, stop at one route rather than nine.

### 2. Roll out to the remaining eight

`MRF`, `Settings`, `Analytics`, `CandidateDetail`, `CandidateScreening`, `HRUpload`,
`VendorPortal`, `VendorDashboard`. Same two changes each. `Pipeline` and
`AdminDashboard` already open with a `Surface` and need only the header.

Each needs a real eyebrow/subtitle written — not filler. The subtitle is the line that
says what the screen is *for*, which is the thing the topbar title cannot carry.

### 3. Let the dashboard hero breathe

Measured 157px against the mock's 106px. Without removing features:

- Move the **period selector and role filter out of the hero** into the `filters` slot
  `PageHeader` already has, below the title row rather than crowded beside it.
- That alone should recover most of the 48%.

### 4. Decide what the dashboard shows — **your call, not mine**

The mock shows KPIs + 2 widgets. The app has 6 below the fold (Needs Your Attention,
Conversion Funnel, Talent Insights, Upcoming Interviews, Live Activity, Latest Uploads).
Closing 13 → 10 means removing widgets, which is a **product decision about content**.
I will not choose which features come off a screen. Flagging it as the last ~10% of the
gap, quantified, for you to decide.

---

## Files

- `src/ui/PageShell.jsx` — `PageHeader` already has every slot needed. **Reuse, do not
  extend.**
- `src/pages/Candidates.jsx` — the pilot.
- Then the eight listed above; each is the same two-line change plus copy.
- `src/components/dashboard/DashboardHero.jsx` — the filters move.
- `src/pages/design-lab/AppPane.jsx` — the reference. Read it before each archetype;
  it is the specification.

## What NOT to do

- **Do not touch tokens, `src/ui` primitives, or any stylesheet in `theme/`.** They are
  correct and verified. This gap is assembly, and a token change would put the 9 green
  checks at risk for nothing.
- Do not extend `PageHeader`. Every slot needed already exists.

---

## Verification

1. **Screenshot each converted route beside its lab archetype**, both modes. This gap is
   compositional, so the eye is the instrument — no measurement will settle it.
2. `npm run verify:design` — 9 checks must stay green. Any failure means step 1 touched
   something it should not have.
3. Re-measure hero height and surface count on /dashboard against 106px / 10.
4. `npm run lint` — **0 errors**. Every live file is `error`-level now, so a stray inline
   style fails the build rather than warning.

## Fix the check that missed this

`parity.mjs` asserts tokens only, and that is why "parity passes" was worth nothing here.
Extend it — or add `composition.mjs` — to assert the two structural facts instead:

- every route renders exactly one `.ui-page-header`
- every route's first content child is a `.ui-surface`

Two assertions that would have caught this the day it appeared.
