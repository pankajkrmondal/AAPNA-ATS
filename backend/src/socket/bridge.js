/**
 * bridge.js — cross-process delivery for Socket.io events.
 *
 * The resume worker runs as its own PM2 process (`ats-<env>-worker`, see
 * ecosystem.config.cjs) and never calls initializeSocket() — it has no HTTP
 * server to attach to. So when it finished parsing a resume and updated the job,
 * its emit hit a getIO() that throws, the error was swallowed as a debug line,
 * and no browser ever heard about it. The dashboard sat on "Processing" until
 * the user reloaded and re-fetched over HTTP.
 *
 * Redis is the one thing both processes already share (BullMQ runs on it), so
 * the worker publishes its events there and the HTTP server — the only process
 * holding the actual sockets — replays them into the right rooms.
 *
 * In-process emits are unaffected: publish() is only reached when getIO() is
 * unavailable, so a single-process deployment never takes the Redis hop.
 */
import { createRedisConnection } from '../config/redis.js';
import logger from '../config/logger.js';

/** Channel carrying room-targeted Socket.io events between processes. */
export const SOCKET_BRIDGE_CHANNEL = 'ats:socket:emit';

let publisher = null;

/**
 * Publish a room-targeted event for the HTTP server to relay.
 * Lazily opens the connection so processes that never emit stay off Redis.
 *
 * @param {'user'|'role'|'mrf'|'broadcast'} target
 * @param {string|number|null} id  Room id (null for a broadcast)
 * @param {string} event
 * @param {*} data
 */
export function publishSocketEvent(target, id, event, data) {
  try {
    if (!publisher) publisher = createRedisConnection('socket-bridge-pub');
    publisher.publish(
      SOCKET_BRIDGE_CHANNEL,
      JSON.stringify({ target, id: id ?? null, event, data }),
    );
  } catch (err) {
    // Best-effort: a missed live update is a stale dashboard, not a lost record.
    // The status is already committed to the DB and shows on the next fetch.
    logger.debug(`Socket bridge publish failed for "${event}": ${err.message}`);
  }
}

/**
 * Subscribe the HTTP server to events published by worker processes and replay
 * them into local rooms. Called once from initializeSocket().
 *
 * @param {import('socket.io').Server} io
 */
export function subscribeSocketBridge(io) {
  let subscriber;
  try {
    subscriber = createRedisConnection('socket-bridge-sub');
  } catch (err) {
    logger.warn(`Socket bridge disabled — could not open Redis: ${err.message}`);
    return;
  }

  subscriber.subscribe(SOCKET_BRIDGE_CHANNEL, (err) => {
    if (err) {
      logger.warn(`Socket bridge subscribe failed: ${err.message}`);
      return;
    }
    logger.info(`🌉 Socket bridge listening on "${SOCKET_BRIDGE_CHANNEL}" (relays worker events to browsers)`);
  });

  subscriber.on('message', (channel, raw) => {
    if (channel !== SOCKET_BRIDGE_CHANNEL) return;
    try {
      const { target, id, event, data } = JSON.parse(raw);
      if (target === 'broadcast') {
        io.emit(event, data);
        return;
      }
      const prefix = { user: 'user', role: 'role', mrf: 'mrf' }[target];
      // Unknown target: drop it rather than guess a room and emit to the wrong people.
      if (!prefix || id === null) return;
      io.to(`${prefix}:${id}`).emit(event, data);
    } catch (parseErr) {
      logger.debug(`Socket bridge received an unreadable message: ${parseErr.message}`);
    }
  });
}
