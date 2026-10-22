# Super Admin guide

**For:** Super Admins of the AAPNA ATS. **Version:** October 2026.

A Super Admin can do everything an Admin can (see the [Admin guide](02-ADMIN-GUIDE.md)), across **every company**, plus:
- manage **companies**;
- manage **admins and other Super Admins**;
- **delete** accounts;
- see **Logs & errors** and the **system health** checks.

**Contents**
1. [Companies](#1-companies)
2. [Users across companies](#2-users-across-companies)
3. [Logs & errors](#3-logs--errors)
4. [System health](#4-system-health)
5. [Good practice](#5-good-practice)

---

## 1. Companies
**Admin portal → Companies.** Each company is a separate tenant: its admins, recruiters and vendors see only its own users.

- **Add a company:** **Company name**, a short **Slug** (e.g. `aapna`), and an optional **Email domain** (e.g. `aapnainfotech.com`).
- **Edit** the name, slug or domain.
- **Deactivate** a company: all its users are signed out at once and can't sign in until you reactivate it. Nothing is deleted.

## 2. Users across companies
**User Management** shows every company's users, with a **Company** column and a company filter.

| You can | Notes |
|---|---|
| Create users of any role, including **Super Admin**, in any company | A Super Admin belongs to no company (global) |
| Edit anyone's details, role and status | Including other Super Admins |
| Reset passwords of admins, recruiters and vendors | **Not** another Super Admin's: only they can change it. To stop a rogue Super Admin, deactivate or delete the account (visible to others) |
| Move a user to another company | Only Super Admins can |
| **Delete** an account | The only role that can. Prefer deactivating: it keeps their history |
| Set module access for anyone | Admins and Super Admins always see everything |

You can't change your own role or status, or delete yourself.

## 3. Logs & errors
**Admin portal → Logs & errors** (Super Admins only, because errors can come from any company). This is where the ATS team finds out what went wrong, without logging in to the server.

### Errors
Every server error, failed scheduled job and screen crash, grouped so a repeat shows as one row.

| Column | Meaning |
|---|---|
| Last seen | When it last happened (hover for the exact time) |
| Source | **Server**: a request failed; **Job**: a scheduled job failed (reminders, mailbox, Zeko sync…); **Browser**: a screen crashed in someone's browser |
| Error | What went wrong |
| Where | The screen or action |
| Times / Users | How often, and how many people it affected |
| Env | Production, staging or a developer's machine |
| Latest ref | The reference of the latest occurrence; click to open it in **Find a ref** |

Filter by source, environment and period (24 hours, 7 or 30 days), or search the text. Click the arrow on a row to see each occurrence, with the person it happened to and the technical detail.

Errors are kept for **30 days**.

### Find a ref
When a user reports **"Something went wrong… (ref: K7Q2MX)"**, paste the ref here. You see:
- the stored error: who, which screen, what failed;
- every log line of that request in time order, including calls to Microsoft (email, calendar, OneDrive), Zeko, the AI service and Cohere, with how long each took and whether it worked.

Personal data is masked in all of these (`a***@domain.com`, `******3210`). Alert emails to the developers carry the same ref.

### Jobs
Every scheduled job (reminders, mailbox check, Zeko sync, interview checks, document and offer sweeps…) with its **last run**, **last success**, **last failure** and the error. **Failing** means the last run failed; the developers were emailed. Rows for other environments are dimmed.

## 4. System health
**Logs & errors → Health → Run checks** tests, live and separately:

| Part | Checks |
|---|---|
| Database | The ATS can read its data |
| Redis | The cache and queue service answers |
| Resume queue | Queued uploads (shows "not used" when uploads run directly) |
| Microsoft Graph login | The ATS can still sign in to Microsoft (email, calendar, OneDrive) |

All green: everything is up. Anything red: tell the ATS team, quoting the message shown.

## 5. Good practice
- Keep at least **two** Super Admins, so one can manage the other's account.
- Give Super Admin only to the people who look after the system. Company admins are enough for day-to-day user management.
- Deactivate before you delete.
- Look at **Logs & errors** once a week (the developers do too): a new error that repeats is worth a message to the team.
