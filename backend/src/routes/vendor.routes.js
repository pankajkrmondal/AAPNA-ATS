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

// Protect all vendor routes
router.use(authenticate);
router.use(restrictTo('vendor', 'admin', 'hr'));
// Gate the whole module behind the `vendor_upload` permission (admins/superadmins bypass).
// Mirrors the n8n flow which returned 403 for users without the module enabled.
router.use(checkModuleAccess('vendor_upload'));

// ── Vendor APIs ───────────────────────────────────────────────────────

/** Get candidates uploaded by the vendor */
router.get('/candidates', vendorController.getVendorCandidates);

/** Upload resumes */
router.post('/upload', upload.array('resumes', 100), vendorController.uploadResumes);

/** Get recent upload batches for this vendor */
router.get('/batches', vendorController.getUploadBatches);

/** Get batch summary details */
router.get('/summary/:executionId', vendorController.getSummary);

export default router;
