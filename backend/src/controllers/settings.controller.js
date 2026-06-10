import prisma from '../config/database.js';
import { success } from '../utils/apiResponse.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';
import cron from 'node-cron';
import { rescheduleReminderJob } from '../jobs/reminderScheduler.js';

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

