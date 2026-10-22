/**
 * One date format for the whole app, always in IST (Phase 3 "Do Now").
 *
 *   fmtDate('2026-10-07T11:00:00Z')      -> '07 Oct 2026'
 *   fmtDateTime('2026-10-07T11:00:00Z')  -> '07 Oct 2026, 4:30 PM'
 *
 * Recruiters work in IST, so a date never shifts with the viewer's browser
 * locale or timezone. Month names are fixed here rather than taken from Intl:
 * browsers disagree on short month names ("Sep" vs "Sept").
 *
 *   fmtTime('2026-10-07T11:00:00Z')      -> '4:30 PM'
 *   fmtDayMonth('2026-10-07T11:00:00Z')  -> '07 Oct'
 *   fmtRelative(fiveMinutesAgo)          -> '5 min ago'  (older than a week: fmtDate)
 *
 * Machine keys (API params, "is it today" checks) stay 'YYYY-MM-DD' and do not
 * belong here. Introduced for N44/N27/N19; N34 moved every screen onto it.
 */

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const IST_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Shown wherever a date is missing. */
export const NO_DATE = '–';

function istParts(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const parts = IST_PARTS.formatToParts(d);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { day: get('day'), month: get('month'), year: get('year'), hour: get('hour'), minute: get('minute') };
}

/**
 * '07 Oct 2026', or '–' when there is no usable date.
 * @param {Date|string|number|null|undefined} value
 * @returns {string}
 */
export function fmtDate(value) {
  const p = istParts(value);
  if (!p) return NO_DATE;
  return `${String(p.day).padStart(2, '0')} ${MONTHS[p.month - 1]} ${p.year}`;
}

/**
 * '4:30 PM' (IST), or '–' when there is no usable date.
 * @param {Date|string|number|null|undefined} value
 * @returns {string}
 */
export function fmtTime(value) {
  const p = istParts(value);
  if (!p) return NO_DATE;
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'AM' : 'PM'}`;
}

/**
 * '07 Oct 2026, 4:30 PM', or '–' when there is no usable date.
 * @param {Date|string|number|null|undefined} value
 * @returns {string}
 */
export function fmtDateTime(value) {
  const p = istParts(value);
  if (!p) return NO_DATE;
  return `${fmtDate(value)}, ${fmtTime(value)}`;
}

/**
 * '07 Oct' — for chart axes and compact lists where the year is obvious.
 * @param {Date|string|number|null|undefined} value
 * @returns {string}
 */
export function fmtDayMonth(value) {
  const p = istParts(value);
  if (!p) return NO_DATE;
  return `${String(p.day).padStart(2, '0')} ${MONTHS[p.month - 1]}`;
}

/**
 * IST calendar parts, for layouts that place day and month separately
 * (e.g. the agenda date badge): { day: '07', month: 'Oct', year: 2026 }.
 * @param {Date|string|number|null|undefined} value
 * @returns {{ day: string, month: string, year: number }|null}
 */
export function istDateParts(value) {
  const p = istParts(value);
  if (!p) return null;
  return { day: String(p.day).padStart(2, '0'), month: MONTHS[p.month - 1], year: p.year };
}

/**
 * 'just now', '5 min ago', '3 h ago', '2 d ago'; older than a week (or in the
 * future) falls back to fmtDate. '–' when there is no usable date.
 * @param {Date|string|number|null|undefined} value
 * @param {number} [now] epoch ms, for tests
 * @returns {string}
 */
export function fmtRelative(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return NO_DATE;
  const d = value instanceof Date ? value : new Date(value);
  const t = d.getTime();
  if (Number.isNaN(t)) return NO_DATE;
  const mins = Math.floor((now - t) / 60000);
  if (mins < 0) return fmtDate(d);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days <= 7) return `${days} d ago`;
  return fmtDate(d);
}

export default { fmtDate, fmtDateTime, fmtTime, fmtDayMonth, fmtRelative, istDateParts, NO_DATE };
