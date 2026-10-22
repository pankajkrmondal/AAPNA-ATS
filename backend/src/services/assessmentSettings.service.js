/**
 * assessmentSettings.service.js — rpa_settings-backed tuning knobs for the
 * Evalground Assessment stage: invite deadline window + the global
 * auto-advance/auto-reject toggle. Mirrors settings.controller.js's
 * reminder_interval_days pattern (findMany -> map -> parseInt fallback;
 * $transaction of upserts to save).
 */
import prisma from '../config/database.js';

const KEYS = ['assessment_deadline_days', 'assessment_auto_advance_enabled'];
const DEFAULT_DEADLINE_DAYS = 2;

export async function getAssessmentAutomationSettings() {
  const settings = await prisma.rpa_settings.findMany({ where: { key: { in: KEYS } } });
  const map = settings.reduce((acc, curr) => {
    acc[curr.key] = curr.value;
    return acc;
  }, {});

  return {
    deadlineDays: Object.prototype.hasOwnProperty.call(map, 'assessment_deadline_days')
      ? parseInt(map.assessment_deadline_days, 10)
      : DEFAULT_DEADLINE_DAYS,
    // Default OFF — a deliberate safety choice for a first-time-shipped
    // automatic-outcome-setting feature (see docs/changelog for context).
    autoAdvanceEnabled: Object.prototype.hasOwnProperty.call(map, 'assessment_auto_advance_enabled')
      ? map.assessment_auto_advance_enabled === 'true'
      : false,
  };
}

export async function saveAssessmentAutomationSettings({ deadlineDays, autoAdvanceEnabled }) {
  await prisma.$transaction([
    prisma.rpa_settings.upsert({
      where: { key: 'assessment_deadline_days' },
      update: { value: String(deadlineDays) },
      create: { key: 'assessment_deadline_days', value: String(deadlineDays) },
    }),
    prisma.rpa_settings.upsert({
      where: { key: 'assessment_auto_advance_enabled' },
      update: { value: String(!!autoAdvanceEnabled) },
      create: { key: 'assessment_auto_advance_enabled', value: String(!!autoAdvanceEnabled) },
    }),
  ]);
  return { deadlineDays, autoAdvanceEnabled: !!autoAdvanceEnabled };
}
