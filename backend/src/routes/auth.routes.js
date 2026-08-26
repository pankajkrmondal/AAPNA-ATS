import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as authController from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import friendlyRateLimitHandler from '../utils/rateLimitHandler.js';

const router = Router();

// Strict limiter for forgot-password: the endpoint returns 200 on every call
// (anti-enumeration), so the global auth limiter — which only counts FAILED
// requests — never throttles it. This one counts everything.
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: friendlyRateLimitHandler('Too many password reset requests.'),
});

// ── Validation schemas ────────────────────────────────────────────────
const loginSchema = {
  body: {
    username: { type: 'string', required: true, min: 1 },
    password: { type: 'string', required: true, min: 1 },
    // Turnstile widget token; enforced by the controller when TURNSTILE_SECRET_KEY is set
    captchaToken: { type: 'string', required: false, max: 4096 },
  },
};

const refreshTokenSchema = {
  body: {
    refreshToken: { type: 'string', required: true, min: 1 },
  },
};

const changePasswordSchema = {
  body: {
    currentPassword: { type: 'string', required: true, min: 1 },
    newPassword: { type: 'string', required: true, min: 8, max: 128 },
  },
};

const forgotPasswordSchema = {
  body: {
    login: { type: 'string', required: true, min: 1, max: 255 },
    // Turnstile widget token; enforced by the controller when TURNSTILE_SECRET_KEY is set
    captchaToken: { type: 'string', required: false, max: 4096 },
  },
};

const resetPasswordSchema = {
  body: {
    token: { type: 'string', required: true, min: 1 },
    newPassword: { type: 'string', required: true, min: 8, max: 128 },
  },
};

// ── Routes ────────────────────────────────────────────────────────────

/**
 * POST /api/auth/login
 * Public — authenticate with username & password
 */
router.post('/login', validate(loginSchema), authController.login);

/**
 * POST /api/auth/logout
 * Private — invalidate the current session
 */
router.post('/logout', authenticate, authController.logout);

/**
 * GET /api/auth/me
 * Private — get the current user's profile
 */
router.get('/me', authenticate, authController.getCurrentUser);

/**
 * POST /api/auth/change-password
 * Private (all roles) — change own password
 */
router.post('/change-password', authenticate, validate(changePasswordSchema), authController.changePassword);

/**
 * POST /api/auth/forgot-password
 * Public — request a password reset link by username or email
 */
router.post('/forgot-password', forgotPasswordLimiter, validate(forgotPasswordSchema), authController.forgotPassword);

/**
 * POST /api/auth/reset-password
 * Public — set a new password using an emailed reset token
 */
router.post('/reset-password', validate(resetPasswordSchema), authController.resetPassword);

/**
 * POST /api/auth/refresh-token
 * Public — exchange a refresh token for a new access token
 */
router.post('/refresh-token', validate(refreshTokenSchema), authController.refreshToken);

export default router;
