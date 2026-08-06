import Redis from 'ioredis';
import logger from './logger.js';
import config from './index.js';

/**
 * IORedis connection options shared by all connections.
 * @type {import('ioredis').RedisOptions}
 */
const redisOptions = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: true,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5000);
    logger.warn(`Redis reconnecting… attempt ${times}, delay ${delay}ms`);
    return delay;
  },
};

/**
 * Create a new Redis connection.
 * BullMQ requires separate connections for Queue, Worker, and QueueEvents,
 * so we expose a factory rather than a single shared instance.
 * @param {string} [name='default'] - Label used in log messages
 * @returns {import('ioredis').Redis}
 */
export function createRedisConnection(name = 'default', extraOptions = {}) {
  const connection = new Redis({
    ...redisOptions,
    ...extraOptions,
  });

  connection.on('connect', () => {
    logger.info(`✅ Redis connected (${name})`);
  });

  connection.on('error', (err) => {
    logger.error(`❌ Redis error (${name})`, { error: err.message });
  });

  connection.on('close', () => {
    logger.warn(`Redis connection closed (${name})`);
  });

  return connection;
}

/**
 * Shared Redis connection for general-purpose caching.
 * Do NOT pass this to BullMQ — use createRedisConnection() instead.
 */
const redis = createRedisConnection('shared', { enableOfflineQueue: false });

/**
 * Gracefully disconnect the shared Redis connection.
 * @returns {Promise<void>}
 */
export async function disconnectRedis() {
  await redis.quit();
  logger.info('Redis shared connection closed');
}

export default redis;
