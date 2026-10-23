# R1: HR Admin Recruiter role regression (all modules)

## Test plan

**Scope.** Once `hr_admin_recruiter` exists ([HR-Admin-Recruiter-Role-Impact.md](../HR-Admin-Recruiter-Role-Impact.md)) and Chhaya Verma is moved to it, she must be able to do **everything she does today as a Recruiter**, in every module. Admin-only areas must stay closed to her. Each case names the code change it proves (B# / F# from the impact doc).

**Accounts** (credentials given in chat at test time):

| Account | Role | Used for |
|---|---|---|
| Harish Mopuri | Super Admin | R1-03 |
| Pankaj Kumar Mondal | Admin | Role assignment, second browser context for live events |
| Chhaya Verma | Recruiter → **HR Admin Recruiter** | Every case |
| A plain Recruiter test account | Recruiter | Control cases (R1-60 to R1-62) |

**Approach.**
1. **Baseline**, before the role change: as Chhaya (still Recruiter), record the sidebar, module toggles and each module's main actions (screenshots `R1-00-*`).
2. Change the role, then log Chhaya out and in.
3. Walk every module as Chhaya. Watch the **network panel**: any **403 on a page or action that worked in the baseline is a FAIL**, even if the page looks fine.
4. Run the admin-only negative sweep (R1-50 to R1-56).
5. Run the plain-Recruiter controls, to prove nothing widened for Recruiters.

**Safety.** Staging only. Write actions (re-send links, close/reopen) are run on `ZZ-TEST` MRFs only. Staging redirects outgoing mail to the test inbox. Do not merge or cancel real vendor reviews.

## Test cases

### A. Role assignment

| ID | Case | Steps | Expected | Proves |
|---|---|---|---|---|
| R1-00 | Baseline | As Chhaya (Recruiter): screenshot the sidebar, Admin Portal › Module Access row, and each module page | Baseline saved | n/a |
| R1-01 | Option offered to Admin | Pankaj › Admin Portal › Users › Edit Chhaya › Role dropdown; also Create user › Role dropdown | **HR Admin Recruiter** listed in both | F7, F8, B1 |
| R1-02 | Admin assigns it | Pankaj sets Chhaya → HR Admin Recruiter › Save | Saved without error; row shows "HR Admin Recruiter"; her module toggles unchanged | B1, F6, F9 |
| R1-03 | Super Admin sees it too | Harish › Edit user › Role dropdown | Option listed | F7 |
| R1-04 | Role filter | Admin Portal › Users › filter by HR Admin Recruiter | Only Chhaya listed | F9 |
| R1-05 | New session | Chhaya logs out and in | Header badge "HR Admin Recruiter"; lands on Dashboard | F3 |

### B. Navigation

| ID | Case | Steps | Expected | Proves |
|---|---|---|---|---|
| R1-10 | Same menu as before | Compare the sidebar with R1-00 | Identical, **including Vendor Dashboard** | F2 |
| R1-11 | No Admin Portal | Look for the "Admin Portal" button; open `/admin/dashboard` directly | Button hidden; URL redirects to Dashboard | §4 (unchanged) |

### C. Dashboard

| ID | Case | Steps | Expected | Proves |
|---|---|---|---|---|
| R1-15 | Dashboard loads | Open Dashboard; switch the MRF filter; open trends | All tiles, trends, upcoming interviews and MRF options load; no 403 | requireStaff (rank) |

### D. MRF

| ID | Case | Steps | Expected | Proves |
|---|---|---|---|---|
| R1-20 | List | Open MRF; use the All / Pending / Manager Submitted / Closed tabs | Rows load | n/a |
| R1-21 | Export CSV | Click **Export CSV** | File downloads; no 403 | B2 |
| R1-22 | Detail export | Open a record › **Export CSV** in the modal | File downloads | B2 |
| R1-23 | Approval trail | Open a submitted MRF | Trail loads **without IP or device** | B2, §4 |
| R1-24 | Re-send links | On a pending `ZZ-TEST` MRF › **Re-send approval links** | Success toast; the trail shows "re-sent" | B3 |
| R1-25 | Close / reopen | On an approved `ZZ-TEST` MRF › **Close requisition…** › reason › then Reopen | Both succeed | B3 |
| R1-26 | No approval-audit export | Look for the **Approval audit** button | Hidden (admin only) | §4 |

### E. Search Candidate

| ID | Case | Steps | Expected | Proves |
|---|---|---|---|---|
| R1-30 | Search and open | Search; open a fixture candidate | Loads | n/a |
| R1-31 | Edit and referral | Edit one field on a fixture candidate; view/set a referral | Saves | requireStaff |
| R1-32 | Remove referral stays admin-only | Look for the remove-referral action | Hidden / refused | §4 |

### F. HR Manual Upload / Vendor

| ID | Case | Steps | Expected | Proves |
|---|---|---|---|---|
| R1-35 | HR upload page | Open HR Manual Upload | Loads, as in the baseline | requireStaff |
| R1-36 | Recruiter dropdown | On the upload/candidate form, open the **Recruiter** dropdown | **Chhaya Verma is listed** | B11 |
| R1-37 | Vendor Upload (staff view) | Open Vendor Upload | Staff view, as in the baseline | B5, B6, B7 |
| R1-38 | Vendor Dashboard | Open Vendor Dashboard | **Staff review view** (not the vendor's own view); data loads | F4, B7 |
| R1-39 | Review search | Vendor Dashboard › duplicate review › search | Results load; Merge / Cancel buttons enabled (do not execute on real data) | B8 |

### G. Candidate Screening / Pipeline / Analytics / Email

| ID | Case | Steps | Expected | Proves |
|---|---|---|---|---|
| R1-40 | Screening | Open Candidate Screening; pick a JD role | Role dropdown and results load | requireStaff |
| R1-41 | Pipeline board | Open Candidate Pipeline | Board loads | requireStaff |
| R1-42 | Dossier download | Open a fixture journey drawer | **Download dossier** button visible and downloads | F5 |
| R1-43 | Recordings | In the drawer, open a recorded round (if any) | Recording link available | canViewRecordings (rank) |
| R1-44 | Analytics | Open Recruitment Analytics | Charts load | n/a |
| R1-45 | Email monitoring export | Email Templates › monitoring › Export | File downloads | B4 |
| R1-46 | Create template stays admin-only | Look for "Create template" | Hidden / 403 | §4 |
| R1-47 | Settings | Open Settings; change and save **Reminder Settings**, then restore them | Saves as before; Company Profile and Pipeline Config cards hidden | §4 |

### H. Live events (two browser contexts)

| ID | Case | Steps | Expected | Proves |
|---|---|---|---|---|
| R1-48 | Bell notification | Pankaj performs a pipeline action on a fixture journey that raises a notification; Chhaya watches the bell | The notification arrives for Chhaya | B10 |
| R1-49 | Live socket push | Trigger an assessment import (or any `recruiter`-room event) while Chhaya is on the page | Toast/refresh arrives **once** (not twice) | B12, B13, B14 |

### I. Admin-only stays closed (API sweep as Chhaya, from the browser console with her session)

| ID | Endpoint | Expected |
|---|---|---|
| R1-50 | `GET /api/admin/users/list` | 403 |
| R1-51 | `GET /api/mrf/approval-audit/export` | 403 |
| R1-52 | `POST /api/pipeline/stages` (empty body) | 403 (before validation) |
| R1-53 | `POST /api/email/templates` (empty body) | 403 |
| R1-54 | `DELETE /api/candidates/<fixture>/referral` | 403 |
| R1-55 | `POST /api/settings/company-profile` | 403 |
| R1-56 | `GET /api/mrf/<id>/approval-trail` | 200, and the events carry **no** `ip` / `user_agent` |

### J. Plain Recruiter controls (nothing widened)

| ID | Case | Expected |
|---|---|---|
| R1-60 | Plain Recruiter repeats R1-10 and R1-21 | Same as before the change |
| R1-61 | Plain Recruiter: Admin Portal › Users dropdown not reachable | Redirected, as before |
| R1-62 | Plain Recruiter repeats the R1-50 to R1-55 sweep | All 403, as before |

### K. Rollback check

| ID | Case | Expected |
|---|---|---|
| R1-70 | Pankaj sets Chhaya back to Recruiter (only if a blocking FAIL can't be fixed the same day); she logs out and in | Everything in R1-00 works again |

## Results log

### Run 1: 22 Oct 2026 (local code against the staging DB; backend restarted with the change)

**Accounts actually used.** Staging has no `admin`-role user. `pankaj` is **Super Admin**; `admin` ("Admin Supers", a test account) was **Recruiter**. Chhaya's account was **not** changed: the deployed staging server still runs the old code, and moving her there now would lock her out of MRF export and the vendor screens until this code is deployed. The `admin` test account stood in for her: baseline as Recruiter, then switched to HR Admin Recruiter. **It stays HR Admin Recruiter** for the Hold / on-behalf testing (H1–H6).

**Method.** The same API sweep was run in both roles from the logged-in browser: 16 recruiter gates and 6 admin-only routes. Close / reopen / re-send links were probed with id `x`, which gives 400 if the role passes and 403 if not, so no data changed. Then each page was walked, checking every `/api/` call for status ≥ 400 (`performance` resource timing).

**Code-level checks first.** `roles.test.js` 13/13 (includes the source guard, which finds no hand-written staff role list without the new role). Full unit suite **857/857**. Frontend `vite build` OK.

| ID | Result | Notes |
|---|---|---|
| R1-00 | PASS | Baseline as Recruiter: 11 menu items; gates: MRF export 200, detail export 200, trail 200 (no IP), close/reopen/reissue 400, email monitoring export 200, vendor dashboard/list/jobs/review-search 200, mrf-options 200, notifications 200, recruiter names 200 (self listed), reminder settings 200, pipeline stages **403** (account lacks the Pipeline module). Admin-only: all 6 = 403 |
| R1-01 | PASS | Edit-user role dropdown (Super Admin) lists **HR Admin Recruiter** (between Company Admin and Recruiter) |
| R1-02 | PASS | Saved; row shows the **HR ADMIN RECRUITER** badge; API role `hr_admin_recruiter`; module toggles unchanged. `screenshots/R1-02-role-assigned.png`. Note: the browser auto-filled "New Password" in the edit form; cleared before saving so only the role changed |
| R1-03 | PASS | Same as R1-01 (pankaj is the Super Admin) |
| R1-04 | PASS | Role filter "HR Admin Recruiter" shows only this account |
| R1-05 | PASS | Re-login: `ats_user.role = hr_admin_recruiter`. The main app has no role badge for non-admins, so nothing to show |
| R1-10 | PASS | Menu identical to baseline (11 items, Vendor Dashboard present) |
| R1-11 | PASS | `/admin/dashboard` → redirected to `/dashboard`; no Admin Portal button |
| R1-15 | PASS | Dashboard: 16 API calls, none failed |
| R1-20 | PASS | MRF list loads; no failed calls |
| R1-21/22 | PASS | Export and detail export 200 (API sweep); Export CSV button present |
| R1-23 | PASS | Trail 200 with `ip` absent; modal "Approval trail" renders |
| R1-24/25 | PASS | Modal shows **Close requisition…** and **Re-send approval links**; gates pass (400 on id `x`). `screenshots/R1-24-mrf-modal-actions.png` |
| R1-26 | PASS | "Approval audit" button not shown; API 403 |
| R1-30/31 | PASS | Search Candidate: 25 rows, no failed calls |
| R1-32 | PASS | Remove referral API 403 |
| R1-35 | PASS | HR Manual Upload: 8 calls, none failed |
| R1-36 | PASS (API) | `/api/candidates/public/recruiters` includes this account's name. The dropdown UI was not opened |
| R1-37 | PASS | Vendor Upload: `/vendor/mrfs`, `/vendors`, `/jobs` all 200 |
| R1-38 | PASS | Vendor Dashboard shows the **staff** view ("Overview across all vendors", vendor picker); no failed calls |
| R1-39 | PASS (API) | `POST /vendor/review/search` 200. Merge/cancel not executed |
| R1-40 | PASS | Candidate Screening: 6 calls, none failed |
| R1-41 | PASS* | With the Pipeline module off, `/pipeline` redirects and `/api/pipeline/*` is 403, **the same as the Recruiter baseline** (module gate, not role). With the module switched on temporarily for the test account: board loads, no failed calls |
| R1-42 | PASS | Drawer shows **Download dossier** (plus Move to…, Approve/Hold/Reject…). `screenshots/R1-42-drawer-dossier.png` |
| R1-43 | NOT RUN | The opened journey had no recording; covered by the `canViewRecordings` unit test (rank ≥ recruiter) |
| R1-44 | PASS | Analytics: `/pipeline/analytics` 200 with the module on (it was 403 with the module off, same cause as R1-41) |
| R1-45 | PASS | Email monitoring export 200 |
| R1-46 | PASS | No create-template button; API 403 |
| R1-47 | PASS | Settings: 7 cards load, no failed calls; Company Profile and Pipeline Config cards hidden. Reminder save was not exercised (GET 200), to avoid changing the shared staging schedule |
| R1-48/49 | NOT RUN | Needs two live sessions plus a real event. Covered in code: `NOTIFY_ROLES` = `RECRUITER_TIER_ROLES` (bell recipients), and the recruiter socket emits loop over `RECRUITER_ROOM_ROLES` (unit-tested; each socket is in exactly one role room, so no double delivery). Retest once Chhaya's role is moved after deploy |
| R1-50 to R1-55 | PASS | All 403 as HR Admin Recruiter (same as Recruiter) |
| R1-56 | PASS | Trail 200, no `ip` / `user_agent` |
| R1-60 to R1-62 | PASS | The Recruiter baseline (R1-00) ran against the **new** backend, so it is the control: unchanged results, nothing widened |
| R1-70 | NOT NEEDED | No blocking failure |

**Clean-up.** The Pipeline module was switched back **off** for the test account after R1-41/42/44. No MRF, candidate or vendor data was changed.

**Design change found while building.** The planned `emitToRoles` socket helper (impact doc B14) was not needed. Each socket joins only its own `role:<role>` room, so emitting to `recruiter` and `hr_admin_recruiter` in turn reaches every recruiter-level user exactly once, and the Redis bridge stays untouched.

**Still to do for R1:** after deploy, move Chhaya to HR Admin Recruiter, have her log out and in, and spot-check R1-10, R1-38, R1-42 and R1-48 with her own account.
