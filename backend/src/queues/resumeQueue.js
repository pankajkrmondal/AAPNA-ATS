import { Queue } from 'bullmq';
import { createRedisConnection } from '../config/redis.js';
import logger from '../config/logger.js';

/**
 * Resume processing queue.
 *
 * Jobs are added here when new CVs are uploaded. The resumeWorker picks
 * them up, parses the file, extracts fields, runs AI scoring, and writes
 * the results to rpa_cv.
 *
 * Queue name: 'resume-processing'
 */
const resumeQueue = new Queue('resume-processing', {
  connection: createRedisConnection('resume-queue'),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      age: 24 * 60 * 60, // keep completed jobs for 24 h
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 60 * 60, // keep failed jobs for 7 d
    },
  },
});

/**
 * Add a resume-processing job to the queue.
 *
 * @param {Object} payload
 * @param {string} payload.filePath - Absolute path to the uploaded file
 * @param {string} payload.fileName - Original file name
 * @param {string} payload.vendorEmail - Uploader / vendor email
 * @param {string} payload.batchId - Upload batch identifier
 * @param {string} [payload.mrfId] - Optional MRF to match against
 * @param {Object} [opts] - BullMQ JobsOptions overrides
 * @returns {Promise<import('bullmq').Job>}
 */
export async function addResumeJob(payload, opts = {}) {
  const job = await resumeQueue.add('process-resume', payload, {
    ...opts,
    jobId: `resume-${payload.batchId}-${Date.now()}`,
  });

  logger.info('Resume job added to queue', {
    jobId: job.id,
    fileName: payload.fileName,
    batchId: payload.batchId,
  });

  return job;
}

/**
 * Get queue health metrics.
 * @returns {Promise<Object>}
 */
export async function getQueueHealth() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    resumeQueue.getWaitingCount(),
    resumeQueue.getActiveCount(),
    resumeQueue.getCompletedCount(),
    resumeQueue.getFailedCount(),
    resumeQueue.getDelayedCount(),
  ]);

  return { waiting, active, completed, failed, delayed };
}

export default resumeQueue;
