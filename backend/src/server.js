import http from 'http';
import app from './app.js';
import config from './config/index.js';
import logger from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { disconnectRedis } from './config/redis.js';
import { initializeSocket } from './socket/index.js';
import { startSessionCleanupJob } from './jobs/sessionCleanup.js';
import { startReminderSchedulerJob, stopReminderSchedulerJob } from './jobs/reminderScheduler.js';
import { startInterviewReminderJob, stopInterviewReminderJob } from './jobs/interviewReminder.js';
import { startInterviewOccurrenceJob, stopInterviewOccurrenceJob } from './jobs/interviewOccurrence.js';
import { startInterviewRecordingJob, stopInterviewRecordingJob } from './jobs/interviewRecordings.js';
import { startMailboxPollerJob, stopMailboxPollerJob } from './jobs/mailboxPoller.js';
import { startZekoSchedulerJob, stopZekoSchedulerJob } from './jobs/zekoScheduler.js';
import { startAssessmentDeadlineJob, stopAssessmentDeadlineJob } from './jobs/assessmentDeadlineChecker.js';
import { startOfferSweepJob, stopOfferSweepJob } from './jobs/offerSweep.js';
import { startDocumentReminderJob, stopDocumentReminderJob } from './jobs/documentReminder.js';
import { loadEmailRecipients } from './config/emailRecipients.js';

// ── Create HTTP server ────────────────────────────────────────────────
const server = http.createServer(app);

// ── Initialise Socket.io ──────────────────────────────────────────────
const io = initializeSocket(server);

// Make io accessible from request handlers via app.locals
app.set('io', io);

// ── Start server ──────────────────────────────────────────────────────
async function startServer() {
  try {
    // 1) Connect to database
    await connectDatabase();

    // 2) Load per-flow email recipients from rpa_settings (overlays code defaults)
    await loadEmailRecipients();

    // 3) Start background jobs
    startSessionCleanupJob();
    await startReminderSchedulerJob();

    // Pre-interview reminders for booked technical rounds; self-gated by the
    // interview_reminder_enabled setting (Settings → Reminder Settings).
    await startInterviewReminderJob();

    // Post-interview occurrence sweep — decides "did it happen?" (Teams
    // attendance or a confirm nudge) so a scorecard is never sent for a
    // no-show; self-gated by interview_occurrence_enabled.
    await startInterviewOccurrenceJob();

    // Post-interview recording discovery — links the Teams recording to the
    // booking once Teams has finished processing it; self-gated by
    // MS_RECORDING_FETCH_ENABLED and interview_recording_enabled.
    await startInterviewRecordingJob();

    // Consolidated Outlook mailbox poller — one delta fetch per tick fanned out
    // to resume intake + inbound sync (replaces n8n "Outlook Trigger2" + "WF2");
    // self-gated by EMAIL_INTAKE_ENABLED / INBOUND_SYNC_ENABLED.
    startMailboxPollerJob();

    // Zeko sync (replaces n8n "FULLY AUTO Sync (API Key Auth)" + "Step 3 Results"); self-gated
    startZekoSchedulerJob();

    // Evalground invite deadline checker — pure DB polling, no external API, always runs.
    startAssessmentDeadlineJob();

    // Offer sweeps — daily approval nudge + post-joining auto-close (Q12/Q26);
    // pure DB polling, no external API, always runs.
    startOfferSweepJob();

    // Document reminder sweep — chases candidates whose documents are still
    // outstanding ("reminders until submitted"); pure DB polling, always runs.
    startDocumentReminderJob();

    // Durable resume-processing worker (BullMQ + Redis). Off by default; enable
    // with USE_RESUME_QUEUE=true once Redis is available. Dynamically imported so
    // the queue/Redis connection is never created when the flag is off.
    if (process.env.USE_RESUME_QUEUE === 'true') {
      await import('./workers/resumeWorker.js');
      logger.info('🏭 Resume queue worker enabled (USE_RESUME_QUEUE=true)');
    }

    // 4) Bind to port
    server.listen(config.port, () => {
      logger.info(`🚀 ATS Backend listening on port ${config.port} [${config.env}]`);
      logger.info(`   Health check: http://localhost:${config.port}/api/health`);
    });
  } catch (error) {
    logger.error('💥 Failed to start server', { error: error.message });
    await disconnectDatabase().catch(() => {});
    await disconnectRedis().catch(() => {});
    process.exit(1);
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function gracefulShutdown(signal) {
  logger.info(`\n${signal} received — shutting down gracefully…`);

  // Stop cron schedulers
  stopReminderSchedulerJob();
  stopInterviewReminderJob();
  stopInterviewOccurrenceJob();
  stopInterviewRecordingJob();
  stopMailboxPollerJob();
  stopZekoSchedulerJob();
  stopAssessmentDeadlineJob();
  stopOfferSweepJob();
  stopDocumentReminderJob();

  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      await disconnectDatabase();
      await disconnectRedis();
      logger.info('All connections closed. Goodbye 👋');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', { error: err.message });
      process.exit(1);
    }
  });

  // Force kill after timeout
  setTimeout(() => {
    logger.error('Shutdown timed out — forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ── Unhandled errors ──────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION 💥', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('UNHANDLED REJECTION 💥', { reason: reason?.message || reason });
  process.exit(1);
});

// ── Go! ───────────────────────────────────────────────────────────────
startServer();
