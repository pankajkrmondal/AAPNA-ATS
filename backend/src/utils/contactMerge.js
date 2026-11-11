/**
 * Merging the email and phone lists stored on a candidate (U05).
 *
 * rpa_cv."EmailID" and rpa_cv."ContactNumber" are free text holding every
 * value we have for the candidate, comma-joined ("a@x.com, b@y.com"). An
 * upload merge, the public missing-details form, the Schedule dialog and the
 * Edit form all add to these lists, so they share one rule for what counts as
 * "the same value":
 *   - a phone is identified by its last 10 digits, so "+91 98765 43210",
 *     "098765-43210" and "9876543210" are one number (same rule as phone.js);
 *   - an email is identified by its lower-cased, trimmed form.
 * The first spelling kept wins; the stored list is joined with ", ".
 *
 * Pure: no database. Imported by hrUpload.service.js, candidate.controller.js,
 * pipeline.service.js, candidate.service.js, and U08's Zeko phone page.
 */

/** @typedef {'email'|'phone'} ContactKind */

const SPLIT = { email: /[,;]/, phone: /[,;/]/ };

/** Infers the kind of one value when the caller did not say. */
function kindOf(value, kind) {
  if (kind === 'email' || kind === 'phone') return kind;
  return String(value).includes('@') ? 'email' : 'phone';
}

/**
 * The comparison key for one value: last 10 digits for a phone (all its digits
 * when it has fewer than 10), lower case for an email.
 *
 * @param {string} value - one value, already split from its list
 * @param {ContactKind} [kind]
 * @returns {string} '' for a blank value
 */
export function contactKey(value, kind) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  if (kindOf(v, kind) === 'email') return v.toLowerCase();
  const digits = v.replace(/[^0-9]/g, '');
  if (!digits) return v.toLowerCase();
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * Splits a stored or typed list into its values, trimmed. Blanks and the
 * literal "null" the parser sometimes returns are dropped. Arrays are accepted
 * (each element may itself be a list).
 *
 * @param {string|string[]|null|undefined} value
 * @param {ContactKind} [kind] - phones also split on "/", emails do not
 * @returns {string[]} values in their stored spelling, duplicates included
 */
export function splitContacts(value, kind) {
  if (value == null) return [];
  const parts = Array.isArray(value) ? value : [value];
  return parts
    .flatMap((p) => String(p ?? '').split(SPLIT[kind] || SPLIT.phone))
    .map((p) => p.trim())
    .filter((p) => p !== '' && p.toLowerCase() !== 'null');
}

/** De-duplicates by contactKey, keeping the first spelling of each value. */
function dedupe(values, kind) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    const key = contactKey(v, kind);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/**
 * The existing list with any new values added at the END. The first value
 * (the primary email, the main phone) stays first.
 *
 * @param {string|null|undefined} existing - the stored list
 * @param {string|string[]|null|undefined} incoming - value(s) to add
 * @param {ContactKind} [kind] - inferred per value ('@' → email) when omitted
 * @returns {string} the merged list joined with ", "; '' when both are empty
 */
export function appendUnique(existing, incoming, kind) {
  const k = kind || kindOf(splitContacts(incoming)[0] ?? splitContacts(existing)[0] ?? '', kind);
  return dedupe([...splitContacts(existing, k), ...splitContacts(incoming, k)], k).join(', ');
}

/**
 * The new value(s) FIRST, then the rest of the existing list. For a number the
 * candidate or recruiter has just given as the one to use (public form,
 * Schedule dialog, U08 Zeko phone page): firstValidPhone() and toIndianE164()
 * read the first number, so the newest one is the one those use.
 *
 * @param {string|null|undefined} existing - the stored list
 * @param {string|string[]|null|undefined} incoming - value(s) to put first
 * @param {ContactKind} [kind] - inferred per value ('@' → email) when omitted
 * @returns {string} the merged list joined with ", "; '' when both are empty
 */
export function prependUnique(existing, incoming, kind) {
  const k = kind || kindOf(splitContacts(incoming)[0] ?? splitContacts(existing)[0] ?? '', kind);
  return dedupe([...splitContacts(incoming, k), ...splitContacts(existing, k)], k).join(', ');
}

/**
 * An edited email list with the record's primary (first) address kept first.
 * The Edit form shows the primary read-only; this holds on the server too, so
 * a payload that drops or reorders it cannot change the candidate's primary.
 *
 * @param {string|string[]|null|undefined} incoming - the edited list
 * @param {string|null|undefined} existing - the stored EmailID
 * @returns {string} joined with ", "
 */
export function withPrimaryEmailFirst(incoming, existing) {
  const primary = splitContacts(existing, 'email')[0];
  return primary ? prependUnique(incoming, primary, 'email') : appendUnique('', incoming, 'email');
}

export default { contactKey, splitContacts, appendUnique, prependUnique, withPrimaryEmailFirst };
