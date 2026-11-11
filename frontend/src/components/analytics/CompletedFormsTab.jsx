/**
 * CompletedFormsTab — Analytics → "Completed forms" (U10). The missing-details
 * forms candidates completed in a range, one row per JD with its count,
 * expanding to the candidates (each opens their profile).
 *
 * The range lives in the URL, so the 09:00 bell note
 * (/analytics?tab=completed-forms&from=…&to=…) opens it straight away, even
 * when the page is already open. Its own presets, not the page's range bar:
 * Yesterday (the default), Today, Last 7 days, or custom dates.
 *
 * Data: GET /api/pipeline/analytics/completed-forms?range= | ?from&to
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, DatePicker, Empty, List, Segmented, Space, Table, Tag, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import pipelineService from '../../services/pipeline';
import { ACCENT, SectionTitle } from './openPositionsShared';

const { Text } = Typography;

export const FORMS_PRESETS = [
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'today', label: 'Today' },
  { value: '7', label: 'Last 7 days' },
];
/** Same cap as the server (completedForms.helpers.js MAX_FORMS_RANGE_DAYS). */
const MAX_DAYS = 92;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The tab's range from the URL: `range=yesterday|today|7`, or `from` / `to`.
 * Anything else is yesterday.
 * @param {URLSearchParams} searchParams
 * @returns {{ preset: string, from: string|null, to: string|null }}
 */
export function formsRangeFromParams(searchParams) {
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (from && DAY.test(from)) return { preset: 'custom', from, to: to && DAY.test(to) ? to : from };
  const preset = searchParams.get('range');
  return { preset: FORMS_PRESETS.some((p) => p.value === preset) ? preset : 'yesterday', from: null, to: null };
}

/** API params for a range state. */
const apiParams = (value) => (value.preset === 'custom' ? { from: value.from, to: value.to } : { range: value.preset });

const fmtTime = (iso) => (iso ? dayjs(iso).format('DD MMM YYYY, hh:mm A') : '—');

/**
 * @param {{ value: { preset: string, from: string|null, to: string|null }, onChange: (next: object) => void }} props
 */
export default function CompletedFormsTab({ value, onChange }) {
  const navigate = useNavigate();
  // A string, so the fetch runs only when the range really changes.
  const paramsKey = useMemo(() => JSON.stringify(apiParams(value)), [value]);
  const [state, setState] = useState({ loading: true, error: false, data: null });
  const [pickedStart, setPickedStart] = useState(null);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: false }));
    pipelineService.getCompletedForms(JSON.parse(paramsKey))
      .then((res) => { if (alive) setState({ loading: false, error: false, data: res.data?.data || res.data }); })
      .catch(() => { if (alive) setState({ loading: false, error: true, data: null }); });
    return () => { alive = false; };
  }, [paramsKey]);

  const d = state.data;
  const groups = d?.groups || [];
  const noJd = groups.find((g) => g.mrf_id === null)?.count || 0;
  const label = d?.range?.label;
  const picker = d?.range?.from ? [dayjs(d.range.from), dayjs(d.range.to)] : null;

  const columns = [
    {
      title: 'JD',
      key: 'title',
      render: (_, g) => (g.mrf_id === null
        ? <Text type="secondary" italic>{g.title}</Text>
        : (
          <Space size={8}>
            <Text strong>{g.title}</Text>
            <Tag style={{ borderRadius: 12, margin: 0 }}>MRF-{g.mrf_id}</Tag>
          </Space>
        )),
    },
    {
      title: 'Forms completed',
      dataIndex: 'count',
      key: 'count',
      align: 'right',
      width: 170,
      render: (n) => <Text strong>{n}</Text>,
    },
  ];

  return (
    <div data-testid="completed-forms-tab">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <SectionTitle accent={ACCENT.success} hint={`missing-details forms candidates completed${label ? ` · ${label}` : ''}`}>
          Completed forms
        </SectionTitle>
        <Space size={10} wrap>
          <Segmented
            value={value.preset === 'custom' ? null : value.preset}
            onChange={(preset) => onChange({ preset, from: null, to: null })}
            options={FORMS_PRESETS}
            data-testid="completed-forms-presets"
          />
          <DatePicker.RangePicker
            value={value.preset === 'custom' ? picker : null}
            onChange={(v) => {
              if (!v?.[0] || !v?.[1]) { onChange({ preset: 'yesterday', from: null, to: null }); return; }
              if (v[1].diff(v[0], 'day') + 1 > MAX_DAYS) { message.warning(`Pick up to ${MAX_DAYS} days.`); return; }
              onChange({ preset: 'custom', from: v[0].format('YYYY-MM-DD'), to: v[1].format('YYYY-MM-DD') });
            }}
            onCalendarChange={(dates, _s, info) => { if (info?.range === 'start') setPickedStart(dates?.[0] ?? null); }}
            onOpenChange={(open) => { if (!open) setPickedStart(null); }}
            format="DD MMM YYYY"
            allowClear
            disabledDate={(day) => day && (day.isAfter(dayjs(), 'day') || (pickedStart && day.isBefore(pickedStart, 'day')))}
            aria-label="Completed forms dates"
            data-testid="completed-forms-picker"
          />
        </Space>
      </div>

      {state.error && <Alert type="error" showIcon style={{ marginBottom: 12 }} message="The completed forms could not be loaded. Try again." />}

      {d && (
        <Text type="secondary" style={{ display: 'block', marginBottom: 10, fontSize: 13 }} data-testid="completed-forms-summary">
          <strong>{d.total}</strong> {d.total === 1 ? 'form' : 'forms'} across <strong>{d.jd_count}</strong> {d.jd_count === 1 ? 'JD' : 'JDs'}
          {noJd ? ` · ${noJd} with no JD yet` : ''}
          {' · this tab has its own dates (yesterday by default), in India time'}
        </Text>
      )}

      <Table
        rowKey={(g) => (g.mrf_id === null ? 'none' : String(g.mrf_id))}
        dataSource={groups}
        columns={columns}
        loading={state.loading}
        pagination={groups.length > 20 ? { pageSize: 20 } : false}
        expandable={{
          expandRowByClick: true,
          expandedRowRender: (g) => (
            <List
              size="small"
              dataSource={g.candidates}
              renderItem={(c) => (
                <List.Item
                  actions={[<Button key="open" type="link" size="small" onClick={() => navigate(`/candidates/${c.cv_id}`)}>Profile →</Button>]}
                  data-testid="completed-forms-candidate"
                >
                  <List.Item.Meta
                    title={c.name}
                    description={<Text type="secondary" style={{ fontSize: 12.5 }}>Completed {fmtTime(c.completed_at)}</Text>}
                  />
                </List.Item>
              )}
            />
          ),
        }}
        locale={{ emptyText: <Empty description={label ? `No forms completed · ${label}` : 'No forms completed'} /> }}
        data-testid="completed-forms-table"
      />
      <Text type="secondary" style={{ fontSize: 12 }}>
        A candidate counts once, under the JD of their open pipeline journey, else the JD they were last linked to. &quot;No JD yet&quot; means neither exists.
      </Text>
    </div>
  );
}
