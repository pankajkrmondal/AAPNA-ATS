/**
 * AnalyticsRangeBar — the date range every Analytics tab follows (L06).
 * Presets 7 / 30 / 60 / 90 / 365 days and All, plus custom dates. Picking
 * custom dates switches the preset off; picking a preset clears them.
 */
import { DatePicker, Segmented, Space, Typography } from 'antd';
import dayjs from 'dayjs';
import MetricInfo from '../common/MetricInfo';
import { RANGE_PRESETS, rangeParams, rangeText } from './openPositionsShared';

const { Text } = Typography;

/**
 * @param {{ value: { preset: string, from: import('dayjs').Dayjs|null, to: import('dayjs').Dayjs|null },
 *   onChange: (next: object) => void, previousLabel?: string|null }} props
 */
export default function AnalyticsRangeBar({ value, onChange, previousLabel }) {
  const params = rangeParams(value);
  const picker = params.from ? [dayjs(params.from), dayjs(params.to)] : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }} data-testid="analytics-range-bar">
      <Space size={10} wrap style={{ justifyContent: 'flex-end' }}>
        <Segmented
          value={value.preset === 'custom' ? null : value.preset}
          onChange={(preset) => onChange({ preset, from: null, to: null })}
          options={RANGE_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
          data-testid="analytics-range-presets"
        />
        <DatePicker.RangePicker
          value={picker}
          onChange={(v) => {
            if (v?.[0] && v?.[1]) onChange({ preset: 'custom', from: v[0].startOf('day'), to: v[1].startOf('day') });
            else onChange({ preset: 'all', from: null, to: null });
          }}
          format="DD MMM YYYY"
          allowClear
          disabledDate={(d) => d && d.isAfter(dayjs(), 'day')}
          aria-label="Custom date range"
          data-testid="analytics-range-picker"
        />
        <MetricInfo metric="analyticsRange" />
      </Space>
      <Text type="secondary" style={{ fontSize: 12 }} data-testid="analytics-range-caption">
        Showing <strong>{rangeText(value)}</strong>
        {previousLabel ? ` · compared with ${previousLabel}` : ''}
        {' · every tab follows this range; numbers marked NOW show today'}
      </Text>
    </div>
  );
}
