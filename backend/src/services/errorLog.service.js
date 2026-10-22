/**
 * errorLog.service.js — the error store behind Super Admin → Logs & errors (N42).
 *
 * `recordError()` is called from the global error handler (5xx), the job
 * runner, the crash handlers and POST /api/errors (browsers). It NEVER throws
 * and never awaits anything the caller depends on: if the database is down or
 * the table is missing, the error is still in the log files.
 *
 * Everything stored is masked (emails, phone numbers), and `meta` keeps only
 * whitelisted keys.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import config from '../config/index.js';
import logger from '../config/logger.js';
import { currentRef, getContext } from '../middleware/requestContext.js';
import { maskText, maskValue, templatePath } from '../utils/logMask.js';

const SOURCES = new Set(['backend', 'frontend', 'job']);
const META_KEYS = ['status', 'statusCode', 'code', 'job', 'durationMs', 'method', 'page', 'component', 'browser', 'kind', 'apiStatus', 'apiPath', 'buildId'];
const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;

/** First stack frame that is our code, without line/column numbers. */
function topFrame(stack) {
  const lines = String(stack || '').split('\n').map((l) => l.trim());
  const frame = lines.find((l) => l.startsWith('at ') && !l.includes('node_modules') && !l.includes('node:internal'))
    || lines.find((l) => l.startsWith('at ') || l.includes('@'))
    || '';
  return frame.replace(/:\d+(:\d+)?\)?$/, '').replace(/\?[^\s)]*/g, '').replace(/-[A-Za-z0-9_]{8}\.js/g, '.js');
}

/**
 * The route as stored and grouped. Three shapes reach here: a bare path from a
 * browser ("/pipeline/42"), "METHOD /path" from the error handler, and a
 * non-path label ("job:mailboxPoller", "process:uncaughtException"). Only the
 * path part has its ids templated; a label is kept as it is.
 */
export function routeShape(route) {
  const r = String(route || '').trim();
  if (!r) return '';
  if (/^[a-z]+:[\w.-]+$/i.test(r)) return r;
  const m = r.match(/^([A-Z]+)\s+(\S.*)$/);
  return m ? `${m[1]} ${templatePath(m[2])}` : templatePath(r);
}

/**
 * Groups repeats of the same error. Messages are templated (numbers removed)
 * so "candidate 123 not found" and "candidate 456 not found" group together.
 */
export function fingerprintOf({ source, name, code, route, stack, message }) {
  const msgShape = String(message || '').replace(/\d+/g, '#').slice(0, 120);
  const basis = [source, code || name || 'Error', routeShape(route), topFrame(stack) || msgShape].join('|');
  return createHash('sha1').update(basis).digest('hex').slice(0, 16);
}

function pickMeta(meta) {
  if (!meta || typeof meta !== 'object') return undefined;
  const out = {};
  for (const k of META_KEYS) {
    if (meta[k] !== undefined && meta[k] !== null) out[k] = typeof meta[k] === 'string' ? meta[k].slice(0, 300) : meta[k];
  }
  return Object.keys(out).length ? maskValue(out) : undefined;
}

/**
 * Record one error occurrence. Fire-and-forget: returns a promise that always
 * resolves (true when stored).
 * @param {object} p
 * @param {'backend'|'frontend'|'job'} p.source
 * @param {Error} [p.err]
 * @param {string} [p.message]  used when there is no Error object
 * @param {string} [p.stack]
 * @param {'error'|'warn'} [p.level]
 * @param {string} [p.route]
 * @param {string} [p.requestId]  defaults to the current context's ref
 * @param {number} [p.userId]     defaults to the current context's user
 * @param {object} [p.meta]
 * @returns {Promise<boolean>}
 */
export async function recordError({ source, err, message, stack, level = 'error', route, requestId, userId, meta } = {}) {
  try {
    const ctx = getContext();
    const src = SOURCES.has(source) ? source : 'backend';
    const rawMessage = message ?? (err ? `${err.name && err.name !== 'Error' ? `${err.name}: ` : ''}${err.message}` : 'Unknown error');
    const rawStack = stack ?? err?.stack ?? null;
    const routeValue = route ?? ctx?.route ?? null;
    const data = {
      source: src,
      env: String(config.env).slice(0, 20),
      level: level === 'warn' ? 'warn' : 'error',
      message: maskText(String(rawMessage)).slice(0, MAX_MESSAGE),
      stack: rawStack ? maskText(String(rawStack)).slice(0, MAX_STACK) : null,
      request_id: (requestId ?? currentRef())?.slice(0, 80) ?? null,
      route: routeValue ? routeShape(routeValue).slice(0, 300) || null : null,
      user_id: Number.isInteger(userId ?? ctx?.userId) ? (userId ?? ctx.userId) : null,
      meta: pickMeta(meta),
      fingerprint: fingerprintOf({ source: src, name: err?.name, code: err?.code, route: routeValue, stack: rawStack, message: rawMessage }),
    };
    await prisma.rpa_error_log.create({ data });
    return true;
  } catch (e) {
    // Never recurse into the error log from here.
    logger.warn(`[ErrorLog] could not store an error: ${e.message}`);
    return false;
  }
}

// ── Reads for the Logs & errors page ──────────────────────────────────

function whereClause({ source, env, userId, from, to, q, fingerprint }) {
  const parts = [];
  if (source && SOURCES.has(source)) parts.push(Prisma.sql`e.source = ${source}`);
  if (env) parts.push(Prisma.sql`e.env = ${String(env)}`);
  if (Number.isInteger(userId)) parts.push(Prisma.sql`e.user_id = ${userId}`);
  if (from) parts.push(Prisma.sql`e.created_at >= ${from}`);
  if (to) parts.push(Prisma.sql`e.created_at < ${to}`);
  if (q) parts.push(Prisma.sql`(e.message ILIKE ${`%${q}%`} OR e.route ILIKE ${`%${q}%`})`);
  if (fingerprint) parts.push(Prisma.sql`e.fingerprint = ${fingerprint}`);
  return parts.length ? Prisma.sql`WHERE ${Prisma.join(parts, ' AND ')}` : Prisma.empty;
}

/**
 * Errors grouped by fingerprint, most recent first.
 * @returns {Promise<Array<object>>}
 */
export async function listErrorGroups(filters = {}, limit = 200) {
  const rows = await prisma.$queryRaw`
    SELECT e.fingerprint,
           COUNT(*)::int                                          AS count,
           MIN(e.created_at)                                      AS first_seen,
           MAX(e.created_at)                                      AS last_seen,
           (ARRAY_AGG(e.message    ORDER BY e.created_at DESC))[1] AS message,
           (ARRAY_AGG(e.source     ORDER BY e.created_at DESC))[1] AS source,
           (ARRAY_AGG(e.env        ORDER BY e.created_at DESC))[1] AS env,
           (ARRAY_AGG(e.route      ORDER BY e.created_at DESC))[1] AS route,
           (ARRAY_AGG(e.request_id ORDER BY e.created_at DESC))[1] AS last_ref,
           COUNT(DISTINCT e.user_id)::int                         AS users
      FROM rpa_error_log e
      ${whereClause(filters)}
     GROUP BY e.fingerprint
     ORDER BY MAX(e.created_at) DESC
     LIMIT ${limit}`;
  return rows;
}

/** Individual occurrences (newest first), with the user's name. */
export async function listOccurrences(filters = {}, limit = 100) {
  return prisma.$queryRaw`
    SELECT e.id::text AS id, e.source, e.env, e.level, e.message, e.stack, e.request_id, e.route,
           e.user_id, e.meta, e.created_at,
           NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS user_name, u.role AS user_role
      FROM rpa_error_log e
      LEFT JOIN rpa_users u ON u.id = e.user_id
      ${whereClause(filters)}
     ORDER BY e.created_at DESC
     LIMIT ${limit}`;
}

/** Every stored error for one ref (a request or a job run). */
export async function findErrorsByRef(ref) {
  return prisma.$queryRaw`
    SELECT e.id::text AS id, e.source, e.env, e.level, e.message, e.stack, e.request_id, e.route,
           e.user_id, e.meta, e.created_at,
           NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS user_name, u.role AS user_role
      FROM rpa_error_log e
      LEFT JOIN rpa_users u ON u.id = e.user_id
     WHERE e.request_id = ${ref} OR e.request_id LIKE ${`%-${ref}`}
     ORDER BY e.created_at ASC
     LIMIT 50`;
}

/**
 * Delete rows older than `days`, in batches. Used by the nightly sweep.
 * @returns {Promise<number>} rows deleted
 */
export async function deleteOlderThan(days, { batchSize = 5000, maxBatches = 20 } = {}) {
  const cutoff = new Date(Date.now() - days * 86400000);
  let total = 0;
  for (let i = 0; i < maxBatches; i += 1) {
    const n = await prisma.$executeRaw`
      DELETE FROM rpa_error_log WHERE id IN (
        SELECT id FROM rpa_error_log WHERE created_at < ${cutoff} ORDER BY id LIMIT ${batchSize})`;
    total += n;
    if (n < batchSize) break;
  }
  return total;
}
