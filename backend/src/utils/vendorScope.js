import { ROLES, normalizeRole } from '../config/roles.js';

/**
 * vendorScope.js — the one rule deciding which candidates a vendor may query.
 *
 * Lives in utils rather than candidate.service.js (where it started) because it
 * is pure: role in, filters out, no database. Importing the service to reach it
 * pulled in prisma, the socket layer and the whole Gemini parsing chain, which
 * made the single most security-relevant function in the codebase the most
 * expensive one to test. It is re-exported from candidate.service.js, so every
 * existing caller is unaffected.
 */

/**
 * Force a vendor caller's query to their own candidates.
 *
 * `vendorEmail` arrives as a plain query parameter, so without this a
 * vendor-role token could simply omit it (or name another vendor) and read the
 * entire candidate table. The paginated list, the CSV export and the vendor
 * dashboard all run their filter set through here, so they cannot drift apart —
 * which is exactly how the export hole fixed in b671236 opened.
 *
 * Non-vendor roles are untouched — recruiters and admins legitimately query
 * across vendors, and pass `vendorEmail` deliberately.
 *
 * @param {Object} filters
 * @param {{ role?: string, email?: string }} [user]
 * @returns {Object} a new filters object; the input is not mutated
 */
export function enforceVendorScope(filters = {}, user) {
  if (normalizeRole(user?.role) !== ROLES.VENDOR) return { ...filters };

  return {
    ...filters,
    // Overwrite, never merge: whatever the client asked for is irrelevant.
    vendorEmail: user.email,
    vendorOnly: false,
  };
}

export default { enforceVendorScope };
