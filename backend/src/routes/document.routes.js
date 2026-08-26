import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import config from '../config/index.js';
import AppError from '../utils/AppError.js';
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
//
// .zip is accepted because a single checklist row often means several files —
// three months of payslips is three PDFs — and the page allows one file per row.
// Candidates were already zipping them and being turned away at the last step.
// Note the signature check can only prove a .zip IS a zip, not what is inside;
// the recruiter opens it during verification, same as any other document.
const ALLOWED_EXTS = ['.pdf', '.docx', '.doc', '.jpg', '.jpeg', '.png', '.zip'];

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTS.includes(ext)) {
      cb(null, true);
    } else {
      // AppError, NOT a bare Error (defect D6, 2026-08-20). A plain Error carries
      // no statusCode and no isOperational flag, so the global handler treated a
      // candidate picking the wrong file type as a SERVER fault: it answered 500
      // instead of 400, discarded the explanatory message in production (only
      // operational errors keep theirs — errorHandler.js sendProdError), and
      // fired a "Backend Error Alert" email to the team on every occurrence.
      // This route is public and unauthenticated, so that last one was reachable
      // by anyone holding a document token.
      cb(new AppError(`File type ${ext} is not allowed. Accepted: ${ALLOWED_EXTS.join(', ')}.`, 400));
    }
  },
});

// PUBLIC routes — intentionally NO authenticate middleware: candidates have no
// ATS session (mirrors scorecard.routes.js). The uuid token is the only
// credential, validated in the controller.
router.get('/:token', getDocumentRequest);
router.post('/:token/upload', upload.single('document'), uploadCandidateDocument);

export default router;
