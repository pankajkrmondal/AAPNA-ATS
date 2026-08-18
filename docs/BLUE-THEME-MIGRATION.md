# Blue Theme Migration — Olive/Green ➜ mera.work Blue

**Date:** 2026-08-17
**Branch:** `pankaj-work-staging-NewColor-v9`
**Scope:** Frontend only. **No database change is required.**
**Status:** ✅ Applied and verified (`npm run build` clean; dev server on
`localhost:5173` serving blue tokens, zero olive remaining).

---

## 1. Why no database change

The brand palette lives entirely in the frontend:

- `frontend/src/theme/brands.js` — brand token registry (`--brand-*`)
- `frontend/src/theme/index.css` — CSS custom properties, aliased onto legacy names
- `frontend/src/theme/themeConfig.js` — Ant Design 5 token overrides
- Hardcoded hexes scattered across pages/components

`brands.js` documents a *future* option to store per-company overrides in the existing
`rpa_settings` key/value table under `theme.company.<id>`. That path is **not used today**
— `resolveBrandId()` reads only `localStorage`. So changing the default brand needs zero
schema work and zero data migration.

> **Conclusion: no DB change needed, now or to ship this.**

---

## 2. Reference palette (extracted, not guessed)

Pulled from the live production bundle
`https://app.mera.work/assets/index-d04c04bb.css` (Bootstrap 5 custom properties):

| Token | Value |
|---|---|
> ### ⚠️ CORRECTION (applied 2026-08-17, after visual review)
>
> The table below reads `--bs-primary: #1b84ff` — and that is a real variable in the
> bundle — but **it is not the product's identity colour**. The rendered chrome of
> `app.mera.work` (sidebar, active nav, "Today's Data" panel) and the `demo.mera.work`
> header are **violet**. Metronic sets `--bs-primary` to a link/utility blue and paints
> the actual chrome from a separate violet ramp:
>
> | Role | Value |
> |---|---|
> | Primary (solid chrome, sidebar, nav) | **`#4f2fb8`** |
> | Hover / accent | `#6c62d2` |
> | Gradient partner (buttons, badges) | `#8b7bea` |
> | Tint bg | `#e7e3f7` (site uses `#f0eef9` / `#f7f6fc`) |
> | Dark-mode primary | `#a99cf0` |
>
> **The shipped theme uses the violet ramp above.** `#1b84ff` was retained only for the
> `colorInfo` / "signal" role, where a non-brand blue is needed to stay distinct from
> primary actions. Lesson: verify against the *rendered page*, not the variable name.

| `--bs-primary` (link/utility blue — NOT the chrome) | `#1b84ff` |
| `--bs-primary-rgb` | `27, 132, 255` |
| `--bs-link-hover-color` | `#056ee9` |
| `--bs-primary-bg-subtle` (light) | `#d1e6ff` |
| `--bs-primary-border-subtle` (light) | `#a4ceff` |
| `--bs-primary-text-emphasis` (light) | `#0b3566` |
| `--bs-primary-text-emphasis` (dark) | `#76b5ff` |
| `--bs-primary-bg-subtle` (dark) | `#051a33` |
| `--bs-link-color` (dark) | `#006ae6` |
| Body bg (light) | `#ffffff`, greys `#f9f9f9` / `#f1f1f4` |
| Body bg (dark) | `#15171c` |

### Note on karyakeeper.com

`app.karyakeeper.com` was checked too (`build/assets/theme-default-CLlwH_1N.css`). Its
primary is **`#7367f0` — a violet/indigo**, not blue (it is the stock Vuexy admin theme).
It was therefore **not** used as a colour source. Only the mera.work palette was adopted,
per decision on 2026-08-17.

---

## 3. Colour mapping

### 3a. Brand axis — these convert

| Old (olive) | New (violet) | Role |
|---|---|---|
| `#7a922e` | `#4f2fb8` | primary (light) |
| `#92a63c` | `#6c62d2` | primary hover (light) |
| `#5f7424` | `#3d2196` | primary active (light) |
| `#92a339` | `#6c62d2` | accent (light) |
| `#eef3da` | `#e7e3f7` | primary tint bg (light) |
| `#f7f6f3` | `#f8f7fc` | canvas (light) |
| `#fbfcf7` | `#fcfbfe` | canvas-deep (light) |
| `#a8c24a` | `#a99cf0` | primary (dark) |
| `#bcd566` | `#c4baf7` | primary hover (dark) |
| `#94ad3f` | `#8b7bea` | primary active (dark) |
| `#0a0e0c` | `#0d0b16` | canvas (dark) |
| `#121816` | `#161327` | surface (dark) |
| `#5a6e1f` | `#3d2196` | `--gold-dark` (light) |
| `#4a7c59` | `#4f2fb8` | `--green` brand companion* |
| `rgba(122,146,46,a)` | `rgba(79,47,184,a)` | all alpha tints (light) |
| `rgba(168,194,74,a)` | `rgba(169,156,240,a)` | all alpha tints (dark) |

\* `--green` is used as a *brand companion* (avatar gradients, `.cdc-avatar`,
`.cdc-tag-role`, screening focus rings) — not as a success signal. It converts.

### 3b. Semantic colours — these stay unchanged

Success/approval green is meaning-bearing and is **deliberately preserved**:

`#27ae60` (hired) · `#16a34a` · `#22c55e` · `#52c41a` · `#1e8449` · `#237804` ·
`#3f8600` · `#73d13d` · `#10b981` · `#166534` · `#dcfce7`

Also unchanged: `#c0392b`/`#e74c3c` (error), `#d4a017`/`#f6c000` (warning),
`#2980b9`/`#3498db` (info — see note below).

> **Info-vs-primary collision:** with a **violet** primary, an info state in violet
> would be indistinguishable from a primary action. `colorInfo` and the info banner
> (`--info-bg`/`--info-border`/`--info-text`/`--info-strong`) plus the "signal" chips
> are therefore set to **blue** (`#1b84ff` / `#056ee9`, dark `#4d9fff` / `#76b5ff`) —
> mera.work's own link/utility blue, which sits alongside its violet chrome for exactly
> this purpose.

---

## 4. Files changed

**Theme core (4):**
- `frontend/src/theme/brands.js` — `aapna` brand tokens ➜ blue; `midnight` test brand left as-is
- `frontend/src/theme/themeConfig.js` — AntD light + dark tokens
- `frontend/src/theme/index.css` — custom properties, gradients, aurora, scrollbars, selection, ~38 literal hexes
- `frontend/src/theme/aurora-glass.css` — ambient field tints

**Pages / components (~28)** carrying hardcoded brand hexes, chiefly:
`CandidatePipelinePrototype.jsx`, `CandidateScreening.jsx`, `MrfApprovalAction.jsx`,
`VendorPortal.jsx`, `VendorDashboard.jsx`, `Pipeline.jsx`, `Analytics.jsx`, `MRF.jsx`,
`MissingJdUpload.jsx`, `HRUpload.jsx`, `Candidates.jsx`, `CandidateDetail.jsx`,
`Dashboard.jsx`, `HiringTrendsCard.jsx`, `StatusBadge.jsx`, `StatCard.jsx`,
`Sparkline.jsx`, `DeliveryMonitoring.jsx`, `emailPreview.js`, `ThemeContext.jsx`, etc.

**Not changed:** any backend file, any Prisma schema/migration, any SQL.

**Actual result:** 41 frontend files modified across two passes —
pass 1 the brand ramp (39 files), pass 2 the green-cast *neutrals* (7 files:
canvases, borders, dark surfaces and the green-black shadow ink `rgba(16,24,20)`
➜ `rgba(15,23,36)`), which otherwise would have kept the UI feeling green even with a
blue primary.

### Verification performed

- `npm run build` — succeeds, 4099 modules, no new warnings.
- Repo-wide hue audit — **zero** hexes remaining in the olive band (hue 55–80);
  the only greens left are the semantic success set listed in §3b.
- Zero residual olive `rgba()` triplets.
- Dev server `http://localhost:5173/src/theme/index.css` confirmed serving
  `--brand-primary: #1b84ff` (light) / `#76b5ff` (dark).

> **Encoding caveat for future sweeps:** this codebase's comments contain em-dashes and
> `∈`. PowerShell 5.1's `Get-Content -Raw` decodes as the ANSI codepage and corrupts
> them. Any bulk rewrite must use
> `[IO.File]::ReadAllText($p, [Text.UTF8Encoding]::new($false))` and the matching
> `WriteAllText`. The scripts used here are in the session scratchpad.

---

## 5. Rollback

```bash
git checkout -- frontend/src
```

Or revert the single commit. Because the brand axis is centralised, a future flip back
to olive only needs the `aapna` block in `brands.js` restored.

---

## 6. Follow-ups (optional, not in this change)

1. **Email templates** — `utils/emailPreview.js` is covered, but any server-side email
   HTML in `backend/` with inline olive should be swept separately if branded mail matters.
2. **Logo / favicon** — bitmap assets in `frontend/public/` still carry olive if the mark
   is coloured; needs a design asset, not a code change.
3. **Server-driven themes** — if per-tenant colour is ever wanted, wire `rpa_settings`
   ➜ `BrandProvider overrides` as `brands.js` already describes. *That* would be the
   first change to touch the database.
