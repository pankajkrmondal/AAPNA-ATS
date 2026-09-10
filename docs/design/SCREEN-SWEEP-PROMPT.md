# Screen sweep — the prompt

Paste the block below into a fresh session, filling in the screen name. It is written to be
self-contained: a session with no memory of the previous screens should be able to run it.

Started 2026-08-31. Method and findings so far:
[`CHANGES-2026-08-31-screen-design-sweep.md`](../changelog/CHANGES-2026-08-31-screen-design-sweep.md)
· [`CHANGES-2026-09-01-screen-design-sweep-mrf.md`](../changelog/CHANGES-2026-09-01-screen-design-sweep-mrf.md).

---

## The prompt

> We are running a screen-by-screen design sweep of the AAPNA-ATS frontend. **Today's screen
> is `<ROUTE>`.** Do this one screen only, end to end, then stop and report.
>
> ### The method — this is the point, don't skip it
>
> **Measure before you change anything.** Every defect found in this sweep so far was invisible
> to the automated suite — it was green for all eleven. Do not reason from the CSS about what
> the screen looks like: log in with Playwright, read computed styles and bounding boxes off
> the live page, and report numbers. Several "obvious" fixes in earlier screens turned out to
> be wrong when measured, and two rules I trusted turned out to be dead code matching nothing.
>
> **Report what you find before you fix it.** Give me the measured before/after for each
> defect. If something I reported turns out not to be a defect, say so with the measurement.
>
> **Ask before making a judgment call that changes the design**, not before routine fixes.
>
> ### What to check on the screen
>
> 1. **Type** — is every size an existing step on the ramp in `theme/tokens.css`, and is it
>    *derived* from a token rather than coinciding with one? Nothing below the 12px floor.
> 2. **Geometry** — radius against `--radius-ctl` / `--radius-card`, control heights against
>    `--control-h*`, spacing against `--space-*`. Symmetric padding unless asymmetry is meant.
> 3. **Glass** — which tier is each surface, and does it behave? Tiers 1 and 4 blur; 2 and 3
>    never do. Does every interactive surface have a material response, or is hover flat?
> 4. **Contrast** — compute real ratios against the actual painted background, including
>    **hover-only surfaces like tooltips**, which `contrast.mjs` does not cover.
> 5. **Composition** — one `PageHeader`, a real eyebrow and subtitle, no duplication between
>    chrome and page.
> 6. **Function** — does anything on the screen not work? Filters, empty states, the things a
>    design pass walks past. Three of the defects so far were functional, not visual.
>
> ### Laws you must not break
>
> Read Part I of `docs/design/AURORA-GLASS-ROLLOUT-PLAN.md` first. In particular:
>
> - **The inline-style law.** An inline `style={{…}}` cannot be overridden by any stylesheet.
>   Move it to a class byte-identically, or pass data-derived values as a CSS custom property.
>   Note this also arrives *from AntD* — it writes inline `padding-left` on menu items — in
>   which case fix it at the component prop, not with `!important`.
> - **Never write a raw hex in a component.** Per-tenant theming works by swapping the brand
>   layer; a hardcoded colour is invisible to it.
> - **Ramp steps only.** Never invent a size, weight, radius or spacing value.
> - **Shared-class couplings.** Before touching any shared class, find every other page using
>   it and check them too. `.auth-form-inner` covers four pages; `.dash-band` covers the whole
>   dashboard.
> - **A rule broad enough to set resting colour also hits the selected state** and will
>   silently erase a brand or status colour. Scope it.
> - **Light-mode chrome is opaque white on purpose.** Do not "fix" it back to glass.
> - **Nothing is deleted** — comment removals out with a dated reason, and make sure the
>   wrapper actually closes (a JSX comment that swallows its closing tags is the trap here).
>
> `DESIGN-LAB-PARITY-PLAN.md` contains **two disproved claims** — its "Gap 2 / outer page
> pane" and its hero-height finding. Ignore both; see the corrections in
> `docs/changelog/CHANGES-2026-08-31-design-lab-parity.md`.
>
> ### Verification — in this order, and read the warnings
>
> 1. Make sure the Vite dev server **and the backend on :5000** are up. A cold dev server
>    makes the whole suite red on a 2200ms timing gap — warm it and re-run before believing
>    any failure.
> 2. `npm run verify:design` **first**, capturing the full output to a file (not `tail`).
> 3. **Confirm it actually ran by counting PASS lines. Do not trust the exit code.** A pruned
>    playwright prints "playwright is not installed" and **exits 0 having run nothing**, which
>    reads as a fully green suite. `npm install --no-save playwright` if the PASS count is 0.
> 4. **Then** `npm run lint` (0 errors required) and `npx vite build`. Running these before
>    `verify:design` prunes playwright.
> 5. Measure and screenshot in **both light and dark**, and in every state the screen has
>    (collapsed/expanded, empty/populated, and any role variant).
>
> **Expected failures — do not chase these:**
> - `parity.mjs` `button radius` (lab 17.86px vs app 15px) and `button height` (38 vs 36px),
>   both on `/dashboard`. Pre-existing and unrelated; proved by reverting and re-running.
> - `composition.mjs` "renders exactly one page header" is **flaky under load** — the failing
>   route set moves between runs. Re-probe the route directly, polling for the header instead
>   of its fixed 3000ms wait, before believing it.
>
> Any *other* failure is yours.
>
> ### Logging — required, both tiers
>
> - An entry in `frontend/UI-CHANGELOG.md`, newest first. Include the measured before/after,
>   what the defect was, and **why nothing caught it**.
> - Append to `docs/changelog/CHANGES-2026-08-31-screen-design-sweep.md` (or start a new dated
>   write-up if the sweep rolls into a new month), and keep the summary in `docs/CHANGELOG.md`
>   in step.
> - Carry anything you deliberately did not do into "Still open" rather than dropping it.
>
> ### Report back
>
> What you measured, what you changed, what you deliberately left, and the verification
> standing — including any check you could not run and why. If you were wrong about something
> mid-way, say so plainly rather than quietly correcting it.

---

## Screens remaining

Tick as they go. Order is a suggestion — the densest files carry the most debt.

- [ ] `/candidates` — Search Candidate *(converted in the parity pilot, never eye-swept)*
- [ ] `/candidates/:id` — Candidate Detail *(nested; not in `composition.mjs`'s route list)*
- [x] `/filtering` — Candidate Screening — **tab strip + keyword fields done 2026-09-01**;
      the inline-style debt (88 inline, ~39 raw hex) is still untouched
- [ ] `/pipeline` — Candidate Pipeline *(board columns; status colours encode data — Failure B risk)*
- [x] `/mrf` — MRF *(2026-09-01: view mode, Segmented filter, modal overflow)*
- [ ] `/hr-upload` — HR Manual Upload
- [ ] `/vendor` — Vendor Upload
- [ ] `/vendor-dashboard` — Vendor Dashboard
- [ ] `/analytics` — Recruitment Analytics *(tab strip already converted 2026-09-01 with
      `/filtering`, which shared `.screening-tabs`; the rest of the screen is unswept)*
- [ ] `/settings` — Settings
- [ ] `/email` — Email Templates
- [ ] `/admin/dashboard` — **separate shell, still unaudited**; needs an admin login the
      verify account does not have

Done: the four auth pages · the left nav · the topbar/shell · `/dashboard` · the Inter + Sora
font pack (global) · `/mrf` · `/filtering`.

## Standing items the sweep has parked

These are not screen-specific and want their own change sets:

- The two `/dashboard` button parity rows — the oldest untouched finding.
- `composition.mjs`'s fixed 3000ms wait should become a poll.
- `contrast.mjs` does not cover hover-only surfaces.
- **The scans cannot see a pane they never open.** `type-floor.mjs` and `contrast.mjs` both
  measure only what is mounted on load, so every tabbed route hides content from them —
  `/filtering`'s keyword form hid 14 sub-floor elements this way. They should walk each
  `Segmented` option before measuring.
- The module-permission check exists in four places; extract a shared helper.
- Topbar hit boxes differ (bell 38 / toggle 36 / avatar 32).
- Stretched dashboard cards top-align their content (~338px dead space under Live Activity).
- Turnstile is on a testing-only site key on `/login`.
- **`FieldValue` (added 2026-09-01) should replace the hand-rolled read views on the
  remaining detail screens** — `/candidates/:id`, `/filtering`, `PipelineDrawer`. It is the
  read side of a field; view mode is not the disabled state.
- **No check asserts that a non-editing view uses read-only presentation.** `/mrf` shipped a
  1.84:1 detail modal against a green suite. `contrast.mjs` only measures what `/design-lab`
  renders, so a new text role must be added to the lab AND to its `TARGETS` to be covered.
