/**
 * LatestUploads — a compact five-row strip of the newest candidates.
 *
 * Replaces the dashboard's full paginated candidate table. Two reasons that table
 * did not belong here:
 *  - It duplicated the job of /candidates, which is the records surface, and it did
 *    it worse: ten rows behind its own pagination, no search, no filters.
 *  - It ran a second paginated fetch on every dashboard visit purely for decoration.
 *
 * This uses `/dashboard/recent-uploads`, which already existed and was purpose-built
 * for exactly this (it even returns relative "2 hours ago" timestamps) but was never
 * called by any screen. Everything beyond a glance is one click away in Search
 * Candidate.
 */
import { useEffect, useState } from 'react';
import { Card, Typography, Skeleton, Empty } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import dashboardService from '../../services/dashboardService';
import MetricInfo from '../common/MetricInfo';

const { Title, Text } = Typography;

/** Initials for the avatar chip, from a display name. */
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

export default function LatestUploads({ onNavigate }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    dashboardService.getRecentUploads(5)
      .then((res) => {
        if (cancelled) return;
        const list = res.data?.data || res.data || [];
        setRows(Array.isArray(list) ? list.slice(0, 5) : []);
      })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <Card bordered={false} className="glass-card dash-chart-card" styles={{ body: { padding: 22 } }}>
      <div className="dash-card-head">
        <div>
          <Title level={5} style={{ margin: 0 }}>
            Latest uploads <MetricInfo metric="latestUploads" />
          </Title>
          <Text type="secondary" style={{ fontSize: 12.5 }}>The five most recent candidates</Text>
        </div>
        <span
          className="dash-card-link"
          role="button"
          tabIndex={0}
          onClick={() => onNavigate('/candidates')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onNavigate('/candidates'); }}
        >
          Search all candidates <ArrowRightOutlined style={{ fontSize: 11 }} />
        </span>
      </div>

      {loading ? (
        <Skeleton active paragraph={{ rows: 4 }} title={false} style={{ marginTop: 16 }} />
      ) : rows.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No uploads yet" style={{ margin: '26px 0' }} />
      ) : (
        <div className="dash-uploads">
          {rows.map((r) => (
            <div
              key={r.key ?? r.email ?? r.name}
              className="dash-uploads__row"
              role="button"
              tabIndex={0}
              onClick={() => onNavigate('/candidates')}
              onKeyDown={(e) => { if (e.key === 'Enter') onNavigate('/candidates'); }}
            >
              <span className="dash-uploads__avatar">{initials(r.name)}</span>
              <span className="dash-uploads__body">
                <span className="dash-uploads__name">{r.name || '—'}</span>
                <span className="dash-uploads__role">{r.position || 'Role not specified'}</span>
              </span>
              <span className="dash-uploads__time mono">{r.uploadedAt || ''}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
