/**
 * roles.js — the frontend mirror of backend/src/config/roles.js.
 *
 * Use these instead of writing role lists inline. A hand-written
 * ['admin', 'superadmin', 'recruiter'] silently hides features from an
 * HR Admin Recruiter, who must see everything a Recruiter sees.
 * Inventory: docs/phase3/MRF/HR-Admin-Recruiter-Role-Impact.md
 *
 * These gates are convenience only — the server is the authority.
 */

export const ROLES = Object.freeze({
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  HR_ADMIN_RECRUITER: 'hr_admin_recruiter',
  RECRUITER: 'recruiter',
  VENDOR: 'vendor',
});

/** Mirror of backend ROLE_RANK. */
export const ROLE_RANK = Object.freeze({
  superadmin: 40,
  admin: 30,
  hr_admin_recruiter: 25,
  recruiter: 20,
  hr: 20, // legacy alias of recruiter-tier
  vendor: 10,
});

export const ROLE_LABELS = Object.freeze({
  superadmin: 'Super Admin',
  admin: 'Admin',
  hr_admin_recruiter: 'HR Admin Recruiter',
  recruiter: 'Recruiter',
  hr: 'Recruiter',
  vendor: 'Vendor',
});

/** Internal staff at recruiter level or above (never vendors). */
export const RECRUITER_TIER_ROLES = Object.freeze([
  ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.HR_ADMIN_RECRUITER, ROLES.RECRUITER, 'hr',
]);

export const normalizeRole = (role) => String(role || '').trim().toLowerCase();

export const isAdminTier = (role) => [ROLES.ADMIN, ROLES.SUPERADMIN].includes(normalizeRole(role));

export const isRecruiterTier = (role) => RECRUITER_TIER_ROLES.includes(normalizeRole(role));

export const atLeast = (role, minRole) =>
  (ROLE_RANK[normalizeRole(role)] ?? 0) >= (ROLE_RANK[minRole] ?? Infinity);

/** HR Admin Recruiter, Admin, Super Admin: decide MRFs on behalf of absent approvers, manage holds. */
export const canDecideOnBehalf = (role) => atLeast(role, ROLES.HR_ADMIN_RECRUITER);

export const outranks = (requesterRole, targetRole) =>
  (ROLE_RANK[normalizeRole(requesterRole)] ?? 0) > (ROLE_RANK[normalizeRole(targetRole)] ?? 0);

export const roleLabel = (role) => ROLE_LABELS[normalizeRole(role)] || String(role || '');
