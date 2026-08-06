import AppError from '../utils/AppError.js';
import logger from '../config/logger.js';
import config from '../config/index.js';

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
    err.code === 'P1017'    // server closed the connection
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

  // Try to convert known library errors into AppErrors
  const prismaErr = handlePrismaError(err);
  if (prismaErr) return sendResponse(prismaErr, req, res);

  const jwtErr = handleJWTError(err);
  if (jwtErr) return sendResponse(jwtErr, req, res);

  const multerErr = handleMulterError(err);
  if (multerErr) return sendResponse(multerErr, req, res);

  // Validation errors (from our validate middleware)
  if (err.name === 'ValidationError') {
    const validationErr = new AppError(err.message, 400);
    return sendResponse(validationErr, req, res);
  }

  // SyntaxError from bad JSON body
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    const syntaxErr = new AppError('Invalid JSON in request body.', 400);
    return sendResponse(syntaxErr, req, res);
  }

  return sendResponse(err, req, res);
};

function sendResponse(err, _req, res) {
  if (config.isProduction) {
    sendProdError(err, res);
  } else {
    sendDevError(err, res);
  }
}

export default errorHandler;
