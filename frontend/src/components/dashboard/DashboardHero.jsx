/**
 * DashboardHero — the "wow" header: animated gradient-mesh background, greeting with a
 * live clock/pulse, the primary CTAs, and the global controls (date-range, role filter,
 * ⌘K command palette trigger). Presentational — all state is owned by the page.
 *
 * Under Design V2 (`.ats-v2`) this is the flagship glass surface: the mesh below gains a
 * slow conic light sweep and the AAPNA rotor bleeding off the corner. Both are decorative
 * siblings styled entirely in theme/aurora-glass.css — outside that scope they inherit no
 * rules and render as zero-size no-ops, so this markup is safe either way.
 */
import { useEffect, useState } from 'react';
import { Select, Tooltip } from 'antd';
import { PlusOutlined, FilterOutlined, ThunderboltOutlined, SearchOutlined } from '@ant-design/icons';
import { PageHeader, Button, Segmented } from '../../ui';
import MetricInfo from '../common/MetricInfo';

// `Title` and `Text` were AntD Typography, used only by the previous render (kept
// commented at the foot of this file). PageHeader owns the heading and subtitle now, so
// nothing here consumes them — and leaving the destructure in place threw
// "Typography is not defined" at module scope, which took the whole app down.
// const { Title, Text } = Typography;

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
        // `role` FIRST-CLASS, added 2026-08-31. GET /screening/roles returns rows shaped
        // { id, role, number_of_positions, created_at } — the key is `role`, which was the
        // one name missing from this chain. Every row therefore mapped to '' and was
        // filtered out, leaving the Select with nothing but "All roles"; typing any real
        // role showed AntD's "No data" even though the API had returned it. The other keys
        // stay: this list is also fed from candidate-shaped records elsewhere.
        const label = r?.role_name || r?.role || r?.PositionApplied || r?.name || r?.label || (typeof r === 'string' ? r : '');
        return label ? { value: label, label } : null;
      })
      .filter(Boolean),
  ];

  return (
    <PageHeader
      hero
      /* `md` (--fs-title-1, 32px), not `lg` (--fs-display, 42px) — 2026-08-31.
         Two reasons, one measured and one editorial. Measured: at 42px the greeting is
         499px wide and is the single thing that pushed the control block onto a second
         row, which is what left the hero 280px tall with a hole in its lower left.
         Editorial: a greeting was the largest type in the product, larger than every
         real page title, while the KPIs underneath are the actual subject. */
      size="md"
      /* The live dot replaces `.dash-hero__pulse` — same 2.6s halo, but it is a real
         state indicator in the design system rather than one screen's private class. */
      eyebrow={(
        <Tooltip title="You're connected — the dashboard is receiving live pipeline updates.">
          <span>
            <span className="ui-live-dot" aria-hidden />
            {' '}{eyebrow}
          </span>
        </Tooltip>
      )}
      title={(
        <>
          {/* The gradient ink stays on a span, not the heading: background-clip would
              render the waving hand as a transparent blob. */}
          <Tooltip title={`Signed in as ${firstName}. Change how your name appears in Admin Portal › Users.`} placement="bottomLeft">
            <span className="dash-hero__greeting">
              {greetingForNow()}, {firstName}
            </span>
          </Tooltip>{' '}
          👋
        </>
      )}
      subtitle={(
        <>
          Here&rsquo;s what&rsquo;s happening across your recruitment pipeline ·{' '}
          <Tooltip title={`Your local time — ${now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}. Everything on this page is counted in this timezone.`}>
            <span className="mono">
              {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </Tooltip>
        </>
      )}
      actions={(
        <>
          {/* RETIRED 2026-08-31 — the shell topbar now carries this control, on every
              route rather than only the dashboard. Kept per the no-delete rule; note
              there is already a second dead copy of it further down this file.
          <Tooltip title="Jump to any screen or candidate without leaving the keyboard. Shortcut: Ctrl+K.">
            <Button emphasis="soft" icon={<SearchOutlined />} onClick={onOpenCommand}>
              Search... <kbd className="dash-kbd">CmdK</kbd>
            </Button>
          </Tooltip>
          */}

          {isModuleEnabled?.('new_mrf') && (
            <Tooltip title="Raise a new Manpower Requisition Form to start hiring for a role.">
              {/* Was `.cta-primary` plus an inline `height: 44, borderRadius: 10,
                  fontWeight: 600, paddingInline: 20` — a one-off geometry that existed
                  nowhere else in the app and that no other page could have matched.
                  It is now simply the system's solid button. */}
              <Button emphasis="solid" icon={<PlusOutlined />} onClick={onNewMrf}>
                New MRF Request
              </Button>
            </Tooltip>
          )}

          {isModuleEnabled?.('candidate_screening') && (
            <Tooltip title="Open Candidate Screening to match, score and shortlist candidates against a role.">
              <Button emphasis="soft" icon={<FilterOutlined />} onClick={onScreen}>
                Screen Candidates
              </Button>
            </Tooltip>
          )}
        </>
      )}
      /* The two global filters. Both carry hover text saying WHAT THEY CHANGE and,
         just as importantly, what they don't: the card headline numbers are lifetime
         totals and stay put, which otherwise looks like the control is broken. */
      filters={(
        <>
          <Tooltip title="Choose the period the graphs cover. Every card graph and Hiring Trends updates; the big totals on the cards are lifetime figures and stay the same.">
            <span className="ui-page-header__filter-label">
              Period <MetricInfo metric="dateRange" size={11} />
            </span>
          </Tooltip>

          {/* The design system's Segmented, not AntD's: one tab stop for the group and
              arrow-key navigation, which the raw control did not provide. */}
          <Segmented
            aria-label="Period covered by the graphs"
            value={rangeDays}
            onChange={onRangeChange}
            options={[
              { label: <Tooltip title="Show the last 7 days">7d</Tooltip>, value: 7 },
              { label: <Tooltip title="Show the last 30 days">30d</Tooltip>, value: 30 },
              { label: <Tooltip title="Show the last 90 days">90d</Tooltip>, value: 90 },
            ]}
          />

          <Tooltip title={role
            ? `Showing ${role} only. The graphs on this page cover just this role — clear it to see all roles again.`
            : 'Narrow every graph on this page to a single role. The card totals cover all roles either way.'}>
            <Select
              value={role || ''}
              onChange={onRoleChange}
              options={roleOptions}
              style={{ minWidth: 180 }}
              showSearch
              optionFilterProp="label"
              placeholder="Filter by role"
              aria-label="Filter the dashboard graphs by role"
              suffixIcon={<ThunderboltOutlined className="dh-bolt" />}
            />
          </Tooltip>
        </>
      )}
    />
  );
}

// ============================================================================
//    PREVIOUS RENDER — kept per the no-delete rule, 2026-08-29 (Stage 5.2a).
//
//    Replaced because `/dashboard` was measured against the design lab and diverged:
//    this markup produced a 34px title against the lab's 42px, a 22px radius against 24px,
//    and its own 34/38px padding. It was the V2 hero surviving inside a converted route.
//
//    Everything it did is preserved above — the live clock, the ⌘K trigger, the PERIOD
//    MetricInfo, the brand-sourced eyebrow, every tooltip. What changed is that the
//    structure now comes from `PageHeader hero`, so the hero takes the type scale, radius,
//    conic sweep and AAPNA mark from the design system instead of from `.dash-hero__*`.
//
//    Do not restore without re-reading the above; the `.dash-hero__*` rules it depends on
//    are themselves marked unused in theme/index.css.
//
//      return (
//        <div className="dash-hero">
//          <div className="dash-hero__mesh" aria-hidden />
//          <div className="dash-hero__sweep" aria-hidden />
//          {/* The rotor again, but small and crisp at higher opacity — the mark needs to
//              be legible somewhere, not only ghosted across the page behind glass. */}
//          <div className="dash-hero__mark" aria-hidden>
//            <AapnaLogo />
//          </div>
//          <div className="dash-hero__content">
//            <div className="dash-hero__intro">
//              <Tooltip title="You're connected — the dashboard is receiving live pipeline updates.">
//                <span className="dash-hero__eyebrow">
//                  <span className="dash-hero__pulse" />
//                  {eyebrow}
//                </span>
//              </Tooltip>
//              <Title level={2} className="dash-hero__title">
//                {/* The gradient ink is on a span, not the heading: background-clip
//                    would render the waving hand as a transparent blob. */}
//                <Tooltip title={`Signed in as ${firstName}. Change how your name appears in Admin Portal › Users.`} placement="bottomLeft">
//                  <span className="dash-hero__greeting">
//                    {greetingForNow()}, {firstName}
//                  </span>
//                </Tooltip>{' '}
//                👋
//              </Title>
//              <Text className="dash-hero__subtitle">
//                Here's what's happening across your recruitment pipeline ·{' '}
//                <Tooltip title={`Your local time — ${now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}. Everything on this page is counted in this timezone.`}>
//                  <span className="mono">
//                    {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
//                  </span>
//                </Tooltip>
//              </Text>
//            </div>
//
//            <div className="dash-hero__actions">
//              <Space size={10} wrap>
//                <Tooltip title="Jump to any screen or candidate without leaving the keyboard. Shortcut: Ctrl+K (⌘K on Mac).">
//                  <Button
//                    icon={<SearchOutlined />}
//                    onClick={onOpenCommand}
//                    className="dash-hero__cmd"
//                  >
//                    Search… <kbd className="dash-kbd">⌘K</kbd>
//                  </Button>
//                </Tooltip>
//                {isModuleEnabled?.('new_mrf') && (
//                  <Tooltip title="Raise a new Manpower Requisition Form to start hiring for a role.">
//                    <Button
//                      type="primary"
//                      icon={<PlusOutlined />}
//                      className="cta-primary"
//                      onClick={onNewMrf}
//                      style={{ height: 44, borderRadius: 10, fontWeight: 600, paddingInline: 20 }}
//                    >
//                      New MRF Request
//                    </Button>
//                  </Tooltip>
//                )}
//                {isModuleEnabled?.('candidate_screening') && (
//                  <Tooltip title="Open Candidate Screening to match, score and shortlist candidates against a role.">
//                    <Button
//                      icon={<FilterOutlined />}
//                      className="cta-secondary"
//                      onClick={onScreen}
//                      style={{ height: 44, borderRadius: 10, fontWeight: 600, paddingInline: 20, borderColor: 'var(--gold)', color: 'var(--gold)' }}
//                    >
//                      Screen Candidates
//                    </Button>
//                  </Tooltip>
//                )}
//              </Space>
//
//              {/* The two global filters. Both carry hover text saying WHAT THEY CHANGE and,
//                  just as importantly, what they don't: the card headline numbers are
//                  lifetime totals and stay put, which otherwise looks like the control is
//                  broken. Each period option is labelled in full — "7d" alone is jargon. */}
//              <Space size={10} wrap className="dash-hero__filters">
//                <Tooltip title="Choose the period the graphs cover. Every card graph and Hiring Trends updates; the big totals on the cards are lifetime figures and stay the same.">
//                  <span className="dash-hero__filter-label">
//                    Period <MetricInfo metric="dateRange" size={11} />
//                  </span>
//                </Tooltip>
//                <Segmented
//                  value={rangeDays}
//                  onChange={onRangeChange}
//                  options={[
//                    { label: <Tooltip title="Show the last 7 days">7d</Tooltip>, value: 7 },
//                    { label: <Tooltip title="Show the last 30 days">30d</Tooltip>, value: 30 },
//                    { label: <Tooltip title="Show the last 90 days">90d</Tooltip>, value: 90 },
//                  ]}
//                />
//                <Tooltip title={role
//                  ? `Showing ${role} only. The graphs on this page cover just this role — clear it to see all roles again.`
//                  : 'Narrow every graph on this page to a single role. The card totals cover all roles either way.'}>
//                  <Select
//                    value={role || ''}
//                    onChange={onRoleChange}
//                    options={roleOptions}
//                    style={{ minWidth: 180 }}
//                    showSearch
//                    optionFilterProp="label"
//                    placeholder="Filter by role"
//                    aria-label="Filter the dashboard graphs by role"
//                    suffixIcon={<ThunderboltOutlined style={{ color: 'var(--gold)' }} />}
//                  />
//                </Tooltip>
//              </Space>
//            </div>
//          </div>
//        </div>
//      );
//    }
