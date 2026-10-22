/**
 * systemLogs.controller.js — Super Admin → Logs & errors, and browser error
 * reports (N42).
 *
 *   POST /api/errors                 any signed-in user's browser reports an error
 *   GET  /api/admin/errors           grouped errors / occurrences   (superadmin)
 *   GET  /api/admin/logs?ref=        the whole trail of one ref     (superadmin)
 *   GET  /api/admin/jobs             job heartbeats                 (superadmin)
 *   GET  /api/admin/health/deep      database, Redis, queue, Graph  (superadmin)
 *
 * Super Admin only: errors cover every company.
 */
import prisma from '../config/database.js';
import config from '../config/index.js';
import redis from '../config/redis.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';
import { recordError, listErrorGroups, listOccurrences, findErrorsByRef } from '../services/errorLog.service.js';
import { findLogLinesByRef } from '../services/logScan.service.js';
import { getAccessToken } from '../services/onedrive.service.js';
import { HEARTBEAT_PREFIX } from '../utils/jobRunner.js';

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);

/** Drop the query string and fragment from a browser URL (they can carry tokens or emails). */
function pathOnly(url) {
  if (typeof url !== 'string') return undefined;
  try {
    return new URL(url, 'http://x').pathname.slice(0, 300);
  } catch {
    return url.split(/[?#]/)[0].slice(0, 300);
  }
}

// ── POST /api/errors ──────────────────────────────────────────────────

/**
 * A browser error from a signed-in user. Only whitelisted fields are kept;
 * everything is masked by recordError. Always answers 204 so a reporting
 * problem never shows the user a second error.
 */
export const reportClientError = catchAsync(async (req, res) => {
  const b = req.body || {};
  const message = str(b.message, 1000);
  if (message) {
    const page = pathOnly(b.page);
    recordError({
      source: 'frontend',
      level: b.level === 'warn' ? 'warn' : 'error',
      message: `${str(b.name, 80) ? `${str(b.name, 80)}: ` : ''}${message}`,
      stack: str(b.stack, 6000) ?? str(b.componentStack, 4000),
      route: page,
      // The ref of the failed API call, when the error came from one; else this report's own.
      requestId: /^[A-Za-z0-9_-]{4,80}$/.test(b.ref || '') ? b.ref : req.requestId,
      userId: req.user?.id,
      meta: {
        kind: str(b.kind, 40),
        page,
        component: str(b.component, 120),
        apiStatus: Number.isInteger(b.apiStatus) ? b.apiStatus : undefined,
        apiPath: pathOnly(b.apiPath),
        browser: str(req.get('user-agent'), 200),
        buildId: str(b.buildId, 40),
      },
    });
  }
  res.status(204).end();
});

// ── GET /api/admin/errors ─────────────────────────────────────────────

function parseFilters(q) {
  const toDate = (v) => {
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  const days = parseInt(q.days, 10);
  return {
    source: str(q.source, 20),
    env: str(q.env, 20),
    userId: q.userId ? parseInt(q.userId, 10) : undefined,
    from: toDate(q.from) ?? (Number.isFinite(days) && days > 0 ? new Date(Date.now() - days * 86400000) : undefined),
    to: toDate(q.to),
    q: str(q.q, 200)?.trim() || undefined,
    fingerprint: /^[0-9a-f]{16}$/.test(q.fingerprint || '') ? q.fingerprint : undefined,
  };
}

/** Grouped errors, or one group's occurrences when ?fingerprint= is given. */
export const listErrors = catchAsync(async (req, res) => {
  const filters = parseFilters(req.query);
  const data = filters.fingerprint
    ? await listOccurrences(filters, 100)
    : await listErrorGroups(filters, 200);
  res.status(200).json({ status: 'success', data });
});

// ── GET /api/admin/logs?ref= ──────────────────────────────────────────

/** Everything known about one ref: stored errors plus matching log lines. */
export const findByRef = catchAsync(async (req, res) => {
  const ref = String(req.query.ref || '').trim().replace(/^ref:\s*/i, '');
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(ref)) {
    throw new AppError('Enter a reference such as K7Q2MX.', 400);
  }
  const [errors, scan] = await Promise.all([findErrorsByRef(ref), findLogLinesByRef(ref)]);
  res.status(200).json({ status: 'success', data: { ref, errors, ...scan } });
});

// ── GET /api/admin/jobs ───────────────────────────────────────────────

/** One row per job and environment, from the heartbeats runJob writes. */
export const listJobs = catchAsync(async (_req, res) => {
  const rows = await prisma.rpa_settings.findMany({ where: { key: { startsWith: HEARTBEAT_PREFIX } } });
  const data = rows
    .map((r) => {
      const [env, ...rest] = r.key.slice(HEARTBEAT_PREFIX.length).split('.');
      let beat = {};
      try { beat = JSON.parse(r.value); } catch { /* unreadable heartbeat */ }
      const failing = beat.lastFailAt && (!beat.lastOkAt || beat.lastFailAt > beat.lastOkAt);
      return { job: rest.join('.'), env, ...beat, failing: Boolean(failing) };
    })
    .sort((a, b) => (a.env === b.env ? a.job.localeCompare(b.job) : a.env.localeCompare(b.env)));
  res.status(200).json({ status: 'success', data, currentEnv: config.env });
});

// ── GET /api/admin/health/deep ────────────────────────────────────────

async function check(name, fn, timeoutMs = 5000) {
  const started = Date.now();
  try {
    const detail = await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs)),
    ]);
    return { name, ok: true, ms: Date.now() - started, detail: detail ?? null };
  } catch (err) {
    return { name, ok: false, ms: Date.now() - started, error: err.message };
  }
}

/** Checks each dependency separately; 503 if any is down. */
export const deepHealth = catchAsync(async (_req, res) => {
  const useQueue = process.env.USE_RESUME_QUEUE === 'true';
  const checks = await Promise.all([
    check('database', async () => { await prisma.$queryRaw`SELECT 1`; return 'SELECT 1 ok'; }),
    check('redis', async () => {
      // A connection that is still opening (e.g. just after a restart) gets a
      // moment to finish before it counts as down.
      if (['connecting', 'connect', 'reconnecting'].includes(redis.status)) {
        await new Promise((resolve) => {
          const t = setTimeout(resolve, 3000);
          redis.once('ready', () => { clearTimeout(t); resolve(); });
        });
      }
      if (redis.status !== 'ready') throw new Error(`connection is ${redis.status}`);
      return `PING ${await redis.ping()}`;
    }),
    useQueue
      ? check('resume queue', async () => {
        const { getQueueHealth } = await import('../queues/resumeQueue.js');
        const h = await getQueueHealth();
        return `waiting ${h.waiting}, active ${h.active}, failed ${h.failed}, delayed ${h.delayed}`;
      })
      : Promise.resolve({ name: 'resume queue', ok: true, ms: 0, detail: 'not used (USE_RESUME_QUEUE is off; uploads run in the API process)' }),
    check('microsoft graph login', async () => { await getAccessToken(); return 'token ok'; }),
  ]);
  const ok = checks.every((c) => c.ok);
  res.status(ok ? 200 : 503).json({
    status: ok ? 'success' : 'error',
    data: { ok, env: config.env, uptimeSeconds: Math.round(process.uptime()), checkedAt: new Date().toISOString(), checks },
  });
});
