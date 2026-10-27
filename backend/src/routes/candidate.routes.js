import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import config from '../config/index.js';
import * as candidateController from '../controllers/candidate.controller.js';
import { authenticate, requireStaff, requireAdmin } from '../middleware/auth.js';
import { exportLimiter } from '../middleware/exportRateLimit.js';
import AppError from '../utils/AppError.js';

const router = Router();

// Ensure upload directory exists
const uploadDir = path.resolve(config.upload.dir);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `missing-jd-${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.pdf', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      // AppError, not a bare Error: a bare one carries no statusCode, so the
      // global handler treats a wrong file type as a 500 and emails the team a
      // "Backend Error Alert" (defect D6). This route is public, so that was
      // remotely triggerable by anyone with an upload link.
      cb(new AppError(`File type ${ext} is not allowed. Only ${allowedExts.join(', ')} are accepted.`, 400));
    }
  },
});

// Public candidate routes (unauthenticated)
router.get('/public/roles', candidateController.getPublicRoles);
// Option lists for the candidate forms (N18): names only, cached for an hour.
router.get('/public/locations', candidateController.getPublicLocations);
router.get('/public/recruiters', candidateController.getPublicRecruiters);
router.get('/public/missing-data', candidateController.getPublicMissingData);
router.post('/public/missing-data', upload.single('uploadResume'), candidateController.submitPublicMissingData);

// All other candidate routes require authentication
router.use(authenticate);

/**
 * GET /api/candidates
 * Search with pagination & filters: ?search=&status=&page=&limit=&sort=&order=
 */
router.get('/', candidateController.searchCandidates);

/**
 * GET /api/candidates/export
 * CSV of every candidate matching the filters (no pagination).
 * Registered before '/:id' so 'export' is never captured as a candidate id.
 */
router.get('/export', exportLimiter, candidateController.exportCandidates);

/**
 * GET /api/candidates/:id
 * Retrieve a single candidate by ID. A vendor gets only their own submissions
 * (vendorMayReadCandidate, checked in the controller); anyone else's is a 404.
 */
router.get('/:id', candidateController.getCandidate);

/**
 * PATCH /api/candidates/:id
 * Update a candidate record (partial update). Staff only (N29): a vendor's
 * search is scoped to their own submissions, but this edit was not, so a
 * vendor login could rewrite any candidate through the API.
 */
router.patch('/:id', requireStaff, candidateController.updateCandidate);

/**
 * GET /api/candidates/:id/emails
 * Retrieve email conversations associated with a candidate. Staff only (L10):
 * these are the recruiters' own conversations with the candidate, and no vendor
 * screen reads them — but the route had no role check, so any vendor token
 * could read any candidate's mail by id.
 */
router.get('/:id/emails', requireStaff, candidateController.getCandidateEmails);

/**
 * GET /api/candidates/:id/pipeline-scores
 * Read-only pipeline scores for Search Candidate (N29). Staff only, like the
 * pipeline it reads from.
 */
router.get('/:id/pipeline-scores', requireStaff, candidateController.getCandidatePipelineScores);

/**
 * JD tags on Search Candidate (L02-B). A wrong tag can be removed while
 * another remains; the only tag, or a JD the candidate is in the pipeline for,
 * can only be switched (the pipeline one through Move to another JD).
 */
router.get('/:id/tags', requireStaff, candidateController.getCandidateTags);
router.delete('/:id/tags/:mrfId', requireStaff, candidateController.removeCandidateTag);
router.post('/:id/tags/:mrfId/switch', requireStaff, candidateController.switchCandidateTag);

// ── Referral candidate (P1) ───────────────────────────────────────────
//
// Separate routes from the general PATCH above, because the three actions carry
// three different permissions and one of them must record an audit row:
//
//   read   staff  — the flag is for logged-in superadmin/admin/recruiter only.
//                   requireStaff is rank-based, so `vendor` (rank 10) is refused
//                   here even though it can reach the rest of this router.
//   set    staff  — any recruiter may mark a referral.
//   remove ADMIN  — only admin-tier, and only with a typed reason. Removing a
//                   referral erases the referrer's name from the candidate, so
//                   it is the one action worth constraining and logging hardest.
//
// The gate is the middleware, not the UI: the modal renders the control disabled
// for a recruiter, but a token is not a browser.
//
// See docs/REFERRAL-CANDIDATE-PLAN.md section 5 and section 6.

/**
 * GET /api/candidates/referral/referrers
 * Referrer names already in use, for the "Referred by" autocomplete.
 *
 * MUST stay above '/:id/referral' — both are two-segment paths, so Express would
 * otherwise match this as a candidate with the id "referral". Same trap, and the
 * same fix, as '/export' sitting above '/:id' higher up this file.
 */
router.get('/referral/referrers', requireStaff, candidateController.getReferrerSuggestions);

/**
 * GET /api/candidates/:id/referral
 * Current referral state plus its full audit history.
 */
router.get('/:id/referral', requireStaff, candidateController.getCandidateReferral);

/**
 * PATCH /api/candidates/:id/referral
 * Mark as a referral, or change the referrer / note. Body: { referredBy, note? }
 */
router.patch('/:id/referral', requireStaff, candidateController.setCandidateReferral);

/**
 * DELETE /api/candidates/:id/referral
 * Remove a referral. Admin-tier only. Body: { reason } — mandatory.
 */
router.delete('/:id/referral', requireAdmin, candidateController.removeCandidateReferral);

export default router;
