/**
 * Phone-number normalisation for MATCHING, not for display.
 *
 * rpa_cv."ContactNumber" is free text written by resume parsers, Excel uploads
 * and recruiters, so one candidate can be stored as "+91 98765 43210",
 * "098765-43210" or "9876543210, 9123456789". Comparing those strings directly
 * only ever matches when the recruiter happens to type the same formatting.
 *
 * Every Indian mobile number is fully identified by its last 10 digits, so each
 * stored part is reduced to that — the country code, a trunk "0", spaces,
 * dashes and brackets all drop away. The SQL lookup in screeningV2.service.js
 * applies the same rule on the database side.
 */

/**
 * Splits a phone field into comparable 10-digit numbers.
 *
 * @param {string|number|null|undefined} value - Raw field, possibly several numbers joined by , ; or /
 * @returns {string[]} De-duplicated 10-digit strings; parts with fewer than 10 digits are dropped.
 */
export function normalisePhone(value) {
  if (value == null) return [];
  const seen = new Set();
  for (const part of String(value).split(/[,;/]/)) {
    const digits = part.replace(/[^0-9]/g, '');
    if (digits.length >= 10) seen.add(digits.slice(-10));
  }
  return [...seen];
}

export default { normalisePhone };
