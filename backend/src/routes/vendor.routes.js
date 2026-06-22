import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate, restrictTo, checkModuleAccess } from '../middleware/auth.js';
import * as vendorController from '../controllers/vendor.controller.js';
import config from '../config/index.js';

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
      cb(new Error(`Invalid file type. Allowed: ${allowedExts.join(', ')}`));
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
  restrictTo('vendor', 'admin', 'superadmin', 'recruiter'),
  vendorController.getVendorDashboard,
);

/** List registered vendors — powers the staff vendor-picker. */
router.get(
  '/vendors',
  restrictTo('admin', 'superadmin', 'recruiter'),
  vendorController.listVendors,
);

// ── Upload-related APIs (vendor/admin/hr + vendor_upload module) ────────
router.use(restrictTo('vendor', 'admin', 'hr'));
router.use(checkModuleAccess('vendor_upload'));

/** Get candidates uploaded by the vendor */
router.get('/candidates', vendorController.getVendorCandidates);

/** Upload resumes */
router.post('/upload', upload.array('resumes', 100), vendorController.uploadResumes);

/** Get recent upload batches for this vendor */
router.get('/batches', vendorController.getUploadBatches);

/** Get batch summary details */
router.get('/summary/:executionId', vendorController.getSummary);

export default router;
