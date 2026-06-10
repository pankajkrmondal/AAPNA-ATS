import http from 'http';
import app from './app.js';
import config from './config/index.js';
import logger from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { disconnectRedis } from './config/redis.js';
import { initializeSocket } from './socket/index.js';
import { startSessionCleanupJob } from './jobs/sessionCleanup.js';
import { startReminderSchedulerJob, stopReminderSchedulerJob } from './jobs/reminderScheduler.js';

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

    // 2) Start background jobs
    startSessionCleanupJob();
    await startReminderSchedulerJob();

    // 3) Bind to port
    server.listen(config.port, () => {
      logger.info(`🚀 ATS Backend listening on port ${config.port} [${config.env}]`);
      logger.info(`   Health check: http://localhost:${config.port}/api/health`);
    });
  } catch (error) {
    logger.error('💥 Failed to start server', { error: error.message });
    process.exit(1);
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function gracefulShutdown(signal) {
  logger.info(`\n${signal} received — shutting down gracefully…`);

  // Stop cron schedulers
  stopReminderSchedulerJob();

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
