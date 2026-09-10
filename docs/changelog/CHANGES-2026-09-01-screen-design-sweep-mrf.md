# Screen-by-screen design sweep, continued: `/mrf`

**Date:** 2026-09-01 · **Modules:** Frontend (`/mrf`, design system, design lab, verification)
**Continues:** [CHANGES-2026-08-31-screen-design-sweep.md](./CHANGES-2026-08-31-screen-design-sweep.md)
**Method:** [`docs/design/SCREEN-SWEEP-PROMPT.md`](../design/SCREEN-SWEEP-PROMPT.md)
**Per-change detail:** full entry in `frontend/UI-CHANGELOG.md`.

A new file rather than an append: the sweep has rolled into a new month, which the prompt
names as the point to start a fresh write-up.

## Why

Screen 6, reported by eye in two sentences: *"when I open a submitted MRF, right now
everything is disabled — it should be like view mode, not disabled mode"*, and *"this tab
switch is not following our finalized design."* Both reproduced. The first measured
considerably worse than it looked, and a third defect turned up while reading the file.

## The defects

### 1. View mode was the disabled state

The detail modal said "you are reading, not editing" using AntD's **disabled** state —
`disabled={!isEditing}` on both forms plus nine fields hard-wired `readOnly disabled`.

| | Before | After | Floor |
|---|---|---|---|
| Value text, light | **1.84:1** | **14.01:1** | 4.5:1 |
| Value text, dark | **1.91:1** | **14.56:1** | 4.5:1 |
| The label naming it | 5.35 / 5.46:1 | unchanged | 4.5:1 |
| Disabled inputs in view | 53 of 53 | **0** | — |
| `cursor: not-allowed` | 53 | **0** | — |

The number that makes the case is the pairing: **the label was three times more legible
than the value it labelled**, and the value only became readable once the user was allowed
to type into it — the same field measures `--text` the instant Edit is pressed. Disabled is
a statement about permission. View mode is a statement about mode. The screen had one word
for both.

**Fix — a new `src/ui` primitive, `FieldValue`.** The read side of a field, sitting beside
`Field`. It takes `value` and swallows the `onChange` that `Form.Item` clones onto its
child, so it can be the control of a **named** Form.Item:

```jsx
<Form.Item name="role">{isEditing ? <Input /> : <FieldValue />}</Form.Item>
```

That shape is deliberate and is what makes the change cheap: the form store,
`Form.useWatch`, `isFieldsTouched()` and validation all survive the mode switch, so nothing
is re-seeded and no value is dropped. `min-height: var(--ctl-h)` keeps the grid identical
across modes so the dialog does not jump. Verified: entering edit shows 28 pre-filled
inputs, `mrfstatus` still protected, footer still Cancel / Save Changes.

Both `<Form disabled={!isEditing}>` props were **kept on purpose** — a field missed by the
swap degrades to the old behaviour rather than silently becoming editable.

Seven fields that were `readOnly disabled` in *both* modes (Form Submission Date, Date of
Request, five AI-parsed JD rows) are now `FieldValue` unconditionally: they are facts, not
fields. The AI "Roles & Responsibilities" answer had been a 3-row disabled TextArea you
scrolled inside; it now reads as a paragraph.

Two follow-ons the change surfaced, both fixed:

- **Required asterisks rendered in view mode** — an instruction with nothing to act on.
  `requiredMark={isEditing}`; the rules stay, so saving still validates.
- **`JD Document Link` wrapped to seven lines of SharePoint query string.** An input had
  been hiding that behind a single-line scroll. It is a link in view mode now, matching
  what `MrfApprovalAction.jsx:189` already does with the same column.

### 2. The status filter was never converted

| | Before (`Radio.Group`) | After (`Segmented`) |
|---|---|---|
| Item radius | `15px 0px 0px 15px` — a joined slab | `999px` |
| Item type | 15px / 400 | 13px / 600 |
| Active fill | `rgb(122,146,46)` raw solid brand | `--material-thick` + `--brand-ink` |
| **Tab stops** | **6** | **1** |
| Group role | none | `radiogroup`, labelled |

Values are unchanged, so `loadRecords` and the CSV export query are untouched;
`handleStatusFilterChange` now takes the value rather than an event. Verified the filter
still fires: All to Closed takes 10 rows to 0, and the active pill follows.

### 3. The modal scrolled sideways

`styles={{ body: { padding: '20px 0 0 0' } }}` — an inline-style-law violation, and the
cause of the horizontal scrollbar: `Row gutter={16}` lays its columns out with a −8px
inline margin, so a body with **zero** inline padding is overflowed by exactly the
half-gutter. Measured `scrollWidth 760` vs `clientWidth 752`, both themes. Now a class,
overflow **0**.

**Worth recording: the first version of that rule silently did nothing**, with a symptom
identical to the inline style it replaced. antd 5.29 paints
`:where(.css-<hash>).ant-modal .ant-modal-body { padding: 0 }` — `:where()` contributes
nothing, but the two real classes still make it **(0,2,0)**, so a lone `.mrf-modal-body` at
(0,1,0) lost and computed to `0px`. Resolved with specificity
(`.ant-modal .ant-modal-body.mrf-modal-body`), not `!important`.

## Why nothing caught any of it

The suite was **152 PASS / 2 FAIL** throughout, the two failures being the pre-existing
`/dashboard` parity rows.

| Defect | Why it was invisible |
|---|---|
| 1.84:1 values | **No check has a concept of "view mode."** A screen expressing it as `disabled` is, to every check, a correctly rendered form |
| 1.84:1 values | **`contrast.mjs` only measures `/design-lab`.** These live in a modal on `/mrf` behind a row click, so they were never in the sample |
| 6 tab stops | `a11y.mjs` asserts one tab stop per `.ui-segmented`. A control that is *not* a Segmented is invisible to it |
| 8px overflow | Inside a 3400px-tall modal that scrolls vertically anyway |

**The gap that let #1 hide is now closed at the source**, not just on this screen:
`.ui-value` and `.ui-value__empty` were added to `contrast.mjs`'s `TARGETS` **and** to the
design lab's `SystemPane`, because that check can only measure what the lab renders. They
now report 13.1 / 4.75 (light) and 16.11 / 6.23 (dark), across both brands.

## Verification

- `npm run verify:design` — **152 PASS, 2 FAIL**, both documented pre-existing
  (`button radius` 17.86 vs 15px, `button height` 38 vs 36px, on `/dashboard`).
  PASS lines counted, not the exit code. `composition.mjs` did not flake on either run.
- `npm run lint` — **0 errors** (94 warnings, all pre-existing inline-style warnings in
  `StatCard.jsx` and `CandidatePipelinePrototype.jsx`; none in any file touched here).
- `npx vite build` — clean, 4140 modules.
- Measured and screenshotted in **light and dark**, in view and edit state, across all six
  filter tabs, at 1500px.

## Files

**Frontend**
- `src/ui/FieldValue.jsx` — **new** primitive, the read side of a field
- `src/ui/ui.css` — `.ui-value` block
- `src/ui/index.js` — export
- `src/pages/MRF.jsx` — view/edit swap on both modal forms, `Segmented`, `requiredMark`,
  URL columns as links, status-label helper, modal body class
- `src/styles/pages/mrf.css` — `.mrf-modal-body`
- `src/pages/design-lab/SystemPane.jsx` — `FieldValue` documented in the lab
- `frontend/UI-CHANGELOG.md` — one entry

**Tests**
- `scripts/verify/contrast.mjs` — `.ui-value` / `.ui-value__empty` added to `TARGETS`

**No schema change. No backend change.**

## Still open

Carried forward, plus what this screen added:

- **Duplicate raise status inside one dialog.** The Workflow Summary shows *MRF Raise
  Status* as a tag, and the form below repeats the same column as a (disabled) *MRF Raise
  Status* field. Plain-text view mode makes it more obvious, not less. Deliberately not
  acted on: it is a content decision about which of the two should go, not a style fix.
- **`FieldValue` should replace the hand-rolled read views on the remaining detail
  screens** — `/candidates/:id`, `/filtering`, and `PipelineDrawer`. One screen at a time.
- **Legacy raise-status codes are not in the Select's option list.** #181 reads `approved`,
  which no option offers; view mode sentence-cases the raw code rather than inventing a
  label. The vocabulary itself wants reconciling with the workflow.
- Everything still open from the 2026-08-31 write-up, unchanged: the two `/dashboard`
  button parity rows, `composition.mjs`'s fixed 3000ms wait, `contrast.mjs` not covering
  hover-only surfaces, the four-fold module-permission check, topbar hit boxes, stretched
  dashboard cards, `/admin/dashboard` unaudited, and the Turnstile testing key.
