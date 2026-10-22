/**
 * Admin Portal CSV exports — the User Management table and the superadmin-only
 * Companies table.
 *
 * Both mirror the tenant scoping the list endpoints enforce:
 *   - superadmin sees every user (optionally filtered by company)
 *   - a company admin sees only their own company's users, and never
 *     superadmin (global) accounts
 *
 * `password_hash` is not in the column list and not selected — the export is
 * an allowlist, so it cannot leak even by accident.
 */
import prisma from '../config/database.js';
import { isSuperadmin, ROLES } from '../config/roles.js';

export const userColumns = [
  { header: 'User ID', key: 'id' },
  { header: 'First Name', key: 'first_name' },
  { header: 'Last Name', key: 'last_name' },
  { header: 'Username', key: 'username' },
  { header: 'Email', key: 'email' },
  { header: 'Role', key: 'role' },
  { header: 'Department', key: 'department' },
  { header: 'Company', key: 'company.name' },
  { header: 'Active', key: 'is_active' },
  { header: 'Approved', key: 'is_approved' },
  { header: 'Created At', key: 'created_at', type: 'datetime' },
];

/** Never selects password_hash. */
const USER_SELECT = {
  id: true,
  first_name: true,
  last_name: true,
  username: true,
  email: true,
  role: true,
  department: true,
  is_active: true,
  is_approved: true,
  created_at: true,
  company: { select: { name: true } },
};

/** Same scoping as GET /api/admin/users/list. */
export function buildUserWhere(req) {
  const where = {};

  if (isSuperadmin(req.user.role)) {
    if (req.query.company_id) {
      where.company_id = parseInt(req.query.company_id, 10);
    }
  } else {
    where.company_id = req.user.company_id;
    where.NOT = { role: { equals: ROLES.SUPERADMIN, mode: 'insensitive' } };
  }

  return where;
}

/**
 * Build the users spec for one request. The Prisma `where` is captured in the
 * closure rather than passed through `filters`, which is echoed verbatim into
 * the audit log — an internal query object there would be noise, not evidence.
 */
export function usersSpecFor(req) {
  const where = buildUserWhere(req);

  return {
    key: 'admin_users',
    label: 'Admin-Users',
    columns: userColumns,
    filters: {
      company_id: req.query.company_id,
      scope: isSuperadmin(req.user.role) ? 'all-companies' : `company:${req.user.company_id}`,
    },
    fetch: ({ max }) => prisma.rpa_users.findMany({
      where,
      select: USER_SELECT,
      orderBy: { id: 'desc' },
      take: max,
    }),
  };
}

export const companyColumns = [
  { header: 'Company ID', key: 'id' },
  { header: 'Name', key: 'name' },
  { header: 'Slug', key: 'slug' },
  { header: 'Domain', key: 'domain' },
  { header: 'Users', key: 'user_count', numeric: true },
  { header: 'Active', key: 'is_active' },
  { header: 'Created At', key: 'created_at', type: 'datetime' },
];

export const companiesSpec = {
  key: 'admin_companies',
  label: 'Admin-Companies',
  columns: companyColumns,
  fetch: async ({ max }) => {
    const companies = await prisma.rpa_companies.findMany({
      orderBy: { id: 'asc' },
      include: { _count: { select: { users: true } } },
      take: max,
    });

    return companies.map(({ _count, ...c }) => ({ ...c, user_count: _count?.users ?? 0 }));
  },
};

export default { usersSpecFor, companiesSpec, buildUserWhere };
