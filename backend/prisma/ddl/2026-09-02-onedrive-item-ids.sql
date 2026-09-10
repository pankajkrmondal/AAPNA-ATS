-- ============================================================================
-- Phase 3 — Candidate Complete Download, Phase 2: read files back out of OneDrive
-- Manual DDL — apply then: cd backend && npm run prisma:pull && npm run prisma:generate
-- Idempotent, additive, non-destructive. No existing column or row is touched.
--
-- WHY: the dossier a recruiter emails to an external interviewer has to carry the
-- resume INSIDE it. We store only a SharePoint webUrl today, which is a browser
-- URL behind a Microsoft login — handing it to an outsider produces a login wall,
-- not a resume. To put the bytes in the pack the ATS has to read the file back,
-- and reading back by drive-item id is the direct route:
--
--     GET /users/{owner}/drive/items/{itemId}/content
--
-- uploadFileToOneDrive() already receives the whole item object back from Graph
-- and currently keeps only item.webUrl, throwing the id away. These columns give
-- it somewhere to put the id.
--
-- WHY THIS IS AN IMPROVEMENT INDEPENDENT OF THE DOSSIER: an item id survives the
-- file being renamed or moved within the drive; a webUrl does not. Every stored
-- webUrl in these two tables is one rename away from being a dead link.
--
-- NULL IS EXPECTED AND SUPPORTED. Rows written before this change have no id, and
-- there is deliberately no backfill migration here — resolving thousands of URLs
-- through Graph inside a DDL script would be slow, rate-limited and untestable.
-- Instead downloadDriveItem() resolves a legacy row through the /shares/ route on
-- first use and writes the id back, so the backfill happens lazily, only for
-- files someone actually asks for, and costs one extra round trip per file once.
--
-- See docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md §6.3 and
--     docs/phase3/CANDIDATE-DOWNLOAD-IT-PERMISSION-REQUEST.md §3.
--
-- Permission note: the app-only read this enables was tested against staging on
-- 2026-09-02 and PASSED on the existing Sites.Selected grant — no new Graph
-- permission is required. Production uses a separate app registration whose
-- per-site grant is issued separately, so re-run that test before relying on
-- this there.
-- ============================================================================

-- The candidate's resume, uploaded by the parser / HR upload / manual add.
ALTER TABLE rpa_cv
  ADD COLUMN IF NOT EXISTS cv_file_item_id VARCHAR(512);

COMMENT ON COLUMN rpa_cv.cv_file_item_id IS
  'OneDrive drive-item id for cvFileUrl. NULL for rows written before 2026-09-02; '
  'resolved from the webUrl on first read and written back. Survives rename/move.';

-- Documents the candidate uploaded through the public document-collection link
-- (ID proof, payslips, certificates). These are opt-in for a dossier and their
-- inclusion is audited — see plan §8.4.
ALTER TABLE rpa_candidate_documents
  ADD COLUMN IF NOT EXISTS file_item_id VARCHAR(512);

COMMENT ON COLUMN rpa_candidate_documents.file_item_id IS
  'OneDrive drive-item id for file_url. NULL for rows written before 2026-09-02; '
  'resolved from the webUrl on first read and written back.';
