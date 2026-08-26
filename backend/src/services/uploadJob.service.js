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
import { notify, NOTIFICATION_TYPES } from './notification.service.js';

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

/**
 * Statuses a job can still move on from under its own steam. A row sitting in one
 * of these is either genuinely in flight or was stranded by a parse that hung or a
 * process that died mid-batch — which is what the dashboard reconciler looks for.
 */
export const NON_TERMINAL_STATUSES = Object.freeze([
  JOB_STATUS.UPLOADED,
  JOB_STATUS.QUEUED,
  JOB_STATUS.PROCESSING,
]);

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
      // Kept as-is: HRUpload.jsx and VendorPortal.jsx reload their lists on this
      // event. The bell reads rpa_notifications instead — see notifyReview().
      for (const role of REVIEW_ROLES) {
        emitToRole(role, 'review:new', payload);
      }
    }
  } catch (err) {
    // Socket.io may not be initialised (e.g. in a standalone worker) — never fatal.
    logger.debug(`Socket emit skipped for job ${job.id}: ${err.message}`);
  }

  // Persist it as a notification so a review request survives a refresh and
  // reaches whoever is on shift, not just whoever had a tab open.
  if (job.action_required) {
    notify({
      type: NOTIFICATION_TYPES.REVIEW_NEW,
      title: 'Duplicate resume needs review',
      description: `${job.candidate_name || 'A candidate'}${job.vendor_name ? ` — vendor: ${job.vendor_name}` : ''}`,
      linkPath: '/hr-upload',
      meta: { job_id: payload?.id ?? null },
    }).catch(() => {}); // notify() already swallows; this guards the un-awaited promise
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

/**
 * Mark every still-in-flight job in a batch as Failed and emit each change. Called
 * when a batch aborts before its files were processed — without this those rows keep
 * their Uploaded/Processing status indefinitely, since the per-file loop that would
 * have advanced them never ran.
 */
export async function failPendingJobs(executionId, errorMessage) {
  if (!jobsModelReady()) return 0;
  const pending = await prisma.rpa_upload_jobs.findMany({
    where: { execution_id: executionId, status: { in: [...NON_TERMINAL_STATUSES] } },
  });
  if (pending.length === 0) return 0;

  await prisma.rpa_upload_jobs.updateMany({
    where: { id: { in: pending.map((j) => j.id) } },
    data: { status: JOB_STATUS.FAILED, error_message: errorMessage, action_required: false },
  });
  logger.warn(`failPendingJobs: marked ${pending.length} stranded job(s) Failed for batch ${executionId}`);

  for (const job of pending) {
    emitJob({ ...job, status: JOB_STATUS.FAILED, error_message: errorMessage, action_required: false });
  }
  return pending.length;
}

/**
 * How long a job may sit in an in-flight status (Processing/Queued/Uploaded) before
 * reconcileStaleJobs treats it as stranded. Comfortably longer than a real run — a
 * single resume is an AI parse plus a OneDrive upload, seconds to a minute — so only
 * genuinely dead runs are recovered, never a slow one still in progress.
 */
const STALE_JOB_MINUTES = Number(process.env.UPLOAD_JOB_STALE_MINUTES || 15);

/**
 * Repair job rows that no live run will ever advance again. Safe to call on every
 * dashboard load: each statement is filtered on status and on the staleness window,
 * so healthy in-flight uploads are never touched and an idle table matches nothing.
 *
 * Lives here rather than in a controller because both the HR and the vendor dashboard
 * need it — the vendor page had no reconciler at all, so a vendor whose batch died
 * watched "Processing" forever unless an admin happened to open the HR dashboard and
 * trigger the sweep on their behalf.
 *
 * Best-effort throughout: a failure to heal must never break the listing itself.
 */
export async function reconcileStaleJobs(logPrefix = 'Upload-job') {
  if (!jobsModelReady()) return;

  // 1) Advance any "Awaiting Candidate Details" job whose linked candidate is already
  // complete (statusActive = ACTIVE), no matter which path resolved the missing data
  // (public form, recruiter edit, merge, re-upload).
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
    logger.warn(`${logPrefix} self-heal skipped: ${e.message}`);
  }

  // 2) Re-link orphans before reaping. When a run died after writing rpa_cv_tmp but
  // before stamping cv_tmp_id onto the job, the staging row exists and the recruiter
  // has been emailed about it — but the job row still points at nothing, so step 3
  // would call it Failed and invite a reprocess that files the SAME duplicate twice.
  //
  // Matched on the resume URL, which both rows carry verbatim from the same upload,
  // and only for a staging row still awaiting review that was created after the job
  // started — so a merged/rejected row, or an unrelated older submission of the same
  // candidate, is never adopted.
  try {
    const relinked = await prisma.$executeRawUnsafe(`
      UPDATE rpa_upload_jobs AS j
      SET cv_tmp_id = t.id,
          candidate_name = COALESCE(j.candidate_name, t."Name"),
          candidate_email = COALESCE(j.candidate_email, t."EmailID"),
          updated_at = now()
      FROM rpa_cv_tmp AS t
      WHERE j.status IN ('Processing', 'Queued', 'Uploaded')
        AND j.cv_tmp_id IS NULL
        AND j.cv_id IS NULL
        AND j.file_url IS NOT NULL
        AND t."cvFileUrl" = j.file_url
        AND t."reviewStatus" = 'pending_review'
        AND t."createdAt" >= j.created_at
        AND j.updated_at < now() - ($1 || ' minutes')::interval
    `, String(STALE_JOB_MINUTES));
    if (relinked > 0) logger.warn(`${logPrefix} reaper: re-linked ${relinked} orphaned duplicate(s) to their review-queue row.`);
  } catch (e) {
    logger.warn(`${logPrefix} orphan re-link skipped: ${e.message}`);
  }

  // 3) Reap what is left. Recovery is driven by what the run actually managed to
  // persist, so we never invent an outcome: a staging row means the duplicate was
  // queued for review, a candidate row means it saved, and neither means the work was
  // lost and the file must be reprocessed.
  try {
    const reaped = await prisma.$executeRawUnsafe(`
      UPDATE rpa_upload_jobs
      SET status = CASE
            WHEN cv_tmp_id IS NOT NULL THEN 'Duplicate_Pending_Review'
            WHEN cv_id     IS NOT NULL THEN 'Missing_Information'
            ELSE 'Failed'
          END,
          action_required = (cv_tmp_id IS NOT NULL),
          error_message = CASE
            WHEN cv_tmp_id IS NULL AND cv_id IS NULL
              THEN 'Processing did not finish (worker restarted or connection lost). Reprocess this file.'
            ELSE error_message
          END,
          updated_at = now()
      WHERE status IN ('Processing', 'Queued', 'Uploaded')
        AND updated_at < now() - ($1 || ' minutes')::interval
    `, String(STALE_JOB_MINUTES));
    if (reaped > 0) logger.warn(`${logPrefix} reaper: recovered ${reaped} stranded job(s).`);
  } catch (e) {
    logger.warn(`${logPrefix} reaper skipped: ${e.message}`);
  }
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
