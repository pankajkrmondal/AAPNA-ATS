# Admin guide

**For:** company admins of the AAPNA ATS. **Version:** October 2026.

As an admin you can do everything a recruiter can (see the [Recruiter & HR guide](01-RECRUITER-HR-GUIDE.md)), plus look after your company's accounts, decide who sees which screens, and set up how the recruitment process behaves: stages, reasons, emails and automation.

Your powers stop at your own company. Super Admins (see the [Super Admin guide](03-SUPERADMIN-GUIDE.md)) look after companies and other admins.

**Contents**
1. [Opening the admin portal](#1-opening-the-admin-portal)
2. [Users](#2-users)
3. [Module access: who sees which screens](#3-module-access-who-sees-which-screens)
4. [Referral log](#4-referral-log)
5. [Pipeline configuration](#5-pipeline-configuration)
6. [Settings only admins can change](#6-settings-only-admins-can-change)
7. [Email templates](#7-email-templates)
8. [MRF approvers and closing MRFs](#8-mrf-approvers-and-closing-mrfs)
9. [Housekeeping checklist](#9-housekeeping-checklist)

---

## 1. Opening the admin portal
- Sign in at the **admin sign-in page** (`/admin/login`), or click the admin button in the top bar of the recruitment screens.
- The portal has its own top bar: **HR Admin**, your role badge, and the tabs. **Recruitment Portal** takes you back to the recruitment screens.
- Tabs: **User Management**, **Module Access**, **Referral Log** (and **Companies** / **Logs & errors** for Super Admins).

## 2. Users
**User Management** lists your company's accounts with counts: **Total users**, **Active** (can log in) and **Inactive** (access revoked). Search by name or email.

**Add a user**
1. Click **Add User**. Fill **First name**, **Last name**, **Email address**, an optional **Username** (blank = they sign in with their email), **Role** and **Password** (or **Generate** a secure one and **Copy** it).
2. Roles you can give: **Admin**, **Recruiter**, **Vendor**.
3. **Create User & Send Email**. The person is emailed their sign-in details at their own address.

**Change a user:** **Edit** → change name, email, username, role or **Account status**; type a **New password** only if you want to reset it (blank keeps the current one). The user is emailed when their credentials change.

**Deactivate rather than delete.** Set **Account status** to inactive: they can no longer sign in, and their history stays. Only a Super Admin can delete an account.

**What you can't do (by design):**

| Rule | Why |
|---|---|
| You can't change your own role or status, or delete yourself | Nobody can lock themselves in or out by mistake |
| You can't edit, reset or deactivate another admin | Admins are peers; a Super Admin manages admins |
| You don't see Super Admin accounts or other companies' users | Your scope is your company |

Everyone can change their own password (picture → **Change Password**, or **Forgot password?**). You only need to reset one for someone who is locked out.

## 3. Module access: who sees which screens
**Module Access**: pick a user on the left, then switch each screen on or off for them.

| Module | Screen |
|---|---|
| New MRF | MRF |
| Search candidates | Search Candidate |
| HR manual upload | HR Manual Upload |
| Vendor upload | Vendor Upload |
| Candidate screening | Candidate Screening |
| Screening analytics | Recruitment Analytics |
| Recruitment pipeline | Candidate Pipeline |
| System config | Settings, Email Templates |
| HR admin | The admin portal (normally off for recruiters) |

- **New recruiters** start with every recruitment screen on and the admin portal off. **New vendors** start with only Vendor Upload and their dashboard.
- Admins and Super Admins always see everything; switches don't apply to them.
- Switches save as you click them. The person is **signed out** so the change applies straight away; tell them they will need to sign in again.

## 4. Referral log
Every time a candidate is marked as an employee referral, changed, or has the referral removed, it is recorded with who, when and the referrer's name.

- **Referral Log** tab: filter by action, candidate, referrer and date. **Removals** are counted separately with a one-click filter, because a removal changes who gets hired. **Export** downloads the list.
- **Only admins can remove a referral**, and must type a reason: Search Candidate → candidate → Edit → Referral → **Remove referral**.

## 5. Pipeline configuration
**Settings → Pipeline Configuration** (admins only) shapes the candidate pipeline without a developer. Four tabs:

| Tab | What you can do |
|---|---|
| **Stages & Outcomes** | Add a stage, rename it, set its **type** (Manual, Zeko, Assessment, Interview with scorecards, System) and order, mark it **Optional**, switch it **Active / Inactive**. For each stage, edit the outcomes (Approve / Hold / Reject…), which ones **advance** the candidate and which are **final** |
| **Reject / Hold Reasons** | The reasons recruiters choose from. Each applies to **all stages** or specific ones; switch off old reasons instead of deleting them, so past decisions keep their reason |
| **Outcome Emails** | For each stage and outcome, whether an email goes to the candidate and which template. "Nothing sends" means no email for that outcome |
| **Email Routing** | Who receives each internal email flow (**Goes to**, **Cc**), and whether it reaches the real inbox or the test inbox on staging |

**Be careful with:**
- **Deactivating a stage that has candidates in it.** Move them first.
- **Optional stages** can be skipped by recruiters; the CEO round is optional since October 2026.
- **Outcome emails** go to real candidates in production. Check the template (section 7) before switching one on.

## 6. Settings only admins can change
Most of Settings is open to recruiters (see the recruiter guide, §11). Only admins can:
- **Company profile**: the "About AAPNA" text added to shortlist emails with the JD.
- **Assessment Automation → Auto-advance / auto-reject on score**: when on, importing Evalground results approves or rejects the round automatically at the pass mark.
- **Pipeline Configuration** (section 5).

Settings affect everyone, immediately. Each section explains what it will do before you save.

## 7. Email templates
- **Email Templates** lists every email the ATS sends. Recruiters can edit them; **only admins can create a new template**.
- Keep the placeholders in braces (`{candidate_name}`, `{{position}}`, `{{stage_label}}`…) exactly as written; they are filled in when the email is sent.
- Check **Live Preview** before saving. A wrong template goes to every candidate at that stage.
- To link a new template to an outcome, use **Pipeline Configuration → Outcome Emails**.

## 8. MRF approvers and closing MRFs
- **Approvers:** each MRF goes to the approvers on the approval roster; one approval is enough. Each approver gets a **personal link** that records who decided, when, from where and their comment. To change the roster, ask the ATS team (it is stored as a setting).
- **Re-send approval links** (MRF → details → approval trail) when an approver lost the email; the old links stop working.
- **Approval report:** MRF → **Approval audit** (admins only) downloads every approval event of the last 90 days: who, when, IP and device.
- **Closing:** an MRF closes by itself when all its openings are filled by accepted offers. Close one by hand with **Close requisition…** and a reason (filled elsewhere, cancelled, on hold). Stale test MRFs should be closed so the open-positions list stays accurate.
- Approvers' IP address and device are masked automatically 12 months after their decision; who decided and when are kept for good.

## 9. Housekeeping checklist
Monthly, or after a change of staff:
- [ ] People who left: **deactivate** their account.
- [ ] New joiners in HR or other teams who hire: create accounts with the right **modules** so their hiring is in the ATS.
- [ ] Vendors you no longer use: deactivate them.
- [ ] Old or test MRFs still showing as open: close them with a reason.
- [ ] Candidates tagged to the wrong MRF: close that journey (pipeline → Close this candidate's record).
- [ ] Reject / Hold reasons: switch off any no longer used.
- [ ] Email Routing: the internal recipients are still the right people.
