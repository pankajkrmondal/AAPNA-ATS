/**
 * roles.js — Canonical roles, role hierarchy, and module keys.
 *
 * Single source of truth for the access model. Replaces the ad-hoc role/module
 * strings that were previously scattered across middleware, controllers, and the
 * frontend.
 *
 * Hierarchy:  superadmin (global) > admin (one company) > hr_admin_recruiter >
 *             recruiter / vendor (one company)
 * Legacy note: the historical `hr` role is treated as recruiter-tier.
 *
 * hr_admin_recruiter ("HR Admin Recruiter") is a Recruiter with a few MRF
 * extras (deciding on behalf of absent approvers, managing held MRFs). It is
 * NOT admin-tier: no Admin Portal, no user management, no IP/device data.
 * Everything a recruiter may do, it may do — which is why every role list
 * below that names `recruiter` must name it too (RECRUITER_TIER_ROLES).
 * Inventory: docs/phase3/MRF/HR-Admin-Recruiter-Role-Impact.md
 */

export const ROLES = Object.freeze({
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  HR_ADMIN_RECRUITER: 'hr_admin_recruiter',
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
  hr_admin_recruiter: 25,
  recruiter: 20,
  hr: 20, // legacy alias of recruiter-tier
  vendor: 10,
});

/** Display labels, for emails and audit text. */
export const ROLE_LABELS = Object.freeze({
  superadmin: 'Super Admin',
  admin: 'Admin',
  hr_admin_recruiter: 'HR Admin Recruiter',
  recruiter: 'Recruiter',
  hr: 'Recruiter',
  vendor: 'Vendor',
});

/**
 * Internal staff at recruiter level or above. Use this wherever a route or
 * query used to list `['admin', 'superadmin', 'recruiter', 'hr']` by hand —
 * a hand-written list that forgets hr_admin_recruiter silently locks those
 * users out of something they could do as a recruiter.
 */
export const RECRUITER_TIER_ROLES = Object.freeze([
  ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.HR_ADMIN_RECRUITER, ROLES.RECRUITER, 'hr',
]);

/**
 * Socket rooms that receive "recruiter" broadcasts. A socket joins only its own
 * `role:<role>` room, so an emit to each of these reaches every recruiter-level
 * user exactly once.
 */
export const RECRUITER_ROOM_ROLES = Object.freeze([ROLES.RECRUITER, ROLES.HR_ADMIN_RECRUITER]);

/**
 * Roles a company `admin` is allowed to assign when creating/updating users in
 * their own company — admins, HR admin recruiters, recruiters and vendors (but
 * NOT superadmin). (A superadmin may assign any role, including superadmin,
 * across any company.)
 */
export const ADMIN_ASSIGNABLE_ROLES = Object.freeze([
  ROLES.ADMIN, ROLES.HR_ADMIN_RECRUITER, ROLES.RECRUITER, ROLES.VENDOR,
]);

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
  RECRUITMENT_PIPELINE: 'recruitment_pipeline',
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

/**
 * True if the requester's role strictly outranks the target's role.
 * Equal-rank roles (e.g. admin acting on a co-admin) do NOT outrank each other.
 * @param {string|null|undefined} requesterRole
 * @param {string|null|undefined} targetRole
 * @returns {boolean}
 */
export function outranks(requesterRole, targetRole) {
  return (ROLE_RANK[normalizeRole(requesterRole)] ?? 0) > (ROLE_RANK[normalizeRole(targetRole)] ?? 0);
}

/**
 * True if the role's rank is at least that of `minRole`.
 * @param {string|null|undefined} role
 * @param {string} minRole - a key of ROLE_RANK
 * @returns {boolean}
 */
export function atLeast(role, minRole) {
  return (ROLE_RANK[normalizeRole(role)] ?? 0) >= (ROLE_RANK[minRole] ?? Infinity);
}

/**
 * Who may approve / reject / hold an MRF from the ATS on behalf of the
 * approvers (only while an absence window is open — checked separately), and
 * manage held MRFs and the hold rules: HR Admin Recruiter, Admin, Super Admin.
 * @param {string|null|undefined} role
 * @returns {boolean}
 */
export function canDecideOnBehalf(role) {
  return atLeast(role, ROLES.HR_ADMIN_RECRUITER);
}

/**
 * True for internal staff at recruiter level or above (never a vendor).
 * @param {string|null|undefined} role
 * @returns {boolean}
 */
export function isRecruiterTier(role) {
  return RECRUITER_TIER_ROLES.includes(normalizeRole(role));
}

/**
 * Display label for a role ("HR Admin Recruiter"); the raw value if unknown.
 * @param {string|null|undefined} role
 * @returns {string}
 */
export function roleLabel(role) {
  return ROLE_LABELS[normalizeRole(role)] || String(role || '');
}
