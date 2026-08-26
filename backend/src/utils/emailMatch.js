/**
 * Helpers for matching a stored candidate address against an address reported
 * by an external system.
 *
 * Several columns (rpa_shortlisted_candidates.candidate_email, rpa_cv."EmailID")
 * hold more than one address in a single field ("a@x.com, b@y.com"), while
 * external systems report whichever single address the record was created
 * against — so a plain equality test misses the match.
 *
 * emailCandidates() is the in-process form (filter rows already in memory);
 * emailMatchesSql() is the SQL form of the same predicate, for queries that
 * must do the matching in the database.
 */
import { Prisma } from '@prisma/client';

/**
 * Splits a stored address field into individually comparable addresses.
 *
 * @param {string|null|undefined} value - Raw column value, possibly comma/semicolon joined.
 * @returns {string[]} Lower-cased, trimmed, de-duplicated addresses.
 */
export function emailCandidates(value) {
  if (!value) return [];
  const seen = new Set();
  for (const part of String(value).split(/[,;]/)) {
    const email = part.trim().toLowerCase();
    if (email) seen.add(email);
  }
  return [...seen];
}

/**
 * SQL predicate: does a stored address column share any address with `value`?
 *
 * The stored side is split the same way emailCandidates() splits it, so a
 * column holding "a@x.com, b@y.com" matches a lookup for either address —
 * `column ILIKE 'b@y.com'` (whole-string equality, since a wildcard-free
 * ILIKE is just a case-insensitive `=`) never can. This also avoids ILIKE's
 * wildcard semantics: `_` is legal in an email local-part but matches any
 * character to ILIKE, so "first_last@x.com" would otherwise also match
 * "firstXlast@x.com" — a wrong candidate, silently.
 *
 * Mirrors the array-overlap match hrUpload.service.js uses for its candidate
 * dedupe lookup, widened to split on ';' as well so it agrees with
 * emailCandidates().
 *
 * @param {Prisma.Sql} columnSql - The column to test, e.g. Prisma.sql`cv."EmailID"`.
 * @param {string|string[]|null|undefined} value - Address(es) being looked up; may itself be multi-valued.
 * @returns {Prisma.Sql} A predicate, or `false` when `value` yields no address
 *   to match on — never a predicate that matches everything.
 */
export function emailMatchesSql(columnSql, value) {
  const wanted = [
    ...new Set((Array.isArray(value) ? value : [value]).flatMap((v) => emailCandidates(v))),
  ];
  if (wanted.length === 0) return Prisma.sql`false`;
  // '[[:space:]]' rather than '\s': a backslash escape would be swallowed by
  // the JS template literal before Postgres ever sees it.
  return Prisma.sql`
    regexp_split_to_array(
      lower(regexp_replace(coalesce(${columnSql}, ''), '[[:space:]]', '', 'g')),
      '[,;]'
    ) && ${wanted}::text[]`;
}

export default { emailCandidates, emailMatchesSql };
