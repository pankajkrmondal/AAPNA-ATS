import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import config from '../config/index.js';
import * as mrfController from '../controllers/mrf.controller.js';
import { authenticate } from '../middleware/auth.js';

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

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
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
// View/edit the submitted main MRF record (rpa_mrf). Declared before '/:id' for clarity.
router.get('/main/:id', mrfController.getMainMrf);
router.patch('/main/:id', mrfController.updateMainMrf);
router.get('/:id', mrfController.getMrfRequest);
router.patch('/:id', mrfController.updateMrfRequest);

export default router;

