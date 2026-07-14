import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/database.js';
import config from '../config/index.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import { sendPasswordResetEmail } from './emailNotification.service.js';

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
    include: { company: true },
  });
}

/**
 * Find a user by login identifier — matches username OR email (case-insensitive).
 * @param {string} login
 * @returns {Promise<Object|null>}
 */
export async function findUserByLogin(login) {
  return prisma.rpa_users.findFirst({
    where: {
      OR: [
        { username: { equals: login, mode: 'insensitive' } },
        { email: { equals: login, mode: 'insensitive' } },
      ],
    },
    include: { company: true },
  });
}

/**
 * Hash a plain-text password with a random salt.
 * Format matches verifyPassword: "salt:sha512(password + salt)".
 * @param {string} password
 * @returns {string} "salt:hash"
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(8).toString('hex');
  const hash = crypto.createHash('sha512').update(password + salt).digest('hex');
  return `${salt}:${hash}`;
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
      company_id: user.company_id ?? null,
      // Unique token id — without it, two logins in the same second produce an
      // identical JWT and violate the rpa_sessions.token unique constraint.
      jti: uuidv4(),
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
 * @param {number|null} [companyId]
 * @returns {Promise<Object>} Created session
 */
export async function createSession(userId, role, token, refreshToken = null, companyId = null) {
  // Calculate expiry from JWT config
  const expiresIn = config.jwt.expiresIn;
  const expiresMs = parseExpiry(expiresIn);
  const expiresAt = new Date(Date.now() + expiresMs);

  return prisma.rpa_sessions.create({
    data: {
      user_id: userId,
      token,
      role,
      company_id: companyId ?? null,
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
 * @param {string} username - Username or email address
 * @param {string} password
 * @returns {Promise<{ user: Object, token: string, refreshToken: string }>}
 */
export async function login(username, password) {
  // 1) Find user (by username or email)
  const user = await findUserByLogin(username);
  if (!user) {
    throw new AppError('Invalid username/email or password.', 401);
  }

  // 2) Check active status
  if (!user.is_active) {
    throw new AppError('Your account has been deactivated. Contact an administrator.', 403);
  }

  // 3) Verify password
  const isValid = verifyPassword(password, user.password_hash);
  if (!isValid) {
    throw new AppError('Invalid username/email or password.', 401);
  }

  // 4) Generate tokens
  const token = generateJWT(user);
  const refreshToken = generateRefreshToken(user);

  // 5) Persist session
  await createSession(user.id, user.role, token, refreshToken, user.company_id ?? null);

  // 6) Strip sensitive fields before returning
  const { password_hash, company, ...rest } = user;
  const safeUser = {
    ...rest,
    company_name: company?.name ?? null,
  };

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

// ── Password reset (forgot password) ──────────────────────────────────
//
// Stateless single-use reset tokens: a short-lived JWT carrying a fingerprint
// of the CURRENT password hash. Resetting rotates the salt+hash, so the
// fingerprint stops matching and the token cannot be replayed. No token table.

const RESET_TOKEN_EXPIRY = '30m';

/**
 * Fingerprint of a stored password hash, embedded in reset tokens to make
 * them single-use (any password change invalidates outstanding tokens).
 * @param {string} passwordHash
 * @returns {string} first 16 hex chars of sha256(passwordHash)
 */
function passwordFingerprint(passwordHash) {
  return crypto.createHash('sha256').update(passwordHash || '').digest('hex').slice(0, 16);
}

/**
 * Generate a password-reset token for a user.
 * @param {Object} user - rpa_users row
 * @returns {string} Signed JWT, expires in 30 minutes
 */
export function generatePasswordResetToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      type: 'password-reset',
      fp: passwordFingerprint(user.password_hash),
    },
    config.jwt.secret,
    { expiresIn: RESET_TOKEN_EXPIRY },
  );
}

/**
 * Handle a forgot-password request. Deliberately silent about whether the
 * account exists (anti-enumeration): callers always report generic success.
 * @param {string} login - Username or email address
 * @returns {Promise<void>}
 */
export async function requestPasswordReset(login) {
  const user = await findUserByLogin(login);
  if (!user || !user.is_active || !user.email) {
    logger.info(`Password reset requested for unknown/ineligible login "${login}" — no email sent.`);
    return;
  }

  const token = generatePasswordResetToken(user);
  const base = (config.cors.frontendUrl || 'https://ats.aapnainfotech.com').replace(/\/+$/, '');
  const resetUrl = `${base}/reset-password?token=${encodeURIComponent(token)}`;

  if (!config.isProduction) {
    logger.info(`[dev] Password reset URL for user ${user.id}: ${resetUrl}`);
  }

  // Fire-and-forget (the mailer catches its own errors) so response timing
  // stays near-constant regardless of whether an account matched.
  sendPasswordResetEmail({ user, resetUrl });
}

/**
 * Reset a password using a reset token. Errors are always 400 (never 401 —
 * the frontend interceptor hard-redirects on 401 and the public reset page
 * needs inline errors).
 * @param {string} token
 * @param {string} newPassword
 * @returns {Promise<void>}
 */
export async function resetPasswordWithToken(token, newPassword) {
  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    if (err?.name === 'TokenExpiredError') {
      throw new AppError('This password reset link has expired. Please request a new one.', 400);
    }
    throw new AppError('This password reset link is invalid. Please request a new one.', 400);
  }

  if (decoded.type !== 'password-reset') {
    throw new AppError('This password reset link is invalid. Please request a new one.', 400);
  }

  const user = await prisma.rpa_users.findUnique({ where: { id: decoded.userId } });
  if (!user || !user.is_active) {
    throw new AppError('This password reset link is invalid. Please request a new one.', 400);
  }

  if (decoded.fp !== passwordFingerprint(user.password_hash)) {
    throw new AppError('This password reset link has already been used. Please request a new one.', 400);
  }

  await prisma.rpa_users.update({
    where: { id: user.id },
    data: { password_hash: hashPassword(newPassword) },
  });

  // Recovery flow: sign out every existing session for this account.
  await prisma.rpa_sessions.deleteMany({ where: { user_id: user.id } });

  logger.info(`Password reset completed for user ${user.id}; all sessions invalidated.`);
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
