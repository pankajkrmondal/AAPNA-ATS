/**
 * Auto-pause rule for idle pipeline journeys (RT ask, 23 Oct 2026).
 *
 * A journey that has sat in the same stage with no activity for N days is
 * paused, which takes it off the default board (it stays under "Paused
 * journey"). N is set by admins on the Settings page. Idle is measured the
 * way the card's day counter is: from the journey's latest stage event, or
 * from modified_at when it has none — so "24d" on a card and the sweep agree.
 */
export const DEFAULT_AUTO_PAUSE_DAYS = 10;
export const MIN_AUTO_PAUSE_DAYS = 1;
export const MAX_AUTO_PAUSE_DAYS = 365;

/**
 * A whole number of days in range, or null.
 * @param {unknown} value
 * @returns {number|null}
 */
export function parseAutoPauseDays(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < MIN_AUTO_PAUSE_DAYS || n > MAX_AUTO_PAUSE_DAYS) return null;
  return n;
}

/**
 * Stored 'true'/'false'; anything else is the default (on).
 * @param {string|null|undefined} value
 * @returns {boolean}
 */
export function parseAutoPauseEnabled(value) {
  if (value === 'false') return false;
  return true;
}

/** The audit note written on each journey the sweep pauses. */
export function autoPauseNote(days) {
  return `Journey auto-paused — no activity in this stage for ${days} day${days === 1 ? '' : 's'}. `
    + 'Reminders and chase-ups are suspended. Resume it from the candidate\'s drawer.';
}
