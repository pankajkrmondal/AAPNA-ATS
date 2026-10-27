/**
 * NotShownDrawer — "See the N not shown" on Candidate Screening (L11).
 *
 * "8 recently rejected for this role · 3 meet education, budget and
 * experience · of those, 0 have all 7 mandatory skills — if I wish to see the
 * data, there is no such option." This is that option: the candidates the
 * search left out, nearest misses first (fewest rules failed), each with the
 * rules that removed them in plain words, filterable by rule.
 *
 * Read-only by design (P12's recommended first version): no Shortlist or
 * Reject from here. A recruiter who thinks a rule is wrong fixes the MRF, or
 * opens the profile.
 *
 * Loaded only when opened (React Query, enabled on `open`), so the search
 * itself costs nothing extra.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Drawer, Empty, Segmented, Space, Spin, Tag, Typography } from 'antd';
import screeningService from '../../services/screeningService';
import ExportButton from '../common/ExportButton';
import { fmtDate } from '../../utils/dateFormat';

const { Text } = Typography;

const REASON_COLORS = {
  recentlyRejected: 'red',
  education: 'purple',
  ctc: 'orange',
  experience: 'gold',
  addedWithin: 'default',
  location: 'blue',
  gender: 'default',
  notice: 'cyan',
  position: 'geekblue',
  skills: 'volcano',
};

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {'jd'|'keyword'} props.kind
 * @param {object} props.params - jd: { mrfId, addedWithinDays, taggedOnly }; keyword: { filters }
 * @param {string} [props.contextLabel] - e.g. the role name or "this keyword search"
 */
export default function NotShownDrawer({ open, onClose, kind, params, contextLabel }) {
  const [reason, setReason] = useState('all');
  const paramsKey = JSON.stringify(params || {});
  const query = useQuery({
    queryKey: ['screening-not-shown', kind, paramsKey, reason],
    queryFn: () => screeningService
      .notShown(kind, { ...params, reason: reason === 'all' ? null : reason })
      .then((r) => r.data?.data || r.data),
    enabled: Boolean(open && params),
    staleTime: 60_000,
  });
  // The "All" query carries the per-reason counts for the tabs.
  const allQuery = useQuery({
    queryKey: ['screening-not-shown', kind, paramsKey, 'all'],
    queryFn: () => screeningService.notShown(kind, { ...params, reason: null }).then((r) => r.data?.data || r.data),
    enabled: Boolean(open && params && reason !== 'all'),
    staleTime: 60_000,
  });
  const counts = (reason === 'all' ? query.data : allQuery.data) || query.data;

  const options = useMemo(() => {
    const byReason = counts?.byReason || {};
    const labels = counts?.labels || {};
    return [
      { label: `All (${(counts?.total ?? 0).toLocaleString('en-IN')})`, value: 'all' },
      ...Object.entries(byReason)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => ({ label: `${labels[k] || k} (${Number(n).toLocaleString('en-IN')})`, value: k })),
    ];
  }, [counts]);

  const data = query.data;
  const list = data?.candidates || [];

  return (
    <Drawer
      title={(
        <div>
          <div>Not shown{counts ? `: ${counts.total.toLocaleString('en-IN')} candidate${counts.total === 1 ? '' : 's'}` : ''}</div>
          <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
            Left out of {contextLabel || 'this search'} by its rules · nearest misses first · read-only
          </Text>
        </div>
      )}
      open={open}
      onClose={onClose}
      width={760}
      destroyOnClose
      extra={(
        <ExportButton
          request={(cfg) => screeningService.exportNotShown(kind, { ...params, reason: reason === 'all' ? null : reason }, cfg)}
          fallbackName={kind === 'jd' ? 'AAPNA-ATS_Screening-Not-Shown.csv' : 'AAPNA-ATS_Screening-Keyword-Not-Shown.csv'}
          rowCount={list.length}
          disabled={!list.length}
          label="Export"
          size="small"
        />
      )}
    >
      {data?.note && <Alert type="warning" showIcon message={data.note} style={{ marginBottom: 12 }} />}
      {query.isError && (
        <Alert type="error" showIcon message={query.error?.response?.data?.message || 'Could not load the candidates not shown.'} />
      )}

      {options.length > 1 && (
        <Segmented
          value={reason}
          onChange={setReason}
          options={options}
          style={{ marginBottom: 12, flexWrap: 'wrap' }}
        />
      )}
      {counts && Object.keys(counts.byReason || {}).length > 1 && (
        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 10 }}>
          A candidate can fail several rules, so the rule counts add up to more than the total.
        </Text>
      )}

      {query.isLoading && <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>}
      {!query.isLoading && data && list.length === 0 && (
        <Empty description={reason === 'all' ? 'Nobody was left out: every candidate in scope matched.' : 'No candidates were left out by this rule.'} />
      )}

      {list.map((c) => (
        <div
          key={c.id}
          style={{ border: '1px solid var(--border-light)', borderRadius: 10, padding: '10px 14px', marginBottom: 8, background: 'var(--ink-4, transparent)' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <a href={`/candidates/${c.id}`} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
              {c.name || 'Unnamed candidate'}
            </a>
            <Text type="secondary" style={{ fontSize: 12 }}>{c.createdAt ? `added ${fmtDate(c.createdAt)}` : ''}</Text>
          </div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', margin: '2px 0 6px' }}>
            {[c.positionApplied, c.experience && `${c.experience} exp`, c.expectedCtc && `exp. CTC ${c.expectedCtc}`, c.location, c.noticePeriod && `notice ${c.noticePeriod}`, c.education]
              .filter(Boolean).join(' · ') || '—'}
          </Text>
          <Space size={[6, 6]} wrap>
            {c.reasons.map((text, i) => (
              <Tag key={i} color={REASON_COLORS[c.reasonKeys[i]] || 'default'} style={{ whiteSpace: 'normal' }}>{text}</Tag>
            ))}
          </Space>
        </div>
      ))}

      {data?.capped && (
        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 8 }}>
          Showing the nearest {data.listed} of {(reason === 'all' ? data.total : data.byReason?.[reason] ?? data.total).toLocaleString('en-IN')}.
          Pick a rule above to see its candidates.
        </Text>
      )}
    </Drawer>
  );
}
