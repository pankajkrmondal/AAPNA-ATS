# Document Collection (Module 4) — DDL Apply Instructions

**File:** `2026-07-29-document-collection.sql`
**Do not hand-edit `schema.prisma`** — per `docs/reference/VENDOR_PROCESS.md` §13, this repo always introspects the live DB.

## Steps to apply

1. Run the SQL against the database:
   ```
   psql "$DATABASE_URL" -f backend/prisma/ddl/2026-07-29-document-collection.sql
   ```
   Additive and idempotent — safe to re-run.

2. Stop the backend (and the queue worker — both hold the Prisma query engine
   DLL on Windows), then introspect + regenerate:
   ```
   cd backend
   npx prisma db pull
   npx prisma generate
   ```

3. Seed the checklist (once per environment):
   ```
   npm run seed:documents:staging      # or seed:documents:prod
   ```

4. Restart the backend. Until steps 1–3 are done, `POST /api/pipeline/:id/documents/request`
   fails — the Prisma client doesn't know the tables, and with no seeded
   checklist the request is rejected with "No active document checklist items are configured."

## New tables

| Table | Purpose |
|---|---|
| `rpa_document_checklist_items` | The checklist as **data**, so it changes without a redeploy. |
| `rpa_document_requests` | One request per journey: the no-login upload token and reminder counters. |
| `rpa_candidate_documents` | One row per checklist item per request: the OneDrive file, its status, and the rejection reason. |

## Checklist content — deliberately narrower than the old draft

Seeded with Chhaya's actual 2026-07-14 request template: **last 3 months'
payslips**, **permanent address**, and **one government ID showing DOB + father's
name**. The older 4-item draft in `docs/phase3/04-QUESTIONS.md` Q8 (which also had
education certificates and experience/relieving letters) predates that template
and is *not* what gets seeded. Since the list is data, adding those two back is an
admin edit, not a code change.

## Where files go

`Document Collection/<candidate name (cv-<id>)>/` inside the **same OneDrive
parent folder resumes already use** (`MS_ONEDRIVE_PARENT_ID`). The nesting is new
— `onedrive.service.js` gained `ensureOneDriveFolderPath()` and an optional
`folderPath` argument on `uploadFileToOneDrive()`. Called without `folderPath`
(every pre-existing caller) it still uploads flat into the parent exactly as
before. The cv id is in the folder name because candidate names are not unique.

## Standing rules encoded here

- **Retention (RT, 2026-07-14): documents are NEVER deleted.** There is no
  delete or expiry path anywhere in this module, by design. The SharePoint
  archive job is deliberately not built — no archive threshold has been agreed.
- **Vendors (Q5): no document-stage email or API ever reaches a vendor.**
  `documentCollection.service.js` never reads `vendor_email`; the request,
  reminder, and re-request all go to the candidate only.

## Optional email templates

Both fall back to a built-in body, so the flow works before either exists. HR can
override the copy by adding `rpa_email_templates` rows named **"Document
Collection Request"** and **"Document Collection Reminder"** (placeholders:
`{{candidate_name}}`, `{{position}}`, `{{upload_link}}`, plus
`{{rejected_document}}` / `{{rejection_reason}}` on a re-request).
