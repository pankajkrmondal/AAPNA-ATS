/**
 * Helpers for matching a stored candidate address against an address reported
 * by an external system.
 *
 * Several columns (rpa_shortlisted_candidates.candidate_email, rpa_cv."EmailID")
 * hold more than one address in a single field ("a@x.com, b@y.com"), while
 * external systems report whichever single address the record was created
 * against — so a plain equality test misses the match.
 */

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

export default { emailCandidates };
