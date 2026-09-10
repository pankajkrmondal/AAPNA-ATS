# Screen-by-screen design sweep, continued: `/filtering`

**Date:** 2026-09-01 · **Modules:** Frontend (`/filtering`, `/analytics`, design system, verification)
**Continues:** [CHANGES-2026-09-01-screen-design-sweep-mrf.md](./CHANGES-2026-09-01-screen-design-sweep-mrf.md)
**Method:** [`docs/design/SCREEN-SWEEP-PROMPT.md`](../design/SCREEN-SWEEP-PROMPT.md)
**Per-change detail:** full entry in `frontend/UI-CHANGELOG.md`.

One file per screen, following the `/mrf` write-up.

## Why

Screen 7, reported by eye in two lines: *"tab switching is not following our theme"* and
*"keyword filtering is not following our design-lab theme fields."* Both reproduced. The
tab strip measured worse than it looked — it was carrying an **AA contrast failure** — and
the reason the filter form was never caught turned out to be structural rather than an
oversight.

`/filtering` is the screen the sweep prompt flags as *"largest inline-style debt in the
app."* This pass deliberately did **not** go after that debt; it did the two reported
defects and the couplings they forced. The rest is carried in "Still open".

## The defects

### 1. The tab strip was a `<Tabs>` wearing a segmented costume

`.screening-tabs` dressed AntD's tab chrome as a capsule: an `--ink-3` nav-list, tabs with
hand-picked padding, and the ink bar suppressed with `!important`.

| | Before (`.screening-tabs`) | After (`Segmented`) | Ramp |
|---|---|---|---|
| Track radius | **10px** | `999px` | `--radius-pill` |
| Item radius | **8px** | `999px` | `--radius-pill` |
| Item height | 35.3px | 30px | `calc(--ctl-h - 8px)` |
| Track height | 45.3px | 38px | — |
| Label type | 15px / 600 | 13px / 600 | `--fs-subhead` |
| Gap below | **18px** (`/filtering`), **20px** inline (`/analytics`) | 24px | `--space-5` |
| **Active label, light** | **3.51:1** | **5.81:1** | **4.5:1** |
| Active label, dark | 8.97:1 | 11.88:1 | 4.5:1 |
| Tab stops | 2 (`/filtering`), 4 (`/analytics`) | 1 each | — |
| Group role | none | `radiogroup`, labelled | — |

**The 3.51:1 is the finding.** The active tab painted its label `--brand-primary`
(`rgb(122,146,46)`) on an opaque white pane — under the 4.5:1 floor for 15px text, in the
product's primary brand, on the control telling you which mode you are in. This is the same
failure `ui/Segmented.jsx` already documents in its own source (*"the identity colour on an
opaque light pane measured 3.25:1 under the olive brand"*) and had already fixed by using
`--brand-ink`. The screen simply never adopted the component built to fix it.

Worth recording what the retired `.ats-v2` block was *reaching* for, because it names its
own failure: *"translucent track, near-solid thumb — the selected tab has to stay the most
solid thing in the control or the segmented metaphor stops reading."* Measured, its track
resolved to `rgba(255,255,255,0.9)` with the thumb at `rgb(255,255,255)` — a **10%**
difference between track and thumb, which is why the selected pill barely read at all.
`.ui-segmented` puts the track at 12% of `--text-3` and the thumb on `--material-thick`,
which is the contrast that note asked for and did not get.

**Fix — a new `src/ui` primitive, `SegmentedTabs`.** `Segmented` plus the pane wiring, so
the two screens sharing this control cannot drift:

```jsx
<SegmentedTabs aria-label="Screening mode" activeKey={activeTab} onChange={…} items={items} />
```

**Mounting semantics are copied from AntD deliberately.** `<Tabs>` mounts a pane on first
activation and leaves it mounted (`destroyInactiveTabPane` defaults false). Rendering only
the active pane would have been simpler and would have quietly changed behaviour on both
screens — `/analytics`' four panes hold `<Table>`s whose pagination would reset on every
round trip, and `/filtering`'s keyword pane holds a `<Form>` that would remount. Both
verified after the swap: a sentinel typed into the keyword form survives a round trip to
JD and back, and an `/analytics` table left on page 2 is still on page 2 after visiting
another tab.

### 2. The keyword fields predated the token contract

`.screening-filter` was written before the ramp existed and had never been revisited.

| | Before | After | Reference |
|---|---|---|---|
| Label | **11px** / 700 / 0.6px | 12px / 600 | `--fs-caption` |
| Hint (`.field-hint`) | **11px**, lh 15.4 | 12px, lh 16.8 | `--fs-footnote` |
| Control radius | **10px `!important`** ×6 | 15px | `--radius-ctl` |
| Compact group | `10px 0 0 10px` | `15px 0 0 15px` | `--radius-ctl` |
| Collapse item | **12px** | 15px | `--radius-ctl` |
| Input text | 17px | 15px | `--fs-body` |
| Hover border | `--green` = `rgb(74,124,89)` | brand at 55% | `--brand-primary` |
| Focus ring | `rgba(122,146,46,0.14)` **raw hex** | `--glow-focus` | token |
| Focus border | `rgb(74,124,89)` | `rgb(122,146,46)` / `rgb(168,194,74)` | `--brand-primary` |
| Sub-12px elements | **14** | **0** | 12px floor |

Two sizes sat under the **12px floor** — the floor this rollout spent real effort
establishing, and which `CandidateScreening` is named in `type-floor.mjs`'s header as the
original source of.

Three things only measurement gave up:

- **The focus ring was a raw brand hex**, so it could reach neither a tenant brand nor dark
  mode. Proof it was dead rather than merely ugly: it measured **byte-identical in light
  and dark** (`rgba(122,146,46,0.14)` in both). `--glow-focus` now resolves to different
  values per mode, as it should.
- **The hover and focus border was `--green`, which is `#4a7c59` — not the brand olive.**
  A different green entirely. The focused control was painting a `--green` border inside a
  `--brand-primary` ring: two unrelated greens on one input, agreeing with nothing.
- **17px input text.** Not a violation — `size="large"` maps `fontSizeLG` to the *headline*
  size, so it was derived — but it made the filter inputs the largest body text on the
  screen, 3px above the lab's field. Now `--fs-body`, following `.auth-form-inner`, which is
  the app's other relaxed-height form.

Control height **stays at 46px** (`--control-h-relaxed`), matching the role Select on the
JD tab. That was a deliberate call, not an oversight: the lab's `Field` is 38px, but the
two tabs of this screen have to agree with each other first.

## A regression this pass introduced, caught by measuring after

Dropping the input font 17px → 15px took the three text inputs from 46.1px to **43.3px**
while the Selects and InputNumbers beside them — which take `controlHeightLG` directly —
stayed at 46. A 2.7px stagger across one filter row, invisible in a screenshot and green
in every check. An affix wrapper is sized by its content, so the height has to be pinned
once the font changes; `.auth-form-inner` already does exactly this and is why that rule
exists. Now 46.0 / 46.0 / 46.0 in both themes.

Recorded rather than quietly fixed, because it is the argument for the method: the
after-measurement is not a formality.

## Why nothing caught it

`type-floor.mjs` scans `/filtering` and would have flagged both 11px sizes on sight. It
never saw them: **AntD `<Tabs>` mounts only the active pane**, and the active tab defaults
to `'jd'` (`CandidateScreening.jsx:312`, seeded from `localStorage`). Measured — 0 sub-12px
elements on load, **14** the instant the Keyword tab is clicked (7 labels + 7 hints).

The scan was not wrong, and neither was the check. The form had simply never been in the
DOM at the moment anything looked. `contrast.mjs` missed the 3.51:1 active tab for a
related reason — it only measures what `/design-lab` renders, and the lab renders
`Segmented`, which was already correct.

**This is not fixed by the swap.** `SegmentedTabs` is still lazy, on purpose. The floor on
this screen is held by the rules, not by the scan. Making the scan click through every
pane on every route is the real repair and is carried below.

## Shared-class couplings this forced

`.screening-tabs` was on **both** `/filtering` and `/analytics` — the coupling
`AURORA-GLASS-ROLLOUT-PLAN.md` §I.4 lists with the warning *"do not clean it up without
checking both."* Both were converted together rather than leaving the two screens to
disagree.

Three couplings turned up while retiring it:

1. **`functional.mjs:153` drove the `/analytics` tabs by `.ant-tabs-tab`.** That selector
   dies with the swap — and it had `.catch(() => {})` on it, so it would not have thrown.
   It would have silently stayed on the default tab and failed the three panel assertions
   below it, reading as though the `Surface` swap had broken. Now `getByRole('radio')`, and
   asserted rather than caught, for that reason.
2. **The collapse radius had to move at both ends.** `aurora-glass.css` loads *after*
   `index.css`, so at equal specificity with both `!important` its 12px silently beat the
   retokened 15px — the accordion would have kept 12px corners inside 15px fields and the
   fix would have looked like it did nothing. Split out of its shared rule; the summary and
   select-all bars deliberately stay put.
3. **The `prefers-reduced-transparency` block is a selector list.** Commenting out its last
   entry would have left `.cd-summary,` trailing, invalidating the whole list and dropping
   the rule for **eleven other surfaces** — a reduced-transparency regression with no error
   anywhere. The comma is inside the comment. Verified by parsing the built CSS: 14
   selectors in, 14 out.

## Files

**Frontend**
- `src/ui/SegmentedTabs.jsx` — **new**; `Segmented` + AntD-parity lazy pane mounting
- `src/ui/index.js` — export it
- `src/ui/ui.css` — `.ui-segmented__label` (new class, so the three existing `Segmented`
  callers are untouched), `.ui-segmented-tabs` gap, `.ui-segmented-tabs__pane[hidden]`
- `src/pages/CandidateScreening.jsx` — `<Tabs>` → `<SegmentedTabs>`; `<Space>` labels →
  `.ui-segmented__label`
- `src/pages/Analytics.jsx` — same swap, 4 panes; `tabBarStyle` inline style removed;
  `size="large"` and the now-unused `Tabs` import dropped
- `src/theme/index.css` — `.screening-filter` retokened; `.screening-edu-panel` radius;
  `.screening-tabs` retired (commented, dated)
- `src/theme/aurora-glass.css` — two `.screening-tabs` blocks retired; edu-panel radius
  split out of its shared rule
- `src/styles/pages/candidate-screening.css` — stale header note corrected

**Tests**
- `scripts/verify/functional.mjs` — `/analytics` tab driven by role, and asserted

**No schema change. No backend change.**

## Verification

- `npm run verify:design` — **152 PASS / 2 FAIL**, both the documented pre-existing
  `/dashboard` rows (`button radius` 17.86 vs 15, `button height` 38 vs 36). PASS lines
  counted, not the exit code. `composition.mjs`'s flaky page-header check passed all 11
  routes this run.
- `npm run lint` — **0 errors**, 94 warnings, all pre-existing and all in `StatCard.jsx`
  and `CandidatePipelinePrototype.jsx`, neither touched here.
- `npx vite build` — clean, 4141 modules.
- Measured and screenshotted in **light and dark**, on both tabs, accordion collapsed and
  expanded. 0 page errors across the pass.
- Behaviour verified rather than assumed: keyword form survives a tab round trip;
  `/analytics` table pagination survives a round trip; exactly 1 pane visible of 2 mounted.

## Still open

Carried forward, plus what this screen added:

- **The scan cannot see a pane it never opens.** `type-floor.mjs` and `contrast.mjs` both
  measure only what is mounted on load, and every route with tabs hides content from them.
  Making them walk each `Segmented` option is the real fix and is its own change — it will
  almost certainly find more than this screen did.
- **`/filtering`'s inline-style debt is untouched** — 88 inline declarations and ~39 raw
  hexes, the largest in the app. The `screening-summary-bar` block at
  `CandidateScreening.jsx:1404` is the visible one; the rest is the AI profile drawer.
- **The drawer's own `<Tabs>` (`CandidateScreening.jsx:1933`) was left.** Plain AntD
  underline tabs — a genuinely different control from the segmented strip, not the reported
  defect, and it deserves its own decision rather than being swept along.
- **`Input.Group compact` is deprecated** in antd 5.29 (wants `Space.Compact`). Used twice
  for the Min/Max pairs. Behavioural, not visual; left rather than folded into a design pass.
- **`.screening-summary-bar` (10px) and `.screening-selectall-bar` (6px) still carry
  off-ramp radii**, now beside 15px fields. They belong to the results list, which this
  sweep did not measure — changing them on an unmeasured surface is the thing the method
  exists to prevent.
- **`/analytics` got its tab strip converted early** and is otherwise unswept. Its own turn
  still owes the rest of the screen.
- Everything still open from the 2026-08-31 and `/mrf` write-ups, unchanged.
