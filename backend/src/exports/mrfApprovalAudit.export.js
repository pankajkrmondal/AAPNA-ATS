/**
 * MRF approval audit CSV — every approval event across all requisitions in a
 * window (who got the request, opened it, decided, was told; refused attempts).
 * The admin-level counterpart of the per-MRF "Approval Trail" in the MRF modal.
 *
 * ADMIN TIER ONLY (enforced on the route): it carries IP address and device,
 * which are personal data (retention: jobs/mrfAuditRetentionSweep.js).
 */
import prisma from '../config/database.js';
import { formatIst, summarizeUserAgent } from '../utils/mrfApprovalRules.js';

/** Window clamp, same shape as the other monitoring exports. */
export function parseDays(raw) {
  return Math.min(Math.max(parseInt(raw, 10) || 90, 1), 3650);
}

export const columns = [
  { header: 'When (IST)', key: 'at_ist' },
  { header: 'MRF ID', key: 'mrf_id' },
  { header: 'Position', key: 'position' },
  { header: 'Event', key: 'event_type' },
  { header: 'Person', key: 'actor_name' },
  { header: 'Person Email', key: 'actor_email' },
  { header: 'Identified By', key: 'identity_source' },
  { header: 'Status Before', key: 'prior_status' },
  { header: 'Status After', key: 'new_status' },
  { header: 'Comment', key: 'comments' },
  { header: 'IP Address', key: 'ip_address' },
  { header: 'Device', key: 'device' },
  { header: 'Possibly Automated Scanner', value: (r) => (r.likely_scanner ? 'YES' : '') },
  { header: 'IP/Device Masked (retention)', value: (r) => (r.client_data_masked_at ? 'YES' : '') },
];

export function parseFilters(req) {
  return { days: parseDays(req.query.days) };
}

/** @type {import('./runExport.js').ExportSpec['fetch']} */
export async function fetch({ filters, max }) {
  const since = new Date(Date.now() - filters.days * 86400000);
  const events = await prisma.rpa_mrf_approval_events.findMany({
    where: { created_at: { gte: since } },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: max,
    include: { mrf: { select: { position_hiring_for: true } } },
  });
  return events.map((e) => ({
    at_ist: formatIst(e.created_at),
    mrf_id: e.mrf_id.toString(),
    position: e.mrf?.position_hiring_for || '',
    event_type: e.event_type,
    actor_name: e.actor_name || '',
    actor_email: e.actor_email || '',
    identity_source: e.identity_source,
    prior_status: e.prior_status || '',
    new_status: e.new_status || '',
    comments: e.comments || '',
    ip_address: e.ip_address || '',
    device: summarizeUserAgent(e.user_agent) || '',
    likely_scanner: e.likely_scanner,
    client_data_masked_at: e.client_data_masked_at,
  }));
}

export default { columns, fetch, parseFilters, parseDays };
