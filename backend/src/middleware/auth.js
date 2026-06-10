import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';
import config from '../config/index.js';
import AppError from '../utils/AppError.js';
import catchAsync from '../utils/catchAsync.js';

/**
 * JWT authentication middleware.
 * Extracts the Bearer token, verifies it, looks up the session in rpa_sessions,
 * and attaches the full user object to `req.user`.
 *
 * Usage:  router.get('/protected', authenticate, handler);
 */
export const authenticate = catchAsync(async (req, _res, next) => {
  // 1) Extract token from Authorization header
  let token;
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    throw new AppError('You are not logged in. Please provide a valid token.', 401);
  }

  // 2) Verify JWT signature & expiry
  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    // Re-throw — the global error handler knows how to map JWT errors
    throw err;
  }

  // 3) Check that a matching session still exists in rpa_sessions
  const session = await prisma.rpa_sessions.findFirst({
    where: {
      token,
      user_id: decoded.userId,
    },
  });

  if (!session) {
    throw new AppError('Session not found or has been invalidated. Please log in again.', 401);
  }

  // Check session expiry
  if (session.expires_at && new Date(session.expires_at) < new Date()) {
    // Clean up the expired session
    await prisma.rpa_sessions.delete({ where: { id: session.id } });
    throw new AppError('Your session has expired. Please log in again.', 401);
  }

  // 4) Fetch the user record
  const user = await prisma.rpa_users.findUnique({
    where: { id: decoded.userId },
  });

  if (!user) {
    throw new AppError('The user belonging to this token no longer exists.', 401);
  }

  if (!user.is_active) {
    throw new AppError('Your account has been deactivated. Contact an administrator.', 403);
  }

  // 5) Attach user & token to the request
  req.user = user;
  req.token = token;
  req.session = session;

  next();
});

/**
 * Role-based access control middleware factory.
 * Restricts access to users whose role is in the allowed list.
 *
 * Usage:  router.delete('/item/:id', authenticate, restrictTo('admin', 'hr'), handler);
 *
 * @param {...string} roles - Allowed roles (e.g. 'admin', 'hr', 'vendor')
 * @returns {import('express').RequestHandler}
 */
export const restrictTo = (...roles) => {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required.', 401));
    }

    const userRole = (req.user.role || '').toLowerCase();

    if (!roles.map((r) => r.toLowerCase()).includes(userRole)) {
      return next(
        new AppError('You do not have permission to perform this action.', 403),
      );
    }

    next();
  };
};

/**
 * Module-level permission check middleware factory.
 * Verifies that the authenticated user has access to a specific module
 * via the rpa_module_permissions table.
 *
 * Usage:  router.get('/analytics', authenticate, checkModuleAccess('analytics'), handler);
 *
 * @param {string} moduleName - The module identifier (e.g. 'analytics', 'admin')
 * @returns {import('express').RequestHandler}
 */
export const checkModuleAccess = (moduleName) => {
  return catchAsync(async (req, _res, next) => {
    if (!req.user) {
      throw new AppError('Authentication required.', 401);
    }

    // Admins and SuperAdmins bypass module checks
    const userRole = (req.user.role || '').toLowerCase();
    if (userRole === 'admin' || userRole === 'superadmin') {
      return next();
    }

    const permission = await prisma.rpa_module_permissions.findFirst({
      where: {
        user_id: req.user.id,
        module_key: moduleName,
        is_enabled: true,
      },
    });

    if (!permission) {
      throw new AppError(
        `You do not have access to the "${moduleName}" module.`,
        403,
      );
    }

    next();
  });
};
