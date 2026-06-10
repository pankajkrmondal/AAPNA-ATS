import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

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

// ── Formats ───────────────────────────────────────────────────────────
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
 * In production only info and above are logged to console;
 * in development the configured LOG_LEVEL (default: debug) is used.
 */
const logger = winston.createLogger({
  level: NODE_ENV === 'production' ? 'info' : LOG_LEVEL,
  levels,
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
