/**
 * Option lists for the candidate forms (Phase 3 "Do Now", N18) that come from
 * data rather than code. Both are served on PUBLIC routes (the missing-details
 * form is opened without a login), so each returns names only — never ids,
 * emails, counts or anything else about a person or a candidate.
 *
 *   getLocationSuggestions()  the most common cities already in the ATS
 *   getRecruiterNames()       active Recruiter accounts, display names only
 *
 * Cities are cached in memory for an hour; recruiter names for 5 minutes, so
 * an account an admin creates or deactivates shows on the forms quickly.
 */
import prisma from '../config/database.js';
import { locationParts } from '../utils/screeningFilters.js';

const TTL_MS = 60 * 60 * 1000;
const RECRUITER_TTL_MS = 5 * 60 * 1000;
const MAX_CITIES = 500;
let locationsCache = null; // { at, value }
let recruitersCache = null;

/** "greater noida" -> "Greater Noida" */
const titleCase = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());

/**
 * Pure: city names from stored location values with their row counts,
 * most common first. "Noida, Uttar Pradesh" counts as both "Noida" and
 * "Uttar Pradesh" (every comma part is a place a recruiter may type).
 * @param {Array<{location: string, n: number}>} rows
 * @param {number} [max]
 * @returns {string[]}
 */
export function rankCities(rows, max = MAX_CITIES) {
  const counts = new Map();
  for (const { location, n } of rows) {
    for (const part of locationParts(location)) {
      if (part.length < 2 || /\d/.test(part)) continue; // pin codes, junk
      counts.set(part, (counts.get(part) || 0) + Number(n || 0));
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([part]) => titleCase(part));
}

/** @returns {Promise<string[]>} */
export async function getLocationSuggestions() {
  if (locationsCache && Date.now() - locationsCache.at < TTL_MS) return locationsCache.value;
  const rows = await prisma.$queryRaw`
    SELECT "CurrentLocation" AS location, COUNT(*)::int AS n
    FROM rpa_cv
    WHERE "CurrentLocation" IS NOT NULL AND btrim("CurrentLocation") <> ''
    GROUP BY "CurrentLocation"
    ORDER BY n DESC
    LIMIT 5000`;
  const value = rankCities(rows);
  locationsCache = { at: Date.now(), value };
  return value;
}

/**
 * Active, approved Recruiter accounts as "First Last" (decision 15 Oct 2026:
 * the Recruiter (AAPNA) list follows the user accounts — deactivate a login to
 * remove the name). Legacy `hr` counts as Recruiter.
 * @returns {Promise<string[]>}
 */
export async function getRecruiterNames() {
  if (recruitersCache && Date.now() - recruitersCache.at < RECRUITER_TTL_MS) return recruitersCache.value;
  const users = await prisma.rpa_users.findMany({
    where: { role: { in: ['recruiter', 'hr'] }, is_active: true, is_approved: true },
    select: { first_name: true, last_name: true },
  });
  const names = [...new Set(users
    .map((u) => `${u.first_name || ''} ${u.last_name || ''}`.replace(/\s+/g, ' ').trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  recruitersCache = { at: Date.now(), value: names };
  return names;
}

/** Test hook. */
export function clearFormOptionCaches() {
  locationsCache = null;
  recruitersCache = null;
}

export default { getLocationSuggestions, getRecruiterNames, rankCities, clearFormOptionCaches };
