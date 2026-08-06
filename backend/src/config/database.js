import { PrismaClient } from '@prisma/client';
import logger from './logger.js';
import config from './index.js';

/**
 * Prisma client singleton.
 * Uses query-level logging in development and error-only in production.
 * Attaches shutdown hooks to cleanly disconnect.
 */
const prisma = new PrismaClient({
  log: config.isProduction
    ? [{ emit: 'event', level: 'error' }]
    : [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
});

// ── Logging hooks ──────────────────────────────────────────────────────
prisma.$on('error', (e) => {
  logger.error('Prisma error', { message: e.message, target: e.target });
});

if (!config.isProduction) {
  prisma.$on('query', (e) => {
    logger.debug('Prisma query', {
      query: e.query,
      params: e.params,
      duration: `${e.duration}ms`,
    });
  });

  prisma.$on('warn', (e) => {
    logger.warn('Prisma warning', { message: e.message });
  });
}

/**
 * Test the database connection.
 * Call this during server startup to fail fast on bad credentials.
 * @returns {Promise<void>}
 */
export async function connectDatabase() {
  try {
    await prisma.$connect();
    logger.info('✅ Database connected successfully');
  } catch (error) {
    logger.error('❌ Database connection failed', {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Gracefully disconnect from the database.
 * @returns {Promise<void>}
 */
export async function disconnectDatabase() {
  await prisma.$disconnect();
  logger.info('Database disconnected');
}

// Shutdown hooks are registered in server.js instead of beforeExit to avoid infinite loops

export default prisma;
