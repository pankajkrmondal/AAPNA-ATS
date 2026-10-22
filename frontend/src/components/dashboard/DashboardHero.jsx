/**
 * DashboardHero — the "wow" header: animated gradient-mesh background, greeting with a
 * live clock/pulse, the primary CTAs, and the global controls (date-range, MRF filter,
 * ⌘K command palette trigger). Presentational — all state is owned by the page.
 *
 * Under Design V2 (`.ats-v2`) this is the flagship glass surface: the mesh below gains a
 * slow conic light sweep and the AAPNA rotor bleeding off the corner. Both are decorative
 * siblings styled entirely in theme/aurora-glass.css — outside that scope they inherit no
 * rules and render as zero-size no-ops, so this markup is safe either way.
 */
import { useEffect, useState } from 'react';
import { Button, Select, Segmented, Space, Typography, Tooltip } from 'antd';
import { PlusOutlined, FilterOutlined, ThunderboltOutlined, SearchOutlined } from '@ant-design/icons';
import AapnaLogo from '../common/AapnaLogo';
import MetricInfo from '../common/MetricInfo';
import { mrfOptionLabel } from '../../utils/mrfLabel';

const { Title, Text } = Typography;

function greetingForNow() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardHero({
  firstName = 'there',
  /** Brand-sourced eyebrow text (see brands.js heroEyebrow). */
  eyebrow = 'ATS Platform',
  isModuleEnabled,
  onNewMrf,
  onScreen,
  rangeDays,
  onRangeChange,
  mrfId,
  onMrfChange,
  mrfOptions = [],
  onOpenCommand,
}) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // N36: one entry per open MRF, labelled as in Screening (role · MRF-41 ·
  // date, "Latest" on the newest of a name). The old list read a field the API
  // never sent, so it only ever offered "All roles".
  const mrfSelectOptions = [
    { value: '', label: 'All MRFs' },
    ...mrfOptions.map((r) => ({
      value: String(r.id),
      label: `${mrfOptionLabel(r, { openings: false })}${r.isLatest ? ' · Latest' : ''}`,
    })),
  ];
  const selected = mrfOptions.find((r) => String(r.id) === String(mrfId || ''));

  return (
    <div className="dash-hero">
      <div className="dash-hero__mesh" aria-hidden />
      <div className="dash-hero__sweep" aria-hidden />
      {/* The rotor again, but small and crisp at higher opacity — the mark needs to
          be legible somewhere, not only ghosted across the page behind glass. */}
      <div className="dash-hero__mark" aria-hidden>
        <AapnaLogo />
      </div>
      <div className="dash-hero__content">
        <div className="dash-hero__intro">
          <Tooltip title="You're connected — the dashboard is receiving live pipeline updates.">
            <span className="dash-hero__eyebrow">
              <span className="dash-hero__pulse" />
              {eyebrow}
            </span>
          </Tooltip>
          <Title level={2} className="dash-hero__title">
            {/* The gradient ink is on a span, not the heading: background-clip
                would render the waving hand as a transparent blob. */}
            <Tooltip title={`Signed in as ${firstName}. Change how your name appears in Admin Portal › Users.`} placement="bottomLeft">
              <span className="dash-hero__greeting">
                {greetingForNow()}, {firstName}
              </span>
            </Tooltip>{' '}
            👋
          </Title>
          <Text className="dash-hero__subtitle">
            Here's what's happening across your recruitment pipeline ·{' '}
            <Tooltip title={`Your local time — ${now.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}. Days on this page are counted in India time (IST).`}>
              <span className="mono">
                {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
              </span>
            </Tooltip>
          </Text>
        </div>

        <div className="dash-hero__actions">
          <Space size={10} wrap>
            <Tooltip title="Jump to any screen or candidate without leaving the keyboard. Shortcut: Ctrl+K (⌘K on Mac).">
              <Button
                icon={<SearchOutlined />}
                onClick={onOpenCommand}
                className="dash-hero__cmd"
              >
                Search… <kbd className="dash-kbd">⌘K</kbd>
              </Button>
            </Tooltip>
            {isModuleEnabled?.('new_mrf') && (
              <Tooltip title="Raise a new Manpower Requisition Form to start hiring for a role.">
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  className="cta-primary"
                  onClick={onNewMrf}
                  style={{ height: 44, borderRadius: 10, fontWeight: 600, paddingInline: 20 }}
                >
                  New MRF Request
                </Button>
              </Tooltip>
            )}
            {isModuleEnabled?.('candidate_screening') && (
              <Tooltip title="Open Candidate Screening to match, score and shortlist candidates against a role.">
                <Button
                  icon={<FilterOutlined />}
                  className="cta-secondary"
                  onClick={onScreen}
                  style={{ height: 44, borderRadius: 10, fontWeight: 600, paddingInline: 20, borderColor: 'var(--gold)', color: 'var(--gold)' }}
                >
                  Screen Candidates
                </Button>
              </Tooltip>
            )}
          </Space>

          {/* The two global filters. Both carry hover text saying WHAT THEY CHANGE and,
              just as importantly, what they don't: the card headline numbers are
              lifetime totals and stay put, which otherwise looks like the control is
              broken. Each period option is labelled in full — "7d" alone is jargon. */}
          <Space size={10} wrap className="dash-hero__filters">
            <Tooltip title="Choose the period the graphs cover. Every card graph, Hiring Trends, Talent Insights and the shortlist rate update; the big totals on the cards are lifetime figures and stay the same.">
              <span className="dash-hero__filter-label">
                Period <MetricInfo metric="dateRange" size={11} />
              </span>
            </Tooltip>
            <Segmented
              value={rangeDays}
              onChange={onRangeChange}
              options={[
                { label: <Tooltip title="Show the last 7 days">7d</Tooltip>, value: 7 },
                { label: <Tooltip title="Show the last 30 days">30d</Tooltip>, value: 30 },
                { label: <Tooltip title="Show the last 90 days">90d</Tooltip>, value: 90 },
              ]}
            />
            <Tooltip title={selected
              ? `Showing ${selected.role} (${selected.ref}). Shortlisted and the pipeline graph follow this MRF; candidates added are matched on the role they applied for. Clear it to see everything again.`
              : 'Narrow the page to one MRF. Total Candidates, Active MRFs and the funnel cover everything either way.'}>
              <Select
                value={mrfId ? String(mrfId) : ''}
                onChange={(v) => onMrfChange(v || null)}
                options={mrfSelectOptions}
                style={{ minWidth: 220, maxWidth: 360 }}
                popupMatchSelectWidth={false}
                showSearch
                optionFilterProp="label"
                placeholder="Filter by MRF"
                aria-label="Filter the dashboard by MRF"
                data-testid="dashboard-mrf-filter"
                suffixIcon={<ThunderboltOutlined style={{ color: 'var(--gold)' }} />}
              />
            </Tooltip>
            <MetricInfo metric="roleFilter" size={11} />
          </Space>
        </div>
      </div>
    </div>
  );
}