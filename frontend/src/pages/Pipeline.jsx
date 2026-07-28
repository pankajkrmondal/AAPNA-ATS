/**
 * Pipeline.jsx — Phase 3 Module 1: the REAL Interview Pipeline Tracker.
 *
 * Wired to the actual backend (/api/pipeline, pipeline.service.js on the
 * server) — unlike CandidatePipelinePrototype.jsx, this page persists real
 * data, sends real outcome emails via stageNotification.service.js, and
 * writes back to the legacy rpa_cv.FinalStatus / pipeline_status columns.
 *
 * Visual language matches the prototype's v8/v9 board redesign (avatar +
 * left-border status accent instead of stacked pills, stage-type accent bar
 * per column, "Ask the board" search) — reusing the same `.cp-candidate-card`/
 * `.cp-avatar` CSS already in theme/index.css. The NL search box uses the
 * identical mocked local keyword-matching the prototype does (no real AI/LLM
 * call either place) — it only sets the Position/Source/Hold/Stuck filters
 * that are already wired to the real backend.
 *
 * Every value on screen otherwise comes from real data — no mocked
 * scheduling, scorecards, documents, offer flow, or AI features (those stay
 * on the prototype until Modules 2/3 exist for real).
 *
 * Route: /pipeline (behind ModuleRoute moduleKey="recruitment_pipeline").
 * The mock prototype at /candidate-pipeline-prototype stays live alongside
 * this page until RT signs off and the real Tracker is verified end-to-end.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Badge, Card, Checkbox, Empty, Input, Select, Space, Spin, Tag, Tooltip, Typography, App as AntApp,
} from 'antd';
import { LeftOutlined, RightOutlined, RobotOutlined, SearchOutlined, ShopOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';
import pipelineService from '../services/pipeline';
import PipelineDrawer from '../components/pipeline/PipelineDrawer';

const { Text, Title } = Typography;

/** Aging badge thresholds — green -> amber -> red, per 02-BUSINESS-DESIGN.md §1.1. */
const ageColor = (d) => (d <= 5 ? 'green' : d <= 10 ? 'gold' : 'red');

const SOURCE_LABEL = {
  recruiter: 'Recruiter',
  vendor: 'Vendor',
  screening_shortlist: 'Screening Shortlist',
  bulk_excel: 'Bulk Excel',
  email_intake: 'Email Intake',
};
const sourceLabel = (card) => (card.source === 'vendor' ? (card.vendor_email || 'Vendor') : (SOURCE_LABEL[card.source] || card.source));

/** Column accent by real stage_type (rpa_pipeline_stages.stage_type) — same
 * colour intent as the prototype's STAGE_ACCENT, mapped onto the real
 * seeded type strings ('zeko' | 'manual' | 'scheduled_interview' |
 * 'document' | 'offer') rather than the prototype's mock-only ones. */
const STAGE_ACCENT = {
  zeko: 'linear-gradient(90deg, #2f54eb, #5b7ff0)',
  manual: 'linear-gradient(90deg, #13c2c2, #36d6d6)',
  scheduled_interview: 'linear-gradient(90deg, #7a922e, #92a63c)',
  document: 'linear-gradient(90deg, #eb2f96, #f062b4)',
  offer: 'linear-gradient(90deg, #4a7c59, #6ba57d)',
};

const AVATAR_PALETTE = ['#7a922e', '#2f54eb', '#13c2c2', '#eb2f96', '#d4a017', '#4a7c59'];
const initials = (name) => (name || '?').split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const avatarColor = (name) => AVATAR_PALETTE[[...(name || '?')].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR_PALETTE.length];

/**
 * Real card status chip + left-border accent, derived only from fields the
 * backend actually returns — current_stage_status, final_outcome, and (for
 * Zeko stages only) whether a score has synced yet (ready_for_decision).
 * Deliberately a smaller state set than the prototype's 5-chip mock model
 * (pending/invited/await/feedback/hold) since Modules 2/3 (scheduling,
 * scorecards) don't exist yet to honestly support those extra states for
 * non-Zeko stages.
 */
function cardStatus(card) {
  if (card.final_outcome) return { label: card.final_outcome.replace(/_/g, ' '), color: 'default', accent: '#c9cdc7' };
  if (card.current_stage_status === 'rejected') return { label: 'Rejected', color: 'red', accent: '#c0392b' };
  if (card.current_stage_status === 'hold') return { label: 'On Hold', color: 'gold', accent: '#d4a017' };
  if (card.current_stage_status === 'approved') return { label: 'Approved', color: 'green', accent: '#27ae60' };
  if (card.ready_for_decision) return { label: 'Ready for decision', color: 'green', accent: '#27ae60' };
  // Technical rounds: a booked interview reads as "Scheduled" (distinct from the
  // Zeko "Invited"). Both use the same blue accent as the active-but-not-done look.
  if (card.scheduled) return { label: 'Scheduled', color: 'blue', accent: '#5b7ff0' };
  if (card.invited) return { label: 'Invited', color: 'blue', accent: '#5b7ff0' };
  return { label: 'In progress', color: 'blue', accent: '#5b7ff0' };
}

/**
 * Compact 3-segment progress bar under each card — Invite/Entry, Awaiting
 * results, Decision — mirroring the drawer's own 4-stage pipeline states
 * (minus "Entry", which is always done by the time a card exists). Derived
 * only from the same real fields the drawer uses: current_stage_status,
 * invited/scheduled/ready_for_decision, final_outcome — no invented lifecycle.
 */
function cardProgressSegments(card) {
  const decided = card.current_stage_status === 'approved' || card.current_stage_status === 'rejected' || card.current_stage_status === 'hold' || !!card.final_outcome;
  const inviteState = 'done'; // the card exists, so the journey has entered this stage
  // "Awaiting" segment is active once the candidate is invited (Zeko),
  // scheduled (tech rounds), or ready for a decision.
  const waitState = decided ? 'done' : (card.invited || card.scheduled || card.ready_for_decision) ? 'active' : 'pending';
  const resultsState = decided ? 'done' : card.ready_for_decision ? 'active' : 'pending';
  const decisionState = card.current_stage_status === 'rejected'
    ? 'rejected'
    : card.current_stage_status === 'hold'
      ? 'hold'
      : decided ? 'done' : 'pending';
  return [
    { key: 'invite', state: inviteState },
    { key: 'wait', state: waitState },
    { key: 'results', state: resultsState },
    { key: 'decision', state: decisionState },
  ];
}

function CandidateCard({ card, onOpen }) {
  const status = cardStatus(card);
  const segs = cardProgressSegments(card);
  const segTooltip = `Invite: ${segs[0].state} · Awaiting: ${segs[1].state} · Results: ${segs[2].state} · Decision: ${segs[3].state}`;
  return (
    <Card
      size="small"
      hoverable
      onClick={() => onOpen(card.id)}
      className="cp-candidate-card"
      styles={{ body: { padding: '9px 11px' } }}
      style={{ marginBottom: 8, borderInlineStart: `3px solid ${status.accent}` }}
    >
      <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
        <div className="cp-avatar" style={{ background: avatarColor(card.candidate_name) }}>{initials(card.candidate_name)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
            <Text strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {card.candidate_name || 'Unnamed candidate'}
            </Text>
            <Tooltip title="Days in current stage">
              {card.days_in_stage > 10
                ? <Tag color="red" className="tag-attention" style={{ marginInlineEnd: 0, fontSize: 10.5, lineHeight: '16px' }}>{card.days_in_stage}d</Tag>
                : <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{card.days_in_stage}d</Text>}
            </Tooltip>
          </div>
          <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {card.position || 'No position on file'} · {sourceLabel(card)}
          </Text>
          <Space size={4} wrap style={{ marginBottom: 7 }}>
            <Tag color={status.color} style={{ fontSize: 11, marginInlineEnd: 0 }}>{status.label}</Tag>
            {card.concurrent_journeys > 1 && (
              <Tooltip title="Active on more than one MRF at once (Q13)">
                <Tag color="purple" icon={<TeamOutlined />} style={{ fontSize: 11, marginInlineEnd: 0 }}>{card.concurrent_journeys} MRFs</Tag>
              </Tooltip>
            )}
            {card.source === 'vendor' && <ShopOutlined style={{ color: 'var(--text-3)', fontSize: 11 }} />}
          </Space>
          <Tooltip title={segTooltip}>
            <div style={{ display: 'flex', gap: 3 }} aria-label={segTooltip}>
              {segs.map((s) => <div key={s.key} className={`cp-progress-seg cp-progress-seg--${s.state}`} />)}
            </div>
          </Tooltip>
        </div>
      </div>
    </Card>
  );
}

/**
 * Mocked NL → filter resolver for the board search box — identical intent
 * to the prototype's parseNlQuery: keyword-matches against the Position/
 * Source/Hold/Stuck filters that are already wired to the real backend. No
 * real AI/LLM call, same as the prototype — just enough local text parsing
 * to make the "Read as: …" line honest about what it did.
 */
function parseNlQuery(text, positions) {
  const lower = text.toLowerCase();
  let position;
  for (const p of positions) {
    const words = p.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    if (lower.includes(p.toLowerCase()) || words.some((w) => lower.includes(w))) { position = p; break; }
  }
  let source;
  if (/\bvendor\b/.test(lower)) source = 'vendor';
  else if (/\brecruiter\b|\bhr\b/.test(lower)) source = 'recruiter';
  else if (/\bemail\b/.test(lower)) source = 'email_intake';
  const hold = /\bhold\b/.test(lower);
  const stuck = /\bstuck\b|\bblocked\b|\boverdue\b|\baging\b|\blong\b/.test(lower);
  const read = [
    position && `Position = "${position}"`,
    source && `Source = ${SOURCE_LABEL[source]}`,
    hold && 'On Hold only',
    stuck && 'Stuck > 10 days',
  ].filter(Boolean);
  return { position, source, hold, stuck, read: read.length ? read.join(' · ') : 'No filters matched — showing all candidates' };
}

/** One column width (260px card + 12px gap) — how far one arrow click scrolls. */
const COLUMN_STEP = 272;

/**
 * Horizontally scrollable board with floating left/right arrow buttons pinned
 * to the vertical center of the VIEWPORT (position: fixed), so they stay
 * reachable no matter how far down the page has scrolled — the whole point of
 * this over relying on the browser's bottom scrollbar. Each arrow auto-hides
 * when the board is already at that edge, and both hide when nothing overflows.
 */
function BoardScroller({ children }) {
  const scrollRef = useRef(null);
  const [edges, setEdges] = useState({ canLeft: false, canRight: false });
  // Left/right pixel positions to anchor the fixed arrows to the board's edges
  // rather than the raw viewport corners (so they sit just inside the columns).
  const [bounds, setBounds] = useState({ left: 0, right: 0 });

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const overflowing = scrollWidth - clientWidth > 4;
    const canLeft = overflowing && scrollLeft > 4;
    const canRight = overflowing && scrollLeft < scrollWidth - clientWidth - 4;
    // Only set state when a value actually changed — measure() runs on every
    // scroll/resize/layout, so unconditional setState would loop (React #185).
    setEdges((prev) => (prev.canLeft === canLeft && prev.canRight === canRight ? prev : { canLeft, canRight }));

    const rect = el.getBoundingClientRect();
    const left = Math.round(rect.left);
    const right = Math.round(window.innerWidth - rect.right);
    setBounds((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  // Re-measure after each render (column count / width can change), but the
  // change-guarded setters above keep this from looping.
  useLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  const scrollBy = (dir) => {
    scrollRef.current?.scrollBy({ left: dir * COLUMN_STEP, behavior: 'smooth' });
  };

  const arrowStyle = (side) => ({
    position: 'fixed',
    top: '50%',
    transform: 'translateY(-50%)',
    [side]: `${Math.max(bounds[side] + 4, 8)}px`,
    zIndex: 20,
    width: 44,
    height: 44,
    borderRadius: '50%',
    // Brand green gradient + glow (same treatment as the primary buttons), with
    // a white icon so it reads as an action and stands out over the cards.
    border: '2px solid #fff',
    background: 'var(--gradient-primary, linear-gradient(135deg, #7a922e, #92a63c))',
    boxShadow: 'var(--glow-accent, 0 4px 14px rgba(122,146,46,0.30)), 0 2px 8px rgba(0,0,0,0.18)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: 18,
    fontWeight: 700,
  });

  // The arrows are portaled to <body> so their position:fixed is anchored to
  // the true viewport — an ancestor with a `transform` (page-enter animation,
  // MainLayout) would otherwise become their containing block and drop them
  // from the viewport middle.
  const arrows = createPortal(
    <>
      {edges.canLeft && (
        <button
          type="button"
          aria-label="Scroll pipeline stages left"
          onClick={() => scrollBy(-1)}
          style={arrowStyle('left')}
          className="board-scroll-arrow"
        >
          <LeftOutlined />
        </button>
      )}
      {edges.canRight && (
        <button
          type="button"
          aria-label="Scroll pipeline stages right"
          onClick={() => scrollBy(1)}
          style={arrowStyle('right')}
          className="board-scroll-arrow"
        >
          <RightOutlined />
        </button>
      )}
    </>,
    document.body,
  );

  return (
    <>
      {arrows}
      <div
        ref={scrollRef}
        className="stagger-children"
        style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16, alignItems: 'flex-start' }}
      >
        {children}
      </div>
    </>
  );
}

export default function Pipeline() {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [position, setPosition] = useState();
  const [source, setSource] = useState();
  const [onHoldOnly, setOnHoldOnly] = useState(false);
  const [stuckOnly, setStuckOnly] = useState(false);
  const [openPipelineId, setOpenPipelineId] = useState(null);
  const [nlQuery, setNlQuery] = useState('');
  const [nlRead, setNlRead] = useState(null);

  const filters = {
    position,
    source,
    on_hold_only: onHoldOnly ? '1' : undefined,
    stuck_days: stuckOnly ? 10 : undefined,
  };

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['pipeline-board', filters],
    queryFn: async () => {
      const res = await pipelineService.listPipeline(filters);
      return res.data?.data || res.data;
    },
  });

  const refreshBoard = () => queryClient.invalidateQueries({ queryKey: ['pipeline-board'] });

  const positions = useMemo(() => data?.positions || [], [data]);

  const handleNlSearch = (text) => {
    setNlQuery(text);
    if (!text.trim()) {
      setNlRead(null);
      setPosition(undefined);
      setSource(undefined);
      setOnHoldOnly(false);
      setStuckOnly(false);
      return;
    }
    const parsed = parseNlQuery(text, positions);
    setPosition(parsed.position);
    setSource(parsed.source);
    setOnHoldOnly(parsed.hold);
    setStuckOnly(parsed.stuck);
    setNlRead(parsed.read);
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (isError) {
    return (
      <Alert
        type="error"
        showIcon
        message="Failed to load the Pipeline Tracker"
        description={error?.response?.data?.message || error?.message || 'Unknown error.'}
        style={{ margin: 24 }}
      />
    );
  }

  const columns = data?.columns || [];
  const total = data?.total ?? 0;
  const filteredTotal = data?.filteredTotal ?? total;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Interview Pipeline Tracker</Title>
        <Text type="secondary">Live data — candidates enter here when shortlisted from Candidate Screening.</Text>
      </div>

      <Input.Search
        allowClear
        placeholder='Ask the board — e.g. "vendor candidates stuck on hold" (local keyword matching)'
        prefix={<RobotOutlined style={{ color: 'var(--gold, #7a922e)' }} />}
        style={{ maxWidth: 520, marginBottom: 8 }}
        value={nlQuery}
        onChange={(e) => { setNlQuery(e.target.value); if (!e.target.value.trim()) handleNlSearch(''); }}
        onSearch={handleNlSearch}
        enterButton={<SearchOutlined />}
      />
      {nlRead && (
        <div style={{ marginBottom: 10 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <RobotOutlined style={{ marginInlineEnd: 4 }} />Read as: {nlRead}
          </Text>
        </div>
      )}

      <Space wrap style={{ marginBottom: 14 }}>
        <Select
          allowClear
          placeholder="Position"
          style={{ minWidth: 200 }}
          value={position}
          onChange={setPosition}
          options={positions.map((p) => ({ value: p, label: p }))}
        />
        <Select
          allowClear
          placeholder="Source"
          style={{ minWidth: 170 }}
          value={source}
          onChange={setSource}
          options={Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <Checkbox checked={onHoldOnly} onChange={(e) => setOnHoldOnly(e.target.checked)}>On Hold only</Checkbox>
        <Checkbox checked={stuckOnly} onChange={(e) => setStuckOnly(e.target.checked)}>Stuck &gt; 10 days</Checkbox>
        <Text type="secondary">{filteredTotal} of {total} candidates</Text>
      </Space>

      <BoardScroller>
        {columns.map((col) => (
          <div key={col.stage_key} style={{ flex: '0 0 260px' }}>
            <Card
              size="small"
              title={(
                <Space size={6}>
                  <Text style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }} strong>{col.label}</Text>
                  {col.is_optional && <Tag style={{ fontSize: 10 }}>optional</Tag>}
                </Space>
              )}
              extra={<Badge count={col.cards.length} showZero color="#7a922e" />}
              styles={{ body: { padding: 10, background: 'transparent' } }}
              style={{ borderTop: 0, overflow: 'hidden' }}
            >
              <div style={{ height: 3, margin: '-1px -1px 10px', background: STAGE_ACCENT[col.stage_type] || 'var(--border)' }} />
              {col.cards.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No candidates" style={{ margin: '4px 0' }} />
              ) : (
                col.cards.map((card) => (
                  <CandidateCard key={card.id} card={card} onOpen={setOpenPipelineId} />
                ))
              )}
            </Card>
          </div>
        ))}
      </BoardScroller>

      <PipelineDrawer
        pipelineId={openPipelineId}
        onClose={() => setOpenPipelineId(null)}
        onChanged={() => {
          refreshBoard();
          message.success('Pipeline updated.');
        }}
      />
    </div>
  );
}
