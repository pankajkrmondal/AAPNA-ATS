/**
 * runExport.js — the single code path every CSV export endpoint goes through.
 *
 * Owning the row cap, the audit row and the logging in one place is the point:
 * a per-controller implementation is how you end up with one export that
 * silently truncates (the defect the old client-side MRF exporter shipped
 * with) and another that doesn't.
 *
 * Usage from a controller:
 *
 *   export const exportMrfRequests = catchAsync(async (req, res) =>
 *     runExport(req, res, {
 *       key: 'mrf',
 *       label: 'MRF-Requests',
 *       columns: mrfExport.columns,
 *       filters: mrfExport.parseFilters(req),
 *       fetch: mrfExport.fetch,
 *     }));
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import AppError from '../utils/AppError.js';
import { buildCsv, csvFilename, sendCsv } from '../utils/csvExport.js';

/** Never write these into the audit log, whatever a caller passes. */
const REDACTED_FILTER_KEYS = new Set(['token', 'password', 'authorization']);

/** Drop empties and secrets so the audit line stays readable. */
function safeFilters(filters = {}) {
  return Object.fromEntries(
    Object.entries(filters).filter(
      ([k, v]) => !REDACTED_FILTER_KEYS.has(String(k).toLowerCase())
        && v !== undefined && v !== null && v !== '',
    ),
  );
}

/**
 * Record the export in rpa_processing_log — the only actor-attributed audit
 * surface this app has. Bulk PII egress is exactly what gets asked about after
 * the fact, so every export leaves a trace of who pulled what.
 *
 * Best-effort: an audit-write failure must never turn a working export into a
 * 500. Same `.catch(() => {})` convention as hrUpload.controller.js.
 */
function audit({ key, req, rowCount, status, filters, filename }) {
  return prisma.rpa_processing_log.create({
    data: {
      fileName: filename || null,
      source: 'CSV_EXPORT',
      status,
      logMessage: `${key}: ${rowCount} row(s); filters=${JSON.stringify(safeFilters(filters))}`,
      actor_email: req.user?.email || null,
      actor_context: `${req.user?.role || 'unknown'} via ${String(req.originalUrl || '').split('?')[0]}`,
      createdAt: new Date(),
    },
  }).catch(() => {});
}

/**
 * @typedef {object} ExportSpec
 * @property {string}   key      Stable identifier for logs/audit ('candidates').
 * @property {string}   label    Human part of the filename ('Candidates').
 * @property {import('../utils/csvExport.js').CsvColumn[]} columns
 * @property {Function} fetch    async ({ filters, user, max }) => rows | { rows, degraded }
 * @property {object}  [filters] Parsed filters, echoed into the audit row.
 * @property {Record<string,string|number>} [headers] Extra response headers.
 */

/**
 * Run an export end-to-end: fetch → cap check → serialise → send.
 *
 * `fetch` is handed `max = maxRows + 1`. Asking for one row more than we will
 * ever send is what lets us tell "exactly at the cap" from "over the cap"
 * without a second COUNT query.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {ExportSpec} spec
 */
export async function runExport(req, res, spec) {
  const { key, label, columns, fetch, filters = {}, headers = {} } = spec;
  const startedAt = Date.now();
  const max = config.exports.maxRows;

  const result = await fetch({ filters, user: req.user, max: max + 1 });
  const rows = Array.isArray(result) ? result : (result?.rows || []);
  const degraded = !Array.isArray(result) && Boolean(result?.degraded);

  if (rows.length > max) {
    audit({ key, req, rowCount: rows.length, status: 'Blocked', filters });
    logger.warn(`CSV export blocked (row cap): ${key}`, {
      user: req.user?.email, rows: rows.length, max,
    });
    // Refuse rather than truncate. A silently truncated CSV opens perfectly
    // well and is indistinguishable from a complete one.
    throw new AppError(
      `This export would contain more than ${max.toLocaleString('en-IN')} rows. `
      + 'Narrow the filters and try again.',
      413,
    );
  }

  const csv = buildCsv(rows, columns);
  const filename = csvFilename(label);

  logger.info(`CSV export: ${key}`, {
    user: req.user?.email,
    role: req.user?.role,
    rows: rows.length,
    bytes: Buffer.byteLength(csv, 'utf8'),
    ms: Date.now() - startedAt,
    filters: safeFilters(filters),
  });

  audit({ key, req, rowCount: rows.length, status: 'Success', filters, filename });

  return sendCsv(res, csv, filename, {
    'X-Export-Row-Count': rows.length,
    ...(degraded ? { 'X-Export-Degraded': 'true' } : {}),
    ...headers,
  });
}

export default runExport;
