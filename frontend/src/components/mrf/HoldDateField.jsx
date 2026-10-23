/**
 * HoldDateField — the "hold until" date picker with quick choices.
 *
 * Used on the approver's page, the on-behalf panel and "Change date". The
 * bounds come from the server (holdDateBounds: tomorrow .. today + maxDays,
 * IST), so the picker can never offer a date the server would refuse.
 *
 * Plan: docs/phase3/MRF/MRF-Hold-and-Delegate-Approval-Plan.md
 */
import { DatePicker, Button, Space, Typography } from 'antd';
import dayjs from 'dayjs';

const { Text } = Typography;

const ISO = 'YYYY-MM-DD';
const QUICK = [
  { label: '2 weeks', days: 14 },
  { label: '30 days', days: 30 },
  { label: '60 days', days: 60 },
  { label: '90 days', days: 90 },
];

/**
 * @param {{
 *   value: string,                 'YYYY-MM-DD' or ''
 *   onChange: (iso: string) => void,
 *   config: { minDate: string, maxDate: string, defaultDays: number, maxDays: number },
 *   label?: string,
 *   id?: string,
 * }} props
 */
export default function HoldDateField({ value, onChange, config, label = 'Hold until', id = 'hold-until' }) {
  if (!config) return null;
  const min = dayjs(config.minDate);
  const max = dayjs(config.maxDate);
  // "Today" as the server sees it is the day before minDate.
  const today = min.subtract(1, 'day');
  const quick = QUICK.filter((q) => q.days <= config.maxDays);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label htmlFor={id} style={{ fontWeight: 600, fontSize: 13 }}>
        {label} <Text type="danger">*</Text>
      </label>
      <Space wrap size={8} align="center">
        <DatePicker
          id={id}
          value={value ? dayjs(value) : null}
          onChange={(d) => onChange(d ? d.format(ISO) : '')}
          format="DD MMM YYYY"
          allowClear={false}
          disabledDate={(d) => d.isBefore(min, 'day') || d.isAfter(max, 'day')}
          style={{ width: 180 }}
        />
        {quick.map((q) => {
          const iso = today.add(q.days, 'day').format(ISO);
          const active = value === iso;
          return (
            <Button
              key={q.days}
              size="small"
              shape="round"
              type={active ? 'primary' : 'default'}
              onClick={() => onChange(iso)}
              style={active ? { background: '#234e8c', borderColor: '#234e8c' } : undefined}
            >
              {q.label}
            </Button>
          );
        })}
      </Space>
      <Text type="secondary" style={{ fontSize: 12 }}>
        Earliest {min.format('DD MMM YYYY')} · latest {max.format('DD MMM YYYY')} (at most {config.maxDays} days).
        The limits are set in Settings › MRF Approval &amp; Hold.
      </Text>
    </div>
  );
}
