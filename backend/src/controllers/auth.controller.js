import * as authService from '../services/auth.service.js';
import { success } from '../utils/apiResponse.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';
import prisma from '../config/database.js';

/**
 * @desc    Log in a user with username & password
 * @route   POST /api/auth/login
 * @access  Public
 */
export const login = catchAsync(async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    throw new AppError('Please provide username and password.', 400);
  }

  const result = await authService.login(username, password);

  return success(res, {
    user: result.user,
    token: result.token,
    refreshToken: result.refreshToken,
  }, 'Login successful');
});

/**
 * @desc    Log out the current user (invalidate session)
 * @route   POST /api/auth/logout
 * @access  Private
 */
export const logout = catchAsync(async (req, res) => {
  await authService.deleteSession(req.token);

  return success(res, null, 'Logged out successfully');
});

/**
 * @desc    Get the currently authenticated user's profile
 * @route   GET /api/auth/me
 * @access  Private
 */
export const getCurrentUser = catchAsync(async (req, res) => {
  // req.user is already attached by the authenticate middleware
  const { password_hash, salt, ...safeUser } = req.user;

  const permissions = await prisma.rpa_module_permissions.findMany({
    where: {
      user_id: req.user.id,
      is_enabled: true,
    },
    select: {
      module_key: true,
    },
  });
  safeUser.permissions = permissions.map((p) => p.module_key);

  return success(res, { user: safeUser }, 'User retrieved successfully');
});

/**
 * @desc    Refresh an expired access token using a valid refresh token
 * @route   POST /api/auth/refresh-token
 * @access  Public (requires valid refresh token in body)
 */
export const refreshToken = catchAsync(async (req, res) => {
  const { refreshToken: rt } = req.body;

  if (!rt) {
    throw new AppError('Please provide a refresh token.', 400);
  }

  // Verify the refresh token
  let decoded;
  try {
    decoded = authService.verifyJWT(rt);
  } catch {
    throw new AppError('Invalid or expired refresh token.', 401);
  }

  if (decoded.type !== 'refresh') {
    throw new AppError('Invalid token type.', 401);
  }

  // Look up the user
  const user = await authService.findUserByUsername(decoded.username || '');
  // Fallback: look up by userId if username wasn't in refresh payload
  let targetUser = user;
  if (!targetUser) {
    const { default: prisma } = await import('../config/database.js');
    targetUser = await prisma.rpa_users.findUnique({
      where: { id: decoded.userId },
    });
  }

  if (!targetUser) {
    throw new AppError('User not found.', 401);
  }

  if (!targetUser.is_active) {
    throw new AppError('Account deactivated.', 403);
  }

  // Generate new tokens
  const newToken = authService.generateJWT(targetUser);
  const newRefreshToken = authService.generateRefreshToken(targetUser);

  // Create new session
  await authService.createSession(targetUser.id, targetUser.role, newToken, newRefreshToken);

  const { password_hash, salt, ...safeUser } = targetUser;

  return success(res, {
    user: safeUser,
    token: newToken,
    refreshToken: newRefreshToken,
  }, 'Token refreshed successfully');
});
