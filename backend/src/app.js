import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import config from './config/index.js';
import logger, { morganStream } from './config/logger.js';
import errorHandler from './middleware/errorHandler.js';
import AppError from './utils/AppError.js';
import friendlyRateLimitHandler from './utils/rateLimitHandler.js';
import apiRouter from './routes/index.js';

const app = express();

// Behind a reverse proxy, derive the client IP from X-Forwarded-For so the
// rate limiter keys on real clients instead of the proxy's IP.
if (config.trustProxy) {
  app.set('trust proxy', 1);
}

// Configure global BigInt JSON serialization safety
app.set('json replacer', (key, value) => {
  if (typeof value === 'bigint') {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
  }
  return value;
});

// ── Security headers ──────────────────────────────────────────────────
app.use(helmet());

// ── CORS ──────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: config.cors.frontendUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    // CSV exports read these client-side. Without exposedHeaders the browser
    // hides them on cross-origin responses, so staging/production (where
    // VITE_API_URL points at another origin) would name every download
    // "export.csv" while dev — proxied same-origin by Vite — looked fine.
    exposedHeaders: [
      'Content-Disposition', 'X-Export-Row-Count', 'X-Export-Degraded',
      // The candidate dossier reuses X-Export-Degraded above (downloadFile()
      // only reads that one); this says which format the pack came back as.
      'X-Dossier-Format',
    ],
  }),
);

// ── Request logging ───────────────────────────────────────────────────
app.use(
  morgan(':method :url :status :res[content-length] - :response-time ms', {
    stream: morganStream,
  }),
);

// ── Body parsing ──────────────────────────────────────────────────────
app.use(express.json({ limit: config.upload.maxSize }));
app.use(express.urlencoded({ extended: true, limit: config.upload.maxSize }));

// ── Response compression ──────────────────────────────────────────────
app.use(compression());

// ── Rate limiting ─────────────────────────────────────────────────────
// Two tiers: a strict brute-force limiter on /api/auth (only FAILED attempts
// count) and a generous abuse-protection limiter on the rest of the API.
const authLimiter = rateLimit({
  windowMs: config.rateLimit.authWindowMs,
  max: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: friendlyRateLimitHandler('Too many failed sign-in attempts. For your security, sign-in is temporarily paused.'),
});
app.use('/api/auth', authLimiter);

const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
  handler: friendlyRateLimitHandler("You've made too many requests in a short time."),
});
app.use('/api', limiter);

// ── API routes ────────────────────────────────────────────────────────
app.use('/api', apiRouter);

// ── Health check ──────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'ATS Backend is running',
    timestamp: new Date().toISOString(),
    environment: config.env,
    uptime: process.uptime(),
  });
});

// ── 404 handler (must be after all routes) ────────────────────────────
app.all('/*splat', (req, _res, next) => {
  next(new AppError(`Cannot find ${req.method} ${req.originalUrl} on this server.`, 404));
});

// ── Global error handler ──────────────────────────────────────────────
app.use(errorHandler);

export default app;
