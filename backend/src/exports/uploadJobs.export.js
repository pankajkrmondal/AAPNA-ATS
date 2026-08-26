/**
 * Upload-queue CSV exports — HR Manual Upload (/hr-upload) and Vendor Manual
 * Upload (/vendor). Both screens list the same `rpa_upload_jobs` table with a
 * different `source` and different visibility scoping, so they share columns
 * and differ only in the `where` each builds.
 *
 * The vendor variant reuses the controller's exact visibility rules — a vendor
 * sees only their own self-uploads, a recruiter sees their own plus the shared
 * review queue, admins see everything — so the CSV can never widen what the
 * screen shows.
 */
import prisma from '../config/database.js';

export const columns = [
  { header: 'Job ID', key: 'id' },
  { header: 'Candidate Name', key: 'candidate_name' },
  { header: 'Candidate Email', key: 'candidate_email' },
  { header: 'File Name', key: 'file_name' },
  { header: 'Status', key: 'status' },
  { header: 'Duplicate', key: 'is_duplicate' },
  { header: 'Action Required', key: 'action_required' },
  { header: 'Uploaded By', key: 'uploaded_by' },
  { header: 'Vendor Name', key: 'vendor_name' },
  { header: 'Vendor Email', key: 'vendor_email' },
  { header: 'Source', key: 'source' },
  { header: 'Reviewed By', key: 'reviewed_by' },
  { header: 'Review Action', key: 'review_action' },
  { header: 'Error Message', key: 'error_message' },
  { header: 'Attempts', key: 'attempts', numeric: true },
  { header: 'Candidate Record ID', key: 'cv_id' },
  { header: 'File URL', key: 'file_url' },
  { header: 'Uploaded At', key: 'created_at', type: 'datetime' },
  { header: 'Last Updated', key: 'updated_at', type: 'datetime' },
];

/** Only what the columns above render — never the whole row. */
const EXPORT_SELECT = {
  id: true,
  candidate_name: true,
  candidate_email: true,
  file_name: true,
  status: true,
  is_duplicate: true,
  action_required: true,
  uploaded_by: true,
  vendor_name: true,
  vendor_email: true,
  source: true,
  reviewed_by: true,
  review_action: true,
  error_message: true,
  attempts: true,
  cv_id: true,
  file_url: true,
  created_at: true,
  updated_at: true,
};

/**
 * `rpa_upload_jobs` is absent from some generated clients — both list
 * controllers guard on it, so the exports must degrade identically: an empty
 * (headers-only) CSV with a 200, never a 500.
 */
const tableMissing = () => !prisma.rpa_upload_jobs;

async function runQuery(where, max) {
  if (tableMissing()) return [];
  return prisma.rpa_upload_jobs.findMany({
    where,
    select: EXPORT_SELECT,
    orderBy: { updated_at: 'desc' },
    take: max,
  });
}

// ── HR Manual Upload ──────────────────────────────────────────────────

export function parseHrFilters(req) {
  const { status, actionRequired } = req.query;
  return { status: status || undefined, actionRequired: actionRequired === 'true' };
}

/** Same `where` as GET /api/hr-upload/jobs. */
export function buildHrWhere(filters = {}) {
  const where = { source: 'hr_manual_upload' };
  if (filters.status) where.status = filters.status;
  if (filters.actionRequired) where.action_required = true;
  return where;
}

export const hrSpec = {
  key: 'hr_upload_jobs',
  label: 'HR-Upload-Jobs',
  columns,
  fetch: ({ filters, max }) => runQuery(buildHrWhere(filters), max),
};

// ── Vendor Manual Upload ──────────────────────────────────────────────

export function parseVendorFilters(req) {
  const { status, actionRequired, vendorEmail } = req.query;
  return {
    status: status || undefined,
    actionRequired: actionRequired === 'true',
    vendorEmail: (vendorEmail || '').trim() || undefined,
  };
}

/**
 * Same visibility rules as GET /api/vendor/jobs (vendor.controller.js).
 * Scoping is derived from the session, so a vendor cannot widen it via query
 * params — the `vendorEmail` drill-down is honoured for staff only.
 */
export function buildVendorWhere(filters = {}, user) {
  const role = (user?.role || '').toLowerCase();
  const isVendor = role === 'vendor';
  const isAdmin = role === 'admin' || role === 'superadmin';

  const where = { source: 'vendor_portal' };

  if (!isAdmin) {
    if (isVendor) {
      where.uploaded_by_id = user.id;
    } else {
      // Recruiters see their own uploads plus the shared review queue.
      where.OR = [{ uploaded_by_id: user.id }, { action_required: true }];
    }
  }

  if (!isVendor && filters.vendorEmail) {
    where.vendor_email = { equals: filters.vendorEmail, mode: 'insensitive' };
  }

  if (filters.status) where.status = filters.status;
  if (filters.actionRequired) where.action_required = true;

  return where;
}

export const vendorSpec = {
  key: 'vendor_upload_jobs',
  label: 'Vendor-Upload-Jobs',
  columns,
  fetch: ({ filters, user, max }) => runQuery(buildVendorWhere(filters, user), max),
};

export default {
  columns, hrSpec, vendorSpec, parseHrFilters, parseVendorFilters, buildHrWhere, buildVendorWhere,
};
