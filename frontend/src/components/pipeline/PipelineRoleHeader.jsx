/**
 * PipelineRoleHeader — a slim line above the board when a requisition is
 * chosen in the Position filter (L06): its health, applicants in the last 7
 * days, how many are in the pipeline and what needs attention, with a link to
 * the role's view in Analytics.
 *
 * Data: GET /api/dashboard/open-positions (the same 7-day pulse the Dashboard
 * shows). Renders nothing for a requisition that is not open.
 */
import { useEffect, useState } from 'react';
import { Space, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import dashboardService from '../../services/dashboardService';
import { Delta, HealthDot, roleAnalyticsLink } from '../analytics/openPositionsShared';

const { Text } = Typography;

/** @param {{ mrfId: string|number|null }} props */
export default function PipelineRoleHeader({ mrfId }) {
  const navigate = useNavigate();
  const [row, setRow] = useState(null);

  useEffect(() => {
    if (!mrfId) { setRow(null); return undefined; }
    let alive = true;
    dashboardService.getOpenPositionsPulse()
      .then((res) => {
        const rows = (res.data?.data || res.data)?.rows || [];
        if (alive) setRow(rows.find((r) => String(r.mrf_id) === String(mrfId)) || null);
      })
      .catch(() => { if (alive) setRow(null); });
    return () => { alive = false; };
  }, [mrfId]);

  if (!row) return null;
  return (
    <div
      className="panel-shell"
      style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', padding: '10px 16px', marginBottom: 12, fontSize: 13.5 }}
      data-testid="pipeline-role-header"
    >
      <HealthDot health={row.health} />
      <span><strong>{row.applied}</strong> applied in 7 days <Delta value={row.applied} previous={row.applied_previous} /></span>
      <span><strong>{row.in_pipeline}</strong> in pipeline</span>
      {row.health?.reasons?.length ? <Text type="secondary">{row.health.reasons.join(' · ')}</Text> : null}
      <Space style={{ marginLeft: 'auto' }}>
        <a onClick={() => navigate(roleAnalyticsLink(row.mrf_id))} role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') navigate(roleAnalyticsLink(row.mrf_id)); }}>
          View role analytics →
        </a>
      </Space>
    </div>
  );
}
