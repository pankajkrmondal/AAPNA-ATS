import prisma from '../config/database.js';
import { success } from '../utils/apiResponse.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';
import cron from 'node-cron';
import { rescheduleReminderJob } from '../jobs/reminderScheduler.js';
import {
  SETTING_KEYS as INTERVIEW_REMINDER_KEYS,
  ALLOWED_INTERVALS,
  getInterviewReminderSettings,
  restartInterviewReminderJob,
} from '../jobs/interviewReminder.js';
import {
  SETTING_KEYS as INTERVIEW_OCCURRENCE_KEYS,
  ALLOWED_INTERVALS as OCCURRENCE_INTERVALS,
  getInterviewOccurrenceSettings,
  restartInterviewOccurrenceJob,
} from '../jobs/interviewOccurrence.js';
import { isAttendanceEnabled } from '../services/graphAttendance.service.js';
import { isAdminTier } from '../config/roles.js';
import { describeFlowKeys, isKnownFlowKey, reloadEmailRecipients } from '../config/emailRecipients.js';
import {
  getAssessmentAutomationSettings,
  saveAssessmentAutomationSettings,
} from '../services/assessmentSettings.service.js';

/**
 * @desc    Get automated email reminder configuration settings
 * @route   GET /api/settings/reminder
 * @access  Private
 */
export const getReminderSettings = catchAsync(async (req, res) => {
  const keys = ['reminder_interval_days', 'reminder_max_count', 'reminder_cron_schedule'];

  const settings = await prisma.rpa_settings.findMany({
    where: {
      key: { in: keys },
    },
  });

  const settingsMap = settings.reduce((acc, curr) => {
    acc[curr.key] = curr.value;
    return acc;
  }, {});

  // Default fallbacks if not seeded
  const reminder_interval_days = settingsMap.hasOwnProperty('reminder_interval_days')
    ? parseInt(settingsMap['reminder_interval_days'], 10)
    : 1;

  const reminder_max_count = settingsMap.hasOwnProperty('reminder_max_count')
    ? parseInt(settingsMap['reminder_max_count'], 10)
    : 4;

  const reminder_cron_schedule = settingsMap.hasOwnProperty('reminder_cron_schedule')
    ? settingsMap['reminder_cron_schedule']
    : '0 9 * * *';

  return success(res, {
    reminder_interval_days,
    reminder_max_count,
    reminder_cron_schedule,
  }, 'Reminder settings retrieved successfully');
});

/**
 * @desc    Update automated email reminder configuration settings
 * @route   POST /api/settings/reminder
 * @access  Private
 */
export const saveReminderSettings = catchAsync(async (req, res) => {
  const { reminder_interval_days, reminder_max_count, reminder_cron_schedule } = req.body;

  if (reminder_interval_days === undefined || reminder_max_count === undefined || reminder_cron_schedule === undefined) {
    throw new AppError('reminder_interval_days, reminder_max_count, and reminder_cron_schedule must be provided.', 400);
  }

  const intervalDays = parseInt(reminder_interval_days, 10);
  const maxCount = parseInt(reminder_max_count, 10);
  const cronExpression = String(reminder_cron_schedule).trim();

  if (isNaN(intervalDays) || intervalDays < 0) {
    throw new AppError('reminder_interval_days must be a valid positive integer.', 400);
  }

  if (isNaN(maxCount) || maxCount < 0) {
    throw new AppError('reminder_max_count must be a valid positive integer.', 400);
  }

  if (!cron.validate(cronExpression)) {
    throw new AppError('reminder_cron_schedule must be a valid cron expression (e.g. "0 9 * * *").', 400);
  }

  // Update in database using transactions
  await prisma.$transaction([
    prisma.rpa_settings.upsert({
      where: { key: 'reminder_interval_days' },
      update: { value: String(intervalDays) },
      create: { key: 'reminder_interval_days', value: String(intervalDays) },
    }),
    prisma.rpa_settings.upsert({
      where: { key: 'reminder_max_count' },
      update: { value: String(maxCount) },
      create: { key: 'reminder_max_count', value: String(maxCount) },
    }),
    prisma.rpa_settings.upsert({
      where: { key: 'reminder_cron_schedule' },
      update: { value: cronExpression },
      create: { key: 'reminder_cron_schedule', value: cronExpression },
    }),
  ]);

  // Reschedule the active cron job immediately
  await rescheduleReminderJob();

  return success(res, {
    reminder_interval_days: intervalDays,
    reminder_max_count: maxCount,
    reminder_cron_schedule: cronExpression,
  }, 'Reminder settings updated successfully');
});

/**
 * @desc    Get the interview reminder scheduler configuration
 * @route   GET /api/settings/interview-reminder
 * @access  Private
 */
export const getInterviewReminderConfig = catchAsync(async (req, res) => {
  const settings = await getInterviewReminderSettings();

  return success(res, {
    enabled: settings.enabled,
    interval_minutes: settings.intervalMin,
    lead_minutes: settings.leadMin,
    allowed_intervals: ALLOWED_INTERVALS,
  }, 'Interview reminder settings retrieved successfully');
});

/**
 * @desc    Update the interview reminder scheduler (on/off, poll interval, lead time)
 * @route   POST /api/settings/interview-reminder
 * @access  Private
 */
export const saveInterviewReminderConfig = catchAsync(async (req, res) => {
  const { enabled, interval_minutes, lead_minutes } = req.body;

  if (enabled === undefined) {
    throw new AppError('enabled must be provided.', 400);
  }
  const isEnabled = enabled === true || enabled === 'true';

  const intervalMin = interval_minutes === undefined ? undefined : parseInt(interval_minutes, 10);
  if (intervalMin !== undefined && !ALLOWED_INTERVALS.includes(intervalMin)) {
    throw new AppError(`interval_minutes must be one of: ${ALLOWED_INTERVALS.join(', ')}.`, 400);
  }

  let leadMin = lead_minutes === undefined ? undefined : parseInt(lead_minutes, 10);
  if (leadMin !== undefined && (isNaN(leadMin) || leadMin < 5 || leadMin > 1440)) {
    throw new AppError('lead_minutes must be between 5 and 1440.', 400);
  }

  // A lead time shorter than the check interval silently drops reminders: the
  // job can step straight over the window (checking every 40 min while
  // reminding 30 min ahead can wake at T-80, T-40, then T+0 — never inside).
  // Raise it to match the interval rather than rejecting, so changing the
  // interval alone can never leave the pair in a broken state.
  const current = await getInterviewReminderSettings();
  const effectiveInterval = intervalMin ?? current.intervalMin;
  const effectiveLead = leadMin ?? current.leadMin;
  let leadAdjusted = false;
  if (effectiveLead < effectiveInterval) {
    leadMin = effectiveInterval;
    leadAdjusted = true;
  }

  const upserts = [
    prisma.rpa_settings.upsert({
      where: { key: INTERVIEW_REMINDER_KEYS.ENABLED },
      update: { value: String(isEnabled) },
      create: { key: INTERVIEW_REMINDER_KEYS.ENABLED, value: String(isEnabled) },
    }),
  ];
  if (intervalMin !== undefined) {
    upserts.push(prisma.rpa_settings.upsert({
      where: { key: INTERVIEW_REMINDER_KEYS.INTERVAL_MIN },
      update: { value: String(intervalMin) },
      create: { key: INTERVIEW_REMINDER_KEYS.INTERVAL_MIN, value: String(intervalMin) },
    }));
  }
  if (leadMin !== undefined) {
    upserts.push(prisma.rpa_settings.upsert({
      where: { key: INTERVIEW_REMINDER_KEYS.LEAD_MIN },
      update: { value: String(leadMin) },
      create: { key: INTERVIEW_REMINDER_KEYS.LEAD_MIN, value: String(leadMin) },
    }));
  }
  await prisma.$transaction(upserts);

  // Apply immediately: turning it off stops the cron, changing the interval
  // re-registers it — no server restart needed.
  await restartInterviewReminderJob();

  const saved = await getInterviewReminderSettings();
  const message = leadAdjusted
    ? `Reminder lead time raised to ${saved.leadMin} minutes so it is never shorter than the check interval.`
    : `Interview reminders ${saved.enabled ? 'enabled' : 'disabled'}`;

  return success(res, {
    enabled: saved.enabled,
    interval_minutes: saved.intervalMin,
    lead_minutes: saved.leadMin,
    lead_adjusted: leadAdjusted,
  }, message);
});

/**
 * @desc    Get the interview occurrence sweep configuration
 * @route   GET /api/settings/interview-occurrence
 * @access  Private
 */
export const getInterviewOccurrenceConfig = catchAsync(async (req, res) => {
  const settings = await getInterviewOccurrenceSettings();
  return success(res, {
    enabled: settings.enabled,
    interval_minutes: settings.intervalMin,
    grace_minutes: settings.graceMin,
    allowed_intervals: OCCURRENCE_INTERVALS,
    // Read-only, from MS_ATTENDANCE_ENABLED. It decides which of the sweep's two
    // modes actually runs: with attendance the verdict is read off the Teams
    // report, without it the sweep can only email a human to ask. The Settings
    // card says which, so the toggle never promises automation that cannot happen.
    attendance_enabled: isAttendanceEnabled(),
  }, 'Interview occurrence settings retrieved successfully');
});

/**
 * @desc    Update the interview occurrence sweep (on/off, poll interval, grace)
 * @route   POST /api/settings/interview-occurrence
 * @access  Private
 */
export const saveInterviewOccurrenceConfig = catchAsync(async (req, res) => {
  const { enabled, interval_minutes, grace_minutes } = req.body;

  if (enabled === undefined) {
    throw new AppError('enabled must be provided.', 400);
  }
  const isEnabled = enabled === true || enabled === 'true';

  const intervalMin = interval_minutes === undefined ? undefined : parseInt(interval_minutes, 10);
  if (intervalMin !== undefined && !OCCURRENCE_INTERVALS.includes(intervalMin)) {
    throw new AppError(`interval_minutes must be one of: ${OCCURRENCE_INTERVALS.join(', ')}.`, 400);
  }

  const graceMin = grace_minutes === undefined ? undefined : parseInt(grace_minutes, 10);
  if (graceMin !== undefined && (isNaN(graceMin) || graceMin < 0 || graceMin > 1440)) {
    throw new AppError('grace_minutes must be between 0 and 1440.', 400);
  }

  const upserts = [
    prisma.rpa_settings.upsert({
      where: { key: INTERVIEW_OCCURRENCE_KEYS.ENABLED },
      update: { value: String(isEnabled) },
      create: { key: INTERVIEW_OCCURRENCE_KEYS.ENABLED, value: String(isEnabled) },
    }),
  ];
  if (intervalMin !== undefined) {
    upserts.push(prisma.rpa_settings.upsert({
      where: { key: INTERVIEW_OCCURRENCE_KEYS.INTERVAL_MIN },
      update: { value: String(intervalMin) },
      create: { key: INTERVIEW_OCCURRENCE_KEYS.INTERVAL_MIN, value: String(intervalMin) },
    }));
  }
  if (graceMin !== undefined) {
    upserts.push(prisma.rpa_settings.upsert({
      where: { key: INTERVIEW_OCCURRENCE_KEYS.GRACE_MIN },
      update: { value: String(graceMin) },
      create: { key: INTERVIEW_OCCURRENCE_KEYS.GRACE_MIN, value: String(graceMin) },
    }));
  }
  await prisma.$transaction(upserts);

  // Apply immediately — no server restart needed.
  await restartInterviewOccurrenceJob();

  const saved = await getInterviewOccurrenceSettings();
  return success(res, {
    enabled: saved.enabled,
    interval_minutes: saved.intervalMin,
    grace_minutes: saved.graceMin,
  }, `Interview occurrence sweep ${saved.enabled ? 'enabled' : 'disabled'}`);
});

/**
 * @desc    Get Evalground Assessment automation settings (invite deadline
 *          window + the global auto-advance/auto-reject toggle)
 * @route   GET /api/settings/assessment-automation
 * @access  Private — any authenticated user may read (recruiters need to see
 *          the current deadline/toggle state when sending an invite)
 */
export const getAssessmentAutomation = catchAsync(async (req, res) => {
  const { deadlineDays, autoAdvanceEnabled } = await getAssessmentAutomationSettings();
  return success(res, {
    assessment_deadline_days: deadlineDays,
    assessment_auto_advance_enabled: autoAdvanceEnabled,
  }, 'Assessment automation settings retrieved successfully');
});

/**
 * @desc    Update Evalground Assessment automation settings
 * @route   POST /api/settings/assessment-automation
 * @access  Private — admin-tier only. Deliberately tighter than the reminder
 *          settings above: this toggle can trigger unattended approve/reject
 *          decisions plus real outcome emails, a materially higher-stakes
 *          action than a reminder cadence.
 */
export const saveAssessmentAutomation = catchAsync(async (req, res) => {
  if (!isAdminTier(req.user?.role)) {
    throw new AppError('Admin access required to change assessment automation settings.', 403);
  }

  const { assessment_deadline_days, assessment_auto_advance_enabled } = req.body;
  const deadlineDays = parseInt(assessment_deadline_days, 10);
  if (isNaN(deadlineDays) || deadlineDays < 1 || deadlineDays > 30) {
    throw new AppError('assessment_deadline_days must be a valid integer between 1 and 30.', 400);
  }

  const result = await saveAssessmentAutomationSettings({
    deadlineDays,
    autoAdvanceEnabled: assessment_auto_advance_enabled === true || assessment_auto_advance_enabled === 'true',
  });

  return success(res, {
    assessment_deadline_days: result.deadlineDays,
    assessment_auto_advance_enabled: result.autoAdvanceEnabled,
  }, 'Assessment automation settings updated successfully');
});

/**
 * @desc    List every email flow key and where its mail currently goes
 * @route   GET /api/settings/flow-keys
 * @access  Private — admin-tier only. Recipient lists carry internal staff
 *          addresses, so this is not a read a recruiter needs.
 */
export const getFlowKeys = catchAsync(async (req, res) => {
  if (!isAdminTier(req.user?.role)) {
    throw new AppError('Admin access required to view email routing.', 403);
  }
  return success(res, describeFlowKeys(), 'Email flow keys retrieved successfully');
});

/**
 * @desc    Update the to/cc for one email flow key
 * @route   POST /api/settings/flow-keys
 * @access  Private — admin-tier only.
 *
 * Writes the same `email_recipients.<flowKey>.to` / `.cc` rows
 * loadEmailRecipients() reads at boot, then reloads the in-memory map so the
 * change takes effect without a restart — the reason this could not simply be
 * "let an admin run the UPDATE themselves".
 *
 * Unknown keys are refused: a typo would otherwise write a row that silently
 * does nothing, which is worse than an error because it looks like it worked.
 */
export const saveFlowKey = catchAsync(async (req, res) => {
  if (!isAdminTier(req.user?.role)) {
    throw new AppError('Admin access required to change email routing.', 403);
  }

  const { flowKey, to = '', cc = '' } = req.body;
  if (!flowKey) throw new AppError('flowKey is required.', 400);
  if (!isKnownFlowKey(flowKey)) {
    throw new AppError(`"${flowKey}" is not a flow this system sends under.`, 400);
  }

  // Light validation only. These lists are comma-separated and are routinely
  // left blank on purpose (every dynamic flow resolves its recipient per-send),
  // so an empty value is valid input, not a missing one.
  const invalid = [to, cc]
    .flatMap((list) => String(list).split(',').map((s) => s.trim()).filter(Boolean))
    .filter((addr) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr));
  if (invalid.length > 0) {
    throw new AppError(`Not a valid email address: ${invalid.join(', ')}.`, 400);
  }

  await prisma.$transaction([
    prisma.rpa_settings.upsert({
      where: { key: `email_recipients.${flowKey}.to` },
      create: { key: `email_recipients.${flowKey}.to`, value: String(to).trim() },
      update: { value: String(to).trim() },
    }),
    prisma.rpa_settings.upsert({
      where: { key: `email_recipients.${flowKey}.cc` },
      create: { key: `email_recipients.${flowKey}.cc`, value: String(cc).trim() },
      update: { value: String(cc).trim() },
    }),
  ]);

  await reloadEmailRecipients();

  return success(res, describeFlowKeys().find((f) => f.flowKey === flowKey), 'Email routing updated successfully');
});

