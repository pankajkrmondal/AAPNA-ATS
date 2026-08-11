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

/** Same window clamp the monitoring endpoint applies. */
export function parseDays(raw) {
  return Math.min(Math.max(parseInt(raw, 10) || 30, 1), 365);
}

const since = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

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
        where: { sent_at: { gte: since(filters.days) } },
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
      where: { status: 'failed', sent_at: { gte: since(filters.days) } },
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

/** Build the runExport spec for one table, or null for an unknown key. */
export function specFor(tableKey, days) {
  const table = TABLES[tableKey];
  if (!table) return null;

  return {
    key: `email_monitoring_${tableKey}`,
    label: `${table.label}_${days}d`,
    columns: table.columns,
    filters: { table: tableKey, days },
    fetch: table.fetch,
  };
}

export default { TABLES, TABLE_KEYS, specFor, parseDays };
