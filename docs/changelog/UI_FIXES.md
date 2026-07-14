# UI Fixes Log

A running log of user-interface fixes applied to the AAPNA ATS frontend.
Each entry records what changed, where, and any safeguards taken so that
existing processes are not broken. Newest entries first.

---

## 2026-06-29 — Sidebar↔page name alignment, Admin Portal icon, profile menu

**File:** `frontend/src/layouts/MainLayout.jsx` (route `key`s untouched
throughout — labels/icons only, so routing/guards/module gating are unaffected).

**Sidebar now mirrors each page's own heading.** Page titles are the source of
truth; `MENU_ITEMS` and the top-bar `BREADCRUMB_MAP` were set to match them:

| Route key | Label (= page heading) |
|---|---|
| `/candidates` | Search Candidate |
| `/hr-upload` | HR Manual Upload |
| `/mrf` | MRF |
| `/vendor` | Vendor Manual Upload (staff view) |
| `/filtering` | Candidate Screening |
| `/analytics` | Recruitment Screening Analytics |
| `/email` | Email Template Management |

(Dashboard, Vendor Dashboard, Reminder Settings already matched. Vendor-role
users keep their own "Upload Candidate" title logic.) This supersedes the
earlier invented labels (Resume Upload / Requisitions (MRF) / Vendors).

**Sidebar overflow:** three full names overflowed the 248px rail, so the
**sidebar (`MENU_ITEMS`) labels only** were shortened — the page `<Title>`s and
the top-bar `BREADCRUMB_MAP` titles keep their full accurate names (the top bar
has room). So these three sidebar labels intentionally differ from their page
titles: `/vendor` "Vendor Upload" (page: Vendor Manual Upload), `/analytics`
"Analytics" (page: Recruitment Screening Analytics), `/email` "Email Templates"
(page: Email Template Management). All other labels fit and still match.

**Admin Portal icon:** replaced the crown with a **person + gear ("manage
accounts")** glyph. AntD ships no single person+gear icon, so it's composed as a
small `AdminPortalIcon` component (`UserOutlined` + a small absolutely-positioned
`SettingOutlined` badge, em-sized so it inherits color/size). Applied in both
spots — the Admin Portal button in the main top bar and the brand tile in the
admin top bar. (Earlier tried `CrownOutlined`, `ControlOutlined`, and
`SafetyCertificateOutlined`; user picked the person+gear style.)

**Profile dropdown:** reduced to **Logout** only; the "Reminder Settings" link
was removed (it lives in the sidebar). The vendor/non-vendor branch collapsed
since both now show only Logout.

**Admin Portal button styling:** replaced one-off inline styles with the shared
`.admin-top-btn` class (already used by the admin top bar's portal-switch
button) for a consistent border/radius/hover across both top bars.

**Verified:** `npm run build` compiles clean.

---

## 2026-06-29 — Sidebar/top-bar labels, icons & company badge

**File:** `frontend/src/layouts/MainLayout.jsx` (labels, icons, and the
top-bar company badge are all defined here).

**Navigation renames** (label strings only — every route `key` was left
unchanged, so routing/guards/module gating are unaffected). Both `MENU_ITEMS`
and the top-bar `BREADCRUMB_MAP` were updated together so the sidebar item and
the page title always match:

| Route key | Old label | New label |
|---|---|---|
| `/hr-upload` | HR Upload | Resume Upload |
| `/mrf` | MRF | Requisitions (MRF) |
| `/vendor` | Vendor | Vendors |

**Icon swaps** (more accurate metaphors; imports updated accordingly —
`TeamOutlined`→`SolutionOutlined`, `FundOutlined`→`AuditOutlined`,
`SettingOutlined`→`BellOutlined`, the latter removed since it was no longer used):

| Item | Old icon | New icon | Why |
|---|---|---|---|
| Candidates | `TeamOutlined` (group) | `SolutionOutlined` | Standard ATS "applicant" glyph |
| Vendor Dashboard | `FundOutlined` (chart) | `AuditOutlined` | Reviewing submissions, not analytics |
| Reminder Settings | `SettingOutlined` (gear) | `BellOutlined` | Page is reminders, not generic settings (also updated in the avatar dropdown item) |

**Company badge removed:** The top-bar `<Tag>` that showed "All Companies"
(superadmin) or the user's company name has been removed — not required in the
UI for now. The now-unused `Tag` import and `companyLabel` variable were
deleted; `isSuperadmin` is retained (still used by the admin top bar). The JSX
keeps a comment marker so it can be reinstated later.

**No functional impact:** Only display labels, icons, and one non-interactive
badge were touched. Verified with `npm run build` (compiles clean).

---

## 2026-06-29 — Rename "Settings" → "Reminder Settings"

**Issue:** The `/settings` route currently holds only the Reminder Settings
page (see `frontend/src/pages/Settings.jsx`, whose on-page title already reads
"Reminder Settings"). The app shell, however, labeled it generically as
"Settings" in several places. This was misleading because there is no general
settings page yet (one may be added in the future).

**Fix:** Renamed the user-facing label to "Reminder Settings" in three places,
all in `frontend/src/layouts/MainLayout.jsx`:

1. **Sidebar navigation item** (`MENU_ITEMS`) — `'Settings'` → `'Reminder Settings'`.
2. **Top-bar page title** (`BREADCRUMB_MAP`) — `settings: 'Settings'` → `settings: 'Reminder Settings'`.
3. **User avatar dropdown item** (`userMenuItems`) — `'Settings'` → `'Reminder Settings'`.

**No functional impact:** Only display label strings were changed. The route
key `/settings` and all navigation targets were left untouched, so routing,
the settings API calls, and the reminder-settings save flow behave exactly as
before. When/if a general Settings page is added later, these labels can be
revisited.
