import { Worker } from 'bullmq';
import { createRedisConnection } from '../config/redis.js';
import logger from '../config/logger.js';

/**
 * BullMQ worker for the 'resume-processing' queue.
 *
 * This worker picks up jobs added by the upload pipeline and:
 *   1. Reads the uploaded file from disk
 *   2. Parses text content (PDF / DOCX)
 *   3. Extracts structured fields (name, email, skills, experience …)
 *   4. Optionally runs AI scoring via Gemini
 *   5. Writes / updates the rpa_cv record in the database
 *   6. Emits a Socket.io event so the dashboard refreshes in real time
 *
 * The actual implementation of each step will be filled in during later phases.
 * This file provides the complete worker scaffold with error handling and logging.
 */

/**
 * Process a single resume job.
 * @param {import('bullmq').Job} job
 * @returns {Promise<Object>} Processing result
 */
async function processResume(job) {
  const { filePath, fileName, vendorEmail, batchId, mrfId } = job.data;

  logger.info(`📄 Processing resume: ${fileName}`, {
    jobId: job.id,
    batchId,
    vendorEmail,
    attempt: job.attemptsMade + 1,
  });

  try {
    // ── Step 1: Read file ─────────────────────────────────────────────
    await job.updateProgress(10);
    // TODO: Implement file reading (fs.readFile or stream)
    logger.debug(`Step 1/5: File read — ${filePath}`);

    // ── Step 2: Parse text ────────────────────────────────────────────
    await job.updateProgress(30);
    // TODO: Implement PDF/DOCX text extraction
    logger.debug('Step 2/5: Text extraction');

    // ── Step 3: Extract structured fields ─────────────────────────────
    await job.updateProgress(50);
    // TODO: Implement field extraction (regex + AI)
    logger.debug('Step 3/5: Field extraction');

    // ── Step 4: AI scoring ────────────────────────────────────────────
    await job.updateProgress(70);
    // TODO: Implement Gemini-based scoring
    logger.debug('Step 4/5: AI scoring');

    // ── Step 5: Database write ────────────────────────────────────────
    await job.updateProgress(90);
    // TODO: Upsert into rpa_cv
    logger.debug('Step 5/5: Database write');

    await job.updateProgress(100);

    const result = {
      fileName,
      batchId,
      status: 'completed',
      candidateId: null, // Will be set after DB write
    };

    logger.info(`✅ Resume processed successfully: ${fileName}`, {
      jobId: job.id,
      batchId,
    });

    return result;
  } catch (error) {
    logger.error(`❌ Resume processing failed: ${fileName}`, {
      jobId: job.id,
      batchId,
      error: error.message,
      stack: error.stack,
    });

    throw error; // BullMQ will retry according to job options
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
