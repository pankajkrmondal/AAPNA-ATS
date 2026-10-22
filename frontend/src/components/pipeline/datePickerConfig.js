/**
 * Shared date-picker rules for the Candidate Pipeline.
 *
 * Date+time entry itself lives in DateTimeField.jsx, which follows the
 * Outlook/Teams split (calendar for the date, dropdown list for the time)
 * rather than AntD's combined picker. What remains here are the plain
 * date-only concerns those controls share.
 */
import dayjs from 'dayjs';

/** Blocks every day before today. Today itself stays selectable. */
export const noPastDates = (current) => current && current < dayjs().startOf('day');

/**
 * Quick picks for a proposed joining date, built around the notice periods
 * candidates actually serve. This one field is a plain date with no time, so
 * presets still read naturally here (unlike a split date+time control, where
 * a preset would have to silently set both halves).
 */
export const JOINING_DATE_PRESETS = [
  { label: 'In 15 days', value: dayjs().add(15, 'day') },
  { label: 'In 30 days (1 month notice)', value: dayjs().add(30, 'day') },
  { label: 'In 60 days (2 month notice)', value: dayjs().add(60, 'day') },
  { label: 'In 90 days (3 month notice)', value: dayjs().add(90, 'day') },
];

/** Display format for date-only pickers. */
export const DATE_FORMAT = 'ddd, DD MMM YYYY';
