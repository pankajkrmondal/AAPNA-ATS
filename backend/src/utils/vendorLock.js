/**
 * vendorLock.js — the 90-day vendor ownership lock (VENDOR_PROCESS.md §8).
 *
 * Whichever vendor submits a candidate first "owns" them for 90 days. The rule
 * was described in the docs and implemented inline in three different places
 * (hrUpload.service.js post-processing, its post-merge block, and — by its
 * absence — the recruiter merge path), each with its own copy of the same date
 * arithmetic. This is the single definition.
 *
 * Storage: `rpa_cv.lockForNinetyDays` is a TEXT column holding a UTC calendar
 * date, `YYYY-MM-DD`. Comparisons here are string comparisons against today's
 * UTC date, which is correct for that format and immune to the server's local
 * timezone — a Date round-trip is what would introduce drift, not what avoids it.
 *
 * The lock is what decides whether a vendor hears about their candidate's
 * progress (see services/vendorNotification.service.js). Evaluated once, when a
 * pipeline journey is created, and snapshotted onto that journey — so a stale
 * attribution from years ago never triggers mail, and a lock lapsing mid-journey
 * never cuts a vendor off from a journey they started.
 */

/** The ownership window, in days. */
export const VENDOR_LOCK_DAYS = 90;

/**
 * A lock that never expires, written when a vendor's candidate is recorded as
 * JOINED (pipeline.service.js setFinalOutcome).
 *
 * A far-future calendar date rather than a new boolean column, for two reasons:
 * it needs no DDL, and every existing reader — the lexicographic comparison
 * below, the SQL the dashboards run, the merge rule — treats it as "still
 * active" without knowing the concept exists. A frozen lock is just a lock with
 * a very long time left, which is exactly the semantics wanted.
 *
 * Sentinel-shaped on purpose: nobody stamps 9999-12-31 by accident, so it is
 * greppable and obvious in the data.
 */
export const VENDOR_LOCK_FROZEN = '9999-12-31';

/** True when the lock has been frozen by a successful placement. */
export function isVendorLockFrozen(lockForNinetyDays) {
  return toIsoDate(lockForNinetyDays) === VENDOR_LOCK_FROZEN;
}

/**
 * Normalizes a stored lock value to a `YYYY-MM-DD` string, or null if it isn't
 * a usable date. Accepts the TEXT column's own format, and a Date defensively
 * (a `prisma db pull` that retyped the column must not silently disable the lock).
 * @param {string|Date|null|undefined} value
 * @returns {string|null}
 */
function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const trimmed = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;

  // Shape is not enough — the comparison below is lexicographic, so an
  // impossible date like "2026-13-45" would sort ABOVE every real one and read
  // as a lock that never expires. Round-trip through Date to reject it: a
  // garbage value must fail closed (nobody owns the candidate), never open.
  const [y, m, d] = trimmed.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  const isReal = parsed.getUTCFullYear() === y
    && parsed.getUTCMonth() === m - 1
    && parsed.getUTCDate() === d;
  return isReal ? trimmed : null;
}

/**
 * The expiry date to stamp when a vendor-sourced candidate is first saved:
 * today + 90 days, as `YYYY-MM-DD`.
 * @param {Date} [from] - the clock, injectable for tests
 * @returns {string}
 */
export function vendorLockExpiry(from = new Date()) {
  const date = new Date(from.getTime());
  date.setUTCDate(date.getUTCDate() + VENDOR_LOCK_DAYS);
  return date.toISOString().slice(0, 10);
}

/**
 * True while the lock still holds. The window is inclusive of its final day:
 * a lock expiring today is still active today (VENDOR_PROCESS.md §8, "true
 * while today <= expiry"), which matters because the stamp is a calendar date
 * with no time component to break the tie.
 * @param {string|Date|null|undefined} lockForNinetyDays - rpa_cv.lockForNinetyDays
 * @param {Date} [now] - the clock, injectable for tests
 * @returns {boolean}
 */
export function isVendorLockActive(lockForNinetyDays, now = new Date()) {
  const expiry = toIsoDate(lockForNinetyDays);
  if (!expiry) return false;
  return now.toISOString().slice(0, 10) <= expiry;
}

/**
 * The vendor who currently owns this candidate, or null.
 *
 * Requires BOTH a vendor attribution and a live lock. A candidate carrying a
 * `VendorEmail` whose lock has lapsed is no longer owned by anyone — they stay
 * attributed for reporting, but the vendor has no live claim on them and must
 * not be told about their progress.
 *
 * @param {{ VendorEmail?: string|null, vendorName?: string|null, lockForNinetyDays?: string|Date|null }} cv
 * @param {Date} [now] - the clock, injectable for tests
 * @returns {{ vendorEmail: string, vendorName: string|null, lockExpiresOn: string }|null}
 */
export function activeVendorFor(cv, now = new Date()) {
  const vendorEmail = (cv?.VendorEmail || '').trim();
  if (!vendorEmail) return null;
  if (!isVendorLockActive(cv?.lockForNinetyDays, now)) return null;
  return {
    vendorEmail,
    vendorName: (cv?.vendorName || '').trim() || null,
    lockExpiresOn: toIsoDate(cv.lockForNinetyDays),
  };
}

export default {
  VENDOR_LOCK_DAYS,
  VENDOR_LOCK_FROZEN,
  vendorLockExpiry,
  isVendorLockActive,
  isVendorLockFrozen,
  activeVendorFor,
};
