import * as authService from '../services/auth.service.js';
import { isTurnstileEnabled, verifyTurnstileToken } from '../services/turnstile.service.js';
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
  const { username, password, captchaToken } = req.body;

  if (!username || !password) {
    throw new AppError('Please provide username and password.', 400);
  }

  // Bot protection: when Turnstile is configured, every login attempt must
  // pass Cloudflare's verification BEFORE credentials are checked, so bots
  // can't brute-force passwords or enumerate accounts.
  if (isTurnstileEnabled()) {
    if (!captchaToken) {
      throw new AppError('Captcha verification is required. Please refresh the page and try again.', 400);
    }
    if (!(await verifyTurnstileToken(captchaToken, req.ip))) {
      throw new AppError('Captcha verification failed. Please try again.', 403);
    }
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
  // req.user is already attached by the authenticate middleware (includes company)
  const { password_hash, salt, company, ...rest } = req.user;
  const safeUser = { ...rest, company_name: company?.name ?? null };

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
 * @desc    Change the current user's password
 * @route   POST /api/auth/change-password
 * @access  Private (all roles)
 */
export const changePassword = catchAsync(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!authService.verifyPassword(currentPassword, req.user.password_hash)) {
    throw new AppError('Current password is incorrect.', 400);
  }

  await prisma.rpa_users.update({
    where: { id: req.user.id },
    data: { password_hash: authService.hashPassword(newPassword) },
  });

  // Invalidate every other session for this user, keeping the current one alive.
  await prisma.rpa_sessions.deleteMany({
    where: {
      user_id: req.user.id,
      NOT: { token: req.token },
    },
  });

  return success(res, null, 'Password changed successfully');
});

/**
 * @desc    Request a password reset link by username or email
 * @route   POST /api/auth/forgot-password
 * @access  Public
 */
export const forgotPassword = catchAsync(async (req, res) => {
  const { login, captchaToken } = req.body;

  // Bot protection: reset requests trigger emails, so when Turnstile is
  // configured they must pass verification before any work happens.
  if (isTurnstileEnabled()) {
    if (!captchaToken) {
      throw new AppError('Captcha verification is required. Please refresh the page and try again.', 400);
    }
    if (!(await verifyTurnstileToken(captchaToken, req.ip))) {
      throw new AppError('Captcha verification failed. Please try again.', 403);
    }
  }

  await authService.requestPasswordReset(login);

  // Always the same generic response — never reveal whether an account exists.
  return success(res, null, 'If an account exists for that username or email, a password reset link has been sent.');
});

/**
 * @desc    Reset a password using an emailed reset token
 * @route   POST /api/auth/reset-password
 * @access  Public (requires valid reset token in body)
 */
export const resetPassword = catchAsync(async (req, res) => {
  const { token, newPassword } = req.body;

  await authService.resetPasswordWithToken(token, newPassword);

  return success(res, null, 'Password reset successfully. You can now sign in with your new password.');
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
