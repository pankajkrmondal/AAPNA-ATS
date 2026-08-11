/**
 * MRF requisition CSV export.
 *
 * `buildMrfWhere` is shared with GET /api/mrf (mrf.controller.js) so the CSV
 * and the screen can never disagree about what a filter means.
 *
 * Two deliberate divergences from the on-screen table:
 *
 *  1. MRF Status carries the DISPLAYED label, not the raw column. The table
 *     maps `managersubmitted` -> "MANAGER SUBMITTED" and blank -> "PENDING"
 *     (MRF.jsx); an export of the raw value would read differently from the
 *     screen it was taken from.
 *  2. Budgets carry the raw number, not the formatted "₹1,20,000" string the
 *     table renders — so the columns still SUM in Excel.
 */
import prisma from '../config/database.js';
import { isMrfFilled } from '../config/pipelineStages.js';

/**
 * Prisma `where` for the MRF list. Mirrors the status aliases the UI's filter
 * tabs send ("manager submitted" with a space, "pending" also matching
 * "pendingfromleader").
 *
 * @param {{ search?: string, status?: string }} query
 */
export function buildMrfWhere(query = {}) {
  const { search, status } = query;
  const andConditions = [];

  if (status && status.toLowerCase() !== 'all') {
    const statusLower = status.trim().toLowerCase();
    if (statusLower === 'pending') {
      andConditions.push({ mrfstatus: { in: ['pending', 'pendingfromleader'] } });
    } else if (statusLower === 'manager submitted' || statusLower === 'managersubmitted') {
      andConditions.push({ mrfstatus: { in: ['managersubmitted', 'manager submitted'] } });
    } else {
      andConditions.push({ mrfstatus: status.trim() });
    }
  }

  if (search) {
    andConditions.push({
      OR: [
        { first_name: { contains: search, mode: 'insensitive' } },
        { last_name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { role: { contains: search, mode: 'insensitive' } },
      ],
    });
  }

  return andConditions.length > 0 ? { AND: andConditions } : {};
}

/**
 * Same mapping the MRF table's status column renders (MRF.jsx).
 * @param {string|null} status
 */
export function mrfStatusLabel(status) {
  const statusStr = (status || '').trim().toLowerCase();
  if (statusStr === 'managersubmitted' || statusStr === 'manager submitted') return 'MANAGER SUBMITTED';
  if (statusStr === 'pending' || statusStr === 'pendingfromleader' || statusStr === '') return 'PENDING';
  return (status || '').toUpperCase();
}

/**
 * Attach the linked requisition's approval_status and fill state, exactly as
 * the list endpoint does (one batched query, defaulting to 'pending' when
 * unlinked).
 *
 * `approval_status` and `mrf_filled` are INDEPENDENT facts and are carried
 * separately: a requisition can legitimately be 'completed' AND filled.
 * Closure used to express "filled" by overwriting approval_status to 'closed',
 * which destroyed the real value (see mrfClosure.service.js); fill state is
 * surfaced alongside, never instead.
 *
 * Fill state is read from the dedicated `rpa_mrf.filled_at` column (added by
 * prisma/ddl/2026-08-11-mrf-filled-at.sql). `filled_at` MUST be selected here:
 * closure now stamps that column and no longer writes
 * `approval_status = 'closed'`, so without it isMrfFilled() falls back to the
 * legacy status test and reports every newly-filled requisition as NOT filled.
 */
export async function attachApprovalStatus(records) {
  const mrfIds = records.map((r) => r.mrf_id).filter(Boolean).map((id) => BigInt(id));

  const linked = mrfIds.length > 0
    ? await prisma.rpa_mrf.findMany({
      where: { id: { in: mrfIds } },
      select: { id: true, approval_status: true, filled_at: true },
    })
    : [];

  const byId = {};
  linked.forEach((m) => { byId[m.id.toString()] = m; });

  return records.map((record) => {
    const mIdStr = record.mrf_id ? record.mrf_id.toString() : null;
    const mrf = mIdStr ? byId[mIdStr] : null;
    return {
      ...record,
      approval_status: mrf?.approval_status || 'pending',
      mrf_filled: isMrfFilled(mrf),
      mrf_filled_at: mrf?.filled_at || null,
    };
  });
}

export const columns = [
  { header: 'MRF Request ID', key: 'id' },
  { header: 'First Name', key: 'first_name' },
  { header: 'Last Name', key: 'last_name' },
  { header: 'Email', key: 'email' },
  { header: 'CC Email', key: 'cc_email' },
  { header: 'Role', key: 'role' },
  { header: 'Min Budget (INR)', key: 'budget_min', numeric: true },
  { header: 'Max Budget (INR)', key: 'budget_max', numeric: true },
  { header: 'MRF Status', value: (r) => mrfStatusLabel(r.mrfstatus) },
  { header: 'Approval Status', key: 'approval_status' },
  // Independent of Approval Status — a requisition can be 'completed' AND filled.
  { header: 'Openings Filled', value: (r) => (r.mrf_filled ? 'YES' : 'NO') },
  { header: 'Filled On', key: 'mrf_filled_at', type: 'datetime' },
  { header: 'JD Document Link', key: 'jd_doc_link' },
  { header: 'Linked MRF ID', key: 'mrf_id' },
  { header: 'Created Date', key: 'created_at', type: 'date' },
];

/** Pull the export's filters off the request, matching the list endpoint. */
export function parseFilters(req) {
  const { search = '', status = '' } = req.query;
  return { search, status };
}

/**
 * Only the columns the CSV actually renders. Notably excludes
 * `email_body_content`, a large HTML blob no export column uses — an
 * unpaginated `findMany` without a select would drag every byte of it back.
 */
const EXPORT_SELECT = {
  id: true,
  first_name: true,
  last_name: true,
  email: true,
  cc_email: true,
  role: true,
  budget_min: true,
  budget_max: true,
  mrfstatus: true,
  jd_doc_link: true,
  mrf_id: true,
  created_at: true,
};

/** @type {import('./runExport.js').ExportSpec['fetch']} */
export async function fetch({ filters, max }) {
  const records = await prisma.rpa_mrf_jd_send.findMany({
    where: buildMrfWhere(filters),
    select: EXPORT_SELECT,
    orderBy: { created_at: 'desc' },
    take: max,
  });

  return attachApprovalStatus(records);
}

export default { columns, fetch, parseFilters, buildMrfWhere, mrfStatusLabel };
