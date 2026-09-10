/**
 * AppPane — the language applied to three real ATS screens.
 *
 * Swatches do not settle a design argument; screens do. These three are rebuilt with
 * real-shaped data because they are the three patterns the other 21 routes are made
 * of, and because judging "does this feel modern" on a page of buttons is not the
 * same question as judging it on a dashboard.
 *
 *   Dashboard   hero + KPI row + chart card + activity feed  — the ceiling
 *   List        search + dense table + row actions + empty   — /candidates
 *   Detail      record header + panels + a presented Sheet   — /candidates/:id
 *
 * The data is fixed and local. This route never calls the API: it has to render
 * identically every time so a visual change is attributable to the design and not to
 * whatever the backend happened to return, and it must work with no backend running.
 */
import { useState } from 'react';
import {
  TeamOutlined, FileTextOutlined, CheckCircleOutlined, CalendarOutlined,
  SearchOutlined, MailOutlined, EditOutlined, PlusOutlined, FilterOutlined,
} from '@ant-design/icons';
import { Input, Tag, Avatar, Select } from 'antd';
import AmbientBackdrop from '../../components/common/AmbientBackdrop';
import {
  Button, Surface, PageShell, PageHeader, StatTile, DataTable, Sheet, Segmented,
} from '../../ui';

const CANDIDATES = [
  { key: 1, name: 'Priya Raman', role: 'Senior Data Engineer', stage: 'Interview', score: 88, owner: 'A. Chen' },
  { key: 2, name: 'Marcus Bell', role: 'Platform Engineer', stage: 'Screening', score: 74, owner: 'A. Chen' },
  { key: 3, name: 'Sofia Almeida', role: 'Senior Data Engineer', stage: 'Offer', score: 92, owner: 'R. Iyer' },
  { key: 4, name: 'Dan Okoro', role: 'QA Automation', stage: 'Interview', score: 81, owner: 'R. Iyer' },
  { key: 5, name: 'Wei Zhang', role: 'Platform Engineer', stage: 'Screening', score: 69, owner: 'A. Chen' },
];

const STAGE_TONE = { Screening: 'default', Interview: 'processing', Offer: 'success' };

const ACTIVITY = [
  { who: 'Sofia Almeida', what: 'moved to Offer', when: '12m ago', accent: 'success' },
  { who: 'Marcus Bell', what: 'completed the assessment', when: '48m ago', accent: 'info' },
  { who: 'Priya Raman', what: 'interview scheduled for Thursday', when: '2h ago', accent: 'brand' },
  { who: 'Dan Okoro', what: 'scorecard submitted by R. Iyer', when: '4h ago', accent: 'brand' },
];

/* A chart drawn as bars rather than pulled from Recharts: this pane must not depend
   on chart-library styling to answer "does the surface read correctly", and a fixed
   series keeps the screenshot stable across renders. */
const TREND = [38, 52, 44, 61, 58, 73, 69, 84, 79, 91, 86, 97];

/** Labelled points so the sparkline hover can name the day rather than show a bare
 *  number. One series is deliberately FLAT — a genuine zero week is information, and
 *  the band has to keep its silhouette on a quiet metric rather than looking broken. */
const spark = (vals, from = 1) => vals.map((v, i) => ({ label: `Day ${from + i}`, value: v }));

const SPARKS = {
  candidates: spark([4, 7, 5, 9, 6, 11, 8, 14, 10, 16, 12, 19]),
  mrfs: spark([2, 3, 2, 4, 3, 3, 5, 4, 6, 5, 7, 6]),
  uploads: spark([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  offers: spark([1, 0, 2, 1, 3, 2, 4, 3, 5, 4, 6, 5]),
};

function DashboardScreen() {
  const [range, setRange] = useState('30');

  return (
    <PageShell width="standard">
      <PageHeader
        hero
        /* `md` (--fs-title-1, 32px), not `lg` (--fs-display, 42px) — changed
           2026-08-31, and changed HERE FIRST because this pane is the specification.

           The greeting at display size was the largest type in the product, above
           every real page title, while the KPIs below it are the screen's actual
           subject. It was also load-bearing on layout: at 42px the title measured
           499px, which is what pushed the hero's control block onto a second row on
           every viewport under 1500px and left a 566x112px hole in its lower left.
           At 32px the band holds one row down to 1440 and drops from 280px to 164px.

           parity.mjs compares this mock against /dashboard, so the two must move
           together — it failed on exactly this property when the app changed first,
           which is the check doing its job. */
        size="md"
        eyebrow={<><span className="ui-live-dot" aria-hidden /> AAPNA ATS Platform</>}
        title="Good evening, Harish Mopuri 👋"
        subtitle="Here's what's happening across your recruitment pipeline."
        actions={(
          <>
            <Button emphasis="soft" icon={<SearchOutlined />}>Search… <kbd className="dl-kbd">⌘K</kbd></Button>
            <Button emphasis="solid" icon={<PlusOutlined />}>New MRF Request</Button>
            {/* The second CTA. v1's hero had an `actions` slot only, so this and the
                filter row below both silently disappeared when it was rebuilt. */}
            <Button emphasis="soft" icon={<FilterOutlined />}>Screen Candidates</Button>
          </>
        )}
        filters={(
          <>
            <span className="ui-page-header__filter-label">Period</span>
            <Segmented
              aria-label="Period"
              value={range}
              onChange={setRange}
              options={[
                { value: '7', label: '7d' },
                { value: '30', label: '30d' },
                { value: '90', label: '90d' },
              ]}
            />
            <Select
              defaultValue=""
              style={{ minWidth: 168 }}
              options={[
                { value: '', label: 'All roles' },
                { value: 'sde', label: 'Senior Data Engineer' },
                { value: 'pe', label: 'Platform Engineer' },
              ]}
            />
          </>
        )}
      />

      <div className="dl-grid dl-grid--4">
        <StatTile
          icon={<TeamOutlined />} label="Total candidates" value={197} accent="brand"
          delta={{ value: -57 }} footnote="28 added in the last 30 days"
          sparkline={SPARKS.candidates} sparklineUnit="added"
          sparklineSummary="Candidates added per day over the selected period"
          interactive bloom
        />
        <StatTile
          icon={<FileTextOutlined />} label="Active MRFs" value={19} accent="info"
          delta={{ value: 4 }} footnote="0 awaiting approval"
          sparkline={SPARKS.mrfs} sparklineUnit="opened"
          sparklineSummary="Requisitions opened per day"
          interactive
        />
        <StatTile
          icon={<CalendarOutlined />} label="Today's uploads" value={0} accent="warning"
          delta={{ value: 0 }} footnote="28 in the last 30 days"
          sparkline={SPARKS.uploads} sparklineUnit="uploaded"
          sparklineSummary="CVs uploaded per day — flat means a genuinely quiet period"
          interactive
        />
        <StatTile
          icon={<CheckCircleOutlined />} label="Shortlisted" value={77} accent="success"
          delta={{ value: 8 }} footnote="39% of sourced"
          sparkline={SPARKS.offers} sparklineUnit="shortlisted"
          sparklineSummary="Candidates shortlisted per day"
          interactive
        />
      </div>

      <div className="dl-grid dl-grid--2-1 dl-mt-lg">
        <Surface tier={2} padding="relaxed">
          <div className="dl-panel-head">
            <div>
              <div className="t-title-3">Hiring trends</div>
              <div className="t-footnote dl-muted">Candidates entering the pipeline, last 12 weeks</div>
            </div>
            <Segmented aria-label="Range" value="90" onChange={() => {}} options={[
              { value: '7', label: '7d' }, { value: '30', label: '30d' }, { value: '90', label: '90d' },
            ]}
            />
          </div>
          <div className="dl-chart" role="img" aria-label="Bar chart of candidates entering the pipeline over twelve weeks, trending upward.">
            {TREND.map((v, i) => (
              <span
                key={i}
                className="dl-chart__bar"
                style={{ height: `${v}%`, '--ui-delay': `${i * 40}ms` }}
              />
            ))}
          </div>
        </Surface>

        <Surface tier={2} padding="relaxed">
          <div className="t-title-3">Live activity</div>
          <div className="dl-feed">
            {ACTIVITY.map((a) => (
              <Surface key={a.who + a.when} tier={3} material="thin" padding="compact" className="dl-feed__row">
                <span className={`dl-dot dl-dot--${a.accent}`} aria-hidden />
                <div>
                  <div className="t-subhead"><strong>{a.who}</strong> {a.what}</div>
                  <div className="t-footnote dl-muted">{a.when}</div>
                </div>
              </Surface>
            ))}
          </div>
        </Surface>
      </div>
    </PageShell>
  );
}

function ListScreen() {
  const [q, setQ] = useState('');
  const rows = CANDIDATES.filter((c) => (
    !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.role.toLowerCase().includes(q.toLowerCase())
  ));

  const columns = [
    {
      title: 'Candidate',
      dataIndex: 'name',
      render: (name) => (
        <div className="dl-cell-person">
          <Avatar size={30} className="dl-avatar">{name.split(' ').map((p) => p[0]).join('')}</Avatar>
          <span className="t-subhead">{name}</span>
        </div>
      ),
    },
    { title: 'Role', dataIndex: 'role' },
    {
      title: 'Stage',
      dataIndex: 'stage',
      render: (s) => <Tag color={STAGE_TONE[s]} bordered={false}>{s}</Tag>,
    },
    {
      title: 'Score',
      dataIndex: 'score',
      align: 'right',
      render: (n) => <span className="ui-table__num">{n}</span>,
    },
    { title: 'Owner', dataIndex: 'owner' },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: () => (
        <div className="dl-row dl-row--tight">
          <Button size="sm" emphasis="text" iconOnly icon={<MailOutlined />} aria-label="Email" />
          <Button size="sm" emphasis="text" iconOnly icon={<EditOutlined />} aria-label="Edit" />
        </div>
      ),
    },
  ];

  return (
    <PageShell width="standard">
      <PageHeader
        title="Search Candidates"
        subtitle="Every candidate across every open requisition."
        actions={<Button emphasis="solid" icon={<PlusOutlined />}>Add candidate</Button>}
      />

      <Surface tier={2} padding="relaxed" bloom>
        <div className="dl-search">
          <Input
            size="large"
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Search by name, role or skill…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button emphasis="soft" icon={<FilterOutlined />}>Filters</Button>
          <Button emphasis="solid">Search</Button>
        </div>
      </Surface>

      <div className="dl-mt-lg">
        <DataTable
          columns={columns}
          dataSource={rows}
          pagination={false}
          empty={{
            title: 'No candidates match that search',
            body: 'Try a shorter phrase, or clear the filters to see everyone in the pipeline.',
            action: { label: 'Clear search', onClick: () => setQ('') },
          }}
        />
      </div>
    </PageShell>
  );
}

function DetailScreen() {
  const [open, setOpen] = useState(false);

  return (
    <PageShell width="narrow">
      <PageHeader
        eyebrow="Senior Data Engineer"
        title="Priya Raman"
        subtitle="In the Interview stage since 12 August. Owned by A. Chen."
        actions={(
          <>
            <Button emphasis="soft" icon={<MailOutlined />}>Email</Button>
            <Button emphasis="solid" onClick={() => setOpen(true)}>Advance stage</Button>
          </>
        )}
      />

      <div className="dl-grid dl-grid--2">
        <Surface tier={2} padding="relaxed">
          <div className="t-title-3">Assessment</div>
          <div className="dl-kv">
            {[['Overall', '88'], ['Aptitude', '91'], ['SQL', '86'], ['Python', '84']].map(([k, v]) => (
              <div className="dl-kv__row" key={k}>
                <span className="t-subhead dl-muted">{k}</span>
                <span className="t-metric-sm">{v}</span>
              </div>
            ))}
          </div>
        </Surface>

        <Surface tier={2} padding="relaxed">
          <div className="t-title-3">Timeline</div>
          <div className="dl-feed dl-mt">
            {['Applied 2 Aug', 'Screened 6 Aug', 'Assessment 9 Aug', 'Interview 12 Aug'].map((t, i) => (
              <div className="dl-step" key={t}>
                <span className={`dl-dot ${i === 3 ? 'dl-dot--brand' : 'dl-dot--muted'}`} aria-hidden />
                <span className="t-subhead">{t}</span>
              </div>
            ))}
          </div>
        </Surface>
      </div>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Advance to Offer"
        size="md"
        footer={(
          <div className="dl-row dl-row--end">
            <Button emphasis="text" onClick={() => setOpen(false)}>Cancel</Button>
            <Button emphasis="solid" onClick={() => setOpen(false)}>Advance</Button>
          </div>
        )}
      >
        <p className="t-body">
          Priya Raman will move from <strong>Interview</strong> to <strong>Offer</strong>.
          The hiring manager is notified and the offer workflow starts.
        </p>
        <Surface tier={3} material="thin" padding="compact" className="dl-mt">
          <span className="t-footnote dl-muted">
            This is the tier-4 overlay — the one content surface that blurs, because
            it is transient and sits above everything.
          </span>
        </Surface>
      </Sheet>
    </PageShell>
  );
}

const SCREENS = {
  dashboard: DashboardScreen,
  list: ListScreen,
  detail: DetailScreen,
};

export default function AppPane() {
  const [screen, setScreen] = useState('dashboard');
  const Screen = SCREENS[screen];

  return (
    <div>
      <div className="dl-screen-switch">
        <Segmented
          aria-label="Screen"
          value={screen}
          onChange={setScreen}
          options={[
            { value: 'dashboard', label: 'Dashboard' },
            { value: 'list', label: 'List / table' },
            { value: 'detail', label: 'Detail + sheet' },
          ]}
        />
      </div>

      {/* THE REAL AmbientBackdrop, not a copy.
          v1 hand-copied four aurora gradients here and nothing else — no rotor
          watermark, no grain. That was most of why the glass read as dull and the
          design read as static: a translucent surface over a flat ground is just a
          grey rectangle, and the only continuously-moving things in the shipped app
          (the 140s rotor, the 26s aurora breathe) were both absent.

          `ats-v3` is what activates it — see the scope note in aurora-glass.css.
          Using the component means what is being judged here is what will ship. */}
      <div className="dl-stage ats-v3">
        <AmbientBackdrop />
        <div className="dl-stage__content" key={screen}>
          <Screen />
        </div>
      </div>
    </div>
  );
}
