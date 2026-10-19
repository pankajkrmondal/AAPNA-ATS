/**
 * logMask.js — keeps personal data out of logs and the error log (N42).
 *
 *   a.person@example.com  → a***@example.com
 *   +91 98765 43210       → ********3210
 *
 * Phone masking is deliberately narrow (Indian mobiles, or any number written
 * with a leading "+") so that ids, epoch timestamps and dates in log text are
 * left alone.
 *
 * No imports from the app: config/logger.js uses it.
 */

const EMAIL = /([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
// A run of digits with the usual separators, not glued to letters/digits.
const PHONE_CANDIDATE = /(?<![\w.])\+?\d[\d ().-]{8,18}\d(?![\w])/g;

function maskPhone(match) {
  const digits = match.replace(/\D/g, '');
  const plus = match.startsWith('+');
  const indianMobile =
    (digits.length === 10 && /^[6-9]/.test(digits)) ||
    (digits.length === 12 && /^91[6-9]/.test(digits));
  if (!indianMobile && !(plus && digits.length >= 10 && digits.length <= 15)) return match;
  if (/^\d{4}-\d{2}-\d{2}/.test(match)) return match; // a date, not a phone
  return `${'*'.repeat(Math.max(digits.length - 4, 0))}${digits.slice(-4)}`;
}

/**
 * Mask emails and phone numbers in a string.
 * @param {string} text
 * @returns {string}
 */
export function maskText(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  return text.replace(EMAIL, '$1***@$2').replace(PHONE_CANDIDATE, maskPhone);
}

/**
 * Mask every string inside a value (plain objects and arrays, a few levels
 * deep). Returns a copy; never mutates the input.
 * @param {any} value
 * @param {number} [depth]
 * @returns {any}
 */
export function maskValue(value, depth = 0) {
  if (typeof value === 'string') return maskText(value);
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (value instanceof Error) {
    return { name: value.name, message: maskText(value.message), ...(value.code ? { code: value.code } : {}), stack: maskText(value.stack) };
  }
  if (Array.isArray(value)) return value.map((v) => maskValue(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = maskValue(v, depth + 1);
  return out;
}

const KEEP_SEGMENT = /^[A-Za-z][A-Za-z_$-]{0,39}$/;
const API_VERSION = /^v\d+(\.\d+)?$/;

/**
 * A URL path with its identifiers replaced, for grouping errors and naming
 * outside calls: "/api/pipeline/123/move?x=1" → "/api/pipeline/:id/move".
 * Query strings are always dropped (they can carry emails or tokens).
 * @param {string} path
 * @returns {string}
 */
export function templatePath(path) {
  const clean = String(path || '').split('?')[0].split('#')[0];
  return clean
    .split('/')
    .map((seg) => (seg === '' || KEEP_SEGMENT.test(seg) || API_VERSION.test(seg) ? seg : ':id'))
    .join('/');
}
