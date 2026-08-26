import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import logger from '../config/logger.js';
import { publishSocketEvent, subscribeSocketBridge } from './bridge.js';

/** @type {Server} */
let io;

/**
 * Initialise Socket.io on the HTTP server.
 *
 * Authenticates connections via the JWT token passed as a query param or
 * in the `auth` handshake payload. Unauthenticated connections are rejected.
 *
 * @param {import('http').Server} httpServer
 * @returns {Server}
 */
export function initializeSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: config.cors.frontendUrl,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60_000,
    pingInterval: 25_000,
  });

  // ── Authentication middleware ─────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;

    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      socket.user = decoded;
      next();
    } catch (err) {
      return next(new Error('Invalid or expired token'));
    }
  });

  // ── Connection handler ────────────────────────────────────────────
  io.on('connection', (socket) => {
    const { userId, username, role } = socket.user;

    logger.info(`🔌 Socket connected: ${username} (${userId})`, {
      socketId: socket.id,
      role,
    });

    // Join a personal room so we can push targeted notifications
    socket.join(`user:${userId}`);

    // Join a role-based room
    if (role) {
      socket.join(`role:${role}`);
    }

    // ── Client events ─────────────────────────────────────────────
    socket.on('join:mrf', (mrfId) => {
      socket.join(`mrf:${mrfId}`);
      logger.debug(`Socket ${socket.id} joined mrf:${mrfId}`);
    });

    socket.on('leave:mrf', (mrfId) => {
      socket.leave(`mrf:${mrfId}`);
      logger.debug(`Socket ${socket.id} left mrf:${mrfId}`);
    });

    socket.on('disconnect', (reason) => {
      logger.info(`🔌 Socket disconnected: ${username}`, {
        socketId: socket.id,
        reason,
      });
    });

    socket.on('error', (err) => {
      logger.error('Socket error', { socketId: socket.id, error: err.message });
    });
  });

  logger.info('⚡ Socket.io initialised');

  // Relay events published by processes that hold no sockets of their own —
  // chiefly the standalone resume worker. See socket/bridge.js.
  subscribeSocketBridge(io);

  return io;
}

/**
 * Get the global Socket.io instance.
 * @returns {Server}
 */
export function getIO() {
  if (!io) {
    throw new Error('Socket.io has not been initialised. Call initializeSocket() first.');
  }
  return io;
}

// ── Emit helpers ────────────────────────────────────────────────────────
//
// Each helper emits directly when this process owns the Socket.io server, and
// otherwise hands the event to the Redis bridge for the HTTP server to relay.
// That second path is what the standalone resume worker takes: it has no `io`,
// so before the bridge existed every emit here threw and the update never
// reached the browser (the caller logged it as debug and moved on).

/** True when this process holds the Socket.io server. */
function hasLocalIO() {
  return Boolean(io);
}

/**
 * Emit an event to a specific user.
 * @param {string|number} userId
 * @param {string} event
 * @param {*} data
 */
export function emitToUser(userId, event, data) {
  if (hasLocalIO()) return void io.to(`user:${userId}`).emit(event, data);
  publishSocketEvent('user', userId, event, data);
}

/**
 * Emit an event to all users with a given role.
 * @param {string} role
 * @param {string} event
 * @param {*} data
 */
export function emitToRole(role, event, data) {
  if (hasLocalIO()) return void io.to(`role:${role}`).emit(event, data);
  publishSocketEvent('role', role, event, data);
}

/**
 * Emit an event to everyone watching a specific MRF.
 * @param {string|number} mrfId
 * @param {string} event
 * @param {*} data
 */
export function emitToMRF(mrfId, event, data) {
  if (hasLocalIO()) return void io.to(`mrf:${mrfId}`).emit(event, data);
  publishSocketEvent('mrf', mrfId, event, data);
}

/**
 * Broadcast an event to all connected clients.
 * @param {string} event
 * @param {*} data
 */
export function broadcast(event, data) {
  if (hasLocalIO()) return void io.emit(event, data);
  publishSocketEvent('broadcast', null, event, data);
}
