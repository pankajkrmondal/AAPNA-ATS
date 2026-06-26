import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import prisma from '../config/database.js';
import { success } from '../utils/apiResponse.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import * as hrUploadService from '../services/hrUpload.service.js';
import * as uploadJobService from '../services/uploadJob.service.js';

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.doc') return 'application/msword';
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === '.xls') return 'application/vnd.ms-excel';
  return 'application/octet-stream';
}

/**
 * @desc    Handle HR manual resume uploads and log batch details
 * @route   POST /api/hr-upload/upload
 * @access  Private (HR, Admin)
 */
export const uploadResumes = catchAsync(async (req, res) => {
  const files = req.files || [];
  if (files.length === 0) {
    throw new AppError('No files uploaded.', 400);
  }

  const hrEmail = req.user.email || 'unknown@hr.com';
  const username = req.user.username || 'hr';
  const firstName = req.user.first_name || '';
  const lastName = req.user.last_name || '';
  const hrFullName = `${firstName} ${lastName}`.trim() || username;
  const executionId = uuidv4();

  logger.info(`HR ${username} uploading ${files.length} files (Batch: ${executionId})`);

  // Unpack any zip files to flatten the file list
  const uploadDir = path.resolve(config.upload.dir);
  const flatFiles = [];

  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.zip') {
      try {
        const zip = new AdmZip(file.path);
        const entries = zip.getEntries();
        for (const entry of entries) {
          if (entry.isDirectory) continue;
          
          const baseName = path.basename(entry.entryName);
          if (baseName.startsWith('.') || entry.entryName.includes('__MACOSX')) {
            continue;
          }
          
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const extName = path.extname(entry.entryName);
          const filename = `hr-resumes-${uniqueSuffix}${extName}`;
          const filePath = path.join(uploadDir, filename);
          
          fs.writeFileSync(filePath, entry.getData());
          
          flatFiles.push({
            fieldname: file.fieldname,
            originalname: baseName,
            encoding: '7bit',
            mimetype: getMimeType(entry.entryName),
            destination: uploadDir,
            filename: filename,
            path: filePath,
            size: entry.header.size
          });
        }
        
        // Remove the temporary uploaded ZIP file
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      } catch (err) {
        logger.error(`Error unpacking zip file: ${file.originalname}`, { error: err.message });
        flatFiles.push(file);
      }
    } else {
      flatFiles.push(file);
    }
  }

  if (flatFiles.length === 0) {
    throw new AppError('No valid files found inside the uploaded ZIP archive(s).', 400);
  }

  // 1) Write batch summary log
  await prisma.rpa_upload_batch_summary.create({
    data: {
      execution_id: executionId,
      uploaded_by: username,
      uploaded_at: new Date(),
      total_count: flatFiles.length,
      success_count: 0,
      failed_count: 0,
      duplicate_count: 0,
      update_count: 0,
      details: {
        hr_email: hrEmail,
        hr_name: hrFullName,
        files: flatFiles.map((f) => ({ name: f.originalname, size: f.size })),
      },
    },
  });

  // 2) Write individual logs (status: pending, source: hr_manual_upload)
  const logsData = flatFiles.map((file) => ({
    execution_id: executionId,
    file_name: file.originalname,
    status: 'pending',
    source: 'hr_manual_upload',
    processed_at: new Date(),
  }));

  await Promise.all(
    logsData.map((log) =>
      prisma.rpa_upload_log.create({
        data: log,
      })
    )
  );

  // 2b) Create durable per-resume job rows (powers the persistent dashboard)
  await uploadJobService.createJobsForBatch(executionId, flatFiles, {
    uploadedBy: username,
    uploadedById: req.user.id,
    source: 'hr_manual_upload',
  });

  // 3) Dispatch parsing (durable queue when enabled, else in-process background)
  await hrUploadService.dispatchBatchParsing(executionId, flatFiles, req.user, 'hr_manual_upload');

  return success(
    res,
    {
      executionId,
      totalFiles: flatFiles.length,
    },
    'Files uploaded successfully and queued for parsing.'
  );
});

/**
 * @desc    Get upload summary for a batch
 * @route   GET /api/hr-upload/summary/:executionId
 * @access  Private (HR, Admin)
 */
export const getSummary = catchAsync(async (req, res) => {
  const { executionId } = req.params;
  const summary = await hrUploadService.getUploadSummary(executionId);
  return success(res, summary, 'Upload batch summary retrieved');
});

/**
 * @desc    Persistent upload/job-tracking dashboard feed (one row per resume).
 *          Scoped to HR manual uploads (source = 'hr_manual_upload') — a shared
 *          queue visible to the authorized HR/recruiter roles.
 * @route   GET /api/hr-upload/jobs
 * @access  Private (HR, Admin, Recruiter w/ hr_manual_upload)
 */
export const getUploadJobs = catchAsync(async (req, res) => {
  // Graceful degradation when the job-tracking table isn't provisioned yet.
  if (!prisma.rpa_upload_jobs) {
    return res.status(200).json({
      status: 'success',
      message: 'Upload job tracking is not provisioned yet',
      data: [],
      stats: { actionRequired: 0 },
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
    });
  }

  // Self-heal: advance any "Awaiting Candidate Details" job whose linked candidate is
  // already complete (statusActive = ACTIVE). Keeps the dashboard correct regardless of
  // which path resolved the missing data. Cheap (filtered on status) and best-effort.
  try {
    await prisma.$executeRaw`
      UPDATE rpa_upload_jobs AS j
      SET status = 'Completed', action_required = false, updated_at = now()
      FROM rpa_cv AS c
      WHERE j.cv_id = c.id
        AND j.status = 'Missing_Information'
        AND c."statusActive" = 'ACTIVE'
    `;
  } catch (e) {
    logger.warn(`HR upload-job self-heal skipped: ${e.message}`);
  }

  const { page = 1, limit = 20, status, actionRequired } = req.query;

  const where = { source: 'hr_manual_upload' };
  if (status) where.status = status;
  if (actionRequired === 'true') where.action_required = true;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const [rows, total, actionCount, grouped] = await Promise.all([
    prisma.rpa_upload_jobs.findMany({
      where,
      orderBy: { updated_at: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
    }),
    prisma.rpa_upload_jobs.count({ where }),
    prisma.rpa_upload_jobs.count({ where: { ...where, action_required: true } }),
    prisma.rpa_upload_jobs.groupBy({ by: ['status'], where, _count: { _all: true } }),
  ]);

  // Status roll-up for the KPI cards (accurate across the whole set, not just this page).
  const byStatus = {};
  grouped.forEach((g) => { byStatus[g.status] = g._count._all; });
  const processing = (byStatus.Processing || 0) + (byStatus.Queued || 0) + (byStatus.Uploaded || 0);
  const completed = byStatus.Completed || 0;

  return res.status(200).json({
    status: 'success',
    message: 'Upload jobs retrieved',
    data: rows.map(uploadJobService.serializeJob),
    stats: { actionRequired: actionCount, total, processing, completed },
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
      hasNext: pageNum * limitNum < total,
      hasPrev: pageNum > 1,
    },
  });
});

/**
 * @desc    Reprocess a failed upload job by re-running parsing on its stored file.
 * @route   POST /api/hr-upload/jobs/:id/reprocess
 * @access  Private (HR, Admin, Recruiter w/ hr_manual_upload)
 */
export const reprocessJob = catchAsync(async (req, res) => {
  if (!prisma.rpa_upload_jobs) {
    throw new AppError('Upload job tracking is not provisioned yet.', 503);
  }
  const { id } = req.params;
  const job = await prisma.rpa_upload_jobs.findUnique({ where: { id: BigInt(id) } });
  if (!job) {
    throw new AppError('Upload job not found.', 404);
  }
  if (job.status !== 'Failed') {
    throw new AppError('Only failed jobs can be reprocessed.', 400);
  }

  // Locate the original file in the uploads directory (local fallback path).
  const basename = (job.file_url || '').startsWith('/uploads/') ? path.basename(job.file_url) : null;
  const uploadDir = path.resolve(config.upload.dir);
  const diskPath = basename ? path.join(uploadDir, basename) : null;
  if (!diskPath || !fs.existsSync(diskPath)) {
    throw new AppError('The original resume file is no longer available on the server. Please re-upload it.', 422);
  }

  const fileObj = {
    originalname: job.file_name,
    path: diskPath,
    filename: basename,
    size: fs.statSync(diskPath).size,
  };

  await uploadJobService.updateJobById(id, {
    status: 'Queued',
    error_message: null,
    attempts: (job.attempts || 0) + 1,
  });
  await prisma.rpa_processing_log.create({
    data: {
      fileName: job.file_name,
      source: 'REPROCESS',
      status: 'reprocess',
      logMessage: `Recruiter triggered reprocess for HR upload job ${id}`,
      createdAt: new Date(),
    },
  }).catch(() => {});

  await hrUploadService.dispatchBatchParsing(
    job.execution_id,
    [fileObj],
    req.user,
    job.source || 'hr_manual_upload',
    null,
  );

  return success(res, { id }, 'Resume reprocessing started.');
});

/**
 * @desc    Search duplicate records in review queue
 * @route   POST /api/hr-upload/duplicates/search
 * @access  Private (HR, Admin)
 */
export const searchDuplicates = catchAsync(async (req, res) => {
  const { filterName, filterEmail, page, perPage } = req.body;
  const result = await hrUploadService.searchDuplicates({
    filterName,
    filterEmail,
    page: parseInt(page, 10) || 1,
    perPage: parseInt(perPage, 10) || 5,
  });
  return success(res, result, 'Duplicate candidates retrieved');
});

/**
 * @desc    Merge selected duplicates into main candidate table
 * @route   POST /api/hr-upload/duplicates/merge
 * @access  Private (HR, Admin)
 */
export const mergeDuplicates = catchAsync(async (req, res) => {
  const { ids } = req.body;
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const result = await hrUploadService.mergeDuplicates(ids, token, req.user);
  return success(res, result, 'Duplicate candidates merged successfully');
});

/**
 * @desc    Delete selected duplicates from review queue
 * @route   POST /api/hr-upload/duplicates/delete
 * @access  Private (HR, Admin)
 */
export const deleteDuplicates = catchAsync(async (req, res) => {
  const { ids } = req.body;
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const result = await hrUploadService.deleteDuplicates(ids, token);
  return success(res, result, 'Duplicate candidates deleted successfully');
});
