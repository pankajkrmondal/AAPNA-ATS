import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import prisma from '../config/database.js';
import * as candidateService from '../services/candidate.service.js';
import * as hrUploadService from '../services/hrUpload.service.js';
import { success, paginated } from '../utils/apiResponse.js';
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
  const { page = 1, limit = 20, search, sort = 'createdAt', order = 'desc' } = req.query;

  const vendorEmail = req.user.email;
  if (!vendorEmail) {
    throw new AppError('Vendor email is required for listing candidates.', 400);
  }

  const filters = { search, vendorEmail };
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const result = await candidateService.search(filters, pageNum, limitNum, sort, order);

  return paginated(res, result.data, pageNum, limitNum, result.total, 'Vendor candidates retrieved');
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

  const vendorEmail = req.user.email || 'unknown@vendor.com';
  const username = req.user.username || 'vendor';
  const firstName = req.user.first_name || '';
  const lastName = req.user.last_name || '';
  const vendorFullName = `${firstName} ${lastName}`.trim() || username;
  const executionId = uuidv4();

  logger.info(`Vendor ${username} uploading ${files.length} files (Batch: ${executionId})`);

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

  // 3) Trigger parsing asynchronously in background
  await hrUploadService.startBackgroundParsing(executionId, flatFiles, req.user, 'vendor_portal');

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
