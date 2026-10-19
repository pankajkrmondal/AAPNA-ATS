import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getContext } from '../middleware/requestContext.js';
import { maskText, maskValue } from '../utils/logMask.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read env directly because this module loads before config/index.js
const NODE_ENV = process.env.NODE_ENV || 'development';
const LOG_LEVEL = process.env.LOG_LEVEL || 'debug';
const LOG_DIR = process.env.LOG_DIR || path.resolve(__dirname, '../../logs');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// ── Custom log levels (npm convention + "http") ───────────────────────
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'cyan',
};

winston.addColors(colors);

// The combined log is what Logs & errors searches by ref (N42), so it always
// keeps request lines and outside-call lines ("http"), even when LOG_LEVEL is
// "info". LOG_LEVEL still decides what the console prints.
const CONSOLE_LEVEL = NODE_ENV === 'production' ? (process.env.LOG_LEVEL || 'info') : LOG_LEVEL;
const FILE_LEVEL = (levels[CONSOLE_LEVEL] ?? levels.info) >= levels.http ? CONSOLE_LEVEL : 'http';

// ── Formats ───────────────────────────────────────────────────────────

/** Adds the current request/job ref and user to every line (N42). */
const contextFormat = winston.format((info) => {
  const ctx = getContext();
  if (ctx) {
    if (info.requestId === undefined) info.requestId = ctx.requestId;
    if (info.userId === undefined && ctx.userId != null) info.userId = ctx.userId;
  }
  return info;
});

/** Masks emails and phone numbers in the message and in every meta value (N42). */
const maskFormat = winston.format((info) => {
  if (typeof info.message === 'string') info.message = maskText(info.message);
  for (const key of Object.keys(info)) {
    if (key === 'level' || key === 'message' || key === 'timestamp') continue;
    info[key] = maskValue(info[key]);
  }
  return info;
});

const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level}: ${message}${metaStr}`;
  }),
);

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

// ── Transports ────────────────────────────────────────────────────────
const transports = [];

// Console — always active
transports.push(
  new winston.transports.Console({
    level: CONSOLE_LEVEL,
    format: NODE_ENV === 'production' ? prodFormat : devFormat,
  }),
);

// File transports — always active (JSON for structured log aggregation)
transports.push(
  new winston.transports.File({
    filename: path.join(LOG_DIR, 'error.log'),
    level: 'error',
    format: prodFormat,
    maxsize: 10 * 1024 * 1024, // 10 MB
    maxFiles: 5,
  }),
);

transports.push(
  new winston.transports.File({
    filename: path.join(LOG_DIR, 'combined.log'),
    level: FILE_LEVEL,
    format: prodFormat,
    maxsize: 10 * 1024 * 1024,
    maxFiles: 5,
  }),
);

// ── Logger instance ───────────────────────────────────────────────────
/**
 * Application-wide Winston logger.
 *
 * Levels (highest → lowest priority):
 *   error → warn → info → http → debug
 *
 * The console prints LOG_LEVEL and above (production default: info). The
 * combined log file always keeps at least "http" (request and outside-call
 * lines) so a ref can be traced. Every line carries the request ref and is
 * masked before any transport sees it.
 */
const logger = winston.createLogger({
  level: FILE_LEVEL,
  levels,
  format: winston.format.combine(contextFormat(), maskFormat()),
  transports,
  // Do not exit on uncaught exceptions — let the process handler deal with it
  exitOnError: false,
});

/**
 * Morgan stream adapter — pipes HTTP request logs into Winston at "http" level.
 */
export const morganStream = {
  write: (message) => {
    logger.http(message.trim());
  },
};

export default logger;
