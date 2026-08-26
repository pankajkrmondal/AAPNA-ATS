import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import config from '../config/index.js';
import * as assessmentImportController from '../controllers/assessmentImport.controller.js';
import AppError from '../utils/AppError.js';

const router = Router();

// Own upload subdirectory — plain CSV/XLSX exports, not hrUpload's zip bundles.
const uploadDir = path.resolve(config.upload.dir, 'assessment-import');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `evalground-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB — plain CSV/XLSX exports, not zip bundles
  },
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.csv', '.xlsx'];
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

// NOTE: mounted from pipeline.routes.js, which already applies
// authenticate + checkModuleAccess('recruitment_pipeline') to this whole
// sub-router — no separate module-permission key for this feature.

/** POST /api/pipeline/assessment-import/preview — parse a CSV/XLSX file, nothing written yet. */
router.post('/preview', upload.single('file'), assessmentImportController.preview);

/** POST /api/pipeline/assessment-import/commit — confirm mappings, write the import. */
router.post('/commit', assessmentImportController.commit);

/** GET /api/pipeline/assessment-import/history — paginated import batches. */
router.get('/history', assessmentImportController.history);

/** GET /api/pipeline/assessment-import/candidate/:pipelineId — latest result for one journey. */
router.get('/candidate/:pipelineId', assessmentImportController.getCandidateResult);

/** POST /api/pipeline/assessment-import/invite — send (email) or record (manual) an Evalground invite. */
router.post('/invite', assessmentImportController.sendInvite);

/** GET /api/pipeline/assessment-import/invite/:pipelineId — latest invite + overdue state for one journey. */
router.get('/invite/:pipelineId', assessmentImportController.getInviteState);

export default router;
