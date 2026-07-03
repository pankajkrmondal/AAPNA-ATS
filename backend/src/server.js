import http from 'http';
import app from './app.js';
import config from './config/index.js';
import logger from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { disconnectRedis } from './config/redis.js';
import { initializeSocket } from './socket/index.js';
import { startSessionCleanupJob } from './jobs/sessionCleanup.js';
import { startReminderSchedulerJob, stopReminderSchedulerJob } from './jobs/reminderScheduler.js';
import { startEmailResumeIntakeJob, stopEmailResumeIntakeJob } from './jobs/emailResumeIntake.js';
import { startInboundEmailSyncJob, stopInboundEmailSyncJob } from './jobs/inboundEmailSync.js';
import { startZekoSchedulerJob, stopZekoSchedulerJob } from './jobs/zekoScheduler.js';
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

    // Outlook mailbox pollers (replace n8n "Outlook Trigger2" + "WF2"); self-gated by config flags
    startEmailResumeIntakeJob();
    startInboundEmailSyncJob();

    // Zeko sync (replaces n8n "FULLY AUTO Sync (API Key Auth)" + "Step 3 Results"); self-gated
    startZekoSchedulerJob();

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
  stopEmailResumeIntakeJob();
  stopInboundEmailSyncJob();
  stopZekoSchedulerJob();

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
