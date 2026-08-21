import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import config from '../config/index.js';
import { authenticate, checkModuleAccess, requireStaff } from '../middleware/auth.js';
import { exportLimiter } from '../middleware/exportRateLimit.js';
import * as hrUploadController from '../controllers/hrUpload.controller.js';
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
    cb(null, `hr-${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB — a single .zip bundles many resumes
  },
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.pdf', '.docx', '.zip', '.xlsx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      // AppError, not a bare Error: a bare one carries no statusCode, so the
      // global handler treats a wrong file type as a 500 and emails the team a
      // "Backend Error Alert" (defect D6).
      cb(new AppError(`File type ${ext} is not allowed. Only ${allowedExts.join(', ')} are accepted.`, 400));
    }
  },
});

// Protect all HR upload routes — admin/superadmin bypass; recruiters/hr need the
// hr_manual_upload module toggle (managed in the Admin Portal). Mirrors the
// screening & vendor route guards.
router.use(authenticate);
// Internal staff only (M6). Vendors upload through /api/vendor/upload, which
// attributes and scopes what they send; this route does neither.
router.use(requireStaff);
router.use(checkModuleAccess('hr_manual_upload'));

// ── HR Upload APIs ────────────────────────────────────────────────────

/** Upload resumes */
router.post('/upload', upload.array('resumes', 100), hrUploadController.uploadResumes);

/** Get batch summary */
router.get('/summary/:executionId', hrUploadController.getSummary);

/** Persistent per-resume job feed (powers the live Upload Status dashboard) */
router.get('/jobs', hrUploadController.getUploadJobs);

/** CSV of every upload job matching the filters (no pagination). */
router.get('/jobs/export', exportLimiter, hrUploadController.exportUploadJobs);

/** Reprocess a failed upload job */
router.post('/jobs/:id/reprocess', hrUploadController.reprocessJob);

/** Search duplicate records in staging table */
router.post('/duplicates/search', hrUploadController.searchDuplicates);

/** Merge selected duplicates into main CV table */
router.post('/duplicates/merge', hrUploadController.mergeDuplicates);

/** Delete selected duplicates from review queue */
router.post('/duplicates/delete', hrUploadController.deleteDuplicates);

export default router;
