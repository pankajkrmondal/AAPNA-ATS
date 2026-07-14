# V16 — Change Summary & Production Deployment Guide

Consolidated reference for everything changed in the V16 workspace, plus what is needed to run it on
the production server. Per-change detail lives in [CHANGELOG.md](./CHANGELOG.md) and the linked
`CHANGES-*.md` docs; this document is the one-stop overview.

Last updated: 2026-07-13

---

## Part 1 — What changed in V16

### 1. Login with username OR email + admin username control + self-service password change (2026-07-10)

Three account-management gaps closed:

**a) Login accepts username or email**
- `backend/src/services/auth.service.js` — new `findUserByLogin()` matches `username` OR `email`,
  case-insensitive; the login flow uses it. 401 message updated to "Invalid username/email or password."
- `frontend/src/pages/Login.jsx`, `AdminLogin.jsx` — field label/placeholder now "Username or Email"
  (the request field is still named `username`; no API change).
- Also fixed here: JWTs now carry a unique `jti` claim. Previously two logins by the same user within
  the same second produced identical tokens and crashed on the `rpa_sessions.token` unique constraint.

**b) Admin can set/edit usernames; username defaults to email**
- `frontend/src/pages/AdminDashboard.jsx` — the Add/Edit User modal has an optional **Username** field
  (create and edit). Left blank, the username defaults to the email address. The old random
  `firstname.lastname123` auto-generation was removed (Auto-Generate now produces only a password).
- `backend/src/controllers/admin.controller.js`:
  - `createUser` no longer requires `username`; falls back to the email.
  - `updateUser` now pre-checks username/email duplicates case-insensitively (excluding the user being
    edited) and returns a friendly `409 EMAIL_EXISTS` instead of a raw Prisma P2002 error.
  - Password hashing consolidated into a shared `hashPassword()` in `auth.service.js`
    (same `salt:sha512` format as before — existing stored hashes unaffected).

**c) Self-service password change for every role (recruiter/vendor included)**
- New endpoint `POST /api/auth/change-password` (authenticated, all roles; validates current password,
  new password min 8 / max 128 chars). On success it deletes all the user's **other** sessions; the
  session that made the change stays alive. No credential email is sent for self-chosen passwords
  (admin-driven resets still email the user).
- New `frontend/src/components/common/ChangePasswordModal.jsx`, opened from the avatar dropdown in
  `MainLayout.jsx` (recruitment portal) and from the user chip in the admin top bar.

**d) Forgot password — emailed time-limited reset link (2026-07-13)**
- "Forgot password?" link on both login pages → `/forgot-password` (enter username or email; always
  the same generic response, so account existence is never revealed; 5 requests/15 min/IP) → branded
  email with a reset link → `/reset-password` page → new password → **all** sessions signed out.
- Tokens are stateless single-use JWTs (30-min expiry, fingerprint of the current password hash —
  no reset-token table, so no schema change). The reset email is a `NEVER_REDIRECT` flow: it reaches
  the real account owner even in staging. In non-production the reset URL is also written to the
  backend log for testing.

No schema changes, no new dependencies, no new env vars. Verified end-to-end (37 API tests + 19
browser tests across both change sets) against a live backend.

Known limitation (deliberate scope cut): the email field is still read-only when editing an existing
user.

### 2. Light/Dark/System theme + dark-mode contrast sweep (2026-07-10)

- Proper three-mode theme system (`localStorage['ats_theme']`, default Light), anti-FOUC script in
  `index.html`, animated sun/moon `ThemeToggle` in both headers, Appearance card in Settings,
  circular-reveal switch animation (`src/utils/themeTransition.js`).
- `darkTheme` uses AntD's `darkAlgorithm` **plus** explicit token overrides (both are required).
- Public token-link routes (`/mrf-submit`, `/mrf/:id/approve`, `/missing-jd-upload`) are pinned
  always-light via the `ForceLight` wrapper in `App.jsx` — wrap any new public route the same way.
- Contrast sweep tokenized ~200 hardcoded hexes across all pages. Rule for new code: use `var(--…)`
  theme tokens, never raw hexes. Full detail: `frontend/UI-CHANGELOG.md`.

### 3. Rate-limit 429 fix (2026-07-10)

- Global limiter raised to 2000 req/15 min per IP (was 100 — a single SPA user exhausted it); new
  strict auth limiter on `/api/auth` counts **failed attempts only** (20/15 min).
- `TRUST_PROXY=true` in staging/production env files so limits key on the real client IP behind the
  reverse proxy. Limits tunable via `RATE_LIMIT_*` env vars.
  Detail: [CHANGES-rate-limit-429-fix.md](./CHANGES-rate-limit-429-fix.md).

### 4. Superadmin/Admin permission tightening + credential email routing (2026-07-03)

- Strict role hierarchy (`outranks()` in `config/roles.js`): admins may edit/reset only themselves and
  strictly lower roles (never co-admins); Delete User is superadmin-only; self-deactivation and
  self-role-change blocked server-side; a superadmin's password can only be changed by its owner.
- Credential/password emails are on the `NEVER_REDIRECT` list — they always reach the affected user's
  real inbox, even in staging. Rules reference: [ROLE_RULES.md](./ROLE_RULES.md),
  [ADMIN_ACCESS_CONTROL.md](./ADMIN_ACCESS_CONTROL.md).

### 5. Candidate Screening enhancements (2026-06-30)

- **JD Skill Match**: each JD skill cross-referenced against resume signals + declared skills, shown
  on cards (compact meter, present-only chips) and in the drawer (full present/missing breakdown);
  keyword tab shows "Searched Skills" the same way. Display-only — scoring unchanged.
- **Roles preload + Refresh**: React Query hooks cache roles/candidates across navigation
  (`useScreeningData.js`); app-load prefetch; Refresh button force-bypasses the Redis cache.
- **Client-side pagination** on both tabs (10/20/50 per page).
- **Premium card refresh**: score tier accent rail, gradient-ring avatar, decluttered summary bar.
  Feature doc: [screening.md](./screening.md).

---

## Part 2 — Running V16 on the production server

### Architecture recap

- **Backend**: Node.js (Express 5 + Prisma 6) + a BullMQ resume worker, both run under **PM2**
  (`ecosystem.config.cjs`; prod app names `ats-prod-backend`, `ats-prod-worker`), listening on
  port 5001 behind the reverse proxy that serves `https://ats.aapnainfotech.com`.
- **Frontend**: static Vite build (`npm run build:prod` → `dist/`) served by the web server; the
  bundle calls `${VITE_API_URL}/api`.
- **Dependencies**: PostgreSQL (remote, `recruitmentautomationdbProd`), Redis (localhost, required by
  the worker and screening cache), Microsoft Graph (mail + OneDrive), Gemini/OpenRouter/Cohere/Zeko APIs.
- Deploy directory: `/var/www/html/ats-platform-prod/backend` (per `ecosystem.config.cjs`).
- No DB migration tooling — the database is the source of truth (`prisma db pull` workflow). **None of
  the V16 changes require schema changes**, so this is a code-only deploy.

### Backend deploy steps

```bash
# 1. Upload/pull the V16 backend code to /var/www/html/ats-platform-prod/backend
cd /var/www/html/ats-platform-prod/backend

# 2. Ensure .env.production exists and is verified (see checklist below)

# 3. Install deps + regenerate the Prisma client
npm ci
npm run prisma:generate

# 4. Check Redis is up
redis-cli ping   # must answer PONG

# 5. Start or zero-downtime reload under PM2
pm2 reload ats-prod-backend ats-prod-worker --update-env   # first time: pm2 start ecosystem.config.cjs --only ats-prod-backend,ats-prod-worker
pm2 save

# 6. Tail logs
pm2 logs ats-prod-backend
```

(One-time on a fresh server: `pm2 startup` so PM2 survives reboots. The staging equivalent of steps
2–5 is automated in `deploy-staging.sh` — it can be copied/adapted for prod.)

### Frontend deploy steps

```bash
cd frontend
cp .env.production.example .env.production    # VITE_API_URL=https://ats.aapnainfotech.com
npm ci
npm run build:prod
# upload dist/ to the web root for ats.aapnainfotech.com
```

The web server must (a) serve the SPA with a fallback to `index.html` for client-side routes, and
(b) proxy `/api` (and Socket.io) to the backend on port 5001.

### `.env.production` checklist — items flagged ⚠ in the file that MUST be resolved

| Item | Current state | Action before go-live |
|---|---|---|
| `EMAIL_REDIRECT_TO_TEST` | `true` (smoke-test safety switch) | Set `false` after the first-day production test so real candidates receive mail; restart. |
| `MS_DEFAULT_SENDER_EMAIL` | `recruitment@aapnainfotech.in` | Verify the mailbox exists in the tenant and is the intended prod sender. |
| `JWT_SECRET` | Same placeholder-ish value as staging | Generate a strong unique secret for prod. Note: rotating it logs everyone out (all JWTs invalid). |
| `DATABASE_URL` | Same host/creds as staging, prod DB name | Confirm prod is meant to share the staging Postgres host/credentials. |
| MS Graph (`MS_CLIENT_ID/SECRET/TENANT_ID`) | Staging Azure app | Confirm prod uses this app or swap in the production app registration; check client-secret expiry. |
| `MS_ONEDRIVE_PARENT_ID` | Filled | Verify it points at the **production** OneDrive folder, not staging's. |
| `ZEKO_SYNC_ENABLED` | `false` | Flip to `true` only after production Zeko credentials are validated (`ZEKO_CLIENT_ID` is already the prod id; `ZEKO_LOGIN_EMAIL` empty = defaults to sender mailbox). |
| `FRONTEND_URL` / `PUBLIC_BASE_URL` | `https://ats.aapnainfotech.com` | Confirm the final prod domain (used for CORS + links/tracking pixel in emails). |
| `TRUST_PROXY` | `true` | Correct — keep (rate limiting keys on real client IP behind the proxy). |

### Post-deploy smoke tests

1. `GET /api/health` responds.
2. Log in with a **username**, then with an **email address** (any letter case) — both must work.
3. Avatar dropdown → Change Password: wrong current password shows an inline error; a successful
   change keeps the current session alive, logs out other sessions, and the old password stops working.
4. Admin portal → Add User with the Username field left blank → user is created with username = email
   and can log in with the email immediately; a duplicate email/username shows the friendly inline
   409 error.
4b. Login page → "Forgot password?" → request a link (generic success either way) → the emailed link
   opens `/reset-password` → new password works, old sessions signed out, and reusing the same link
   shows "already been used". Note: `JWT_SECRET` signs reset tokens too — rotating it invalidates
   outstanding reset links along with sessions.
5. Admin edit-modal password reset still sends the credential email (check the redirect inbox while
   `EMAIL_REDIRECT_TO_TEST=true`).
6. Theme toggle works in both portals; the public MRF submit/approve links render light.
7. Resume upload → worker processes it (watch `pm2 logs ats-prod-worker`); screening Refresh returns
   candidates.

### Recommended hardening (not blockers, in priority order)

1. **Password hashing** is single-round SHA-512+salt (kept for compatibility with the legacy n8n data).
   Migrate to bcrypt/argon2 with a rehash-on-next-login strategy.
2. **Secrets hygiene**: `.env.production` (with DB password, Graph client secret, API keys) lives in
   the repo tree — move real secrets out of version control and rotate anything already committed.
3. The legacy **plaintext-password fallback** in `verifyPassword()` should be removed once all rows
   are confirmed hashed (`password_hash` containing `:`).
