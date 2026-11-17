/**
 * RespondedByJdPanel — Analytics → Open Positions › Responded (U10, moved here
 * from the Completed Forms tab by U10b). Who responded in a range, one row per
 * JD with its count, expanding to the candidates (each opens their profile).
 *
 * "Responded" and the JD pairing are the board's Responded column's, so a JD's
 * count here equals its column for the same dates, and a candidate linked to
 * two JDs is under both. It follows the board's Open / Closed / All switch.
 *
 * The range lives in the URL (?tab=open&view=responded&range= | &from&to), so
 * the 09:00 bell note opens it straight away, even when the page is already
 * open. Its own presets, not the page's range bar: Yesterday (the default),
 * Today, Last 7 days, or custom dates (up to 92 days).
 *
 * U10c: with `mrfId` it shows one position only (the role view's Responded
 * section): the same dates and rules, its candidates as a plain list. Without
 * it, each JD links to its role view when `onOpenRole` is given.
 *
 * Data: GET /api/pipeline/analytics/completed-forms?status | mrf &range= | &from&to
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, DatePicker, Empty, List, Segmented, Space, Table, Tag, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import pipelineService from '../../services/pipeline';

const { Text } = Typography;

export const RESPONDED_PRESETS = [
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'today', label: 'Today' },
  { value: '7', label: 'Last 7 days' },
];
/** Same cap as the server (completedForms.helpers.js MAX_FORMS_RANGE_DAYS). */
export const MAX_RESPONDED_DAYS = 92;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The view's range from the URL: `range=yesterday|today|7`, or `from` / `to`.
 * Anything else is yesterday.
 * @param {URLSearchParams} searchParams
 * @returns {{ preset: string, from: string|null, to: string|null }}
 */
export function respondedRangeFromParams(searchParams) {
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (from && DAY.test(from)) return { preset: 'custom', from, to: to && DAY.test(to) ? to : from };
  const preset = searchParams.get('range');
  return { preset: RESPONDED_PRESETS.some((p) => p.value === preset) ? preset : 'yesterday', from: null, to: null };
}

/** API params for a range state. */
const apiParams = (value) => (value.preset === 'custom' ? { from: value.from, to: value.to } : { range: value.preset });

const fmtTime = (iso) => (iso ? dayjs(iso).format('DD MMM YYYY, hh:mm A') : '—');
const HOW = { form: 'details form', complete_cv: 'complete CV, never asked' };

/**
 * @param {{ value: { preset: string, from: string|null, to: string|null }, onChange: (next: object) => void,
 *   status?: 'open'|'closed'|'all', mrfId?: number|null, onOpenRole?: (mrfId: number) => void }} props
 *   status: the board's switch; mrfId: one position only (U10c)
 */
export default function RespondedByJdPanel({ value, onChange, status = 'open', mrfId = null, onOpenRole }) {
  const navigate = useNavigate();
  const single = mrfId != null;
  // A string, so the fetch runs only when the range, the switch or the position really changes.
  const paramsKey = useMemo(
    () => JSON.stringify({ ...apiParams(value), ...(single ? { mrf: mrfId } : { status }) }),
    [value, status, single, mrfId],
  );
  const [state, setState] = useState({ loading: true, error: false, data: null });
  const [pickedStart, setPickedStart] = useState(null);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: false }));
    pipelineService.getRespondedByJd(JSON.parse(paramsKey))
      .then((res) => { if (alive) setState({ loading: false, error: false, data: res.data?.data || res.data }); })
      .catch(() => { if (alive) setState({ loading: false, error: true, data: null }); });
    return () => { alive = false; };
  }, [paramsKey]);

  const d = state.data;
  const groups = d?.groups || [];
  const noJd = groups.find((g) => g.mrf_id === null)?.count || 0;
  const label = d?.range?.label;
  const picker = d?.range?.from ? [dayjs(d.range.from), dayjs(d.range.to)] : null;

  const candidateList = (candidates) => (
    <List
      size="small"
      dataSource={candidates}
      pagination={candidates.length > 25 ? { pageSize: 25, size: 'small' } : false}
      locale={{ emptyText: <Empty description={label ? `Nobody responded to this position · ${label}` : 'Nobody responded'} /> }}
      renderItem={(c) => (
        <List.Item
          actions={[<Button key="open" type="link" size="small" onClick={() => navigate(`/candidates/${c.cv_id}`)}>Profile →</Button>]}
          data-testid="responded-candidate"
        >
          <List.Item.Meta
            title={c.name}
            description={(
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                Responded {fmtTime(c.responded_at)} · {HOW[c.how] || HOW.form}
              </Text>
            )}
          />
        </List.Item>
      )}
    />
  );

  const columns = [
    {
      title: 'JD',
      key: 'title',
      render: (_, g) => (g.mrf_id === null
        ? <Text type="secondary" italic>{g.title}</Text>
        : (
          <Space size={8} wrap>
            <Text strong>{g.title}</Text>
            <Tag style={{ borderRadius: 12, margin: 0 }}>MRF-{g.mrf_id}</Tag>
            {onOpenRole && (
              <Button
                type="link"
                size="small"
                style={{ padding: 0, height: 'auto' }}
                onClick={(e) => { e.stopPropagation(); onOpenRole(g.mrf_id); }}
                data-testid={`responded-open-role-${g.mrf_id}`}
              >
                Role view →
              </Button>
            )}
          </Space>
        )),
    },
    {
      title: 'Responded',
      dataIndex: 'count',
      key: 'count',
      align: 'right',
      width: 150,
      render: (n) => <Text strong>{n}</Text>,
    },
  ];

  return (
    <div data-testid="responded-view">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
        {d && single && (
          <Text type="secondary" style={{ fontSize: 13 }} data-testid="responded-summary">
            <strong>{d.total}</strong> {d.total === 1 ? 'candidate' : 'candidates'} responded to this position
            {label ? ` · ${label}` : ''}
          </Text>
        )}
        {d && !single && (
          <Text type="secondary" style={{ fontSize: 13 }} data-testid="responded-summary">
            <strong>{d.total}</strong> {d.total === 1 ? 'candidate' : 'candidates'} responded across <strong>{d.jd_count}</strong> {d.jd_count === 1 ? 'JD' : 'JDs'}
            {noJd ? ` · ${noJd} with no JD yet` : ''}
            {label ? ` · ${label}` : ''}
          </Text>
        )}
        {!d && <span />}
        <Space size={10} wrap>
          <Segmented
            value={value.preset === 'custom' ? null : value.preset}
            onChange={(preset) => onChange({ preset, from: null, to: null })}
            options={RESPONDED_PRESETS}
            data-testid="responded-presets"
          />
          <DatePicker.RangePicker
            value={value.preset === 'custom' ? picker : null}
            onChange={(v) => {
              if (!v?.[0] || !v?.[1]) { onChange({ preset: 'yesterday', from: null, to: null }); return; }
              if (v[1].diff(v[0], 'day') + 1 > MAX_RESPONDED_DAYS) { message.warning(`Pick up to ${MAX_RESPONDED_DAYS} days.`); return; }
              onChange({ preset: 'custom', from: v[0].format('YYYY-MM-DD'), to: v[1].format('YYYY-MM-DD') });
            }}
            onCalendarChange={(dates, _s, info) => { if (info?.range === 'start') setPickedStart(dates?.[0] ?? null); }}
            onOpenChange={(open) => { if (!open) setPickedStart(null); }}
            format="DD MMM YYYY"
            allowClear
            disabledDate={(day) => day && (day.isAfter(dayjs(), 'day') || (pickedStart && day.isBefore(pickedStart, 'day')))}
            aria-label="Responded dates"
            data-testid="responded-picker"
          />
        </Space>
      </div>

      {state.error && <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Who responded could not be loaded. Try again." />}

      {single ? (
        <div style={{ opacity: state.loading ? 0.6 : 1 }} data-testid="responded-role-list">
          {candidateList(groups.find((g) => String(g.mrf_id) === String(mrfId))?.candidates || [])}
        </div>
      ) : (
        <Table
          rowKey={(g) => (g.mrf_id === null ? 'none' : String(g.mrf_id))}
          dataSource={groups}
          columns={columns}
          loading={state.loading}
          pagination={groups.length > 20 ? { pageSize: 20 } : false}
          expandable={{ expandRowByClick: true, expandedRowRender: (g) => candidateList(g.candidates) }}
          locale={{ emptyText: <Empty description={label ? `Nobody responded · ${label}` : 'Nobody responded'} /> }}
          data-testid="responded-table"
        />
      )}
      <Text type="secondary" style={{ fontSize: 12 }}>
        {single
          ? 'Same rules and dates as Open Positions › Responded, so this count equals the position\'s Responded column for the same dates.'
          : <>Each JD&apos;s count equals its Responded column for the same dates. A candidate linked to two JDs is under both. &quot;No JD yet&quot;: not linked to any position.</>}
      </Text>
    </div>
  );
}
