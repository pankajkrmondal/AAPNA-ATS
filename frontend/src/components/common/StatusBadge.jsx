/**
 * StatusBadge — Color-coded status indicator for candidate pipeline stages.
 *
 * @param {{ status: string, style?: object }} props
 */
import { Tag } from 'antd';

/** Map status keys to display labels and colors. */
const STATUS_MAP = {
  new:          { label: 'New',          color: '#2980b9' },
  screening:    { label: 'Screening',    color: '#8fa840' },
  shortlisted:  { label: 'Shortlisted',  color: '#7a922e' },
  interview:    { label: 'Interview',    color: '#d4a017' },
  offered:      { label: 'Offered',      color: '#4a7c59' },
  hired:        { label: 'Hired',        color: '#27ae60' },
  rejected:     { label: 'Rejected',     color: '#c0392b' },
  onhold:       { label: 'On Hold',      color: '#95a5a6' },
  withdrawn:    { label: 'Withdrawn',    color: '#7f8c8d' },
};

export default function StatusBadge({ status, style }) {
  const key = (status || '').toLowerCase().replace(/[\s_-]/g, '');
  const config = STATUS_MAP[key] || { label: status || 'Unknown', color: '#95a5a6' };

  return (
    <Tag
      color={config.color}
      style={{
        borderRadius: 6,
        fontWeight: 600,
        fontSize: 12,
        letterSpacing: '0.02em',
        border: 'none',
        padding: '2px 10px',
        ...style,
      }}
    >
      {config.label}
    </Tag>
  );
}
