# HR Admin Recruiter role: impact inventory

| | |
|---|---|
| **Status** | **Built 22 Oct 2026** (uncommitted, branch `pankaj-work-staging-v24`). Unit 857/857; PW-Task R1 run 1 passed. Chhaya's role not yet moved (waits for deploy). |
| **Date** | 22 Oct 2026 |
| **Parent plan** | [MRF-Hold-and-Delegate-Approval-Plan.md §5A](MRF-Hold-and-Delegate-Approval-Plan.md) |
| **Test plan** | [PW-Task/R1-HR-Admin-Recruiter-role-regression.md](PW-Task/R1-HR-Admin-Recruiter-role-regression.md) |
| **Goal** | Add `hr_admin_recruiter` between Admin and Recruiter. Chhaya Verma moves to it and **loses nothing she can do today as a Recruiter**. |

People on staging/prod, for testing:

| Person | Role today | Role after |
|---|---|---|
| Harish Mopuri | Super Admin | Super Admin |
| Pankaj Kumar Mondal | Admin | Admin |
| Chhaya Verma | Recruiter | **HR Admin Recruiter** |

---

## 1. The rule

> **HR Admin Recruiter = Recruiter + the MRF extras.** It is **not** admin-tier.

- Everything a `recruiter` passes today, `hr_admin_recruiter` passes.
- Everything that is **admin-only today stays admin-only**: the Admin Portal, user management, pipeline stage config, creating email templates, removing a referral, the company profile, the approval-audit export, and IP/device in the approval trail.
- The only new rights are the three in the parent plan §5A: decide on behalf (absence window only), change a hold date / release a hold, and edit the hold rules.

How to make that hold everywhere:

1. **One list.** `RECRUITER_TIER_ROLES = ['superadmin','admin','hr_admin_recruiter','recruiter','hr']` in `backend/src/config/roles.js`, mirrored in a new `frontend/src/constants/roles.js`. Every hard-coded `['admin','superadmin','recruiter','hr']` list is replaced by it.
2. **Rank stays the backbone.** `ROLE_RANK.hr_admin_recruiter = 25`. The rank-based checks (`requireStaff`, `canViewRecordings`, `outranks`) then work with no edit.
3. **`isAdminTier` is not touched.** It stays admin + superadmin.

---

## 2. Backend: must change

Found by searching `backend/src` for `restrictTo(`, role lists, `emitToRole`, `isAdminTier`, `requireAdmin`, `requireStaff`, `ROLE_RANK` and `.role` (22 Oct 2026).

| # | File:line | Today | Change | What breaks for Chhaya if missed |
|---|---|---|---|---|
| B1 | [config/roles.js:12-36](../../../backend/src/config/roles.js#L12-L36) | 4 roles; `ADMIN_ASSIGNABLE_ROLES = [admin, recruiter, vendor]` | Add `HR_ADMIN_RECRUITER: 'hr_admin_recruiter'`, rank **25**, add it to `ADMIN_ASSIGNABLE_ROLES`, export `RECRUITER_TIER_ROLES`, `atLeast(role,min)`, `canDecideOnBehalf(role)`, `ROLE_LABELS` | An Admin can't assign the role (400) |
| B2 | [routes/mrf.routes.js:19](../../../backend/src/routes/mrf.routes.js#L19) `MRF_EXPORT_ROLES` | `admin, superadmin, recruiter, hr` | → `RECRUITER_TIER_ROLES` | MRF **Export CSV**, MRF detail export, **Approval trail**: 403 |
| B3 | [routes/mrf.routes.js:22](../../../backend/src/routes/mrf.routes.js#L22) `MRF_CLOSURE_ROLES` | same | → `RECRUITER_TIER_ROLES` | **Close / Reopen requisition**, **Re-send approval links**: 403 |
| B4 | [routes/emailTemplate.routes.js:12](../../../backend/src/routes/emailTemplate.routes.js#L12) `MONITORING_EXPORT_ROLES` | same | → `RECRUITER_TIER_ROLES` | Email monitoring export: 403 |
| B5 | [routes/vendor.routes.js:62](../../../backend/src/routes/vendor.routes.js#L62) | `vendor, admin, superadmin, recruiter` | add `hr_admin_recruiter` | Vendor upload route: 403 |
| B6 | [routes/vendor.routes.js:69](../../../backend/src/routes/vendor.routes.js#L69) | `admin, superadmin, recruiter` | add `hr_admin_recruiter` | Vendor staff route: 403 |
| B7 | [routes/vendor.routes.js:76](../../../backend/src/routes/vendor.routes.js#L76) (router-wide) | `vendor, admin, superadmin, recruiter, hr` | add `hr_admin_recruiter` | **Whole Vendor Dashboard / Vendor Upload API**: 403 |
| B8 | [routes/vendor.routes.js:101-103](../../../backend/src/routes/vendor.routes.js#L101-L103) | `admin, superadmin, recruiter, hr` | → `RECRUITER_TIER_ROLES` | Vendor review **search / merge / cancel**: 403 |
| B9 | [services/uploadJob.service.js:38](../../../backend/src/services/uploadJob.service.js#L38) `REVIEW_ROLES` | `recruiter, hr, admin, superadmin` | add `hr_admin_recruiter` | No live "review:new" push for duplicate-review uploads |
| B10 | [services/notification.service.js:29](../../../backend/src/services/notification.service.js#L29) `NOTIFY_ROLES` | same | add `hr_admin_recruiter` | **No notifications in the bell** (`resolveRecipients` queries users by these roles). Zeko `pipeline:updated` pushes (`zeko.service.js:1181`) also loop over this list. |
| B11 | [services/candidateFormOptions.service.js:71](../../../backend/src/services/candidateFormOptions.service.js#L71) | `role in ['recruiter','hr']` | add `hr_admin_recruiter` | **Chhaya disappears from the "Recruiter" dropdown** on the candidate forms |
| B12 | [services/assessmentImport.service.js:801](../../../backend/src/services/assessmentImport.service.js#L801) | `emitToRole('recruiter', 'assessment:import_done')` | `emitToRoles(['recruiter','hr_admin_recruiter'], …)` | No live "assessment import done" toast |
| B13 | [jobs/assessmentDeadlineChecker.js:104](../../../backend/src/jobs/assessmentDeadlineChecker.js#L104) | `emitToRole('recruiter', 'assessment:deadline_expired')` | same as B12 | No live "assessment deadline expired" toast |
| B14 | [socket/index.js:61, 137](../../../backend/src/socket/index.js#L61) | joins `role:<role>`; `emitToRole(role)` emits to one room | **Not needed (built 22 Oct).** A socket joins only its own role room, so B12/B13 loop `emitToRole` over `RECRUITER_ROOM_ROLES` (`recruiter`, `hr_admin_recruiter`): each user still gets the event exactly once, and the Redis bridge is untouched. | n/a |

**Socket note:** the socket's role comes from the login token, so after the role change Chhaya must **log out and in** to join `role:hr_admin_recruiter`.

## 3. Backend: no change needed (verified)

| Where | Why it already works |
|---|---|
| `requireStaff` ([middleware/auth.js:196](../../../backend/src/middleware/auth.js#L196)) on candidate, dashboard, hrUpload, pipeline and screening routes | Rank-based: 25 ≥ 20 |
| `canViewRecordings` ([interviewRecording.service.js:41](../../../backend/src/services/interviewRecording.service.js#L41)) | Rank-based |
| `outranks()` in admin.controller (who may edit whom) | Rank-based. Admin (30) can edit Chhaya (25); Chhaya has no Admin Portal access anyway |
| `checkModuleAccess` | Same as Recruiter: uses her per-user module toggles, which are keyed by user id and survive the role change |
| `vendorScope.js` | Only asks "is vendor?" |

## 4. Backend: stays admin-only on purpose (do **not** add the role)

| Where | What it guards |
|---|---|
| `routes/admin.routes.js:10` `restrictTo('admin','superadmin')`, `:39-42` superadmin | Admin Portal API, system logs |
| `routes/company.routes.js:10` | Companies (superadmin) |
| `routes/mrf.routes.js:85` | Approval-audit export (carries IP/device) |
| `mrf.controller.js:1139` `isAdminTier` | IP/device inside the approval trail |
| `requireAdmin`: `pipeline.routes.js:46-64`, `emailTemplate.routes.js:22`, `candidate.routes.js:145`, `settings.routes.js:42` | Stage/outcome/reason config, create template, remove referral, company profile |
| `settings.controller.js:454, 483, 503` | Admin / superadmin settings (flow keys etc.) |
| `vendor.controller.js:469`, `exports/uploadJobs.export.js:125` (`isAdmin`) | Admin-wide view; Chhaya keeps the recruiter view she has today |

---

## 5. Frontend: must change

| # | File:line | Today | Change | What breaks if missed |
|---|---|---|---|---|
| F1 | **new** `frontend/src/constants/roles.js` | n/a | `ROLE_RANK` (with 25), `RECRUITER_TIER_ROLES`, `ROLE_LABELS`, `isAdminTier`, `atLeast`, `canDecideOnBehalf` | Lists drift again |
| F2 | [layouts/MainLayout.jsx:145](../../../frontend/src/layouts/MainLayout.jsx#L145) `VENDOR_DASHBOARD_ROLES` | `admin, superadmin, recruiter` | → `RECRUITER_TIER_ROLES` | **"Vendor Dashboard" menu item disappears** |
| F3 | [layouts/MainLayout.jsx:250](../../../frontend/src/layouts/MainLayout.jsx#L250) role badge | shows the raw role string | `ROLE_LABELS[role]` | Badge reads `hr_admin_recruiter` |
| F4 | [pages/VendorDashboard.jsx:195](../../../frontend/src/pages/VendorDashboard.jsx#L195) `isStaff` | `admin, superadmin, recruiter` | → `RECRUITER_TIER_ROLES` | Vendor Dashboard shows the **vendor's** view, not the staff review view |
| F5 | [components/pipeline/PipelineDrawer.jsx:957](../../../frontend/src/components/pipeline/PipelineDrawer.jsx#L957) `canDownloadDossier` | `recruiter, hr, admin, superadmin` | → `RECRUITER_TIER_ROLES` | **"Download dossier" button hidden** in the pipeline drawer |
| F6 | [pages/AdminDashboard.jsx:144](../../../frontend/src/pages/AdminDashboard.jsx#L144) local `ROLE_RANK` | no entry | import from F1 | Edit/toggle buttons on her row computed wrongly |
| F7 | [pages/AdminDashboard.jsx:152-158](../../../frontend/src/pages/AdminDashboard.jsx#L152-L158) `roleOptions` | Company Admin / Recruiter / Vendor (+ Super Admin) | add **HR Admin Recruiter** | Role can't be picked |
| F8 | [pages/AdminDashboard.jsx:787-789](../../../frontend/src/pages/AdminDashboard.jsx#L787-L789) second role select (create form) | same | add **HR Admin Recruiter** | Same |
| F9 | `pages/AdminDashboard.jsx:257` role filter, `:902` role text | raw value | add the filter option; show `ROLE_LABELS` | Can't filter users by the role |

## 6. Frontend: no change needed (verified)

| Where | Why |
|---|---|
| `App.jsx:59-60` home path | Only checks vendor |
| `App.jsx:120, 150, 191, 306` | Admin Portal guard + admin bypass of module toggles: stays admin-only. Chhaya uses her module toggles as today |
| `pages/VendorPortal.jsx:76` | `!== 'vendor'`, so it already treats her as staff |
| `pages/Candidates.jsx:134-136`, `pages/Dashboard.jsx:117` | Module-toggle based, like a Recruiter |
| `Settings.jsx:40`, `MRF.jsx:211`, `EmailManagement.jsx:126`, `ReferralPanel.jsx:37`, `PipelineConfigPanel.jsx:61` | Admin-only UI, stays admin-only (section 4) |
| `AdminDashboard.jsx:162` `nonAdminUsers` | She stays in the Module Access tab, so her toggles stay editable |

---

## 7. Database and data

- `rpa_users.role` is `VARCHAR(50)` with **no CHECK constraint**, so **no DDL** is needed.
- The move is one change in **Admin Portal › Users › Chhaya Verma › Role**, on staging first (the change is then recorded as hers by whoever made it).
- Her module toggles (`rpa_module_permissions`) are kept, since they are keyed by user id.
- She must **log out and in** afterwards: the browser's cached user and the socket token carry the old role.
- Rollback: set the role back to `recruiter`. Nothing else stores the new value.

## 8. Automated tests

- **Unit** (`roles.test.js`, new or extended): rank order; `isAdminTier('hr_admin_recruiter') === false`; `atLeast`; `canDecideOnBehalf` true for hr_admin_recruiter/admin/superadmin and false for recruiter/hr/vendor; `RECRUITER_TIER_ROLES` contains every role in the old lists.
- **Integration** (`hrAdminRecruiterRole.test.js`, new): log in a tagged fixture user with `hr_admin_recruiter`, call **every route in §2** and expect the same status a recruiter gets. Call **every route in §4** and expect 403.
- **Guard test**: `grep` the source for `['admin', 'superadmin', 'recruiter'` patterns and fail if any remain outside `roles.js`, so a future list can't silently drop the role.
- **Browser**: [PW-Task/R1](PW-Task/R1-HR-Admin-Recruiter-role-regression.md) walks every module as Chhaya.

## 9. Order of work

1. B1 + F1 (role definition and the shared lists).
2. B2–B14, F2–F9.
3. Unit + integration tests green on staging.
4. Move Chhaya's role on staging; she logs out and in.
5. Run **PW-Task R1** in full. Fix, retest, and log every run.
6. Only then start the MRF Hold / on-behalf work (PW-Task H1–H6), which builds on this role.
