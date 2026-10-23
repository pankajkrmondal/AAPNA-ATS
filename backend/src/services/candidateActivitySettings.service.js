/**
 * The "active window" for screening order (L01): how recent a details
 * submission (or request) must be for a candidate to count as Active
 * (or Pending response). Kept in rpa_settings under ACTIVE_WINDOW_KEY and
 * changed by admins on the Settings page. Default 15 days (Harish, 22 Oct 2026).
 *
 * The rule itself is utils/candidateActivity.js.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import { clearScreeningRoleCache } from './candidateSync.service.js';
import { DEFAULT_ACTIVE_WINDOW_DAYS, parseActiveWindowDays, candidateActivity } from '../utils/candidateActivity.js';

export const ACTIVE_WINDOW_KEY = 'candidate_active_window_days';

/**
 * The saved window, or the default when unset or unreadable. Never throws: a
 * settings read failure must not fail a search.
 * @returns {Promise<number>}
 */
export async function getActiveWindowDays() {
  try {
    const row = await prisma.rpa_settings.findUnique({ where: { key: ACTIVE_WINDOW_KEY } });
    return parseActiveWindowDays(row?.value) ?? DEFAULT_ACTIVE_WINDOW_DAYS;
  } catch (err) {
    logger.warn(`[candidateActivity] active window read failed, using ${DEFAULT_ACTIVE_WINDOW_DAYS} days: ${err.message}`);
    return DEFAULT_ACTIVE_WINDOW_DAYS;
  }
}

/**
 * Saves the window and drops every cached JD result, so the next search uses it.
 * @param {number} days - already validated with parseActiveWindowDays
 * @param {string} [actedBy]
 * @returns {Promise<{ activeWindowDays: number }>}
 */
export async function saveActiveWindowDays(days, actedBy = 'unknown') {
  const previous = await getActiveWindowDays();
  await prisma.rpa_settings.upsert({
    where: { key: ACTIVE_WINDOW_KEY },
    update: { value: String(days) },
    create: { key: ACTIVE_WINDOW_KEY, value: String(days) },
  });
  await clearScreeningRoleCache();
  logger.info(`[candidateActivity] active window changed ${previous} -> ${days} days by ${actedBy}`);
  return { activeWindowDays: days };
}

/**
 * Activity of every row in one search: one settings read and one clock, so
 * every card in a result is judged against the same moment.
 * @returns {Promise<{ windowDays: number, of: (c: object) => object }>}
 */
export async function activityForSearch() {
  const windowDays = await getActiveWindowDays();
  const now = new Date();
  return { windowDays, of: (c) => candidateActivity(c, { now, windowDays }) };
}

export default { ACTIVE_WINDOW_KEY, getActiveWindowDays, saveActiveWindowDays, activityForSearch };
