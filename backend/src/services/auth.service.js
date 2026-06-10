import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/database.js';
import config from '../config/index.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';

/**
 * Authentication service.
 * Handles user lookup, password verification (SHA-512 + salt), JWT management,
 * and session CRUD against the rpa_sessions table.
 */

/**
 * Find a user by username.
 * @param {string} username
 * @returns {Promise<Object|null>}
 */
export async function findUserByUsername(username) {
  return prisma.rpa_users.findFirst({
    where: {
      username: {
        equals: username,
        mode: 'insensitive', // case-insensitive lookup
      },
    },
  });
}

/**
 * Verify a plain-text password against a stored SHA-512 hash + salt.
 *
 * The existing n8n workflow hashes as: SHA512( salt + password ).
 * We replicate that logic here.
 *
 * @param {string} inputPassword - Plain-text password from login request
 * @param {string} storedHash - Hex-encoded hash stored in DB (format: "salt:hash")
 * @returns {boolean}
 */
export function verifyPassword(inputPassword, storedHash) {
  if (!storedHash) return false;

  // Format: salt:sha512hash
  if (storedHash.includes(':')) {
    const parts = storedHash.split(':');
    const salt = parts[0];
    const expectedHash = parts[1];

    const hash = crypto
      .createHash('sha512')
      .update(inputPassword + salt)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
    } catch {
      return false;
    }
  }

  // Legacy plain text fallback
  return inputPassword === storedHash;
}

/**
 * Generate a signed JWT token.
 * @param {Object} user - User record from DB
 * @returns {string} Signed JWT
 */
export function generateJWT(user) {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username,
      role: user.role,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn },
  );
}

/**
 * Generate a refresh token (signed JWT with longer expiry).
 * @param {Object} user
 * @returns {string}
 */
export function generateRefreshToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      type: 'refresh',
    },
    config.jwt.secret,
    { expiresIn: config.jwt.refreshExpiresIn },
  );
}

/**
 * Verify a JWT and return the decoded payload.
 * @param {string} token
 * @returns {Object} Decoded JWT payload
 * @throws {Error} If token is invalid or expired
 */
export function verifyJWT(token) {
  return jwt.verify(token, config.jwt.secret);
}

/**
 * Create a session record in rpa_sessions.
 * @param {number|string} userId
 * @param {string} role
 * @param {string} token
 * @param {string} [refreshToken]
 * @returns {Promise<Object>} Created session
 */
export async function createSession(userId, role, token, refreshToken = null) {
  // Calculate expiry from JWT config
  const expiresIn = config.jwt.expiresIn;
  const expiresMs = parseExpiry(expiresIn);
  const expiresAt = new Date(Date.now() + expiresMs);

  return prisma.rpa_sessions.create({
    data: {
      user_id: userId,
      token,
      role,
      expires_at: expiresAt,
      created_at: new Date(),
    },
  });
}

/**
 * Delete a session by token (logout).
 * @param {string} token
 * @returns {Promise<void>}
 */
export async function deleteSession(token) {
  try {
    await prisma.rpa_sessions.deleteMany({
      where: { token },
    });
  } catch (err) {
    logger.warn('Failed to delete session', { error: err.message });
  }
}

/**
 * Remove all expired sessions from rpa_sessions.
 * Called periodically by the session-cleanup cron job.
 * @returns {Promise<number>} Number of deleted sessions
 */
export async function cleanupExpiredSessions() {
  const result = await prisma.rpa_sessions.deleteMany({
    where: {
      expires_at: {
        lt: new Date(),
      },
    },
  });

  if (result.count > 0) {
    logger.info(`🧹 Cleaned up ${result.count} expired session(s)`);
  }

  return result.count;
}

/**
 * Full login flow: find user → verify password → create JWT + session.
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ user: Object, token: string, refreshToken: string }>}
 */
export async function login(username, password) {
  // 1) Find user
  const user = await findUserByUsername(username);
  if (!user) {
    throw new AppError('Invalid username or password.', 401);
  }

  // 2) Check active status
  if (!user.is_active) {
    throw new AppError('Your account has been deactivated. Contact an administrator.', 403);
  }

  // 3) Verify password
  const isValid = verifyPassword(password, user.password_hash);
  if (!isValid) {
    throw new AppError('Invalid username or password.', 401);
  }

  // 4) Generate tokens
  const token = generateJWT(user);
  const refreshToken = generateRefreshToken(user);

  // 5) Persist session
  await createSession(user.id, user.role, token, refreshToken);

  // 6) Strip sensitive fields before returning
  const { password_hash, ...safeUser } = user;

  // Fetch enabled permissions
  const permissions = await prisma.rpa_module_permissions.findMany({
    where: {
      user_id: user.id,
      is_enabled: true,
    },
    select: {
      module_key: true,
    },
  });
  safeUser.permissions = permissions.map((p) => p.module_key);

  return { user: safeUser, token, refreshToken };
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Parse a human-readable expiry string (e.g. "24h", "7d") into milliseconds.
 * @param {string} str
 * @returns {number}
 */
function parseExpiry(str) {
  const match = str.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 24 * 60 * 60 * 1000; // default 24h

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default:  return 24 * 60 * 60 * 1000;
  }
}
