# Role Rules

One page per role: what each role can and cannot do, as currently enforced.
Enforcement lives server-side in [`admin.controller.js`](../../backend/src/controllers/admin.controller.js)
(guards built on `outranks` / `isSuperadmin` from [`config/roles.js`](../../backend/src/config/roles.js))
and is mirrored in the Admin Portal UI ([`AdminDashboard.jsx`](../../frontend/src/pages/AdminDashboard.jsx)).
See [ADMIN_ACCESS_CONTROL.md](./ADMIN_ACCESS_CONTROL.md) for the multi-tenancy model and endpoint map.

**Role hierarchy** (`ROLE_RANK`): `superadmin (40) > admin (30) > recruiter / hr (20) > vendor (10)`.
The general rule for acting on another user: **your own account, or an account of a strictly lower
rank**. Equal ranks cannot act on each other — with one deliberate exception for superadmins
(details/status of peer superadmins, never their passwords).

**Universal rules (every role, no exceptions)**
- Nobody can change their **own role**.
- Nobody can change their **own active status** (no self-deactivation).
- Nobody can **delete their own account**.
- Credential / password-change emails always go to the **affected user's own inbox**, in every
  environment (`userCredentialUpdate` is in `NEVER_REDIRECT` — see
  [`config/emailRecipients.js`](../../backend/src/config/emailRecipients.js)).

---

## 1. Super Admin (`superadmin`)

Global role — `company_id = NULL`, crosses all companies. Multiple superadmins are allowed.

**Can**
- Access the Admin Portal; see and manage users of **all companies**, including other superadmins.
- **Create** users of any role (including superadmin) in any company.
- **Delete** any user — the only role that can delete at all.
- **Edit details** of anyone: lower roles *and* peer superadmins (name, email, username, status, role).
- **Change passwords** of **admins, recruiters, and vendors** — and their own.
- **(De)activate** anyone except themselves (including peer superadmins).
- **Change roles** of anyone except themselves (only a superadmin may grant/revoke `superadmin`).
- Manage **companies** (create / edit / (de)activate) and **reassign a user's company**.
- Set per-user **module permissions**; bypasses all module checks themselves.

**Cannot**
- Change **another superadmin's password** (owner-only — prevents silent takeover of an
  equally-privileged account; a rogue peer can instead be deactivated/deleted, which is visible).
- Change their own role / status, or delete themselves (see universal rules).

---

## 2. Company Admin (`admin`)

Company-scoped role — hard-limited to their own `company_id` in every operation.

**Can**
- Access the Admin Portal for **their own company only**.
- **Create** users in their company with roles **admin / recruiter / vendor** (never superadmin).
- **Edit details & change passwords** of their company's **recruiters and vendors**, and of
  **themselves** (own name, email, password).
- **(De)activate** their company's **recruiters and vendors**.
- **Change roles** among admin / recruiter / vendor for users below them.
- Set **module permissions** for their company's recruiters/vendors; bypasses module checks themselves.

**Cannot**
- **Delete** any user (superadmin-only).
- **Edit, reset passwords of, or deactivate co-admins** — other admins are peers; only a superadmin
  manages them.
- See or touch **superadmin accounts** (hidden from their user list entirely).
- See or touch users of **other companies**.
- Grant the **superadmin** role, manage **companies**, or move a user between companies.
- Change their own role / status, or delete themselves.

---

## 3. Recruiter (`recruiter`, legacy `hr`)

Company-scoped working role. No user-management rights at all.

**Can**
- Log in and use the app modules **granted to them** in Module Access. Default grant on creation:
  every module except the Admin Portal — `new_mrf`, `search_candidates`, `hr_manual_upload`,
  `system_config`, `vendor_upload`, `candidate_screening`, `screening_analytics`, `vendor_dashboard`.

**Cannot**
- Access the **Admin Portal** (`hr_admin` module is never granted by default).
- Create, edit, delete, or (de)activate **any** user — including changing **their own**
  profile details or password (there is no self-service password change; an admin or superadmin
  resets it for them, and the new credentials are emailed to them).
- Use any module an admin has toggled off for them.

---

## 4. Vendor (`vendor`)

Company-scoped external role — the most restricted account type.

**Can**
- Log in and use only the **vendor-facing surfaces**. Default grant on creation:
  `vendor_dashboard`, `vendor_upload`. Sidebar is additionally limited to Dashboard + Vendor.

**Cannot**
- Access the Admin Portal or any recruiter module (MRF, screening, search, …) unless an admin
  explicitly grants it.
- Create, edit, delete, or (de)activate any user — including their own details/password
  (same as recruiters: resets are done by an admin and emailed to them).

---

## Quick reference

| Action | Superadmin | Admin | Recruiter | Vendor |
|---|---|---|---|---|
| Admin Portal | ✅ global | ✅ own company | ❌ | ❌ |
| Create users | any role, any company | admin/recruiter/vendor, own company | ❌ | ❌ |
| Delete users | ✅ (not self) | ❌ | ❌ | ❌ |
| Edit details — lower roles | ✅ | ✅ (recruiter/vendor) | ❌ | ❌ |
| Edit details — same rank | ✅ (peer superadmins) | ❌ (co-admins blocked) | ❌ | ❌ |
| Change password — self | ✅ | ✅ | ❌ (admin resets) | ❌ (admin resets) |
| Change password — others | admin, recruiter, vendor | recruiter, vendor | ❌ | ❌ |
| (De)activate users | anyone except self | recruiter/vendor only | ❌ | ❌ |
| Change own role / status, delete self | ❌ | ❌ | ❌ | ❌ |
| Manage companies / reassign company | ✅ | ❌ | ❌ | ❌ |
| Module permissions | set for anyone; bypasses checks | set for own company; bypasses checks | per grant | per grant (vendor surfaces) |
| **See a candidate's referral flag** | ✅ | ✅ | ✅ | ❌ |
| **Mark a candidate as a referral** | ✅ | ✅ | ✅ | ❌ |
| **Remove a referral** (reason required) | ✅ | ✅ | ❌ | ❌ |
| **Read the Referral Log** | ✅ | ✅ | ❌ | ❌ |

---

## Referral candidates — the one rule that is not about accounts

Every other row in this document is about what a logged-in role may do. The referral flag adds a rule about
somebody who **has no account at all**.

Sanghamitra Roy, 2026-08-28: *"the recruiter need to see that it is a referral candidate"* — and, in the same
breath — *"I don't want the interviewer to see… none of the interview process should know that it is a,
because then you can't be non-bias."*

An **interviewer is not a role in this system**. They are an email address plus a `uuid` token: a calendar
invite, an emailed scorecard link, sometimes a dossier, sometimes a recording link. So this rule cannot be
expressed as a permission — there is no subject to check. It is enforced **surface by surface**:

- **Visible** on the authenticated screens, to `superadmin` / `admin` / `recruiter` (rank ≥ 20, which is what
  `requireStaff` already means). `vendor` is excluded, and not automatically — candidate search returns nearly
  every `rpa_cv` column, so the referral columns are dropped from the *query* for vendor callers.
- **Never** on any public token surface: `/scorecard/:token` for **every** recipient role including `ceo`,
  `/documents/:token`, `/recording-share/:token`.
- **Never** in a candidate dossier, an interviewer email, or a Teams calendar invite.

Setting and removing are split on purpose: any recruiter may **set** a referral, but only admin-tier may
**remove** one, and only with a typed reason, which is recorded against their name in `rpa_referral_audit`.
Removing erases the referrer's name from the candidate, so it is the action worth constraining and logging
hardest.

Two rules no code can enforce, which recruiters have to be told:

1. **Never write the referral on the résumé file itself** — the dossier ships attachments byte for byte and the
   leak scan deliberately does not read them.
2. **Do not use `Job Source` for it** — that free-text field is rendered on Candidate Screening.

Full reasoning: [REFERRAL-CANDIDATE-PLAN.md](../REFERRAL-CANDIDATE-PLAN.md) §5.
