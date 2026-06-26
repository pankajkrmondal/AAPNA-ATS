/**
 * uploadJob.service.js — lifecycle for rpa_upload_jobs, the durable per-resume
 * job records that power the persistent upload/job-tracking dashboard.
 *
 * Every status transition is persisted AND pushed over Socket.io so open
 * dashboards update live. Records survive navigation and server restarts.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import { emitToUser, emitToRole } from '../socket/index.js';

/** Canonical job statuses (also the display labels with spaces, see STATUS_LABELS). */
export const JOB_STATUS = Object.freeze({
  UPLOADED: 'Uploaded',
  QUEUED: 'Queued',
  PROCESSING: 'Processing',
  DUPLICATE_PENDING_REVIEW: 'Duplicate_Pending_Review',
  MISSING_INFORMATION: 'Missing_Information',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  REJECTED_SYSTEM: 'Rejected_By_System',
});

/** Roles that should receive "a duplicate needs review" notifications. */
const REVIEW_ROLES = ['recruiter', 'hr', 'admin', 'superadmin'];

/**
 * Fail-safe: the job-tracking feature requires the `rpa_upload_jobs` model in the
 * generated Prisma client (i.e. the table must be provisioned and `prisma generate`
 * / `db pull` run). If it isn't present, job tracking is disabled gracefully so the
 * core upload/parse flow never breaks. Returns true when the model is available.
 */
let warnedMissingModel = false;
export function jobsModelReady() {
  if (!prisma.rpa_upload_jobs) {
    if (!warnedMissingModel) {
      warnedMissingModel = true;
      logger.warn(
        'rpa_upload_jobs is not in the Prisma client — upload job tracking is disabled. '
        + 'Apply the DDL and regenerate the client (npx prisma db pull && npx prisma generate).',
      );
    }
    return false;
  }
  return true;
}

/** Convert BigInt ids to strings so the record is JSON/serialisable. */
export function serializeJob(job) {
  if (!job) return null;
  return {
    ...job,
    id: job.id != null ? job.id.toString() : null,
    cv_id: job.cv_id != null ? job.cv_id.toString() : null,
    cv_tmp_id: job.cv_tmp_id != null ? job.cv_tmp_id.toString() : null,
  };
}

/** Emit a job update to its uploader and (when review is required) to staff. */
function emitJob(job) {
  const payload = serializeJob(job);
  try {
    if (job.uploaded_by_id) {
      emitToUser(job.uploaded_by_id, 'upload:job', payload);
    }
    if (job.action_required) {
      for (const role of REVIEW_ROLES) {
        emitToRole(role, 'review:new', payload);
      }
    }
  } catch (err) {
    // Socket.io may not be initialised (e.g. in a standalone worker) — never fatal.
    logger.debug(`Socket emit skipped for job ${job.id}: ${err.message}`);
  }
}

/**
 * Create one job row per uploaded file for a batch. Returns the created rows.
 * @param {string} executionId
 * @param {Array<{ originalname: string }>} files
 * @param {Object} ctx - { uploadedBy, uploadedById, vendorEmail, vendorName, source }
 */
export async function createJobsForBatch(executionId, files, ctx = {}) {
  if (!jobsModelReady()) return [];
  const created = [];
  for (const file of files) {
    const job = await prisma.rpa_upload_jobs.create({
      data: {
        execution_id: executionId,
        file_name: file.originalname,
        status: JOB_STATUS.UPLOADED,
        uploaded_by: ctx.uploadedBy || null,
        uploaded_by_id: ctx.uploadedById || null,
        vendor_email: ctx.vendorEmail || null,
        vendor_name: ctx.vendorName || null,
        source: ctx.source || 'vendor_portal',
      },
    });
    created.push(job);
    emitJob(job);
  }
  return created;
}

/**
 * Patch a job identified by (execution_id, file_name) and emit the change.
 * Uses updateMany then re-reads so we can emit the full row. In practice
 * (exec, file) is unique for resume uploads (one file = one candidate).
 */
export async function updateJob(executionId, fileName, patch = {}) {
  if (!jobsModelReady()) return null;
  await prisma.rpa_upload_jobs.updateMany({
    where: { execution_id: executionId, file_name: fileName },
    data: patch,
  });
  const job = await prisma.rpa_upload_jobs.findFirst({
    where: { execution_id: executionId, file_name: fileName },
    orderBy: { id: 'desc' },
  });
  if (job) emitJob(job);
  return job;
}

/** Convenience: set just the status (+ optional extra fields). */
export function setJobStatus(executionId, fileName, status, extra = {}) {
  return updateJob(executionId, fileName, { status, ...extra });
}

/** Patch a job by its primary id (used by review actions / reprocess) and emit. */
export async function updateJobById(id, patch = {}) {
  if (!jobsModelReady()) return null;
  const job = await prisma.rpa_upload_jobs.update({
    where: { id: BigInt(id) },
    data: patch,
  });
  emitJob(job);
  return job;
}

/**
 * Patch the job(s) linked to a staging (rpa_cv_tmp) record and emit. Used by the
 * recruiter Merge/Cancel review actions to flip the originating job's status.
 */
export async function updateJobByCvTmpId(cvTmpId, patch = {}) {
  if (!jobsModelReady()) return null;
  await prisma.rpa_upload_jobs.updateMany({
    where: { cv_tmp_id: BigInt(cvTmpId) },
    data: patch,
  });
  const job = await prisma.rpa_upload_jobs.findFirst({
    where: { cv_tmp_id: BigInt(cvTmpId) },
    orderBy: { id: 'desc' },
  });
  if (job) emitJob(job);
  return job;
}

/**
 * Patch the job(s) for a saved candidate and emit. Matches by `cv_id` and/or
 * candidate `email` (the job may have been linked by either). Used when a candidate
 * completes their Missing-Information submission so the job advances to "Saved to
 * Database". `onlyStatuses` guards against clobbering terminal states.
 */
export async function updateJobByCvId(cvId, patch = {}, onlyStatuses = null, email = null) {
  if (!jobsModelReady()) return null;
  const match = [];
  if (cvId != null) match.push({ cv_id: BigInt(cvId) });
  if (email) match.push({ candidate_email: { equals: email, mode: 'insensitive' } });
  if (match.length === 0) return null;

  const where = { OR: match };
  if (onlyStatuses) where.status = { in: onlyStatuses };
  const result = await prisma.rpa_upload_jobs.updateMany({ where, data: patch });
  logger.info(`updateJobByCvId: cvId=${cvId}, email=${email}, statuses=${onlyStatuses ? onlyStatuses.join('|') : 'any'} → ${result.count} job(s) updated`);

  const job = await prisma.rpa_upload_jobs.findFirst({
    where: { OR: match },
    orderBy: { id: 'desc' },
  });
  if (job) emitJob(job);
  return job;
}
