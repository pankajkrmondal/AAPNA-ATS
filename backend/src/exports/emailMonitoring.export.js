/**
 * Email Delivery monitoring CSV exports — the two tables on the Analytics
 * page's "Email Delivery" tab, chosen with `?table=`.
 *
 * `by_type` is the complete per-type roll-up either way. `failures` on screen
 * is capped at the 20 most recent (emailTemplate.controller.js); the export
 * returns EVERY failure in the window, because chasing down delivery problems
 * is exactly what someone exports this for.
 */
import prisma from '../config/database.js';
import { parseAnalyticsRange, rangeFileTag, rangeForResponse } from '../utils/analyticsRange.js';

/** Same window clamp the monitoring endpoint applies. */
export function parseDays(raw) {
  return Math.min(Math.max(parseInt(raw, 10) || 30, 1), 365);
}

/**
 * The window both the tab and its CSV use. L06: the Analytics page sends its
 * date range (from / to); without one, the old rolling `days` window applies.
 * @returns {{ since: Date, until: Date, days: number, range: object|null }}
 */
export function parseWindow(query = {}) {
  const range = parseAnalyticsRange(query);
  if (range) return { since: range.from, until: range.to, days: range.days, range };
  const days = parseDays(query.days);
  return { since: new Date(Date.now() - days * 24 * 60 * 60 * 1000), until: new Date(Date.now() + 60_000), days, range: null };
}

/** The window as the response reports it. */
export const windowForResponse = (w) => ({ window_days: w.days, range: w.range ? rangeForResponse(w.range) : null });

const sentIn = (f) => ({ gte: f.since, lt: f.until });

export const TABLES = {
  by_type: {
    label: 'Email-Delivery-By-Type',
    columns: [
      { header: 'Email Type', key: 'email_type' },
      { header: 'Sent', key: 'sent', numeric: true },
      { header: 'Failed', key: 'failed', numeric: true },
      { header: 'Total', value: (r) => r.sent + r.failed, numeric: true },
    ],
    fetch: async ({ filters }) => {
      const rows = await prisma.rpa_email_log.groupBy({
        by: ['email_type', 'status'],
        where: { sent_at: sentIn(filters) },
        _count: { _all: true },
      });

      // Fold type×status into one row per type — same shape as the screen.
      const byType = {};
      for (const row of rows) {
        const entry = (byType[row.email_type] ??= { email_type: row.email_type, sent: 0, failed: 0 });
        if (row.status === 'failed') entry.failed += row._count._all;
        else entry.sent += row._count._all;
      }

      return Object.values(byType).sort((a, b) => (b.sent + b.failed) - (a.sent + a.failed));
    },
  },

  failures: {
    label: 'Email-Delivery-Failures',
    columns: [
      { header: 'Failed At', key: 'sent_at', type: 'datetime' },
      { header: 'Email Type', key: 'email_type' },
      { header: 'Recipient', key: 'recipient_email' },
      { header: 'Subject', key: 'subject' },
      { header: 'Error', key: 'error_message' },
    ],
    // No `take` — the screen shows the latest 20, the CSV carries them all.
    fetch: async ({ filters, max }) => prisma.rpa_email_log.findMany({
      where: { status: 'failed', sent_at: sentIn(filters) },
      orderBy: { sent_at: 'desc' },
      take: max,
      select: {
        sent_at: true,
        email_type: true,
        recipient_email: true,
        subject: true,
        error_message: true,
      },
    }),
  },
};

export const TABLE_KEYS = Object.keys(TABLES);

/**
 * Build the runExport spec for one table, or null for an unknown key.
 * @param {string} tableKey
 * @param {number|ReturnType<typeof parseWindow>} windowOrDays  a parseWindow() result (or, as before L06, a day count)
 */
export function specFor(tableKey, windowOrDays) {
  const table = TABLES[tableKey];
  if (!table) return null;
  const w = typeof windowOrDays === 'object' && windowOrDays ? windowOrDays : parseWindow({ days: windowOrDays });

  return {
    key: `email_monitoring_${tableKey}`,
    label: w.range ? `${table.label}${rangeFileTag(w.range)}` : `${table.label}_${w.days}d`,
    columns: table.columns,
    filters: { table: tableKey, days: w.days, since: w.since, until: w.until },
    fetch: table.fetch,
  };
}

export default { TABLES, TABLE_KEYS, specFor, parseDays, parseWindow, windowForResponse };
