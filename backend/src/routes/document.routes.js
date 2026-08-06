import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import config from '../config/index.js';
import { getDocumentRequest, uploadCandidateDocument } from '../controllers/document.controller.js';

const router = Router();

const uploadDir = path.resolve(config.upload.dir);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `candidate-doc-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

// Wider than the resume uploader's pdf/docx: payslips and government IDs are
// routinely photographed or scanned, so images have to be accepted too.
const ALLOWED_EXTS = ['.pdf', '.docx', '.doc', '.jpg', '.jpeg', '.png'];

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} is not allowed. Accepted: ${ALLOWED_EXTS.join(', ')}.`));
    }
  },
});

// PUBLIC routes — intentionally NO authenticate middleware: candidates have no
// ATS session (mirrors scorecard.routes.js). The uuid token is the only
// credential, validated in the controller.
router.get('/:token', getDocumentRequest);
router.post('/:token/upload', upload.single('document'), uploadCandidateDocument);

export default router;
