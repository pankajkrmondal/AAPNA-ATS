import AppError from '../utils/AppError.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { sendBackendErrorAlert } from '../services/emailNotification.service.js';

// ── Prisma error mappers ──────────────────────────────────────────────

/**
 * Map known Prisma client errors to user-friendly AppErrors.
 * @param {Error} err
 * @returns {AppError|null}
 */
function handlePrismaError(err) {
  // Prisma connection / initialization errors — never leak host/port to the client
  if (
    err.name === 'PrismaClientInitializationError' ||
    err.code === 'P1000' || // authentication failed
    err.code === 'P1001' || // can't reach database server
    err.code === 'P1002' || // database server timed out
    err.code === 'P1008' || // operation timed out
    err.code === 'P1017' || // server closed the connection
    err.code === 'P2024'    // timed out fetching a connection from the pool
  ) {
    return new AppError('Service temporarily unavailable. Please try again later.', 503);
  }

  // Prisma known request errors (P2xxx)
  if (err.code === 'P2002') {
    const fields = err.meta?.target?.join(', ') || 'unknown field(s)';
    return new AppError(`Duplicate value on: ${fields}. Please use a different value.`, 409);
  }
  if (err.code === 'P2025') {
    return new AppError('Record not found.', 404);
  }
  if (err.code === 'P2003') {
    return new AppError('Invalid reference — related record does not exist.', 400);
  }
  if (err.code === 'P2014') {
    return new AppError('This change would violate a required relation.', 400);
  }
  if (err.code === 'P2000') {
    return new AppError('One of the values entered is too long. Please shorten it and try again.', 400);
  }
  if (err.code === 'P2010') {
    return new AppError('A database query failed. Please try again or contact support.', 500);
  }
  if (err.code === 'P2028' || err.code === 'P2034') {
    return new AppError("This action couldn't be completed due to a temporary conflict. Please try again.", 409);
  }
  // Catch-all for any other known-request-error code we haven't special-cased above.
  if (/^P2\d{3}$/.test(err.code || '')) {
    return new AppError('Something went wrong processing your request. Please try again.', 400);
  }
  return null;
}

/**
 * Map JWT-related errors to AppErrors.
 * @param {Error} err
 * @returns {AppError|null}
 */
function handleJWTError(err) {
  if (err.name === 'JsonWebTokenError') {
    return new AppError('Invalid token. Please log in again.', 401);
  }
  if (err.name === 'TokenExpiredError') {
    return new AppError('Your session has expired. Please log in again.', 401);
  }
  return null;
}

/**
 * Map Multer upload errors to AppErrors.
 * @param {Error} err
 * @returns {AppError|null}
 */
function handleMulterError(err) {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return new AppError('File too large. Please upload a smaller file.', 413);
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return new AppError('Unexpected file field.', 400);
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return new AppError('Too many files uploaded at once.', 400);
  }
  return null;
}

// ── Response builders ─────────────────────────────────────────────────

function sendDevError(err, res) {
  res.status(err.statusCode).json({
    status: err.status,
    message: err.message,
    error: err,
    stack: err.stack,
  });
}

function sendProdError(err, res) {
  if (err.isOperational) {
    // Trusted, operational error → send meaningful message
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
    });
  } else {
    // Programming / unknown error → don't leak details
    logger.error('UNHANDLED ERROR 💥', { error: err });
    res.status(500).json({
      status: 'error',
      message: 'Something went wrong. Please try again later.',
    });
  }
}

// ── Express error middleware ──────────────────────────────────────────

/**
 * Global Express error-handling middleware.
 * Must be registered **last** (after all routes).
 *
 * @type {import('express').ErrorRequestHandler}
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, _next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // Log every error
  logger.error(`${err.statusCode} - ${err.message}`, {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    ...(config.isProduction ? {} : { stack: err.stack }),
  });

  // Try to convert known library errors into AppErrors — first match wins.
  const finalErr =
    handlePrismaError(err) ||
    handleJWTError(err) ||
    handleMulterError(err) ||
    (err.name === 'ValidationError' ? new AppError(err.message, 400) : null) ||
    (err instanceof SyntaxError && err.status === 400 && 'body' in err
      ? new AppError('Invalid JSON in request body.', 400)
      : null) ||
    err;

  // Fire-and-forget: alert a developer on any 5xx (never on routine 4xx like a
  // wrong password or a validation failure). Never awaited — must not affect
  // the response, and never allowed to throw into this middleware.
  if (finalErr.status === 'error') {
    sendBackendErrorAlert({ err, finalErr, req }).catch(() => {});
  }

  return sendResponse(finalErr, req, res);
};

function sendResponse(err, _req, res) {
  // Verbose (raw error + stack) output requires an explicit NODE_ENV=development
  // opt-in; every other environment — staging, production, anything else —
  // defaults to the sanitized response.
  if (!config.isDevelopment) {
    sendProdError(err, res);
  } else {
    sendDevError(err, res);
  }
}

export default errorHandler;
