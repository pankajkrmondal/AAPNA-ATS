/**
 * DashboardHero — the "wow" header: animated gradient-mesh background, greeting with a
 * live clock/pulse, the primary CTAs, and the global controls (date-range, role filter,
 * ⌘K command palette trigger). Presentational — all state is owned by the page.
 */
import { useEffect, useState } from 'react';
import { Button, Select, Segmented, Space, Typography, Tooltip } from 'antd';
import { PlusOutlined, FilterOutlined, ThunderboltOutlined, SearchOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

function greetingForNow() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardHero({
  firstName = 'there',
  isModuleEnabled,
  onNewMrf,
  onScreen,
  rangeDays,
  onRangeChange,
  role,
  onRoleChange,
  roles = [],
  onOpenCommand,
}) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const roleOptions = [
    { value: '', label: 'All roles' },
    ...roles
      .map((r) => {
        const label = r?.role_name || r?.PositionApplied || r?.name || r?.label || (typeof r === 'string' ? r : '');
        return label ? { value: label, label } : null;
      })
      .filter(Boolean),
  ];

  return (
    <div className="dash-hero">
      <div className="dash-hero__mesh" aria-hidden />
      <div className="dash-hero__content">
        <div className="dash-hero__intro">
          <span className="dash-hero__eyebrow">
            <span className="dash-hero__pulse" />
            AAPNA Recruitment Operations
          </span>
          <Title level={2} className="dash-hero__title">
            {greetingForNow()}, {firstName} 👋
          </Title>
          <Text className="dash-hero__subtitle">
            Here's what's happening across your recruitment pipeline ·{' '}
            <span className="mono">
              {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </Text>
        </div>

        <div className="dash-hero__actions">
          <Space size={10} wrap>
            <Tooltip title="Quick search & navigation (⌘K)">
              <Button
                icon={<SearchOutlined />}
                onClick={onOpenCommand}
                className="dash-hero__cmd"
              >
                Search… <kbd className="dash-kbd">⌘K</kbd>
              </Button>
            </Tooltip>
            {isModuleEnabled?.('new_mrf') && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                className="cta-primary"
                onClick={onNewMrf}
                style={{ height: 44, borderRadius: 10, fontWeight: 600, paddingInline: 20 }}
              >
                New MRF Request
              </Button>
            )}
            {isModuleEnabled?.('candidate_screening') && (
              <Button
                icon={<FilterOutlined />}
                className="cta-secondary"
                onClick={onScreen}
                style={{ height: 44, borderRadius: 10, fontWeight: 600, paddingInline: 20, borderColor: 'var(--gold)', color: 'var(--gold)' }}
              >
                Screen Candidates
              </Button>
            )}
          </Space>

          <Space size={10} wrap className="dash-hero__filters">
            <Segmented
              value={rangeDays}
              onChange={onRangeChange}
              options={[
                { label: '7d', value: 7 },
                { label: '30d', value: 30 },
                { label: '90d', value: 90 },
              ]}
            />
            <Select
              value={role || ''}
              onChange={onRoleChange}
              options={roleOptions}
              style={{ minWidth: 180 }}
              showSearch
              optionFilterProp="label"
              suffixIcon={<ThunderboltOutlined style={{ color: 'var(--gold)' }} />}
            />
          </Space>
        </div>
      </div>
    </div>
  );
}