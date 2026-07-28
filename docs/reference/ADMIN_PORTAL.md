# Admin Portal — Backend & Auth Documentation

A self-contained **HR Admin control panel** for managing user accounts and what each
user is allowed to do. It is two screens behind one role-gated area: **User Management**
and **Module Access**.

## Contents
- [1. Layers & key files](#1-layers--key-files)
- [2. Access & authentication](#2-access--authentication)
- [3. What happens when a user is created](#3-what-happens-when-a-user-is-created)
- [4. JWT — what it is and how it is created](#4-jwt--what-it-is-and-how-it-is-created)
- [5. Refresh token — intent vs. reality](#5-refresh-token--intent-vs-reality)
- [6. Database tables](#6-database-tables)
- [7. Workflows](#7-workflows)

---

## 1. Layers & key files

| Layer | File |
|---|---|
| Frontend pages | `frontend/src/pages/AdminDashboard.jsx`, `frontend/src/pages/AdminLogin.jsx` |
| Frontend API client | `frontend/src/services/adminService.js`, `frontend/src/services/authService.js`, `frontend/src/services/api.js` |
| Frontend auth state | `frontend/src/context/AuthContext.jsx`, route guards in `frontend/src/App.jsx` |
| Backend routes | `backend/src/routes/admin.routes.js`, `backend/src/routes/auth.routes.js` |
| Backend controllers | `backend/src/controllers/admin.controller.js`, `backend/src/controllers/auth.controller.js` |
| Backend services | `backend/src/services/auth.service.js`, `backend/src/services/emailNotification.service.js` |
| Middleware | `backend/src/middleware/auth.js` |
| Config | `backend/src/config/index.js` |
| Schema | `backend/prisma/schema.prisma` |

---

## 2. Access & authentication

Every admin endpoint sits behind `authenticate` + `restrictTo('admin','superadmin')`
(`admin.routes.js`). Access model:

- **Roles** (`superadmin` > `admin` > `recruiter`/`vendor`; legacy `hr` is recruiter-tier)
  decide *who can enter the portal*. Canonical role/module constants live in
  `backend/src/config/roles.js` (`ROLES`, `ROLE_RANK`, `MODULES`, `isAdminTier`, `isSuperadmin`).
- **Companies (tenants)** decide *whose users an admin can manage*. Every user (except the
  global `superadmin`) belongs to exactly one company via `rpa_users.company_id`. A company
  `admin` is hard-scoped to their own company; only `superadmin` acts across companies.
  **Multiple superadmins are allowed** (only a superadmin can create/promote one); company
  admins can neither see nor manage superadmin accounts.
- **Module permissions** (rows in `rpa_module_permissions`) decide *what a non-admin user can do* in the rest of the app.

### Multi-tenancy (companies)

- **Schema:** `rpa_companies` (tenant) + nullable `company_id` on `rpa_users` and `rpa_sessions`.
  `superadmin` has `company_id = NULL` (global). See
  `prisma/migrations/add_companies_multitenant.sql` and the backfill seed
  `prisma/seed-companies.js` (`npm run seed:companies:staging` / `:prod`).
- **Tenant context on every request:** `authenticate` loads the user *with* their company,
  sets `req.company_id`, and rejects logins whose company has been deactivated. The JWT and
  the `rpa_sessions` row both carry `company_id`.
- **Scoping enforcement (`admin.controller.js`):**
  - `listUsers` — superadmin sees all (optional `?company_id=` filter); admin sees only their
    own company's users and **never** superadmin (global) accounts.
  - `createUser` — admin is forced to their own company and may assign `admin`/`recruiter`/`vendor`
    within it (`ADMIN_ASSIGNABLE_ROLES`), but never `superadmin`; superadmin may assign any role and
    any company (required for non-superadmin roles).
  - `updateUser` / `deleteUser` / `toggleStatus` / `setModulesAccess` — guarded by
    `restrictToCompanyScope(requester, target)` (in `middleware/auth.js`) on top of the existing
    superadmin-protection check. Only superadmin may reassign a user's `company_id`.
- **Company management (superadmin only):** `company.controller.js` + `company.routes.js`,
  mounted at `/admin/companies` (registered **before** `/admin` in `routes/index.js` so the more
  specific prefix matches first). Endpoints: `list`, `create`, `update`, `toggle-status`.
  Deactivating a company wipes its users' sessions to lock them out immediately.
- **Frontend:** the Admin Portal shows a **Companies** tab and a per-user **Company** column to
  superadmins, a company selector in the create/edit user form (superadmin only), and a
  company badge in the top bar (`MainLayout` — "All Companies" for superadmin).

### Capability matrix

| Capability | Super Admin | Company Admin | Recruiter | Vendor |
|---|---|---|---|---|
| Scope | Global (all companies) | One company | One company | One company |
| Manage companies (create/edit/(de)activate) | ✅ | ❌ | ❌ | ❌ |
| See users of **other** companies | ✅ | ❌ | ❌ | ❌ |
| See **superadmin** accounts | ✅ | ❌ | ❌ | ❌ |
| Create/edit/delete/(de)activate users in **own** company | ✅ (any company) | ✅ (own only) | ❌ | ❌ |
| Roles they can assign | superadmin, admin, recruiter, vendor | admin, recruiter, vendor | — | — |
| Manage other **admins** in own company | ✅ | ✅ (same company) | ❌ | ❌ |
| Set per-user **module permissions** | ✅ | ✅ (own company) | ❌ | ❌ |
| Reassign a user's **company** | ✅ | ❌ | ❌ | ❌ |
| Access the **Admin Portal** | ✅ | ✅ | ❌ | ❌ |
| Use app modules (MRF, candidates, screening, …) | ✅ (bypass) | ✅ (bypass) | ⚙️ per module permission | ⚙️ per module permission (Dashboard + Vendor by default) |

Admin-tier (superadmin/admin) **bypass** module-permission checks. Recruiters and vendors are
gated by `rpa_module_permissions`; vendors additionally have their sidebar limited to Dashboard +
Vendor. Neither recruiters nor vendors can self-toggle/self-delete (UI-blocked).

**Login + gatekeeper** (`AuthContext.login(user, pass, isAdminPortal=true)`):
1. `POST /auth/login` → verify password, mint JWT + create session row.
2. `GET /admin/auth/verify` (`verifyToken`) → allowed if role is `admin`/`superadmin`,
   **or** the user has the `hr_admin` module permission enabled.
3. Not authorized → token discarded. Authorized → store token, go to `/admin/dashboard`.

**Route guarding:**
- Backend: `authenticate` verifies JWT signature + live session + active user; `restrictTo`/`checkModuleAccess` enforce role/module.
- Frontend: `AdminRoute` (role gate) and `ModuleRoute` (module-key gate) in `App.jsx` mirror the backend.

---

## 3. What happens when a user is created

Flow: `admin.controller.js → createUser` (after the route guard).

1. **Validate** required fields: `email`, `username`, `role`, `password` (else `400`).
2. **Duplicate check** — case-insensitive match on email *or* username → `409 EMAIL_EXISTS`.
3. **Role/company guard** — a company admin may only create `recruiter`/`vendor` in their own
   company; only a superadmin may create another `superadmin` (global, `company_id = NULL`).
   Multiple superadmins are permitted.
4. **Hash the password** (plaintext is never stored):
   ```js
   const salt = crypto.randomBytes(8).toString('hex');               // random per user
   const hash = crypto.createHash('sha512').update(password + salt).digest('hex');
   const password_hash = `${salt}:${hash}`;                          // stored as "salt:hash"
   ```
   Per-user salt defeats rainbow-table attacks; stored joined so verification can split it later.
5. **Insert** the row into `rpa_users`.
6. **Send credential email** (`sendCredentialEmail`) — **not awaited**, runs in the
   background; sends username + the plaintext password (its only moment in the clear) via
   MS Graph and writes an `rpa_email_log` row. In non-prod, mail is redirected to an
   internal test inbox.
7. **Respond** `201` with the user, `password_hash` stripped.

> The `username` is auto-generated on the frontend (`first.last###`) and sent in the payload,
> not typed by the admin.

---

## 4. JWT — what it is and how it is created

**JWT = JSON Web Token** — a signed, self-contained string proving "this request is from a
logged-in user," so the password isn't needed on every request. Three dot-separated parts:

```
header . payload . signature
```

- **Header** — algorithm + type.
- **Payload (claims)** — here `{ userId, username, role }` + auto-added expiry. **Base64-encoded, not encrypted** — readable by anyone; never put secrets in it.
- **Signature** — `HMAC-SHA256(header + payload, JWT_SECRET)`. Tampering breaks it unless you know `JWT_SECRET` (server-side, from env in `config/index.js`).

**Created during login** (`auth.service.js → login()`):
1. Find user by username (case-insensitive).
2. Reject if `is_active` is false (`403`).
3. **Verify password** (`verifyPassword`) — split stored `salt:hash`, recompute
   `sha512(input + salt)`, compare with `crypto.timingSafeEqual` (constant-time).
4. Generate tokens:
   ```js
   const token        = generateJWT(user);          // access token, expiresIn "24h"
   const refreshToken = generateRefreshToken(user);  // "7d"
   ```
5. **Persist a session** (`createSession`) — write a row to `rpa_sessions` with the token,
   user, role, and computed `expires_at`.
6. Return safe user (+ enabled `permissions`) and tokens. Frontend stores the access token
   in `localStorage` as `ats_token`.

**Used on every request** — client sends `Authorization: Bearer <token>`. The
`authenticate` middleware does four checks:
1. Extract token (header or `?token=`).
2. Verify signature + expiry (`jwt.verify`).
3. Confirm a matching, non-expired row exists in `rpa_sessions`.
4. Re-fetch user, confirm `is_active`, attach `req.user`.

> **Two-layer model (signature *and* DB session):** the app is intentionally not purely
> stateless. A valid signature alone is not enough — there must also be a live session row.
> This is what makes early revocation possible (logout, permission change).

**Lifecycle summary:** JWT created at login → stored in `rpa_sessions` → valid 24h →
deleted on logout / expiry / permission change → a new one is minted on the next login.

---

## 5. Refresh token — intent vs. reality

### Intended purpose (general pattern)
Short access tokens are good for security (small blast radius if stolen) but bad for UX
(frequent re-login). A longer-lived **refresh token (7d)** mints new access tokens without
re-entering credentials:

```
access token expires (24h)
   → app POSTs the refresh token to /auth/refresh-token
   → server verifies it (and type === 'refresh')
   → issues a new access token (+ session)
   → user stays signed in up to 7 days without a login screen
```

### Reality in this codebase — half-wired / effectively unused
1. **Never stored.** `createSession` accepts a `refreshToken` argument but only writes
   `token` to `rpa_sessions`. The refresh token lives only in the login response.
2. **Never triggered.** On a `401`, the axios interceptor (`api.js`) clears `localStorage`
   and redirects to `/login` — it does **not** attempt a refresh. So the live behavior is:
   token expires/deleted → user logs in again → fresh tokens.
3. **Broken wiring even if called:**
   - Frontend `authService.refreshToken()` POSTs `/auth/refresh`, but the backend route is
     `/auth/refresh-token` → **404**.
   - It sends **no body**, while the route requires `refreshToken` in the body → **400**.

### Security implication (latent, not active)
The "delete all sessions to force re-login" mechanism works because access tokens are
checked against `rpa_sessions`. A refresh token here is **stateless** (signature + expiry
only, no DB row). If the refresh endpoint were ever made live, a user whose sessions were
just wiped could replay a still-valid 7-day refresh token to mint a new access token +
session — **bypassing revocation**. To make refresh safe, refresh tokens would need to be
stored (or DB-checked) so revocation still holds.

---

## 6. Database tables

### `rpa_companies` — the tenant record
| Column | Type | Notes |
|---|---|---|
| `id` | `Int`, PK, auto-increment | Referenced as `company_id` on users/sessions |
| `name` | `String` | Display name (e.g. "AAPNA Infotech") |
| `slug` | `String`, **unique** | URL-safe id (e.g. `aapna`) |
| `domain` | `String?` | Optional email domain |
| `is_active` | `Boolean`, default `true` | Deactivating locks out all its users at login |
| `created_at` | `DateTime?`, default now | |

`onDelete: Restrict` from `rpa_users` — a company with users cannot be hard-deleted.

### `rpa_users` — the account record
| Column | Type | Notes |
|---|---|---|
| `id` | `Int`, PK, auto-increment | Referenced as `user_id` elsewhere |
| `username` | `String`, **unique** | Login id (auto-generated `first.last###`) |
| `password_hash` | `String` | `salt:sha512(password+salt)` — never plaintext |
| `role` | `String?`, default `recruiter` | `superadmin`/`admin`/`recruiter`/`vendor` |
| `company_id` | `Int?` | Tenant link; **NULL only for `superadmin`** (global) |
| `is_active` | `Boolean?`, default `true` | Activate/deactivate toggle; checked at login |
| `is_approved` | `Boolean?`, default `false` | Set `true` for admin-created users |
| `email` | `String?`, **unique** | Duplicate-checked; credential-email target |
| `first_name`, `last_name` | `String?` | Display name / initials |
| `created_at` | `DateTime?`, default now | "Created" column |
| `department` | `String?`, default `HR` | Present, unused by admin UI |

> `rpa_sessions` also carries a denormalized `company_id` (alongside `role`) for cheap tenant
> context without a join.

### `rpa_module_permissions` — the "Module Access" tab
| Column | Notes |
|---|---|
| `user_id` + `module_key` | **Composite PK** (`@@id([user_id, module_key])`) — enables `upsert` on `user_id_module_key` |
| `is_enabled` | `Boolean`, default `false` |
| `updated_at` | Last change |

`onDelete: Cascade` to `rpa_users` — deleting a user wipes their permission rows (no orphans).

### `rpa_sessions` — login state / revocation layer
| Column | Notes |
|---|---|
| `id` | PK |
| `token` | `String`, **unique** — the JWT |
| `user_id` | FK → `rpa_users` (`onDelete: NoAction`) |
| `role`, `created_at`, `expires_at` | Session metadata |

Not edited by the admin screens directly, but `setModulesAccess` deletes a user's session
rows to force re-login. `NoAction` (not cascade) means a hard-deleted user's session row is
not auto-removed — it just becomes unmatchable and expires.

### `rpa_email_log` — audit trail (side effect)
Every credential email writes a row: `email_type` = `user_created` or
`user_password_changed`, `reference_id` → the user's `id`. Loose link (no FK).

### Relationships
```
rpa_users (1) ──┬──< rpa_module_permissions   (CASCADE delete — wiped with user)
                ├──< rpa_sessions             (NoAction — cleared manually)
                └···· rpa_email_log           (loose link via reference_id, no FK)
```

The two tables truly owned by User Management are `rpa_users` (the account) and
`rpa_module_permissions` (what it can do). `rpa_sessions` is the live-login layer the portal
pokes to enforce changes; `rpa_email_log` is the paper trail.

---

## 7. Workflows

Every mutating workflow follows the same skeleton:
**find target → guard (hierarchy + company scope) → mutate DB → (optional) email or session-wipe → respond with sanitized data.**

Invariants enforced server-side: *non-superadmins cannot see/modify/delete/toggle a
superadmin*, and *company admins are hard-scoped to their own company*. Multiple superadmins
are allowed; only a superadmin can create or promote one.

### 1. Admin login & gatekeeper
`POST /auth/login` (mint JWT + session) → `GET /admin/auth/verify` (`verifyToken`: admin role
or `hr_admin` permission). Fail → discard token; pass → enter portal.

### 2. Create user — `POST /admin/users/create`
`checkEmail` pre-flight → validate → duplicate guard → role/company guard (admins limited to
`recruiter`/`vendor` in their own company; superadmin assigns any role + company) → hash
password → `INSERT rpa_users` → `sendCredentialEmail()` (background) → `201`.

### 3. Update user — `POST /admin/users/update`
Find user → hierarchy guard (non-superadmins can't touch a superadmin) → company-scope guard →
re-hash password **only** if a new one is supplied → `UPDATE rpa_users` → credential email
**only** on password change. Only a superadmin may reassign `role`/`company_id`.

### 4. Delete user — `POST /admin/users/delete`
Find user → hierarchy guard → `DELETE rpa_users` → `rpa_module_permissions` cascade-deletes.
Permanent; self-delete blocked in UI.

### 5. Toggle active status — `POST /admin/users/toggle-status`
Find user → hierarchy guard → `UPDATE rpa_users.is_active`. Deactivated users are rejected at
the next `authenticate`/login. Self-toggle blocked in UI.

### 6. Module permission grant/revoke — `POST /admin/modules/set-access`
Verify target exists → hierarchy guard → `UPSERT rpa_module_permissions` →
**`DELETE` all `rpa_sessions` for that user** (forces re-login so the change takes effect
immediately, not after 24h). Read side: `getModulesAccess` (`GET /admin/modules/get-access`).

### 7. List / search / stats — `GET /admin/users/list`
Returns all users (hashes stripped). Search box, role/status filters, and the
Total/Active/Inactive cards are all **client-side** (`useMemo` in `AdminDashboard.jsx`).

### Supporting background workflow
`jobs/sessionCleanup.js` runs `cleanupExpiredSessions()` on a cron, deleting expired
`rpa_sessions` rows. Not admin-triggered, but maintains the table the permission workflow
manipulates.
