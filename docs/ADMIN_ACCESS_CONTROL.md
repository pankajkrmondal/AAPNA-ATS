# Admin Access Control & Multi-Tenancy

Consolidated reference for the role hierarchy, company (tenant) model, and access rules of the
Admin Portal — plus a record of the work done to introduce them. Complements
[ADMIN_PORTAL.md](./ADMIN_PORTAL.md) (which documents the original portal internals).

---

## 1. Context & goal

The app is being built toward an enterprise, multi-company SaaS:
**Super Admin → Company Admins → Recruiters / Vendors**, with only AAPNA live today.

This phase introduced the **foundation** for that:
- a **Company (tenant)** entity, and
- a **company-aware role hierarchy + admin portal**.

Scope decisions (agreed):
- **Foundation first, data later** — users/roles/admin portal are company-aware now. Business data
  (`rpa_cv`, `rpa_mrf`, `rpa_shortlisted_candidates`, screening) is **still global**; the schema is
  left ready to scope it later by adding `company_id`.
- **Fixed roles + module toggles** (no dynamic/custom-role tables).
- **One company per user** (`rpa_users.company_id`; Super Admin = `NULL` = global).

---

## 2. Roles & rules

Canonical roles and helpers live in [`backend/src/config/roles.js`](../backend/src/config/roles.js):
`ROLES`, `ROLE_RANK`, `ADMIN_ASSIGNABLE_ROLES`, `MODULES`, `isAdminTier`, `isSuperadmin`,
`normalizeRole`. Legacy `hr` is treated as recruiter-tier.

Hierarchy: `superadmin (global) > admin (one company) > recruiter / vendor (one company)`.

**Core rules**
1. **Super Admin is global** (`company_id = NULL`) and the only actor that crosses companies.
   **Multiple super admins are allowed**; only a super admin can create or promote one.
2. **Company Admins are hard-scoped to their own company.** They can manage that company's
   **admins, recruiters, and vendors** (create/edit/delete/(de)activate, set module permissions) and
   may assign the roles **admin / recruiter / vendor** — never **superadmin**.
3. **Company admins cannot see or touch** users of other companies, nor any super admin.
4. **Only a super admin** can manage **companies** and **reassign** a user's `company_id`.
5. **Email is globally unique** across the whole system (one person = one account). The duplicate
   check is therefore global and returns only a boolean.

### Capability matrix

| Capability | Super Admin | Company Admin | Recruiter | Vendor |
|---|---|---|---|---|
| Scope | Global (all companies) | One company | One company | One company |
| Manage companies (create/edit/(de)activate) | ✅ | ❌ | ❌ | ❌ |
| See users of **other** companies | ✅ | ❌ | ❌ | ❌ |
| See **super admin** accounts | ✅ | ❌ | ❌ | ❌ |
| Create/edit/delete/(de)activate users in **own** company | ✅ (any company) | ✅ (own only) | ❌ | ❌ |
| Roles they can assign | superadmin, admin, recruiter, vendor | admin, recruiter, vendor | — | — |
| Manage other **admins** in own company | ✅ | ✅ (same company) | ❌ | ❌ |
| Set per-user **module permissions** | ✅ | ✅ (own company) | ❌ | ❌ |
| Reassign a user's **company** | ✅ | ❌ | ❌ | ❌ |
| Access the **Admin Portal** | ✅ | ✅ | ❌ | ❌ |
| Use app modules (MRF, candidates, screening, …) | ✅ (bypass) | ✅ (bypass) | ⚙️ per module permission | ⚙️ per module permission (Dashboard + Vendor by default) |

Admin-tier (superadmin/admin) **bypass** module-permission checks. Recruiters/vendors are gated by
`rpa_module_permissions`; vendors additionally have their sidebar limited to Dashboard + Vendor.
Self-deactivate / self-delete is UI-blocked for everyone.

---

## 3. Where it's enforced

**Tenant context** — [`middleware/auth.js`](../backend/src/middleware/auth.js): `authenticate`
loads the user *with* their company, sets `req.company_id`, and rejects login if the user's company
is deactivated. JWT and `rpa_sessions` both carry `company_id`.

**Scoping per endpoint** ([`controllers/admin.controller.js`](../backend/src/controllers/admin.controller.js)):

| Endpoint | Isolation |
|---|---|
| `GET /admin/users/list` | superadmin → all (optional `?company_id=`); admin → own company only, superadmins excluded |
| `POST /admin/users/create` | admin forced to own company; may assign admin/recruiter/vendor; superadmin any role + company |
| `POST /admin/users/update` | hierarchy guard + `restrictToCompanyScope`; only superadmin reassigns role-to-superadmin / company |
| `POST /admin/users/delete` | hierarchy guard + `restrictToCompanyScope` |
| `POST /admin/users/toggle-status` | hierarchy guard + `restrictToCompanyScope` |
| `GET /admin/modules/get-access` | loads target + `restrictToCompanyScope` (no cross-tenant reads) |
| `POST /admin/modules/set-access` | hierarchy guard + `restrictToCompanyScope` |
| `GET /admin/users/check-email` | **global boolean** (email is globally unique) — only true/false, no data |
| `/admin/companies/*` | superadmin-only route ([`company.routes.js`](../backend/src/routes/company.routes.js)) |

`restrictToCompanyScope(requester, target)` (in `middleware/auth.js`): no-op for super admin;
otherwise throws 403 unless `requester.company_id === target.company_id`.

---

## 4. Data model

| Table | Change |
|---|---|
| `rpa_companies` (new) | `id`, `name`, `slug @unique`, `domain?`, `is_active`, `created_at` |
| `rpa_users` | `+ company_id Int?` (FK → `rpa_companies`, `onDelete: Restrict`, indexed). **NULL only for super admins.** |
| `rpa_sessions` | `+ company_id Int?` (denormalized tenant context) |

Schema: [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma).

### Migration SQL (run once per database)
This project applies schema via raw SQL (not `prisma migrate`); after running it, regenerate the
client (`npm run prisma:generate`) and restart. Idempotent — safe to re-run.

```sql
-- 1) Companies (tenants)
CREATE TABLE IF NOT EXISTS rpa_companies (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  slug       VARCHAR(100) NOT NULL,
  domain     VARCHAR(255),
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP(6) DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS rpa_companies_slug_key ON rpa_companies (slug);

-- 2) Tenant link on users + sessions (nullable: superadmin stays global / NULL)
ALTER TABLE rpa_users    ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE rpa_sessions ADD COLUMN IF NOT EXISTS company_id INTEGER;

-- 3) FK (a company with users cannot be hard-deleted)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'rpa_users_company_id_fkey') THEN
    ALTER TABLE rpa_users
      ADD CONSTRAINT rpa_users_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES rpa_companies (id)
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_rpa_users_company ON rpa_users (company_id);

-- 4) Seed default company + backfill existing users (superadmin stays NULL)
INSERT INTO rpa_companies (name, slug, domain, is_active)
SELECT 'AAPNA Infotech', 'aapna', 'aapnainfotech.com', TRUE
WHERE NOT EXISTS (SELECT 1 FROM rpa_companies WHERE slug = 'aapna');

UPDATE rpa_users
SET    company_id = (SELECT id FROM rpa_companies WHERE slug = 'aapna')
WHERE  company_id IS NULL
  AND  LOWER(COALESCE(role, '')) <> 'superadmin';
```

---

## 5. Operations / how-to

**Add a super admin** — log in as a super admin → Admin Portal → **Add User** → role **Super Admin**
(company auto-cleared/global). Or directly in SQL with a `salt:sha512(password+salt)` hash and
`company_id = NULL`.

**Add a company** — super admin → **Companies** tab → **Add Company** (name; slug auto-derived).

**Add a company admin / recruiter / vendor** — a super admin (pick the company) or that company's
admin (own company) → **Add User**.

**Deactivate a company** — Companies tab toggle; all its users' sessions are wiped → immediate logout.

**Deploy a change** — restart backend (`pm2 reload ats-<env>-backend`) and rebuild the frontend.

---

## 6. Work done (this phase)

**Backend** — new `config/roles.js`; `middleware/auth.js` (tenant context + `restrictToCompanyScope`);
`auth.service.js` (JWT/session/login carry `company_id`, return `company_name`);
`auth.controller.js` (`getCurrentUser` returns `company_name`); `admin.controller.js`
(company scoping on every handler, multiple-superadmin support, admin-manages-admins, scoped
`getModulesAccess`); new `company.controller.js` + `company.routes.js` (superadmin-only),
registered before `/admin` in `routes/index.js`.

**Frontend** — `adminService.js` (company CRUD + `?company_id` filter); `AdminDashboard.jsx`
(Companies tab, Company column, role-scoped dropdown, company selector, real error surfacing,
super-admin rows hidden from non-super admins); `MainLayout.jsx` (company badge);
`AuthContext.jsx` passes the company fields through.

**DB** — `rpa_companies` + `company_id` on `rpa_users`/`rpa_sessions`; AAPNA seeded, users backfilled.

---

## 7. Out of scope (deferred)

- Scoping **business data** (candidates / MRFs / CVs / screening) by `company_id` — the "data later" phase.
- **Dynamic / custom roles** & granular permission tables.
- **Multiple companies per user**.
- Fixing the latent **refresh-token** issues (see [ADMIN_PORTAL.md](./ADMIN_PORTAL.md) §5).
