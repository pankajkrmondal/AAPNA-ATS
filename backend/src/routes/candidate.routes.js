import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import config from '../config/index.js';
import * as candidateController from '../controllers/candidate.controller.js';
import { authenticate } from '../middleware/auth.js';

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
      cb(new Error(`File type ${ext} is not allowed. Only ${allowedExts.join(', ')} are accepted.`));
    }
  },
});

// Public candidate routes (unauthenticated)
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
 * GET /api/candidates/:id
 * Retrieve a single candidate by ID
 */
router.get('/:id', candidateController.getCandidate);

/**
 * PATCH /api/candidates/:id
 * Update a candidate record (partial update)
 */
router.patch('/:id', candidateController.updateCandidate);

/**
 * GET /api/candidates/:id/emails
 * Retrieve email conversations associated with a candidate
 */
router.get('/:id/emails', candidateController.getCandidateEmails);

export default router;
