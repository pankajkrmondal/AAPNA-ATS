/**
 * OpenPositionsPulse — the Dashboard's "Open positions · last 7 days" strip
 * (L06, approved design 22 Oct 2026). One card per open MRF, worst health
 * first: health dot, applicants per day (sparkline), applied against the week
 * before, in pipeline, and how many things need attention. A card opens that
 * role's view in Analytics.
 *
 * Always the last 7 days, whatever range the Dashboard shows.
 * Data: GET /api/dashboard/open-positions (passed in by Dashboard.jsx).
 */
import { Card, Empty, Skeleton, Typography } from 'antd';
import MetricInfo from '../common/MetricInfo';
import Sparkline from './Sparkline';
import { Delta, HealthDot, roleAnalyticsLink } from '../analytics/openPositionsShared';

const { Title, Text } = Typography;

/**
 * @param {{ data: { summary: object, rows: Array }|null, loading: boolean, onNavigate: (url: string) => void }} props
 */
export default function OpenPositionsPulse({ data, loading, onNavigate }) {
  const rows = data?.rows || [];
  return (
    <Card bordered={false} className="glass-card dash-chart-card" styles={{ body: { padding: 22 } }} data-testid="open-positions-pulse">
      <div className="dash-card-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Title level={5} style={{ margin: 0 }}>Open positions · last 7 days <MetricInfo metric="opHealth" size={12} /></Title>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            Always the last 7 days, whatever the range above
            {data?.summary ? ` · ${data.summary.at_risk} at risk, ${data.summary.watch} watch` : ''}
          </Text>
        </div>
        <span className="dash-card-link" onClick={() => onNavigate?.('/analytics?tab=open')} role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onNavigate?.('/analytics?tab=open'); }}>
          All open positions in Analytics →
        </span>
      </div>
      {loading && !data ? <Skeleton active paragraph={{ rows: 3 }} style={{ marginTop: 12 }} /> : null}
      {!loading && !rows.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No open positions" /> : null}
      {rows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12, marginTop: 14 }}>
          {rows.slice(0, 10).map((r) => (
            <button
              type="button"
              key={r.mrf_id}
              onClick={() => onNavigate?.(roleAnalyticsLink(r.mrf_id))}
              className="panel-shell"
              style={{
                textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'var(--text)', background: 'var(--ink-2)',
                padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6,
              }}
              data-testid={`pulse-card-${r.mrf_id}`}
            >
              <HealthDot health={r.health} />
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <strong style={{ fontSize: 14, lineHeight: 1.3 }}>{r.role}</strong>
                <Text type="secondary" style={{ fontSize: 12 }}>{r.ref} · {r.days_open ?? '–'} days open</Text>
              </span>
              <Sparkline
                data={(r.daily || []).map((d) => ({ label: d.day.slice(5).split('-').reverse().join('/'), value: d.value }))}
                height={34}
                unit="applied"
                summary={`Applicants per day, last 7 days: ${(r.daily || []).map((d) => d.value).join(', ')}`}
              />
              <span style={{ fontSize: 12.5 }}>
                <strong style={{ fontSize: 16 }}>{r.applied}</strong> applied <Delta value={r.applied} previous={r.applied_previous} />
                {' · '}<strong>{r.in_pipeline}</strong> in pipeline
              </span>
              <Text type="secondary" style={{ fontSize: 12, fontWeight: r.attention ? 600 : 400 }}>
                {r.attention ? `${r.attention} need${r.attention === 1 ? 's' : ''} attention` : (r.health?.reasons?.[0] || 'Nothing waiting')}
              </Text>
            </button>
          ))}
        </div>
      )}
      {rows.length > 10 && <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>Showing the 10 that most need attention of {rows.length}.</Text>}
    </Card>
  );
}
