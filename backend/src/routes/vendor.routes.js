import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate, restrictTo, checkModuleAccess } from '../middleware/auth.js';
import { exportLimiter } from '../middleware/exportRateLimit.js';
import * as vendorController from '../controllers/vendor.controller.js';
import config from '../config/index.js';
import AppError from '../utils/AppError.js';
import { ROLES, RECRUITER_TIER_ROLES } from '../config/roles.js';

const router = Router();

// Internal staff who may run the duplicate-review queue (never vendors).
const STAFF_ROLES = [...RECRUITER_TIER_ROLES];

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
    cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.pdf', '.docx', '.zip'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      // AppError, not a bare Error: a bare one carries no statusCode, so the
      // global handler treats a wrong file type as a 500 and emails the team a
      // "Backend Error Alert" (defect D6).
      cb(new AppError(`Invalid file type. Allowed: ${allowedExts.join(', ')}`, 400));
    }
  },
});

// All vendor routes require authentication.
router.use(authenticate);

// ── Dashboard & vendor list (vendors + internal staff) ─────────────────

/**
 * Vendor dashboard summary. Vendors see their own submissions (scoped to their
 * email); internal staff (admin/superadmin/recruiter) pick a vendor to view via
 * the `vendorEmail` query param. Defined before the upload-only guards so
 * recruiters/superadmins (who can't upload) can still view the dashboard.
 */
router.get(
  '/dashboard',
  restrictTo('vendor', 'admin', 'superadmin', ROLES.HR_ADMIN_RECRUITER, 'recruiter'),
  vendorController.getVendorDashboard,
);

/** List registered vendors — powers the staff vendor-picker. */
router.get(
  '/vendors',
  restrictTo('admin', 'superadmin', ROLES.HR_ADMIN_RECRUITER, 'recruiter'),
  vendorController.listVendors,
);

// ── Upload-related APIs (vendor + internal staff, gated by vendor_upload) ──
// Staff (admin/superadmin/hr_admin_recruiter/recruiter/hr) may upload on behalf
// of a vendor; the vendor they're acting for is supplied per-request and
// validated server-side.
router.use(restrictTo('vendor', ...STAFF_ROLES));
router.use(checkModuleAccess('vendor_upload'));

/** Get candidates uploaded by the vendor */
router.get('/candidates', vendorController.getVendorCandidates);

/** Upload resumes */
router.post('/upload', upload.array('resumes', 100), vendorController.uploadResumes);

/** Open JDs for the upload's "Uploading for JD" picker (N14). */
router.get('/mrfs', vendorController.listUploadMrfs);

/** Get recent upload batches for this vendor */
router.get('/batches', vendorController.getUploadBatches);

/** Persistent upload/job-tracking dashboard feed (one row per resume) */
router.get('/jobs', vendorController.getUploadJobs);

/** CSV of every upload job this user is scoped to see (no pagination). */
router.get('/jobs/export', exportLimiter, vendorController.exportUploadJobs);

/** Reprocess a failed upload job */
router.post('/jobs/:id/reprocess', vendorController.reprocessJob);

/** Recruiter review actions on the duplicate queue (staff only — never vendors) */
router.post('/review/search', restrictTo(...STAFF_ROLES), vendorController.reviewSearch);
/** Side-by-side comparison for the Review window (L09). Staff only: the existing
 *  record may belong to another vendor or to internal HR. */
router.get('/review/:tmpId/compare', restrictTo(...STAFF_ROLES), vendorController.reviewCompare);
router.post('/review/merge', restrictTo(...STAFF_ROLES), vendorController.reviewMerge);
router.post('/review/cancel', restrictTo(...STAFF_ROLES), vendorController.reviewCancel);

/** Get batch summary details */
router.get('/summary/:executionId', vendorController.getSummary);

export default router;
