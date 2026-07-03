/**
 * roles.js — Canonical roles, role hierarchy, and module keys.
 *
 * Single source of truth for the access model. Replaces the ad-hoc role/module
 * strings that were previously scattered across middleware, controllers, and the
 * frontend.
 *
 * Hierarchy:  superadmin (global) > admin (one company) > recruiter / vendor (one company)
 * Legacy note: the historical `hr` role is treated as recruiter-tier.
 */

export const ROLES = Object.freeze({
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  RECRUITER: 'recruiter',
  VENDOR: 'vendor',
});

/**
 * Hierarchy rank — higher number = more privilege. Used for "can act on" checks.
 * Legacy `hr` is mapped to recruiter-tier.
 */
export const ROLE_RANK = Object.freeze({
  superadmin: 40,
  admin: 30,
  recruiter: 20,
  hr: 20, // legacy alias of recruiter-tier
  vendor: 10,
});

/**
 * Roles a company `admin` is allowed to assign when creating/updating users in
 * their own company — admins, recruiters and vendors (but NOT superadmin).
 * (A superadmin may assign any role, including superadmin, across any company.)
 */
export const ADMIN_ASSIGNABLE_ROLES = Object.freeze([ROLES.ADMIN, ROLES.RECRUITER, ROLES.VENDOR]);

/**
 * Canonical module keys — the per-user toggles surfaced in the Admin Portal's
 * "Module Access" tab and enforced by checkModuleAccess / ModuleRoute.
 */
export const MODULES = Object.freeze({
  NEW_MRF: 'new_mrf',
  SEARCH_CANDIDATES: 'search_candidates',
  HR_MANUAL_UPLOAD: 'hr_manual_upload',
  SYSTEM_CONFIG: 'system_config',
  VENDOR_UPLOAD: 'vendor_upload',
  CANDIDATE_SCREENING: 'candidate_screening',
  SCREENING_ANALYTICS: 'screening_analytics',
  HR_ADMIN: 'hr_admin',
});

export const MODULE_KEYS = Object.freeze(Object.values(MODULES));

/**
 * Normalize a role string (case-insensitive, trimmed, null-safe).
 * @param {string|null|undefined} role
 * @returns {string}
 */
export function normalizeRole(role) {
  return (role || '').trim().toLowerCase();
}

/**
 * True if the role is admin-tier (admin or superadmin) — the set that bypasses
 * module checks and can manage users.
 * @param {string|null|undefined} role
 * @returns {boolean}
 */
export function isAdminTier(role) {
  const r = normalizeRole(role);
  return r === ROLES.ADMIN || r === ROLES.SUPERADMIN;
}

/**
 * True if the role is the global superadmin.
 * @param {string|null|undefined} role
 * @returns {boolean}
 */
export function isSuperadmin(role) {
  return normalizeRole(role) === ROLES.SUPERADMIN;
}
