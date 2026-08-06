# Phase 3 — Module 4: Document Collection

**Date:** 2026-07-29 · **Module:** M4

## Why

The Documents stage was a board column and nothing more. The round it has to
support — fires after the final interviews clear, before the offer goes out — had
no request, no upload path, and no verification workflow anywhere in the codebase.

## What changed

### Data model

New `backend/prisma/ddl/2026-07-29-document-collection.sql`:

| Table | Purpose |
|---|---|
| `rpa_document_checklist_items` | The checklist as **data**, so it changes without a redeploy. |
| `rpa_document_requests` | One request per journey: the no-login upload token, reminder counters. |
| `rpa_candidate_documents` | One row per checklist item per request: the OneDrive file, status, rejection reason. |

A unique index on `(request_id, checklist_item_id)` means a re-upload overwrites
in place rather than stacking rows, so the checklist stays one line per document.

### Checklist content — narrower than the old draft, on purpose

Seeded (`prisma/seed-document-checklist.js`, `npm run seed:documents:*`) with
Chhaya's actual 2026-07-14 request template: **last 3 months' payslips**,
**permanent address**, and **one government ID showing DOB + father's name**.

The 4-item draft in `04-QUESTIONS.md` Q8 — which also had education certificates
and experience/relieving letters, and which both prototypes hard-code — predates
that template. Since the checklist is data, adding those back is an admin edit.

### OneDrive: same drive, new nesting

Files land in **`Document Collection/<candidate name (cv-<id>)>/`** inside the
same parent folder resumes already use (`MS_ONEDRIVE_PARENT_ID`). Nothing in this
codebase nested folders before, so `onedrive.service.js` gained
`ensureOneDriveFolderPath()` (idempotent get-or-create, walking a level at a time
because Graph's path-addressed upload does not reliably create intermediate
folders) and an optional `folderPath` argument on `uploadFileToOneDrive()`.

**Existing callers are unaffected** — called without `folderPath`, it uploads flat
into the parent exactly as before. The cv id is in the folder name because
candidate names are not unique.

### Backend

- `backend/src/services/documentCollection.service.js` — `requestDocuments`,
  `sendReminder`, `getDocumentStatus`, `getRequestByToken`, `uploadDocument`,
  `verifyDocument`, `rejectDocument`. Rejecting takes a mandatory reason and
  automatically re-requests: the item reopens for re-upload and the candidate is
  emailed what to fix.
- Public no-login upload at `/api/documents/:token` (`document.routes.js` +
  `document.controller.js`), mirroring the scorecard token pattern. Multer accepts
  pdf/doc/docx/jpg/png — wider than the resume uploader, because payslips and IDs
  are routinely photographed.
- Recruiter-facing half sits on the authenticated pipeline routes.

### Frontend

- New public `frontend/src/pages/DocumentUpload.jsx` at `/documents/:token`
  (`ForceLight`, same as the other candidate-facing token pages) — checklist with
  per-item status, and a rejected item shows HR's reason inline.
- `PipelineDrawer.jsx` — the Documents round's segments are now real
  (request sent → uploads → verification), with a **"Send document request"**
  button before one exists and a verification checklist (Open / Verify / Reject…
  plus "Send reminder") after.

## Standing rules encoded here

- **Retention (RT, 2026-07-14): documents are NEVER deleted.** No delete or
  expiry path exists anywhere in this module, by design. The SharePoint archive
  job is deliberately *not* built — no archive threshold has been agreed yet.
- **Vendors (Q5): no document-stage email or API ever reaches a vendor.**
  `documentCollection.service.js` never reads `vendor_email`; request, reminder
  and re-request all go to the candidate only.

## Files

**New:** `backend/prisma/ddl/2026-07-29-document-collection.sql` (+ README),
`backend/prisma/seed-document-checklist.js`,
`backend/src/services/documentCollection.service.js`,
`backend/src/controllers/document.controller.js`,
`backend/src/routes/document.routes.js`,
`frontend/src/services/documentService.js`,
`frontend/src/pages/DocumentUpload.jsx`

**Changed:** `onedrive.service.js` (folder nesting), `pipeline.controller.js`,
`pipeline.routes.js`, `routes/index.js`, `config/emailRecipients.js`
(`documentRequest`), `backend/package.json` (seed scripts),
`frontend/src/App.jsx`, `frontend/src/services/pipeline.js`, `PipelineDrawer.jsx`

## Verification

1. Apply the DDL → `npx prisma db pull && npx prisma generate` →
   `npm run seed:documents:staging`.
2. Send the request from the drawer; confirm it reaches the candidate **only** —
   including on a vendor-sourced journey, where the vendor must receive nothing.
3. Open the emailed link logged-out, upload a file, and confirm it appears in
   OneDrive under `Document Collection/<candidate name (cv-id)>/` — **not** the
   flat resumes folder.
4. Reject with a reason → confirm the item reopens, the candidate is emailed the
   reason, and the reason shows on their upload page.
5. Re-upload → verify → confirm the item locks and the segment reads
   "All documents verified".
6. Confirm nothing anywhere deletes a document row.

## Note on scope

`03-DEVELOPMENT-PLAN.md` §M4 flagged a storage-capacity contingency: if capacity
is tight, RT's fallback was to keep documents out of the portal entirely. That
answer (owed by Harish, with Pankaj + IT) has not landed. The full multi-document
flow is built here; if capacity forces the resumes-only fallback, the checklist
being data means it can be reduced without a code change.
