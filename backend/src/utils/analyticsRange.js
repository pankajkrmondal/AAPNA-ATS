/**
 * The Recruitment Analytics date range (L06). Pure — no Prisma — so node:test
 * can load it.
 *
 * A range is a run of whole India-time calendar days, both ends included:
 * "16 Oct – 22 Oct" covers 16 Oct 00:00 IST up to (not including) 23 Oct 00:00
 * IST. `null` means "All time": no filter at all, which is also what every
 * endpoint does when no range is sent, so old callers see no change.
 *
 * Query params: `from` / `to` as YYYY-MM-DD, or `preset` (7, 30, 60, 90, 365,
 * all). The page sends from/to; the preset form is for links and scripts.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // India has no daylight saving.
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The page's presets, in days. "all" is the extra "All" button. */
export const ANALYTICS_PRESET_DAYS = Object.freeze([7, 30, 60, 90, 365]);
/** The longest custom range accepted (about 3 years). */
export const MAX_RANGE_DAYS = 1100;

/** 'YYYY-MM-DD' of the India-time day a moment falls on. */
export function istDay(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The moment an India-time day begins. */
export function istDayStart(day) {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() - IST_OFFSET_MS);
}

/** A real calendar day in YYYY-MM-DD, or null. */
function validDay(value) {
  if (typeof value !== 'string') return null;
  const day = value.trim().slice(0, 10);
  if (!DAY_PATTERN.test(day)) return null;
  const d = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day ? day : null;
}

const addDays = (day, n) => new Date(new Date(`${day}T00:00:00.000Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);

/**
 * Build a range from its first and last day (both included).
 * @returns {{ fromDay: string, toDay: string, from: Date, to: Date, days: number }}
 *   `from` inclusive, `to` exclusive (the start of the day after toDay)
 */
export function makeRange(fromDay, toDay) {
  const from = istDayStart(fromDay);
  const to = istDayStart(addDays(toDay, 1));
  return { fromDay, toDay, from, to, days: Math.round((to - from) / DAY_MS) };
}

/**
 * The last `days` days, today included.
 * @param {number} days
 * @param {Date} [now]
 */
export function lastNDays(days, now = new Date()) {
  const today = istDay(now);
  return makeRange(addDays(today, -(days - 1)), today);
}

/**
 * Read the range from a query string. Junk, a reversed range or one longer
 * than MAX_RANGE_DAYS gives null ("All time"), never an error: a bad link
 * should show everything rather than a blank page.
 *
 * @param {object} [query] req.query
 * @param {Date} [now]
 * @returns {null | ReturnType<typeof makeRange>}
 */
export function parseAnalyticsRange(query = {}, now = new Date()) {
  const preset = String(query.preset ?? '').trim().toLowerCase();
  if (preset === 'all') return null;
  const presetDays = Number.parseInt(preset, 10);
  if (ANALYTICS_PRESET_DAYS.includes(presetDays)) return lastNDays(presetDays, now);

  const fromDay = validDay(query.from ?? query.date_from);
  const toDay = validDay(query.to ?? query.date_to) || (fromDay ? istDay(now) : null);
  if (!fromDay || !toDay || fromDay > toDay) return null;
  const range = makeRange(fromDay, toDay);
  return range.days > MAX_RANGE_DAYS ? null : range;
}

/** Whether a moment falls inside the range. Everything is inside "All time"; a missing date never is. */
export function inRange(value, range) {
  if (!range) return true;
  if (value === null || value === undefined || value === '') return false;
  const t = (value instanceof Date ? value : new Date(value)).getTime();
  return Number.isFinite(t) && t >= range.from.getTime() && t < range.to.getTime();
}

/** The same number of days immediately before the range; null for "All time". */
export function previousPeriod(range) {
  if (!range) return null;
  return makeRange(addDays(range.fromDay, -range.days), addDays(range.fromDay, -1));
}

const fmtDay = (day) => {
  const [y, m, d] = day.split('-');
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
};

/** "16 Oct 2026 – 22 Oct 2026", "22 Oct 2026" for one day, "All time". */
export function rangeLabel(range) {
  if (!range) return 'All time';
  return range.fromDay === range.toDay ? fmtDay(range.fromDay) : `${fmtDay(range.fromDay)} – ${fmtDay(range.toDay)}`;
}

/** File-name tag: "_2026-10-16_to_2026-10-22", or "_all-time". */
export function rangeFileTag(range) {
  return range ? `_${range.fromDay}_to_${range.toDay}` : '_all-time';
}

/** The range as the API echoes it back, so the screen can print what was counted. */
export function rangeForResponse(range) {
  return range
    ? { from: range.fromDay, to: range.toDay, days: range.days, label: rangeLabel(range) }
    : { from: null, to: null, days: null, label: rangeLabel(null) };
}

/**
 * Every India-time day in the range, oldest first (for zero-filled daily
 * series). Capped at `max` days so an "All time" chart can't run to thousands.
 */
export function daysOf(range, max = 400) {
  if (!range) return [];
  const out = [];
  for (let i = 0; i < Math.min(range.days, max); i += 1) out.push(addDays(range.fromDay, i));
  return out;
}

export default {
  ANALYTICS_PRESET_DAYS, MAX_RANGE_DAYS, istDay, istDayStart, makeRange, lastNDays, parseAnalyticsRange,
  inRange, previousPeriod, rangeLabel, rangeFileTag, rangeForResponse, daysOf,
};
