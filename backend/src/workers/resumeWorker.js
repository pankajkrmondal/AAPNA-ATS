import { Worker } from 'bullmq';
import { createRedisConnection } from '../config/redis.js';
import logger from '../config/logger.js';
import { runBatchParsing } from '../services/hrUpload.service.js';

/**
 * BullMQ worker for the 'resume-processing' queue.
 *
 * Each job is one resume file. The worker delegates to runBatchParsing (the same
 * code path used by the in-process executor), which extracts text, AI-parses the
 * resume, runs duplicate detection, writes rpa_cv / rpa_cv_tmp, and persists the
 * job status (which is emitted to the dashboard over Socket.io).
 */

/**
 * Process a single resume job.
 * @param {import('bullmq').Job} job
 * @returns {Promise<Object>} Processing result
 */
async function processResume(job) {
  const { executionId, file, user, source, attribution } = job.data;

  logger.info(`📄 Processing resume: ${file?.originalname}`, {
    jobId: job.id,
    batchId: executionId,
    source,
    attempt: job.attemptsMade + 1,
  });

  try {
    await job.updateProgress(10);
    // Reuses the full extract → AI parse → dedup → DB write pipeline for one file.
    await runBatchParsing(executionId, [file], user, source, attribution);
    await job.updateProgress(100);

    logger.info(`✅ Resume processed: ${file?.originalname}`, { jobId: job.id, batchId: executionId });
    return { fileName: file?.originalname, batchId: executionId, status: 'processed' };
  } catch (error) {
    logger.error(`❌ Resume processing failed: ${file?.originalname}`, {
      jobId: job.id,
      batchId: executionId,
      error: error.message,
    });
    throw error; // BullMQ retries per the queue's backoff policy
  }
}

// ── Worker instance ───────────────────────────────────────────────────

const resumeWorker = new Worker('resume-processing', processResume, {
  connection: createRedisConnection('resume-worker'),
  concurrency: 5,
  limiter: {
    max: 10,
    duration: 1000, // max 10 jobs per second
  },
});

// ── Event listeners ───────────────────────────────────────────────────

resumeWorker.on('completed', (job, result) => {
  logger.info(`Job ${job.id} completed`, { result });
});

resumeWorker.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} failed`, {
    error: err.message,
    attemptsMade: job?.attemptsMade,
  });
});

resumeWorker.on('error', (err) => {
  logger.error('Resume worker error', { error: err.message });
});

resumeWorker.on('stalled', (jobId) => {
  logger.warn(`Job ${jobId} stalled`);
});

logger.info('🏭 Resume worker started — listening for jobs on "resume-processing"');

export default resumeWorker;
