import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import config from '../config/index.js';
import { authenticate, checkModuleAccess } from '../middleware/auth.js';
import * as hrUploadController from '../controllers/hrUpload.controller.js';

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
      cb(new Error(`File type ${ext} is not allowed. Only ${allowedExts.join(', ')} are accepted.`));
    }
  },
});

// Protect all HR upload routes — admin/superadmin bypass; recruiters/hr need the
// hr_manual_upload module toggle (managed in the Admin Portal). Mirrors the
// screening & vendor route guards.
router.use(authenticate);
router.use(checkModuleAccess('hr_manual_upload'));

// ── HR Upload APIs ────────────────────────────────────────────────────

/** Upload resumes */
router.post('/upload', upload.array('resumes', 100), hrUploadController.uploadResumes);

/** Get batch summary */
router.get('/summary/:executionId', hrUploadController.getSummary);

/** Search duplicate records in staging table */
router.post('/duplicates/search', hrUploadController.searchDuplicates);

/** Merge selected duplicates into main CV table */
router.post('/duplicates/merge', hrUploadController.mergeDuplicates);

/** Delete selected duplicates from review queue */
router.post('/duplicates/delete', hrUploadController.deleteDuplicates);

export default router;
