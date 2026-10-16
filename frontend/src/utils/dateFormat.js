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
 * Week 1 introduces this for the new date columns (N44, N27, N19); the sweep
 * that moves every other screen onto it is N34 (week 2).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
 * '07 Oct 2026, 4:30 PM', or '–' when there is no usable date.
 * @param {Date|string|number|null|undefined} value
 * @returns {string}
 */
export function fmtDateTime(value) {
  const p = istParts(value);
  if (!p) return NO_DATE;
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const mm = String(p.minute).padStart(2, '0');
  return `${fmtDate(value)}, ${h12}:${mm} ${p.hour < 12 ? 'AM' : 'PM'}`;
}

export default { fmtDate, fmtDateTime, NO_DATE };
