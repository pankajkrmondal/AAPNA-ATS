/**
 * One date format for every email and page the server writes, in IST unless a
 * caller passes another IANA zone (N34). The frontend twin is
 * frontend/src/utils/dateFormat.js; the two must print the same strings.
 *
 *   fmtDate('2026-10-07T11:00:00Z')        -> '07 Oct 2026'
 *   fmtDateTime('2026-10-07T11:00:00Z')    -> '07 Oct 2026, 4:30 PM'
 *   fmtDateTimeIst('2026-10-07T11:00:00Z') -> '07 Oct 2026, 4:30 PM IST'
 *   fmtTime('2026-10-07T11:00:00Z')        -> '4:30 PM'
 *
 * Numeric parts only from Intl, with month names and AM/PM written here: ICU
 * versions disagree on short month names ("Sep" vs "Sept") and on the AM/PM
 * marker, so a Node upgrade must not change what an email says.
 *
 * CSV exports keep their own machine format (utils/csvExport.js, YYYY-MM-DD).
 * Every function returns '' when there is no usable date: these strings are
 * interpolated into emails, where a dash would read as content.
 */

export const IST = 'Asia/Kolkata';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const formatters = new Map();
function partsFormatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-GB', {
      timeZone, day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
    }));
  }
  return formatters.get(timeZone);
}

function zonedParts(value, timeZone = IST) {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const parts = partsFormatter(timeZone).formatToParts(d);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { day: get('day'), month: get('month'), year: get('year'), hour: get('hour'), minute: get('minute') };
}

/**
 * '07 Oct 2026', or '' when there is no usable date.
 * @param {Date|string|number|null|undefined} value
 * @param {{ timeZone?: string }} [opts]
 */
export function fmtDate(value, { timeZone = IST } = {}) {
  const p = zonedParts(value, timeZone);
  if (!p) return '';
  return `${String(p.day).padStart(2, '0')} ${MONTHS[p.month - 1]} ${p.year}`;
}

/**
 * '4:30 PM', or '' when there is no usable date.
 * @param {Date|string|number|null|undefined} value
 * @param {{ timeZone?: string }} [opts]
 */
export function fmtTime(value, { timeZone = IST } = {}) {
  const p = zonedParts(value, timeZone);
  if (!p) return '';
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'AM' : 'PM'}`;
}

/**
 * '07 Oct 2026, 4:30 PM', or '' when there is no usable date.
 * @param {Date|string|number|null|undefined} value
 * @param {{ timeZone?: string }} [opts]
 */
export function fmtDateTime(value, opts = {}) {
  const date = fmtDate(value, opts);
  return date ? `${date}, ${fmtTime(value, opts)}` : '';
}

/**
 * '07 Oct 2026, 4:30 PM IST' — for emails, where the reader may not be in
 * India and the zone has to be said. '' when there is no usable date.
 * @param {Date|string|number|null|undefined} value
 */
export function fmtDateTimeIst(value) {
  const s = fmtDateTime(value);
  return s ? `${s} IST` : '';
}

/**
 * 'just now', '5 min ago', '3 h ago', '2 d ago'; older than a week (or in the
 * future) falls back to fmtDate. '' when there is no usable date.
 * @param {Date|string|number|null|undefined} value
 * @param {number} [now] epoch ms, for tests
 */
export function fmtRelative(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return '';
  const t = (value instanceof Date ? value : new Date(value)).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.floor((now - t) / 60000);
  if (mins < 0) return fmtDate(t);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days <= 7) return `${days} d ago`;
  return fmtDate(t);
}

export default { IST, fmtDate, fmtTime, fmtDateTime, fmtDateTimeIst, fmtRelative };
