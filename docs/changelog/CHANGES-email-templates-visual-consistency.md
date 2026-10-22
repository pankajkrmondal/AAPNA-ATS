# Email Templates — visual consistency pass

**Date:** 2026-08-25 · **Scope:** Email Template Management screen (`/email`) — CSS and layout
only, no content or backend changes · **Environments:** dev/staging only

## Why

A recent redesign of `/email` (see `CHANGES-email-templates-business-friendly.md`
for the content-side work done alongside it) introduced a real bug — the search
box and category dropdown did not align — and drifted from the rest of the app
in ways that made the screen read as a different product: pill-shaped form
controls, a missing page title, a bespoke gradient Save button, and an
off-palette preview chrome with no dark-mode path. Three pieces of the
screen's own published design canvas (`design/Main.dc.html`) had also never
been implemented.

This pass fixed the alignment bug, brought the screen back in line with
`/candidates` and `/mrf`, closed the remaining canvas gaps, and added motion
using the app's existing keyframe vocabulary. It does not touch the branded
email itself — see the "what was not touched" note below.

---

## The alignment bug — root cause

The toolbar hardcoded `height: 38px` on the search `Input` and the `Select`.
AntD derives every *internal* metric of a `Select` from `controlHeight`
(`themeConfig.js`, set to `40`) — its selection-item line-height and baseline
spacer render at `controlHeight - 2×lineWidth` = 38px, which then had to fit
inside the 36px content box left by a 38px outer box with 1px borders. On top
of that, AntD's own `.ant-select-single:not(.ant-select-customize-input)
.ant-select-selector` rule ties our override on CSS specificity (0,3,0 each);
AntD's cssinjs injects after Vite's stylesheet, so it won the tie and its
`padding: 0 11px` beat our `14px` regardless. The two controls ended up
different heights *and* different insets.

**Fix:** stop overriding `controlHeight`. All explicit heights and paddings
were removed from `.email-toolbar`'s search/select/button rules; all three
controls now inherit AntD's `40px` and align by construction, with no
specificity fight left to lose later.

## App consistency

- **Control radius:** pill (`999px`) → `var(--radius-sm)` (8px) on the search
  box, category dropdown and Save button, matching Candidates/MRF/Settings.
  The pill shape is kept only where the app already uses it: the row status
  dot and (new, see below) the segmented tab strip.
- **Save button:** dropped the bespoke gradient + glow; it is now a standard
  AntD primary button styled entirely by `themeConfig`'s `Button` tokens, with
  a hover lift that reuses `.admin-portal .ant-btn-primary:hover`'s shadow
  rather than a one-off `color-mix()`.
- **Page title restored** via `PageHeader` — the app's documented standard
  header component, which had zero import sites anywhere in the codebase
  before this (this screen was its last consumer, removed by the redesign).
  Its default `--space-6` gap was tightened to `--space-4` for this page only,
  since the editing surface is sized to fit a whole email and every band above
  it comes out of that height budget; the list pane's `max-height` calc was
  adjusted to match.
- **Preview chrome tokenized.** `EmailPreviewPane`'s mail-client header bar
  (traffic-light dots, "Subject:"/"To:" rows) was an inline style object built
  from an off-palette Tailwind slate ramp (`#f8fafc`/`#64748b`/`#0f172a`/…)
  with no dark-mode handling — it stayed near-white in dark mode. Moved to a
  stylesheet class mapped onto the app's tokens (`--ink-3`, `--text-3`,
  `--red`/`--warn-text`/`--green`). This component is shared with Candidate
  Screening's decision modal and the Pipeline drawer, so all three now get a
  correct dark-mode preview header, not just this screen.
- **Editor/HTML-editor shell:** background and radius moved from raw
  `#ffffff`/`10px` to `var(--ink-2)`/`var(--radius-md)`.

## Closing the design-canvas gaps

- **Segmented pill tabs.** The Editor/HTML Code/Live Preview tab strip was
  AntD's default `type="card"` look; restyled to match the app's existing
  `.admin-tabs`/`.admin-tab` segmented-control pattern (tinted track, capsule
  active state, `tabPop` on activation). Scoped strictly to
  `.email-editor-card .email-editor-tabs` so the two modal consumers of the
  same `EmailEditorTabs` component keep their unchanged card tabs.
- **Subject row** changed from a floating bordered box to a full-bleed row
  with a bottom rule, matching the canvas — it now reads as part of the
  message header rather than a form field dropped onto the page.
- **The email-as-a-document-sheet** requirement in the canvas turned out to
  already be implemented — `brandedShell.js`/`emailPreview.js` already render
  the email as a centered 620px white sheet with a shadow, inside the iframe.
  The only real gap was the iframe *element's* own background (`#ffffff` /
  `#f1f5f9`) not matching the document's actual ground (`#f4f6f9`), which
  showed as a load flicker. Fixed as a literal-hex match, deliberately not
  tokenized (see below).

## Motion

Reused the app's existing keyframes and `--ease-out-quint` timing rather than
adding new ones: the email frame now rises in on load/template-switch
(`emailSheetIn`, ported from the canvas's `sheetIn`), the selected list row's
green rail grows in via a scaled pseudo-element instead of snapping a
border-color, and tab switches fade via the existing `fadeIn`/`tabPop`
keyframes. The local `prefers-reduced-motion` block was extended to cancel all
of the above, since the app's global guard zeroes durations but not
already-applied hover/state transforms.

## What was not touched — the email body itself

Nothing here can reach the rendered email. Both the Editor and the Preview
tab build a **complete `<!DOCTYPE html>` document** and hand it to an iframe
via `srcDoc`; CSS custom properties and `[data-theme]` do not cross that
boundary. The email's font (`Arial,Helvetica,sans-serif`), colors and 620px
sheet all come from literal values in `brandedShell.js` / `utils/emailPreview.js`,
unchanged. The two iframe-element backgrounds that *were* touched
(`#ffffff`/`#f1f5f9` → `#f4f6f9`) are deliberately literal hexes, not tokens —
tokenizing them would make the email flash a themed color on load and, in
dark mode, sit on a dark ground behind a white email.

---

## Live verification pass — four more bugs found and fixed

Dev credentials became available after the CSS pass above, and a full
Playwright pass against the running app (`msedge` headless, real login) both
confirmed the alignment fix and surfaced four defects the static/build-only
verification could not have caught. All are fixed and re-verified live.

- **Tab active-state didn't hug its label.** The segmented-pill tab restyle
  (§ "Closing the design-canvas gaps") lost outright to AntD's own card+small
  tab rule — not a source-order tie like the toolbar bug, a straight
  **specificity loss**: AntD wraps its generated class in `:where()`, which
  contributes zero specificity, but the rest of that selector
  (`.ant-tabs-card.ant-tabs-small > .ant-tabs-nav .ant-tabs-tab`) still carries
  **four** real class selectors against this override's three. Confirmed via
  `getComputedStyle` — AntD's `padding: 8px` and top-only `border-radius: 8px
  8px 0 0` were winning, so the active pill rendered 6px taller than its label
  with square corners instead of hugging it. Fixed the same way
  `.admin-tab.ant-btn` and `.ant-menu-horizontal .ant-menu-item` already do
  elsewhere in this file: `!important` on the contested properties.
- **Subject label weight/spacing didn't match the app.** `.email-subject-row__label`
  computed as Inter at the *correct* family/size, but `font-weight: 600;
  letter-spacing: 0.07em` — the design canvas's own values — read as lighter
  than the app's established uppercase-eyebrow-label idiom (MRF's toolbar
  "Records" label and others: `700`/`0.1em`). Changed to match the app
  convention rather than the canvas.
- **Subject row was not vertically centered in its available space.** The
  row's negative side-margins (making it full-bleed) never touched its *top*
  margin, so it still sat inside the Card body's default `padding-top: 24px`
  — roughly 32px of space above the label/text versus ~20px below.
  Confirmed by measuring `getBoundingClientRect()`: a 23px gap between the
  card-head divider and the row. Fixed with `.email-subject-row:first-child {
  margin-top: -24px }`, scoped to `:first-child` specifically so it backs off
  when a validation `Alert` renders above the row (confirmed the Alert case is
  provably unaffected by this selector, since the row is then no longer the
  first child).
- **Live Preview's branded header showed the wrong subject.** Unrelated to
  this pass's CSS — a pre-existing data-flow bug in
  `EmailManagement.jsx`. The mail-client chrome's "Subject:" line reads
  `dummyPreview.subject` (sample-substituted, e.g. "…Technical Round 1: John
  Doe"), but the actual green header band inside the branded shell is baked
  from `editorWrapper`, built with the **raw** `subject` state
  (`{{stage_label}}: {{candidate_name}}`) and reused for both the Editor tab
  and Live Preview. The two were never meant to show the same thing — Editor
  correctly needs the raw, editable subject in its header; Preview needs the
  compiled one — but they shared one wrapper. Fixed by adding a second,
  preview-only `previewWrapper` (built from `dummyPreview` instead of the raw
  state) and threading it through `EmailEditorTabs` as an optional prop that
  defaults to the existing `wrapper` when absent, so the other three callers
  of `EmailEditorTabs` (which have no sample-substitution concept at all) are
  unaffected. This touches code flagged as sensitive by iteration 3 above (the
  protected-chrome mechanism), so it was fixed and verified deliberately
  rather than folded in silently.
- **Animation gap.** `.email-html-editor` (CodeMirror's wrapper) never got the
  `emailSheetIn` rise-in that `.email-editor-iframe`/`.email-preview-iframe`
  had, so the HTML Code tab read as unanimated next to the other two. Added
  the same animation; confirmed via `element.getAnimations()` that all three
  panes now retrigger it — correctly, every time — on every tab switch, not
  just first mount.
- **Live Preview scrolled internally; Editor never did — same template, same
  content length.** `EmailPreviewPane.jsx`'s iframe carried `sandbox=""`,
  the maximally restrictive value: no `allow-scripts`, no
  `allow-same-origin`, which makes the framed document an **opaque origin**.
  That silently nulls `iframe.contentDocument` when read from the parent —
  confirmed live (`contentDocAccessible: false` before the fix) — so
  `handleLoad()`'s height measurement could never run, and the frame sat
  stuck at CSS's `min-height: 240px` with taller content spilling into the
  browser's own native iframe scrollbar. The Editor tab's iframe
  (`EmailBodyEditor.jsx`) carries **no** `sandbox` attribute at all, so its
  matching `autoSize()` logic could always measure and resize it — which is
  why only Preview showed the scrollbar. Changed to
  `sandbox="allow-same-origin"`: this restores `contentDocument` access for
  measurement but does **not** reopen script execution — that requires the
  separate `allow-scripts` token, which was not added, and the content is
  DOMPurify-sanitized before it ever reaches `srcDoc` regardless. Confirmed
  live: `contentDocAccessible: true`, the frame measures and sets its own
  height to match `scrollHeight` exactly (both `711px` on the template
  tested), `hasInternalOverflow: false`, and a full-page screenshot shows the
  complete email — header through footer — with no inner scrollbar.

**A data-integrity incident during this pass, disclosed for the record:** one
verification step cleared the "Application On Hold" template's subject and
clicked Save to check the validation-`Alert` layout, expecting
`validateTemplate()` to fail client-side before any network call. It did not
fail (that subject has no required placeholders to violate), so the save
actually went through — the live template's subject was briefly overwritten
to "No placeholders here at all". Caught within the same session via a direct
API read, confirmed via `modified_at`, and restored via an authenticated
`PUT` back to the original subject ("Application on Hold - AAPNA Infotech")
with the body untouched. Confirmed restored by a subsequent read. No other
template was touched by any verification step in this pass — every other
check was read-only (`getBoundingClientRect`, `getComputedStyle`,
`getAnimations`, screenshots).

## Verification performed

- Frontend production build passes (`npm run build`, no errors/warnings beyond
  the pre-existing chunk-size notice) — re-run after every fix in this file.
- Both themes' color/typography tokens referenced by the new CSS (`--red`,
  `--green`, `--warn-text`, `--ink-2/3`, `--radius-sm/md/pill`) confirmed
  present in both the light and dark `:root` blocks.
- **Live, in-browser** (Playwright + msedge, authenticated): toolbar
  alignment confirmed by measurement (search/select/save all compute to
  `40px`, sharing top and bottom edges); both themes screenshotted with a
  template open, no white-on-dark chrome anywhere including the previously-
  unthemed preview header bar; the branded email itself (font, header colour,
  620px sheet) confirmed pixel-identical between light and dark, and
  unaffected by any change here; the four defects above found and re-verified
  fixed by direct measurement/computed-style, not just visual impression.

## Outstanding

- **The other two `EmailEditorTabs`/`EmailPreviewPane` consumers** (Candidate
  Screening's decision modal, the Pipeline drawer's outcome/interview modals)
  were **not** driven live — deliberately, since exercising them meaningfully
  risks side effects (sending a real email, changing a candidate/pipeline
  status) that this session was not authorized for. They are safe by
  construction rather than by live check: every tab-restyle CSS rule is scoped
  under `.email-editor-card`, which only exists on `/email`, and the new
  `previewWrapper` prop defaults to the existing `wrapper` when a caller
  doesn't pass it, which none of those three do. Worth a live pass next time
  someone is already in one of those flows for other reasons.
- The canvas's tab-strip-inside-the-card-head placement (next to the template
  name, rather than its own row) was not attempted — `activeTab` state lives
  inside `EmailEditorTabs`, so relocating it means lifting state or a
  `renderTabBar` prop. Left as optional follow-up.
