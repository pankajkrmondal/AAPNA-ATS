/**
 * Pure helpers for the "missing details completed" alert (N44).
 *
 * Kept free of Prisma so the wording can be unit-tested without a database.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const IST_DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

/**
 * "07 Oct 2026" in IST, or null when there is no date.
 * @param {Date|string|null|undefined} d
 * @returns {string|null}
 */
export function fmtIstDate(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  // en-GB writes September as "Sept"; the screens (dayjs "DD MMM YYYY") write "Sep".
  return IST_DATE.format(date).replace(/\bSept\b/, 'Sep');
}

/**
 * "responded in 12 days" / "responded in 1 day" / "responded the same day".
 * Whole elapsed days, so a request at 23:00 answered at 09:00 next morning
 * still reads "the same day" rather than overstating the wait.
 * @param {Date|string|null|undefined} requestedAt
 * @param {Date|string} completedAt
 * @returns {string|null} null when the request date is unknown
 */
export function respondedIn(requestedAt, completedAt) {
  if (!requestedAt) return null;
  const days = Math.floor((new Date(completedAt).getTime() - new Date(requestedAt).getTime()) / DAY_MS);
  if (!Number.isFinite(days) || days < 0) return null;
  if (days === 0) return 'responded the same day';
  return `responded in ${days} day${days === 1 ? '' : 's'}`;
}

/** Values the Search Candidate "Details completed in" filter accepts. */
export const COMPLETED_WITHIN_VALUES = Object.freeze(['today', '7', '30']);

/**
 * Lower bound for the "Details completed in" filter.
 * `today` is the IST calendar day (recruiters work in IST, and a UTC midnight
 * would put 05:30 IST at the day boundary); 7 and 30 are rolling windows.
 *
 * @param {string|undefined} value - 'today' | '7' | '30'
 * @param {Date} [now]
 * @returns {Date|null} null for anything else, so a bad value means "no filter"
 */
export function completedSince(value, now = new Date()) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!COMPLETED_WITHIN_VALUES.includes(v)) return null;
  if (v === 'today') {
    const istDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now); // YYYY-MM-DD
    return new Date(`${istDay}T00:00:00+05:30`);
  }
  return new Date(now.getTime() - Number(v) * DAY_MS);
}

/**
 * Title and description for the bell. The description drops any part that is
 * unknown instead of printing "n/a": a legacy candidate with no request date
 * just shows the position.
 *
 * @param {object} p
 * @param {string|null} p.name
 * @param {string|null} p.position
 * @param {Date|string|null} p.requestedAt
 * @param {Date|string} p.completedAt
 * @returns {{ title: string, description: string|null }}
 */
export function describeDetailsCompletion({ name, position, requestedAt, completedAt }) {
  const who = (name && String(name).trim()) || 'A candidate';
  const parts = [];
  if (position && String(position).trim()) parts.push(String(position).trim());
  const requested = fmtIstDate(requestedAt);
  if (requested) parts.push(`requested ${requested}`);
  const waited = respondedIn(requestedAt, completedAt);
  if (waited) parts.push(waited);
  return {
    title: `${who} completed their missing details`,
    description: parts.length ? parts.join(' · ') : null,
  };
}
