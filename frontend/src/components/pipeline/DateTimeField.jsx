/**
 * DateTimeField — an Outlook/Teams-style date + time control.
 *
 * Replaces AntD's combined `<DatePicker showTime>`, whose time side is a pair
 * of narrow scrolling hour/minute columns inside the calendar popup plus an OK
 * button — three fiddly interactions to set one time.
 *
 * Outlook and Teams instead split the two: a calendar for the date, and a
 * plain dropdown LIST of quarter-hour slots for the time. Picking 2:30 PM is one
 * click in a list you can also type into. That is what this reproduces.
 *
 *   Date                    Time
 *   [ 11 Aug 2026    📅 ]   [ 2:30 PM        ▼ ]
 *
 * The two halves stay in sync on one dayjs value: choosing a date keeps the
 * time already set (defaulting to `defaultHour` when there wasn't one), and
 * choosing a time keeps the date (defaulting to today).
 */
import { useMemo } from 'react';
import { DatePicker, Select } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

/** Minutes past midnight -> "2:30 PM", the label Outlook shows. */
const minutesToLabel = (mins) => dayjs().startOf('day').add(mins, 'minute').format('h:mm A');

/**
 * @param {object} props
 * @param {import('dayjs').Dayjs|null} props.value
 * @param {(next: import('dayjs').Dayjs|null) => void} props.onChange
 * @param {number} [props.minuteStep=15] - slot spacing, as in Outlook's 15-min list
 * @param {number} [props.defaultHour=9] - hour applied when a date is picked before a time
 * @param {(current: import('dayjs').Dayjs) => boolean} [props.disabledDate]
 * @param {string} [props.datePlaceholder]
 * @param {number} [props.durationFrom] - when set, each option also shows the gap
 *   from this reference time ("30 minutes", "1 hour") exactly as Outlook's END
 *   time dropdown does
 */
export default function DateTimeField({
  value,
  onChange,
  minuteStep = 15,
  defaultHour = 9,
  disabledDate,
  datePlaceholder = 'Select a date',
  durationFrom = null,
}) {
  const selectedMinutes = value ? value.hour() * 60 + value.minute() : null;

  const timeOptions = useMemo(() => {
    const opts = [];
    for (let m = 0; m < 24 * 60; m += minuteStep) {
      opts.push({ value: m, label: minutesToLabel(m) });
    }
    // A time already on the record (or set before the step changed) may not sit
    // on a slot boundary — surface it rather than silently showing a blank box.
    if (selectedMinutes != null && selectedMinutes % minuteStep !== 0) {
      opts.push({ value: selectedMinutes, label: minutesToLabel(selectedMinutes) });
      opts.sort((a, b) => a.value - b.value);
    }
    return opts;
  }, [minuteStep, selectedMinutes]);

  // Outlook annotates the END dropdown with how long the meeting would run.
  const decorated = useMemo(() => {
    if (durationFrom == null) return timeOptions;
    return timeOptions.map((o) => {
      const diff = o.value - durationFrom;
      if (diff <= 0) return o;
      const h = Math.floor(diff / 60);
      const m = diff % 60;
      const gap = h && m ? `${h} hr ${m} min` : h ? `${h} hour${h > 1 ? 's' : ''}` : `${m} minutes`;
      return { ...o, label: `${o.label}  ·  ${gap}` };
    });
  }, [timeOptions, durationFrom]);

  const handleDate = (next) => {
    if (!next) return onChange(null);
    const base = value || dayjs().hour(defaultHour).minute(0);
    return onChange(next.hour(base.hour()).minute(base.minute()).second(0).millisecond(0));
  };

  const handleTime = (mins) => {
    if (mins == null) return onChange(null);
    const base = value || dayjs();
    return onChange(base.startOf('day').add(mins, 'minute'));
  };

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
      <DatePicker
        size="large"
        style={{ flex: '1 1 60%' }}
        format="ddd, DD MMM YYYY"
        placeholder={datePlaceholder}
        value={value}
        onChange={handleDate}
        disabledDate={disabledDate}
        allowClear={false}
      />
      <Select
        size="large"
        style={{ flex: '1 1 40%' }}
        placeholder="Time"
        suffixIcon={<ClockCircleOutlined />}
        value={selectedMinutes}
        onChange={handleTime}
        options={decorated}
        showSearch
        // Typing "230" or "2:30" jumps to the slot, as Outlook's box does.
        filterOption={(input, option) =>
          option.label.toLowerCase().replace(/[:\s]/g, '').includes(input.toLowerCase().replace(/[:\s]/g, ''))
        }
        // Open on the selected slot instead of at midnight.
        listHeight={288}
      />
    </div>
  );
}
