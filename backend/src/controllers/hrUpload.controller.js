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

  // 3) Trigger parsing asynchronously in background
  await hrUploadService.startBackgroundParsing(executionId, flatFiles, req.user);

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
