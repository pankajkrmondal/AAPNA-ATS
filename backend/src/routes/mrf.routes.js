import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import config from '../config/index.js';
import * as mrfController from '../controllers/mrf.controller.js';
import { authenticate, restrictTo } from '../middleware/auth.js';
import { exportLimiter } from '../middleware/exportRateLimit.js';
import AppError from '../utils/AppError.js';

/**
 * Roles allowed to bulk-export requisitions. Vendors are external companies and
 * are deliberately excluded: the export carries `budget_min`/`budget_max` for
 * every open role, which is commercially sensitive. They have no UI route to
 * MRF either (`VENDOR_ALLOWED_PATHS` in MainLayout.jsx), but that is a
 * client-side confinement — a vendor's token can call the API directly.
 */
const MRF_EXPORT_ROLES = ['admin', 'superadmin', 'recruiter', 'hr'];
// Who may close a requisition by hand (Q34). Same set as exports today, but
// named separately so tightening one does not silently move the other.
const MRF_CLOSURE_ROLES = ['admin', 'superadmin', 'recruiter', 'hr'];

const router = Router();

// Ensure upload directory exists
const uploadDir = path.resolve(config.upload.dir || './uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `mrf-${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

// A JD or test paper is a document. This route had NO fileFilter at all, so it
// accepted any extension — including .exe — on a PUBLIC, unauthenticated
// endpoint (see the submit route below). Same class of hole as defect D7, on a
// route the D7 write-up never listed.
const ALLOWED_EXTS = ['.pdf', '.docx', '.doc'];

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTS.includes(ext)) {
      cb(null, true);
    } else {
      // AppError, not a bare Error: a bare one carries no statusCode, so the
      // global handler treats a wrong file type as a 500 and emails the team a
      // "Backend Error Alert" (defect D6).
      cb(new AppError(`File type ${ext} is not allowed. Accepted: ${ALLOWED_EXTS.join(', ')}.`, 400));
    }
  },
});

// ── Public MRF endpoints (No Authentication required) ───────────────────
router.get('/prefill-options', mrfController.getPrefillOptions);
router.post('/submit', upload.fields([
  { name: 'attach_jd', maxCount: 1 },
  { name: 'attach_online_test_paper', maxCount: 1 }
]), mrfController.submitHiringManagerMrf);
router.get('/public-details/:id', mrfController.getPublicMrfDetails);
router.post('/:id/approve', mrfController.handleMrfApproval);

// ── Private MRF endpoints (Require login) ──────────────────────────────
router.use(authenticate);

router.post('/', mrfController.createMrfRequest);
router.get('/', mrfController.listMrfRequests);
// Registered before '/:id' so 'export' is never captured as an MRF id — the
// controller would run BigInt('export') and 500.
router.get('/export', restrictTo(...MRF_EXPORT_ROLES), exportLimiter, mrfController.exportMrfRequests);
// One requisition (request + the MRF the Hiring Manager submitted), from the
// details modal. Two path segments, so it cannot collide with '/:id'.
router.get('/:id/export', restrictTo(...MRF_EXPORT_ROLES), exportLimiter, mrfController.exportMrfDetail);
// View/edit the submitted main MRF record (rpa_mrf). Declared before '/:id' for clarity.
router.get('/main/:id', mrfController.getMainMrf);
router.patch('/main/:id', mrfController.updateMainMrf);
// Manual requisition closure (Q34). Two path segments, so no '/:id' collision.
// Never writes approval_status or mrfstatus — closure lives in closed_at.
router.get('/closure-reasons', mrfController.listClosureReasons);
router.post('/:id/close', restrictTo(...MRF_CLOSURE_ROLES), mrfController.closeMrf);
router.post('/:id/reopen', restrictTo(...MRF_CLOSURE_ROLES), mrfController.reopenMrf);
router.get('/:id', mrfController.getMrfRequest);
router.patch('/:id', mrfController.updateMrfRequest);

export default router;

