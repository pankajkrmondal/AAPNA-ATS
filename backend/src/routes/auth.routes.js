import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';
import validate from '../middleware/validate.js';

const router = Router();

// ── Validation schemas ────────────────────────────────────────────────
const loginSchema = {
  body: {
    username: { type: 'string', required: true, min: 1 },
    password: { type: 'string', required: true, min: 1 },
  },
};

const refreshTokenSchema = {
  body: {
    refreshToken: { type: 'string', required: true, min: 1 },
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
 * POST /api/auth/refresh-token
 * Public — exchange a refresh token for a new access token
 */
router.post('/refresh-token', validate(refreshTokenSchema), authController.refreshToken);

export default router;
