# Changelog

Reverse-chronological log of changes. One entry per change set, listing files touched and the what/why.
Feature-level detail lives in [docs/screening.md](./screening.md).

---

## 2026-07-13 — Friendly 429 messages with wait time
**Why:** Rate-limit responses said only "please try again later" — users had no idea how long to wait.

- `backend/src/utils/rateLimitHandler.js` (new) — `friendlyRateLimitHandler(whatHappened)` factory:
  computes the remaining wait from the limiter's per-client `resetTime` and responds
  `429 { status, message: "<what happened> Please try again in about X minutes." }`.
- `backend/src/app.js` — global + auth limiters use the handler ("You've made too many requests…" /
  "Too many failed sign-in attempts. For your security, sign-in is temporarily paused.").
- `backend/src/routes/auth.routes.js` — forgot-password limiter likewise ("Too many password reset
  requests."). No frontend change needed — pages already display the API's `message` field.

## 2026-07-13 — Forgot password (emailed time-limited reset link)
**Why:** A user who forgot their password had no self-service recovery — the only path was an admin
reset. Completes the account-management work from 2026-07-10.

- **Design:** stateless single-use reset tokens — a 30-minute JWT `{ userId, type: 'password-reset',
  fp }` signed with the existing `JWT_SECRET`, where `fp` fingerprints the CURRENT `password_hash`
  (sha256, first 16 hex). Resetting rotates the salt+hash, so the fingerprint stops matching and the
  token can't be replayed. No token table — deliberate, since the repo has no migration tooling.
  Reset tokens can't act as bearer tokens (`authenticate` also requires an `rpa_sessions` row).
- `backend/src/services/auth.service.js` — `generatePasswordResetToken`, `requestPasswordReset`
  (anti-enumeration: silent unless user exists + active + has email; fire-and-forget email; logs the
  reset URL in non-prod for dev testing), `resetPasswordWithToken` (expired/invalid/already-used all
  return distinct 400s — never 401, which the frontend interceptor hard-redirects on; deletes ALL
  sessions on success).
- `backend/src/services/emailNotification.service.js` — `sendPasswordResetEmail` (branded template,
  button + raw link, 30-min/single-use copy; logs `email_type: 'password_reset_request'`).
- `backend/src/config/emailRecipients.js` — new `passwordReset` flow, added to `NEVER_REDIRECT`
  (reset links always go to the account owner, even in staging).
- `backend/src/routes/auth.routes.js` + `auth.controller.js` — `POST /api/auth/forgot-password`
  (always generic 200; dedicated 5-per-15-min limiter counting ALL requests, since the global auth
  limiter only counts failures) and `POST /api/auth/reset-password` (newPassword min 8 max 128).
- `frontend/src/pages/ForgotPassword.jsx`, `ResetPassword.jsx` (new) — AuthLayout pages: generic
  success state; missing-token / expired / used-link states with "Request a new link"; confirm
  validator; success state pointing to Sign In.
- `frontend/src/layouts/AuthLayout.jsx` — pathname→heading map for the two new pages.
- `frontend/src/App.jsx` — routes under the `PublicRoute > AuthLayout` group. `Login.jsx` +
  `AdminLogin.jsx` — "Forgot password?" link under the submit button.
  `frontend/src/services/authService.js` — `forgotPassword()`, `resetPassword()`.
- No schema changes, no new env vars/dependencies. Verified end-to-end (17 API + 11 browser checks:
  anti-enumeration byte-identical responses, single-use replay rejection, all-session invalidation,
  429 rate limit, full UI journey incl. used-link state).

## 2026-07-10 — Login by email, admin username control, self-service password change
**Why:** Login accepted username only; the admin UI auto-generated usernames (`first.last123`) with no
way to set or change them; and non-admin roles (recruiter/vendor) had no way to change their own
password — the only password path was the admin portal. Overview + deploy notes in
[docs/V16-CHANGES-AND-DEPLOYMENT.md](./V16-CHANGES-AND-DEPLOYMENT.md).

- `backend/src/services/auth.service.js` — new `findUserByLogin()` (case-insensitive `username` OR
  `email`); `login()` uses it. New shared `hashPassword()` (same `salt:sha512` format). JWTs now carry
  a unique `jti` claim — fixes a race where two same-second logins produced identical tokens and
  violated the `rpa_sessions.token` unique constraint.
- `backend/src/controllers/auth.controller.js` + `routes/auth.routes.js` — new
  `POST /api/auth/change-password` (authenticated, **all roles**; current password verified; new
  password min 8/max 128). Deletes the user's other sessions; the current session survives. No
  credential email for self-chosen passwords (admin resets still email).
- `backend/src/controllers/admin.controller.js` — `createUser`: `username` now optional, defaults to
  the email; `updateUser`: case-insensitive email/username duplicate pre-check (excluding the edited
  user) returning the friendly `409 EMAIL_EXISTS` (was a raw Prisma P2002); both hash blocks replaced
  with the shared `hashPassword()`.
- `frontend/src/pages/AdminDashboard.jsx` — optional Username field in the Add/Edit User modal
  ("Defaults to the email address"); random username auto-gen removed (Auto-Generate = password only);
  username included in create/update payloads; 409 flags both email + username fields.
- `frontend/src/components/common/ChangePasswordModal.jsx` (new) — current/new/confirm form, inline
  error on wrong current password. Wired into the avatar dropdown (`MainLayout.jsx`) and the admin
  top-bar user chip.
- `frontend/src/pages/Login.jsx`, `AdminLogin.jsx` — labels now "Username or Email" (request field
  unchanged). `frontend/src/services/authService.js` — `changePassword()`.
- No schema changes, no new env vars or dependencies. Verified end-to-end (20 API + 8 browser tests).

## 2026-07-10 — Light/Dark/System theme + dark-mode contrast sweep (frontend)
**Why:** The app "randomly rendered black" — the old `ThemeContext` fell back to the OS
`prefers-color-scheme` when no stored theme existed and then persisted it, pinning OS-dark users to
dark with no rendered toggle to escape. After shipping a proper theme system, dark mode surfaced
contrast bugs (light-on-light / dark-on-dark text) across screens.

- `frontend/index.html` — anti-FOUC inline script: applies `data-theme`, `color-scheme`, and the
  `theme-color` meta before first paint. Default **Light**; OS honored only in System mode.
- `frontend/src/context/ThemeContext.jsx` — rewritten: three modes (`light`/`dark`/`system`) in
  `localStorage['ats_theme']`; OS listener only while in System mode; theme flips run through the
  transition helper.
- `frontend/src/utils/themeTransition.js` (new) — circular-reveal switch animation (View
  Transitions API) with cross-fade fallback and `prefers-reduced-motion` bypass.
- `frontend/src/components/common/ThemeToggle.jsx` (new) — animated sun↔moon toggle; wired into the
  main header + admin top bar (`MainLayout.jsx`); Appearance card added to `Settings.jsx`.
- `frontend/src/theme/themeConfig.js` — `darkTheme` now uses `algorithm: theme.darkAlgorithm`
  (fixes AntD-derived light status backgrounds: unreadable Alerts, Tag presets, disabled fills);
  dark component tokens refined (Modal/Drawer/Tooltip/links).
- `frontend/src/theme/index.css` — defined previously-missing vars (`--colorBgContainer` family,
  `--color-primary*`, `--text-secondary`, `--olive`, …); new semantic tokens (`--warn-*`,
  `--success-text`, `--info-strong`, `--overlay-scrim`); `:root, [data-theme='light']` selector
  enables scoped light re-theming; dark overrides for dropzone hover, CodeMirror shell, admin bar.
- `frontend/src/App.jsx` — `ForceLight` wrapper pins the public token-link routes (`/mrf-submit`,
  `/mrf/:id/approve`, `/missing-jd-upload`) always-light (external users have no toggle).
- Page sweep (~200 hardcoded hexes → theme vars, light mode visually unchanged):
  `Candidates.jsx`, `MRF.jsx`, `HRUpload.jsx`, `CandidateDetail.jsx`, `AdminDashboard.jsx`
  (Module Access switches/tiles/pills), `VendorPortal.jsx`, `VendorDashboard.jsx`,
  `CandidateScreening.jsx` (loading overlays), `EmailManagement.jsx` (CodeMirror dark theme),
  `Analytics.jsx`, `Dashboard.jsx`.
- Full detail: [frontend/UI-CHANGELOG.md](../frontend/UI-CHANGELOG.md) (2026-07-10 entries).

## 2026-07-10 — Fix frequent 429 "Too many requests from this IP" errors
**Why:** The global limiter allowed only 100 requests/15 min per IP over ALL of `/api` — a single SPA
user (let alone a whole office behind one NAT IP, or everyone behind the un-trusted reverse proxy)
exhausted it in minutes during normal use. Replaced with a two-tier scheme: generous global abuse
protection + strict brute-force limiting on login only. Full detail in
[docs/CHANGES-rate-limit-429-fix.md](./CHANGES-rate-limit-429-fix.md).

- `backend/src/app.js` — global limiter raised to 2000 req/15 min per IP (`/api/health` exempt); new
  auth limiter on `/api/auth` (20 per 15 min, **failed attempts only** via `skipSuccessfulRequests`);
  `app.set('trust proxy', 1)` when `TRUST_PROXY=true` so limits key on the real client IP.
- `backend/src/config/index.js` — limits env-configurable: `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`,
  `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_AUTH_WINDOW_MS`, `TRUST_PROXY` (defaults are the fix; no env
  change required).
- `backend/.env.staging`, `backend/.env.production` — `TRUST_PROXY=true` (both sit behind a reverse
  proxy); tuning vars documented. `.env.development` — commented docs only.
- `docs/BACKEND.md` — rate-limiter section rewritten for the two-tier scheme.
- Requires a restart of staging/production to take effect.

## 2026-07-03 — Superadmin/Admin permission tightening + credential email routing
**Why:** Any admin could delete users and edit/reset passwords of co-admins. New rules: Delete User is
superadmin-only; an admin may edit details/passwords of **self** and of **recruiters/vendors** only (not
co-admins); a superadmin may reset passwords of admins/recruiters/vendors. Credential/password emails must
reach the affected user's own inbox even in staging (not the test-recipient redirect).

- `backend/src/config/roles.js` — new `outranks(requesterRole, targetRole)` helper (strict `ROLE_RANK`
  comparison; equal ranks do NOT outrank each other).
- `backend/src/controllers/admin.controller.js`:
  - `updateUser` (details + password reset) — target must be **self or a strictly lower role**; a
    superadmin may additionally edit a peer superadmin's **details** (but a superadmin password can only
    be changed by its owner); own role changes rejected; `is_active` ignored on self-edits (lockout
    prevention).
  - `deleteUser` — superadmin-only; self-deletion blocked server-side (was UI-only).
  - `toggleStatus` — self-toggle blocked server-side; target must be a strictly lower role (admins can no
    longer deactivate co-admins).
- `backend/src/config/emailRecipients.js` — `userCredentialUpdate` added to `NEVER_REDIRECT`: credential /
  password-change emails always resolve to the target user's own email in every environment; all other
  flows still redirect to the staging test inbox.
- `frontend/src/pages/AdminDashboard.jsx` — mirrors the rank rule: Edit enabled for self + lower roles,
  Toggle for lower roles only, Delete for superadmins only, with explanatory tooltips; Role and Account
  Status fields disabled when editing your own account. Deactivate confirmation restyled as a warning
  (⚠️ title, amber consequence box, danger-styled "Deactivate" button); activation keeps the positive style.
- `docs/ADMIN_ACCESS_CONTROL.md` — rules, capability matrix, and endpoint table updated.
- `docs/ROLE_RULES.md` (new) — per-role can/cannot reference (Super Admin / Company Admin / Recruiter /
  Vendor) incl. universal rules and a quick-reference matrix.

## 2026-06-30 — Candidate card enterprise refinement (pass 2)
**Why:** Score block read too big; user wanted more enterprise polish but to keep the SKILLS tags multicolor.

- `frontend/src/theme/index.css` — shrank `.cand-score*` (smaller value/stars/verdict, tighter box); added a
  left fit-accent rail (`.cand-card::before` driven by `--cand-accent`) and a `.cand-divider` hairline.
- `frontend/src/pages/CandidateScreening.jsx` — `scoreTierColor(stars)` helper sets `--cand-accent` per card
  (green/gold/amber/neutral by star tier); `renderStars(count, size)` now takes a size (11px in the scorecard);
  added the divider between the identity and skills/match bands. `SkillTags` (SKILLS row) left unchanged.

## 2026-06-30 — Screening UI premium refresh
**Why:** The Candidate Screening page looked cluttered/flat — every card repeated all mandatory + good-to-have
skills (incl. grey "missing" tags) with weak hierarchy. Refine the existing olive/gold brand into a calmer,
premium look. Display-only.

- `frontend/src/theme/index.css` — added scoped screening classes (light + dark): `.cand-card`, `.cand-name`,
  `.cand-company`, `.cand-avatar-ring`, `.cand-score*`, `.match-meter*`, `.skill-chip*`, `.cand-section-label`,
  `.cand-signal-hint`.
- `frontend/src/pages/CandidateScreening.jsx`:
  - `JdSkillMatch` now takes a `variant` prop. `variant="card"` = compact **match meter + present-only chips**
    (no "missing" spam); `variant="full"` (default, drawer) keeps the complete present/missing breakdown.
  - Candidate card restructured: gradient-ring avatar, `.cand-name`, qualification folded into the meta-pill row,
    a single "Skills" row, the compact match meter, and an elegant right-side `.cand-score` scorecard.
  - Summary bar decluttered: primary count + muted detail; star buckets stay as stat chips.
- `docs/screening.md` — noted the card uses the compact meter; drawer keeps the full breakdown.

## 2026-06-30 — App-load roles preload + Refresh button
**Why:** Roles/candidates re-fetched on every page visit and were lost on navigation; no manual reload.

- `backend/src/services/screening.service.js` — `searchRoleCandidates(mrfId, force)` skips the Redis read when
  `force` is true (recompute + overwrite), so Refresh returns genuinely fresh candidates.
- `backend/src/controllers/screening.controller.js` — reads `?force=1` / body flag and passes it through.
- `frontend/src/services/screeningService.js` — `searchRoleCandidates(mrfId, { force })` → `?force=1`.
- `frontend/src/hooks/useScreeningData.js` (new) — React Query hooks `useApprovedRoles()` and
  `useRoleCandidates(roleId, enabled)` (`staleTime: Infinity`; cache persists across navigation).
- `frontend/src/App.jsx` — `AppShell` prefetches roles once at app load (gated on the `candidate_screening`
  module / admin).
- `frontend/src/pages/CandidateScreening.jsx` — roles + candidates sourced from the hooks; sync effect feeds the
  existing render state; `selectedRoleId` + `activeTab` persisted in `localStorage`; Refresh button (force-bypass
  cache) by the role selector and on the keyword tab; removed the cosmetic preloading bar.

## 2026-06-30 — Client-side pagination (both tabs)
**Why:** Result lists rendered all rows at once; hard to scan.

- `frontend/src/pages/CandidateScreening.jsx` — `currentPage`/`pageSize` state, sliced render, AntD `<Pagination>`
  (10/20/50), reset to page 1 on new search / tab switch. Select-All still spans the full result set.

## 2026-06-30 — Keyword-tab searched-skill signals
**Why:** Extend JD Skill Match to the Keyword Filtering tab so searched terms are cross-referenced too.

- `backend/src/services/screening.service.js` — `searchKeywordCandidates` attaches `jdSkillSignals`
  (searched keyword/designation as the matched skills) when a term is present.
- `frontend/src/pages/CandidateScreening.jsx` — `<JdSkillMatch>` gained a `label` prop; keyword mode shows
  "Searched Skills" / "Searched Skill Match".

## 2026-06-30 — JD Skill Match (JD Filtering tab)
**Why:** Cross-reference each JD skill against the candidate's resume signals + declared skills so recruiters see
which mandatory skills are actually evidenced. Display-only (scoring unchanged).

- `backend/src/services/screening.service.js` — `buildJdSkillSignals()` (+ helpers `splitSkillPhrases`,
  `parseDeclaredSkills`, `parseTechnicalTerms`, `skillMatchesTerm`); attaches `jdSkillSignals` per candidate in
  `searchRoleCandidates`.
- `frontend/src/pages/CandidateScreening.jsx` — `JD_SKILL_STATUS` map + `<JdSkillMatch>` component on card + drawer.
- `docs/screening.md` (new, consolidated) — feature documentation.
