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
 * dashes and brackets all drop away. phoneMatchesSql() applies the same rule
 * on the database side (screening lookup, Search Candidate, upload dedupe).
 */
import { Prisma } from '@prisma/client';

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

/**
 * The candidate's first usable mobile number, as 10 digits (N22).
 * @param {string|number|null|undefined} value - raw ContactNumber
 * @returns {string|null}
 */
export function firstValidPhone(value) {
  return normalisePhone(value)[0] || null;
}

/**
 * "+919876543210" for systems that need the country code (Zeko). Every number
 * the ATS holds is Indian (decision N22: default +91).
 * @param {string|number|null|undefined} value - raw ContactNumber
 * @returns {string} '' when there is no usable number
 */
export function toIndianE164(value) {
  const ten = firstValidPhone(value);
  return ten ? `+91${ten}` : '';
}

/**
 * For logs: phone numbers are personal data, so only the last 4 digits show.
 * @param {string|number|null|undefined} value
 * @returns {string} e.g. "******3210", or "(none)"
 */
export function maskPhone(value) {
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  return digits.length >= 4 ? `******${digits.slice(-4)}` : '(none)';
}

/**
 * SQL predicate: does a stored phone column hold any of the numbers in `value`?
 * Each stored part (split on , ; or /) is reduced to its last 10 digits, the
 * same rule as normalisePhone(), so "+91 98765 43210, 98765-11111" matches a
 * lookup for "9876543210" or "+91 98765 11111".
 *
 * '[^0-9]' rather than '\D': a backslash would be swallowed by the template
 * literal before Postgres saw it (same note as emailMatch.js).
 *
 * @param {Prisma.Sql} columnSql - e.g. Prisma.sql`c."ContactNumber"`
 * @param {string|string[]|null|undefined} value - number(s) being looked up, any format
 * @returns {Prisma.Sql} a predicate, or `false` when `value` holds no 10-digit
 *   number — never a predicate that matches everything
 */
export function phoneMatchesSql(columnSql, value) {
  const wanted = [
    ...new Set((Array.isArray(value) ? value : [value]).flatMap((v) => normalisePhone(v))),
  ];
  if (wanted.length === 0) return Prisma.sql`false`;
  return Prisma.sql`EXISTS (
    SELECT 1 FROM regexp_split_to_table(coalesce(${columnSql}, ''), '[,;/]') AS ph(part)
    WHERE right(regexp_replace(ph.part, '[^0-9]', '', 'g'), 10) = ANY(${wanted}::text[])
  )`;
}

/**
 * SQL predicate for a PARTIAL number typed into a search box ("98765"): does
 * any stored part, digits only, contain these digits? Per part, so a match
 * never spans two numbers of one list.
 *
 * @param {Prisma.Sql} columnSql
 * @param {string} digits - digits only (anything else is stripped)
 * @returns {Prisma.Sql} `false` when no digits are given
 */
export function phoneDigitsContainSql(columnSql, digits) {
  const d = String(digits ?? '').replace(/[^0-9]/g, '');
  if (!d) return Prisma.sql`false`;
  return Prisma.sql`EXISTS (
    SELECT 1 FROM regexp_split_to_table(coalesce(${columnSql}, ''), '[,;/]') AS ph(part)
    WHERE regexp_replace(ph.part, '[^0-9]', '', 'g') LIKE ${`%${d}%`}
  )`;
}

export default { normalisePhone, firstValidPhone, toIndianE164, maskPhone, phoneMatchesSql, phoneDigitsContainSql };
