/**
 * pipelineAutoPause.service.js — the idle-journey auto-pause (23 Oct 2026).
 *
 * Settings live in rpa_settings (admin-only on the Settings page):
 *   pipeline_auto_pause_enabled  'true' | 'false'   (default true)
 *   pipeline_auto_pause_days     1..365              (default 10)
 *
 * The rule is utils/pipelineAutoPause.js; the schedule is jobs/pipelineAutoPause.js.
 * Pausing here is the same flag the drawer's "Pause journey" sets
 * (setJourneyPaused): nothing is closed, nothing is emailed, and the four
 * automated sweeps skip the journey until a recruiter resumes it. Resuming
 * writes a stage event, so a resumed journey gets a fresh N days.
 */
import { Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import {
  DEFAULT_AUTO_PAUSE_DAYS,
  parseAutoPauseDays,
  parseAutoPauseEnabled,
  autoPauseNote,
} from '../utils/pipelineAutoPause.js';

export const AUTO_PAUSE_KEYS = Object.freeze({
  enabled: 'pipeline_auto_pause_enabled',
  days: 'pipeline_auto_pause_days',
});

/**
 * The saved settings, or the defaults. Never throws: a settings read failure
 * must not fail the sweep's caller.
 * @returns {Promise<{ enabled: boolean, days: number }>}
 */
export async function getAutoPauseSettings() {
  try {
    const rows = await prisma.rpa_settings.findMany({
      where: { key: { in: Object.values(AUTO_PAUSE_KEYS) } },
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      enabled: parseAutoPauseEnabled(byKey[AUTO_PAUSE_KEYS.enabled]),
      days: parseAutoPauseDays(byKey[AUTO_PAUSE_KEYS.days]) ?? DEFAULT_AUTO_PAUSE_DAYS,
    };
  } catch (err) {
    logger.warn(`[Auto-pause] settings read failed, using defaults: ${err.message}`);
    return { enabled: true, days: DEFAULT_AUTO_PAUSE_DAYS };
  }
}

/**
 * @param {{ enabled: boolean, days: number }} settings - already validated
 * @param {string} [actedBy]
 */
export async function saveAutoPauseSettings({ enabled, days }, actedBy = 'unknown') {
  const previous = await getAutoPauseSettings();
  await prisma.$transaction([
    prisma.rpa_settings.upsert({
      where: { key: AUTO_PAUSE_KEYS.enabled },
      update: { value: String(enabled) },
      create: { key: AUTO_PAUSE_KEYS.enabled, value: String(enabled) },
    }),
    prisma.rpa_settings.upsert({
      where: { key: AUTO_PAUSE_KEYS.days },
      update: { value: String(days) },
      create: { key: AUTO_PAUSE_KEYS.days, value: String(days) },
    }),
  ]);
  logger.info(`[Auto-pause] settings changed ${previous.enabled ? 'on' : 'off'}/${previous.days}d -> ${enabled ? 'on' : 'off'}/${days}d by ${actedBy}`);
  return { enabled, days };
}

/**
 * Pauses every open, unpaused journey idle for at least `days` days.
 *
 * One UPDATE ... RETURNING both selects and claims, re-checking every
 * condition at write time, so a journey that was moved or paused a moment
 * ago is never paused (or audited) twice, and two processes cannot both
 * claim the same row.
 *
 * @param {{ days?: number }} [opts] - defaults to the saved setting
 * @returns {Promise<{ enabled: boolean, days: number, paused: number }>}
 */
export async function autoPauseIdleJourneys({ days } = {}) {
  const settings = await getAutoPauseSettings();
  if (days === undefined && !settings.enabled) return { enabled: false, days: settings.days, paused: 0 };
  const window = parseAutoPauseDays(days) ?? settings.days;

  const claimed = await prisma.$queryRaw(Prisma.sql`
    UPDATE rpa_candidate_pipeline p
       SET is_paused = TRUE, modified_at = NOW()
     WHERE p.final_outcome IS NULL
       AND p.is_paused = FALSE
       AND COALESCE(
             (SELECT MAX(e.created_at) FROM rpa_pipeline_stage_events e WHERE e.pipeline_id = p.id),
             p.modified_at
           ) <= NOW() - make_interval(days => ${window}::int)
    RETURNING p.id, p.current_stage_key
  `);

  if (claimed.length) {
    try {
      await prisma.rpa_pipeline_stage_events.createMany({
        data: claimed.map((row) => ({
          pipeline_id: row.id,
          stage_key: row.current_stage_key,
          event_type: 'note',
          notes: autoPauseNote(window),
          acted_by: null,
        })),
      });
    } catch (err) {
      logger.error(`[Auto-pause] audit notes failed for ${claimed.length} journey(s): ${err.message}`);
    }
    logger.info(`[Auto-pause] paused ${claimed.length} journey(s) idle >= ${window} days: ${claimed.map((r) => String(r.id)).join(', ')}`);
  }
  return { enabled: settings.enabled, days: window, paused: claimed.length };
}

export default { AUTO_PAUSE_KEYS, getAutoPauseSettings, saveAutoPauseSettings, autoPauseIdleJourneys };
