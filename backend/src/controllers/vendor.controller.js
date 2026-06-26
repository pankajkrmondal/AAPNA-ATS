import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import prisma from '../config/database.js';
import * as candidateService from '../services/candidate.service.js';
import * as hrUploadService from '../services/hrUpload.service.js';
import * as uploadJobService from '../services/uploadJob.service.js';
import { success } from '../utils/apiResponse.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';
import logger from '../config/logger.js';
import config from '../config/index.js';

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.doc') return 'application/msword';
  return 'application/octet-stream';
}

/**
 * @desc    Get candidates uploaded by the logged-in vendor
 * @route   GET /api/vendor/candidates
 * @access  Private (Vendor, HR, Admin)
 */
export const getVendorCandidates = catchAsync(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    search,
    filterName,
    filterEmail,
    filterPosition,
    sort = 'createdAt',
    order = 'desc',
  } = req.query;

  // Vendors are locked to their own email; staff scope the list to the vendor
  // they've selected (mirrors getVendorDashboard).
  const isVendor = (req.user.role || '').toLowerCase() === 'vendor';
  const vendorEmail = isVendor
    ? req.user.email
    : (req.query.vendorEmail || '').trim();

  if (isVendor && !vendorEmail) {
    throw new AppError('Vendor email is required for listing candidates.', 400);
  }

  // Staff who haven't picked a vendor yet get an empty list (nothing to scope to).
  if (!vendorEmail) {
    return res.status(200).json({
      status: 'success',
      message: 'Select a vendor to view their candidates',
      data: [],
      stats: { total: 0, withPosition: 0, thisMonth: 0 },
      pagination: {
        page: 1,
        limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 20)),
        total: 0,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
      },
    });
  }

  const filters = { search, filterName, filterEmail, filterPosition, vendorEmail };
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const [result, stats] = await Promise.all([
    candidateService.search(filters, pageNum, limitNum, sort, order),
    candidateService.vendorStats(vendorEmail),
  ]);

  return res.status(200).json({
    status: 'success',
    message: 'Vendor candidates retrieved',
    data: result.data,
    stats,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: result.total,
      totalPages: Math.ceil(result.total / limitNum),
      hasNext: pageNum * limitNum < result.total,
      hasPrev: pageNum > 1,
    },
  });
});

/**
 * @desc    Vendor dashboard summary (candidate status overview)
 * @route   GET /api/vendor/dashboard
 * @access  Private — vendors see their own; staff pick a vendor via ?vendorEmail
 */
export const getVendorDashboard = catchAsync(async (req, res) => {
  const role = (req.user.role || '').toLowerCase();
  const isVendor = role === 'vendor';

  // Vendors are locked to their own email; staff choose a vendor via the query.
  const vendorEmail = isVendor
    ? req.user.email
    : (req.query.vendorEmail || '').trim();

  if (isVendor && !vendorEmail) {
    throw new AppError('Vendor email is required for the dashboard.', 400);
  }

  // Staff default to an all-vendors overview (vendorEmail empty); a chosen vendor
  // (or a logged-in vendor) scopes everything to that vendor.
  const recentFilter = vendorEmail ? { vendorEmail } : { vendorOnly: true };

  // Count duplicates awaiting recruiter review (scoped or global). Best-effort —
  // depends on the job-tracking table being provisioned.
  let pendingReview = 0;
  if (prisma.rpa_upload_jobs) {
    pendingReview = await prisma.rpa_upload_jobs.count({
      where: {
        source: 'vendor_portal',
        action_required: true,
        ...(vendorEmail ? { vendor_email: { equals: vendorEmail, mode: 'insensitive' } } : {}),
      },
    }).catch(() => 0);
  }

  const [summary, recent] = await Promise.all([
    candidateService.vendorStatusSummary(vendorEmail || undefined),
    candidateService.search(recentFilter, 1, 5, 'createdAt', 'desc'),
  ]);

  return res.status(200).json({
    status: 'success',
    message: vendorEmail ? 'Vendor dashboard retrieved' : 'All-vendors dashboard retrieved',
    data: {
      stats: { ...summary, pendingReview },
      recentCandidates: recent.data,
      selectedVendorEmail: vendorEmail || null,
      scope: vendorEmail ? 'vendor' : 'all',
    },
  });
});

/**
 * @desc    List registered vendors (for the staff vendor-picker)
 * @route   GET /api/vendor/vendors
 * @access  Private (Admin, SuperAdmin, Recruiter)
 */
export const listVendors = catchAsync(async (req, res) => {
  const vendors = await prisma.rpa_users.findMany({
    where: { role: 'vendor' },
    select: { id: true, email: true, first_name: true, last_name: true },
    orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
  });

  const data = vendors
    .filter((v) => v.email)
    .map((v) => ({
      email: v.email,
      name: `${v.first_name || ''} ${v.last_name || ''}`.trim() || v.email,
    }));

  return res.status(200).json({
    status: 'success',
    message: 'Vendors retrieved',
    data,
  });
});

/**
 * @desc    Handle resume uploads from vendor, unzip packages, and log batch details
 * @route   POST /api/vendor/upload
 * @access  Private (Vendor, HR, Admin)
 */
export const uploadResumes = catchAsync(async (req, res) => {
  const files = req.files || [];
  if (files.length === 0) {
    throw new AppError('No files uploaded.', 400);
  }

  const username = req.user.username || 'vendor';
  const executionId = uuidv4();

  // Determine attribution: vendors upload for themselves; staff upload on behalf
  // of a selected vendor (required, validated against a real vendor account).
  const isVendor = (req.user.role || '').toLowerCase() === 'vendor';
  let vendorEmail;
  let vendorFullName;

  if (isVendor) {
    const firstName = req.user.first_name || '';
    const lastName = req.user.last_name || '';
    vendorEmail = req.user.email || 'unknown@vendor.com';
    vendorFullName = `${firstName} ${lastName}`.trim() || username;
  } else {
    const selectedEmail = (req.body.vendorEmail || '').trim();
    if (!selectedEmail) {
      throw new AppError('Please select a vendor to upload on behalf of.', 400);
    }
    const vendor = await prisma.rpa_users.findFirst({
      where: { email: selectedEmail, role: 'vendor' },
      select: { email: true, first_name: true, last_name: true },
    });
    if (!vendor) {
      throw new AppError('Selected vendor not found.', 400);
    }
    vendorEmail = vendor.email;
    vendorFullName = `${vendor.first_name || ''} ${vendor.last_name || ''}`.trim() || vendor.email;
  }

  const attribution = { vendorEmail, vendorName: vendorFullName };

  logger.info(
    `${isVendor ? 'Vendor' : 'Staff'} ${username} uploading ${files.length} files on behalf of ${vendorEmail} (Batch: ${executionId})`,
  );

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
          const filename = `vendor-resumes-${uniqueSuffix}${extName}`;
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
        
        // Remove temporary uploaded ZIP
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
  const batchSummary = await prisma.rpa_upload_batch_summary.create({
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
        vendor_email: vendorEmail,
        vendor_name: vendorFullName,
        files: flatFiles.map(f => ({ name: f.originalname, size: f.size })),
      },
    },
  });

  // 2) Write individual logs (status: pending, source: vendor_portal)
  const logsData = flatFiles.map(file => ({
    execution_id: executionId,
    file_name: file.originalname,
    status: 'pending',
    source: 'vendor_portal',
    processed_at: new Date(),
  }));

  await Promise.all(
    logsData.map(log =>
      prisma.rpa_upload_log.create({
        data: log,
      })
    )
  );

  // 2b) Create durable per-resume job rows (powers the persistent dashboard)
  await uploadJobService.createJobsForBatch(executionId, flatFiles, {
    uploadedBy: username,
    uploadedById: req.user.id,
    vendorEmail: attribution.vendorEmail,
    vendorName: attribution.vendorName,
    source: 'vendor_portal',
  });

  // 3) Dispatch parsing (durable queue when enabled, else in-process background)
  await hrUploadService.dispatchBatchParsing(executionId, flatFiles, req.user, 'vendor_portal', attribution);

  return success(
    res,
    {
      executionId,
      totalFiles: flatFiles.length,
      batchSummary,
    },
    'Files uploaded successfully and queued for parsing.'
  );
});

/**
 * @desc    Get upload summary for a batch
 * @route   GET /api/vendor/summary/:executionId
 * @access  Private (Vendor, HR, Admin)
 */
export const getSummary = catchAsync(async (req, res) => {
  const { executionId } = req.params;
  const summary = await hrUploadService.getUploadSummary(executionId);
  return success(res, summary, 'Upload batch summary retrieved');
});

/**
 * @desc    Get upload batches for the logged-in vendor
 * @route   GET /api/vendor/batches
 * @access  Private (Vendor, HR, Admin)
 */
export const getUploadBatches = catchAsync(async (req, res) => {
  const username = req.user.username;

  const batches = await prisma.rpa_upload_batch_summary.findMany({
    where: {
      uploaded_by: username,
    },
    orderBy: {
      uploaded_at: 'desc',
    },
    take: 20,
  });

  return success(res, batches, 'Vendor upload batches retrieved');
});

/**
 * @desc    Persistent upload/job-tracking dashboard feed (one row per resume).
 *          Vendors see their own jobs; staff see all (or a chosen vendor via ?vendorEmail).
 * @route   GET /api/vendor/jobs
 * @access  Private (Vendor + staff with vendor_upload)
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
  // already complete (statusActive = ACTIVE). This keeps the dashboard correct no matter
  // which path resolved the missing data (public form, recruiter edit, merge, re-upload),
  // and covers candidates with multiple job rows. Cheap (filtered on status) and best-effort.
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
    logger.warn(`Upload-job self-heal skipped: ${e.message}`);
  }

  const { page = 1, limit = 20, status, actionRequired } = req.query;
  const role = (req.user.role || '').toLowerCase();
  const isVendor = role === 'vendor';
  const isAdmin = role === 'admin' || role === 'superadmin';

  // The Vendor screen only ever shows vendor-portal uploads (never HR manual uploads).
  const where = { source: 'vendor_portal' };

  // Visibility scoping:
  //  • admin / superadmin → all vendor-portal uploads
  //  • recruiter / hr     → only the records THEY uploaded (on behalf of a vendor), plus
  //                         anything needing review (the review queue is shared across recruiters)
  //  • vendor             → only their OWN self-uploads
  if (!isAdmin) {
    if (isVendor) {
      where.uploaded_by_id = req.user.id;
    } else {
      where.OR = [
        { uploaded_by_id: req.user.id },
        { action_required: true },
      ];
    }
  }

  // Optional staff filter: drill into a specific vendor.
  if (!isVendor) {
    const vendorEmail = (req.query.vendorEmail || '').trim();
    if (vendorEmail) where.vendor_email = { equals: vendorEmail, mode: 'insensitive' };
  }
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

  // Status roll-up for the KPI cards (accurate across the whole scoped set, not just this page).
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
 * @route   POST /api/vendor/jobs/:id/reprocess
 * @access  Private (Vendor + staff with vendor_upload)
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
      logMessage: `Recruiter triggered reprocess for upload job ${id}`,
      createdAt: new Date(),
    },
  }).catch(() => {});

  const attribution = job.vendor_email
    ? { vendorEmail: job.vendor_email, vendorName: job.vendor_name }
    : null;

  await hrUploadService.dispatchBatchParsing(
    job.execution_id,
    [fileObj],
    req.user,
    job.source || 'vendor_portal',
    attribution,
  );

  return success(res, { id }, 'Resume reprocessing started.');
});

/**
 * @desc    Recruiter review action — MERGE selected duplicates into the main DB.
 * @route   POST /api/vendor/review/merge
 * @access  Private (staff: admin/superadmin/recruiter/hr)
 */
export const reviewMerge = catchAsync(async (req, res) => {
  const { ids } = req.body;
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const result = await hrUploadService.mergeDuplicates(ids, token, req.user);
  return success(res, result, 'Duplicate candidates merged successfully');
});

/**
 * @desc    Recruiter review action — CANCEL/reject selected duplicates.
 * @route   POST /api/vendor/review/cancel
 * @access  Private (staff: admin/superadmin/recruiter/hr)
 */
export const reviewCancel = catchAsync(async (req, res) => {
  const { ids } = req.body;
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const result = await hrUploadService.deleteDuplicates(ids, token);
  return success(res, result, 'Duplicate candidates cancelled');
});
