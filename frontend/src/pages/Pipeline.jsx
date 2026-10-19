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
import { cloneElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Badge, Button, Card, Checkbox, Dropdown, Input, Select, Space, Tag, Tooltip, Typography, App as AntApp,
} from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined, CheckCircleFilled, ClearOutlined, ImportOutlined, InboxOutlined, LeftOutlined, LockOutlined, PauseCircleOutlined, ReloadOutlined, RightOutlined, RobotOutlined, SearchOutlined, ShopOutlined, SwapOutlined, TeamOutlined, UserOutlined, WarningOutlined } from '@ant-design/icons';
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import pipelineService from '../services/pipeline';
import PipelineDrawer from '../components/pipeline/PipelineDrawer';
import MoveStageModal from '../components/pipeline/MoveStageModal';
import MoveHistoryExport from '../components/pipeline/MoveHistoryExport';
import { canMoveCard, moveBlockReason } from '../components/pipeline/stageMove';
import ReferralChip from '../components/candidates/ReferralChip';
import AssessmentImportModal from '../components/pipeline/AssessmentImportModal';
import ExportButton from '../components/common/ExportButton';
import EmptyState from '../components/common/EmptyState';
import ErrorState from '../components/common/ErrorState';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import { fmtDate, fmtRelative } from '../utils/dateFormat';
import { cardStatus, progressTooltip, STAGE_DESCRIPTIONS } from '../constants/pipelineLabels';
import BoardLegend from '../components/pipeline/BoardLegend';

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
  zeko: 'linear-gradient(90deg, var(--stage-zeko), var(--stage-zeko-2))',
  manual: 'linear-gradient(90deg, var(--stage-manual), var(--stage-manual-2))',
  scheduled_interview: 'linear-gradient(90deg, var(--stage-interview), var(--stage-interview-2))',
  document: 'linear-gradient(90deg, var(--stage-document), var(--stage-document-2))',
  offer: 'linear-gradient(90deg, var(--stage-offer), var(--stage-offer-2))',
};

/* Tokens rather than hexes so the board is legible in dark mode: the dark
   values are lifted, not the same colours at lower alpha, because a 3px rule in
   the light-mode blues all but disappears on the dark board. Defined in
   theme/index.css and shared with CandidatePipelinePrototype.jsx. */
const AVATAR_PALETTE = [
  'var(--avatar-1)', 'var(--avatar-2)', 'var(--avatar-3)',
  'var(--avatar-4)', 'var(--avatar-5)', 'var(--avatar-6)',
];
const initials = (name) => (name || '?').split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const avatarColor = (name) => AVATAR_PALETTE[[...(name || '?')].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR_PALETTE.length];

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

/**
 * Flexible stages (C8): the card's "Move to…" menu — the keyboard / small-screen
 * alternative to dragging, through the same confirmation popup. A locked card
 * shows a lock with the reason instead.
 */
function CardMoveControl({ card, stages, onMoveRequest }) {
  // The button's tooltip must not stay up over the open menu: it sat on top of
  // the menu's items and swallowed the click (found in the T4 browser run).
  const [menuOpen, setMenuOpen] = useState(false);
  const stop = (e) => e.stopPropagation();
  if (!canMoveCard(card)) {
    return (
      <Tooltip title={card.lock?.reason || 'This candidate cannot be moved right now.'}>
        <LockOutlined className="cp-card-lock" onClick={stop} aria-label={`Locked: ${card.lock?.reason || ''}`} data-testid={`card-lock-${card.id}`} />
      </Tooltip>
    );
  }
  // Every stage in board order, the current one included (disabled) so the
  // user sees where the candidate is and which way each option moves them.
  const currentIdx = stages.findIndex((s) => s.stage_key === card.current_stage_key);
  const currentLabel = stages[currentIdx]?.label || card.current_stage_key;
  const items = stages.map((s, i) => {
    const isCurrent = s.stage_key === card.current_stage_key;
    const blocked = !isCurrent && moveBlockReason(card, s.stage_key);
    let marker;
    if (isCurrent) marker = <span className="cp-move-opt__badge cp-move-opt__badge--current">Current</span>;
    else if (blocked) marker = <span className="cp-move-opt__badge cp-move-opt__badge--passed"><CheckCircleFilled /> Passed</span>;
    else marker = i > currentIdx ? <ArrowRightOutlined className="cp-move-opt__dir cp-move-opt__dir--fwd" /> : <ArrowLeftOutlined className="cp-move-opt__dir cp-move-opt__dir--back" />;
    return {
      key: s.stage_key,
      disabled: isCurrent || !!blocked,
      className: `cp-move-item${isCurrent ? ' cp-move-item--current' : ''}${blocked ? ' cp-move-item--passed' : ''}`,
      label: (
        <span className="cp-move-opt" data-testid={isCurrent ? `move-current-${s.stage_key}` : `move-to-${s.stage_key}`}>
          <span className="cp-move-opt__num">{i + 1}</span>
          <span className="cp-move-opt__label">{s.label}</span>
          {marker}
        </span>
      ),
    };
  });
  return (
    // Stops the board's drag sensors (mouse / touch / keyboard) and the card's
    // own click from seeing a press on this button.
    <span onClick={stop} onPointerDown={stop} onMouseDown={stop} onTouchStart={stop} onKeyDown={stop} role="presentation">
      <Dropdown
        trigger={['click']}
        open={menuOpen}
        onOpenChange={setMenuOpen}
        menu={{ items, onClick: ({ key, domEvent }) => { domEvent.stopPropagation(); setMenuOpen(false); onMoveRequest({ card, toStageKey: key }); } }}
        // A framed panel with its own header, so the menu reads as a popup over
        // the board instead of blending into the white cards behind it.
        popupRender={(menu) => (
          <div className="cp-move-menu" data-testid={`card-move-menu-${card.id}`}>
            <div className="cp-move-menu__head">
              <span className="cp-move-menu__icon"><SwapOutlined /></span>
              <div style={{ minWidth: 0 }}>
                <div className="cp-move-menu__title">Move {card.candidate_name || 'candidate'}</div>
                <div className="cp-move-menu__sub">Now in <strong>{currentLabel}</strong></div>
              </div>
            </div>
            {cloneElement(menu, { style: { boxShadow: 'none', background: 'transparent', padding: 6 } })}
            <div className="cp-move-menu__foot">Passed stages cannot be entered again.</div>
          </div>
        )}
      >
        <Tooltip title="Move to…" open={menuOpen ? false : undefined}>
          <Button size="small" type="text" icon={<SwapOutlined />} className="cp-card-move" aria-label="Move to another stage" data-testid={`card-move-${card.id}`} />
        </Tooltip>
      </Dropdown>
    </span>
  );
}

function CandidateCard({ card, onOpen, flexible = false, stages = [], onMoveRequest }) {
  const status = cardStatus(card);
  const segs = cardProgressSegments(card);
  const segTooltip = progressTooltip(segs);
  return (
    <Card
      size="small"
      hoverable
      onClick={() => onOpen(card.id)}
      className="cp-candidate-card"
      data-testid={`pipeline-card-${card.id}`}
      styles={{ body: { padding: '9px 11px' } }}
      // The left border encodes STATUS — it is data, not decoration. It used to
      // be painted here as an inline `borderInlineStart`, which a stylesheet can
      // only beat with `!important`; the hover rule in index.css did exactly
      // that with the `border-color` shorthand and silently wiped the status
      // colour off every hovered card. Passing it as a custom property hands the
      // property to CSS, which can then set the other three sides without ever
      // touching this one. Same pattern as --stat-color / --kpi-color.
      style={{ marginBottom: 8, '--cp-accent': status.accent }}
    >
      <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
        <div className="cp-avatar" style={{ background: avatarColor(card.candidate_name) }}>{initials(card.candidate_name)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
            <Text strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {card.candidate_name || 'Unnamed candidate'}
            </Text>
            <Space size={4} style={{ flexShrink: 0 }}>
              <Tooltip title="Days in current stage">
                {card.days_in_stage > 10
                  ? <Tag color="red" className="tag-attention" style={{ marginInlineEnd: 0, fontSize: 10.5, lineHeight: '16px' }}>{card.days_in_stage}d</Tag>
                  : <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{card.days_in_stage}d</Text>}
              </Tooltip>
              {flexible && onMoveRequest && <CardMoveControl card={card} stages={stages} onMoveRequest={onMoveRequest} />}
            </Space>
          </div>
          <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {card.position || 'No position on file'} · {sourceLabel(card)}{card.owner ? ` · ${card.owner}` : ''}
          </Text>
          <Space size={4} wrap style={{ marginBottom: 7 }}>
            <Tooltip title={status.meaning}>
              <Tag color={status.color} style={{ fontSize: 11, marginInlineEnd: 0 }} data-testid={`card-status-${card.id}`}>{status.label}</Tag>
            </Tooltip>
            {card.concurrent_journeys > 1 && (
              <Tooltip title="Active on more than one MRF at once (Q13)">
                <Tag color="purple" icon={<TeamOutlined />} style={{ fontSize: 11, marginInlineEnd: 0 }}>{card.concurrent_journeys} MRFs</Tag>
              </Tooltip>
            )}
            {/* Still running against a requisition that has already been
                filled — the recruiter is working a role with no opening
                left. Only shown while the journey is genuinely open. */}
            {card.mrf_closed && !card.final_outcome && (
              <Tooltip title="All openings on this requisition are filled — this candidate is still in progress. Continue only if you intend to re-open the role or are holding them as a backup.">
                <Tag color="orange" className="tag-attention" icon={<WarningOutlined />} style={{ fontSize: 11, marginInlineEnd: 0 }}>Role filled</Tag>
              </Tooltip>
            )}
            {/* Held by a recruiter (Q33). Sits next to "Role filled" because
                that is the case it exists for: the role filled underneath this
                candidate and someone chose to hold rather than close them.
                is_paused has been on the card payload all along; nothing wrote
                it until 2026-08-26. */}
            {card.is_paused && !card.final_outcome && (
              <Tooltip title="This journey is paused — interview reminders, occurrence chase-ups and assessment deadline bells are all suspended until it is resumed.">
                <Tag color="orange" icon={<PauseCircleOutlined />} style={{ fontSize: 11, marginInlineEnd: 0 }}>Paused</Tag>
              </Tooltip>
            )}
            {card.source === 'vendor' && <ShopOutlined style={{ color: 'var(--text-3)', fontSize: 11 }} />}
            {/* Recruiter/admin only — this board is behind requireStaff, so a
                vendor never loads it. No referrer name on the board: the chip
                answers "is this a referral?" and the drawer names who. */}
            {card.is_referral && <ReferralChip compact />}
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
/**
 * "Updated 40s ago" — the board's proof that it is genuinely live.
 *
 * Ticks on its own timer rather than off the query, because between the 60s
 * polls nothing re-renders this page, and a label frozen at "just now" for a
 * minute would undercut the very claim it exists to make.
 */
function LastUpdated({ at, refreshing }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  if (refreshing) return <Text type="secondary" style={{ fontSize: 12 }}>Refreshing…</Text>;
  if (!at) return null;

  return <Text type="secondary" style={{ fontSize: 12 }}>Updated {fmtRelative(at)}</Text>;
}

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

/**
 * Flexible stages (C8, phase 5): a card that can be dragged to another column.
 * A locked card cannot be picked up; it shows a lock with the reason instead.
 */
function DraggableCard({ card, children }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `card-${card.id}`,
    data: { card },
    disabled: !canMoveCard(card),
  });
  const movable = canMoveCard(card);
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      // dnd-kit's attributes make the wrapper a keyboard-draggable button. On
      // a locked card they also say aria-disabled="true", which announced the
      // whole card — including its click-to-open — as disabled (found in the
      // T4 browser run), so a locked card gets none of them.
      {...(movable ? attributes : {})}
      tabIndex={movable ? 0 : -1}
      aria-roledescription={movable ? 'draggable candidate card' : undefined}
      className={`cp-card-draggable${isDragging ? ' cp-card-draggable--dragging' : ''}`}
      data-testid={`drag-card-${card.id}`}
      data-locked={movable ? 'false' : 'true'}
    >
      {children}
    </div>
  );
}

/**
 * A board column as a drop target. While a card is dragged, columns it cannot
 * go to (its current stage, stages it already passed — D2) are greyed out and
 * refuse the drop; the column under the pointer is outlined.
 */
function DroppableColumn({ stageKey, activeCard, children }) {
  const blocked = activeCard ? moveBlockReason(activeCard, stageKey) : null;
  const { setNodeRef, isOver } = useDroppable({ id: stageKey, disabled: !activeCard || !!blocked });
  let cls = '';
  if (activeCard) cls = blocked ? 'cp-column-drop--invalid' : `cp-column-drop--valid${isOver ? ' cp-column-drop--over' : ''}`;
  return (
    <div
      ref={setNodeRef}
      className={cls}
      // minWidth 0: a flex item's automatic minimum is its min-content, so one
      // long nowrap line (a vendor email) widened the whole column past 260px
      // — and COLUMN_STEP scrolls by 260+12. The card text already ellipsizes.
      style={{ flex: '0 0 260px', minWidth: 0, borderRadius: 12 }}
      data-testid={`column-${stageKey}`}
      data-drop-state={activeCard ? (blocked ? 'invalid' : 'valid') : 'idle'}
      title={activeCard && blocked ? blocked : undefined}
    >
      {children}
    </div>
  );
}

/**
 * Which column a drop lands in: the one under the POINTER. dnd-kit's default
 * compares the dragged card's rectangle with the columns and skips disabled
 * ones, so a drop on a greyed (passed) column picked the neighbouring column
 * the card overlapped and offered a stage nobody aimed at (found in the T5
 * run). Over a greyed column this returns nothing, so nothing happens. The
 * keyboard sensor has no pointer and keeps the rectangle check.
 */
function boardCollision(args) {
  if (!args.pointerCoordinates) return rectIntersection(args);
  return pointerWithin(args);
}

/**
 * The board after a confirmed move, before the server answers (C8: "the card
 * moves at once and is put back on 409"). Pure, so a refused move can restore
 * the previous snapshot unchanged.
 */
function moveCardInBoard(board, cardId, toKey) {
  if (!board?.columns) return board;
  let moved = null;
  const columns = board.columns.map((c) => ({
    ...c,
    cards: c.cards.filter((x) => {
      if (x.id !== cardId) return true;
      moved = x;
      return false;
    }),
  }));
  if (!moved) return board;
  const updated = {
    ...moved,
    current_stage_key: toKey,
    current_stage_status: 'in_progress',
    days_in_stage: 0,
    invited: false,
    scheduled: false,
    ready_for_decision: false,
    assessment_pending: toKey === 'assessment',
    assessment_invite_sent_at: null,
    assessment_due_at: null,
    assessment_overdue: false,
  };
  return { ...board, columns: columns.map((c) => (c.stage_key === toKey ? { ...c, cards: [updated, ...c.cards] } : c)) };
}

export default function Pipeline() {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  // A Position option key (N19): 'mrf:<id>' for one requisition, or
  // 'text:<role>' for keyword shortlists, which carry no MRF.
  const [position, setPosition] = useState();
  const [source, setSource] = useState();
  const [onHoldOnly, setOnHoldOnly] = useState(false);
  const [rejectedOnly, setRejectedOnly] = useState(false);
  const [stuckOnly, setStuckOnly] = useState(false);
  // G6 — "my candidates". A view, not a permission: resolved server-side to
  // the caller's own identity, so clearing it always shows the full shared
  // board to any staff user.
  const [myCandidatesOnly, setMyCandidatesOnly] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [openPipelineId, setOpenPipelineId] = useState(null);
  // The candidate the drawer is RENDERING. It outlives openPipelineId by the
  // length of the close animation, so the drawer slides out with its content
  // and its modals instead of everything unmounting in one frame — the
  // close-time blank page of N30. Cleared once the drawer has fully closed.
  const [drawerPipelineId, setDrawerPipelineId] = useState(null);
  const openDrawer = useCallback((id) => {
    setOpenPipelineId(id);
    setDrawerPipelineId(id);
  }, []);
  const [nlQuery, setNlQuery] = useState('');
  const [nlRead, setNlRead] = useState(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  // Dims and blurs the board for as long as the stale-conflict error toast is up
  // (defect D3). Lives here rather than in PipelineDrawer because the drawer
  // unmounts itself the moment the conflict is detected.
  const [staleConflict, setStaleConflict] = useState(false);

  // Deep link: /pipeline?candidate=<pipelineId> opens straight into that
  // candidate's drawer. This is how the notification bell hands off — clicking
  // "Feedback received" should land on the candidate, not just the board.
  const [searchParams, setSearchParams] = useSearchParams();
  const candidateParam = searchParams.get('candidate');
  // …&recording=<id> goes one step further and opens that recording's player.
  // This is the link the drawer's "Copy link" button hands out, so a recruiter
  // can email a round to whoever decides — the recipient signs in and their
  // view is audited, which a raw stream URL would defeat.
  const recordingParam = searchParams.get('recording');
  useEffect(() => {
    const id = Number(candidateParam);
    if (Number.isFinite(id) && id > 0) openDrawer(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateParam]);

  /** Closes the drawer and drops the deep-link params so a refresh doesn't reopen it. */
  const closeDrawer = useCallback(() => {
    setOpenPipelineId(null);
    if (candidateParam || recordingParam) {
      const next = new URLSearchParams(searchParams);
      next.delete('candidate');
      next.delete('recording');
      setSearchParams(next, { replace: true });
    }
  }, [candidateParam, recordingParam, searchParams, setSearchParams]);

  const filters = {
    position: position?.startsWith('text:') ? position.slice(5) : undefined,
    position_mrf_id: position?.startsWith('mrf:') ? position.slice(4) : undefined,
    source,
    on_hold_only: onHoldOnly ? '1' : undefined,
    rejected_only: rejectedOnly ? '1' : undefined,
    stuck_days: stuckOnly ? 10 : undefined,
    include_closed: showClosed ? '1' : undefined,
    owned_by: myCandidatesOnly ? 'me' : undefined,
  };

  // The board advertises itself as live, so it has to actually behave that way:
  // candidates arrive here the moment someone shortlists them on Candidate
  // Screening, and a recruiter watching this page previously never saw them
  // (the global default disables focus-refetch, and nothing polled). Poll on a
  // slow cadence, and refetch whenever the tab regains focus — the moment a
  // recruiter is most likely to be looking for a change.
  const { data, isLoading, isFetching, isError, error, dataUpdatedAt } = useQuery({
    queryKey: ['pipeline-board', filters],
    queryFn: async () => {
      const res = await pipelineService.listPipeline(filters);
      return res.data?.data || res.data;
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  // Interviews that ended without anyone recording held/no_show. Nothing moves
  // for these rounds — the scorecard link only goes out on 'held' — and until
  // now nothing told a recruiter they existed, so they sat on "Awaiting Results"
  // indefinitely. Same slow cadence as the board.
  const { data: unresolvedInterviews } = useQuery({
    queryKey: ['unresolved-interviews'],
    queryFn: async () => {
      const res = await pipelineService.getUnresolvedInterviews();
      return res.data?.data || res.data || [];
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const refreshBoard = () => {
    queryClient.invalidateQueries({ queryKey: ['pipeline-board'] });
    queryClient.invalidateQueries({ queryKey: ['unresolved-interviews'] });
  };

  /**
   * A stale-tab decision was refused (409, defect D3). The drawer has already
   * closed itself; this reloads the board and holds a scrim over it for exactly
   * as long as the error toast is up.
   *
   * Why the scrim: the board underneath is the state the recruiter was wrong
   * about, and it visibly re-sorts as the refresh lands — a card jumping columns
   * behind a toast reads as "something else just happened", not as "here is the
   * correction". Freezing the view until the message is read makes the two one
   * event instead of two.
   *
   * STALE_CONFLICT_TOAST_SECONDS must match the message duration below; they are
   * one interaction, so drifting apart would either uncover the board early or
   * leave it dimmed after the explanation has gone.
   */
  const STALE_CONFLICT_TOAST_SECONDS = 5;
  const handleStaleConflict = useCallback(() => {
    refreshBoard();
    setStaleConflict(true);
    window.setTimeout(() => setStaleConflict(false), STALE_CONFLICT_TOAST_SECONDS * 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient]);

  // ── Flexible stages: one move flow for the card menu, the drawer and drag
  // and drop — always through the confirmation popup (C8, D5).
  const [pendingMove, setPendingMove] = useState(null); // { card, toStageKey }
  const [activeDragCard, setActiveDragCard] = useState(null);
  const sensors = useSensors(
    // A short travel before a drag starts, so a plain click still opens the drawer.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Press-and-hold on touch screens, so a swipe still scrolls the board.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const requestMove = useCallback(({ card, toStageKey }) => {
    if (!canMoveCard(card)) {
      message.warning(card.lock?.reason || 'This candidate cannot be moved right now.');
      return;
    }
    const blocked = moveBlockReason(card, toStageKey);
    if (blocked) {
      message.warning(blocked);
      return;
    }
    setPendingMove({ card, toStageKey });
  }, [message]);

  const confirmMove = async () => {
    if (!pendingMove) return;
    const { card, toStageKey } = pendingMove;
    const boardKey = ['pipeline-board', filters];
    const before = queryClient.getQueryData(boardKey);
    const toLabel = (data?.columns || []).find((c) => c.stage_key === toStageKey)?.label || toStageKey;
    // Move the card at once; put it back if the server refuses (C8).
    queryClient.setQueryData(boardKey, (b) => moveCardInBoard(b, card.id, toStageKey));
    setPendingMove(null);
    try {
      await pipelineService.moveToStage(card.id, { target_stage_key: toStageKey, from_stage_key: card.current_stage_key });
      message.success(`${card.candidate_name || 'Candidate'} moved to ${toLabel}. No email was sent.`);
    } catch (err) {
      queryClient.setQueryData(boardKey, before);
      message.error(err?.message || 'The move was refused. The board has been refreshed.', 6);
    } finally {
      queryClient.invalidateQueries({ queryKey: ['pipeline-detail', card.id] });
      refreshBoard();
    }
  };

  const onDragStart = ({ active }) => setActiveDragCard(active?.data?.current?.card || null);
  const onDragEnd = ({ active, over }) => {
    const card = active?.data?.current?.card;
    setActiveDragCard(null);
    if (!card || !over || over.id === card.current_stage_key) return;
    requestMove({ card, toStageKey: String(over.id) });
  };

  const anyFilterActive = Boolean(position || source || onHoldOnly || rejectedOnly || stuckOnly || showClosed || myCandidatesOnly || nlQuery.trim());
  const clearFilters = () => {
    setPosition(undefined);
    setSource(undefined);
    setOnHoldOnly(false);
    setRejectedOnly(false);
    setStuckOnly(false);
    setShowClosed(false);
    setMyCandidatesOnly(false);
    setNlQuery('');
    setNlRead(null);
  };

  const positions = useMemo(() => data?.positions || [], [data]);
  // One entry per MRF, then the keyword shortlists (N19). Closed MRFs stay
  // listed, tagged, so a role like QA Automation can always be found.
  const positionSelectOptions = useMemo(() => {
    const opts = data?.positionOptions || positions.map((p) => ({ key: `text:${p}`, mrfId: null, role: p }));
    const toOption = (o) => ({
      value: o.key,
      label: o.mrfId ? `${o.role} · MRF-${o.mrfId}${o.created_at ? ` · ${fmtDate(o.created_at)}` : ''}` : o.role,
      closed: o.closed,
    });
    const mrf = opts.filter((o) => o.mrfId).map(toOption);
    const text = opts.filter((o) => !o.mrfId).map(toOption);
    return text.length && mrf.length
      ? [...mrf, { label: 'Keyword shortlists (no MRF)', title: 'Keyword shortlists', options: text }]
      : [...mrf, ...text];
  }, [data, positions]);

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
    // A typed role name matches every MRF of that name.
    setPosition(parsed.position ? `text:${parsed.position}` : undefined);
    setSource(parsed.source);
    setOnHoldOnly(parsed.hold);
    if (parsed.hold) setRejectedOnly(false);
    setStuckOnly(parsed.stuck);
    setNlRead(parsed.read);
  };

  if (isLoading) {
    // A board-shaped skeleton, not a centred spinner: the columns' horizontal
    // rhythm is there before the data is, so the board does not snap into
    // existence and shift the page under the pointer.
    return (
      <div style={{ padding: 24 }}>
        <LoadingSkeleton type="board" columns={5} rows={3} />
      </div>
    );
  }

  if (isError) {
    return (
      <div style={{ padding: 24 }}>
        <Card bordered={false} className="glass-card no-lift">
          <ErrorState
            title="Failed to load the Candidate Pipeline"
            body="The board could not be fetched. Nothing has changed — retry, or check that the backend is reachable."
            error={error?.response?.data?.message || error?.message}
            onRetry={refreshBoard}
          />
        </Card>
      </div>
    );
  }

  const columns = data?.columns || [];
  const flexible = !!data?.flexibleStages;
  const boardStages = columns.map((c) => ({ stage_key: c.stage_key, label: c.label }));
  const total = data?.total ?? 0;
  const filteredTotal = data?.filteredTotal ?? total;
  const closedCount = data?.closedCount ?? 0;

  return (
    <div style={{ padding: 24 }}>
      {/* One tier-2 toolbar card holding the header, the freshness/refresh/export
          controls, the NL search and the filters.

          These sat bare on the page before. That worked on a flat background, but
          on the aurora every AntD control paints its own opaque fill, so a dozen
          of them floated unanchored over the gradient with nothing tying them
          together. Grouping them onto one pane also states what they are: the
          board's controls, distinct from the board. */}
      <Card bordered={false} className="glass-card no-lift pipeline-toolbar" styles={{ body: { padding: 18 } }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>Candidate Pipeline</Title>
          <Text type="secondary">Candidates enter here when shortlisted from Candidate Screening.</Text>
        </div>
        <Space size={10}>
          <LastUpdated at={dataUpdatedAt} refreshing={isFetching} />
          <BoardLegend stages={columns} />
          <Tooltip title="Refresh the board">
            <Button icon={<ReloadOutlined spin={isFetching} />} onClick={refreshBoard} disabled={isFetching}>
              Refresh
            </Button>
          </Tooltip>
          {/* The board is cards, not a table — the CSV carries the columns
              there is no room for: outcome, reason, who decided and when. */}
          <ExportButton
            request={(cfg) => pipelineService.exportBoard(filters, cfg)}
            fallbackName="AAPNA-ATS_Candidate-Pipeline.csv"
            rowCount={filteredTotal}
          />
          {/* Flexible stages (C12): every move, filterable by date / user / position. */}
          {flexible && <MoveHistoryExport positionOptions={positionSelectOptions} mrfId={position?.startsWith('mrf:') ? position.slice(4) : undefined} />}
        </Space>
      </div>

      <Input.Search
        allowClear
        placeholder='Ask the board — e.g. "vendor candidates stuck on hold"'
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

      <Space wrap>
        <Select
          allowClear
          placeholder="Position"
          style={{ minWidth: 330 }}
          popupMatchSelectWidth={false}
          showSearch
          optionFilterProp="label"
          value={position}
          onChange={setPosition}
          options={positionSelectOptions}
          // A role name picked by "Ask the board" may match only MRF entries,
          // so it has no option of its own — show the name, never the raw key.
          labelRender={({ label, value }) => label ?? String(value).replace(/^(text|mrf):/, '')}
          optionRender={(opt) => (
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <span style={opt.data.closed ? { color: 'var(--text-3)' } : undefined}>{opt.data.label}</span>
              {opt.data.closed && <Tag style={{ margin: 0 }}>Closed</Tag>}
            </Space>
          )}
        />
        <Select
          allowClear
          placeholder="Source"
          style={{ minWidth: 170 }}
          value={source}
          onChange={setSource}
          options={Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <Checkbox
          checked={onHoldOnly}
          onChange={(e) => {
            setOnHoldOnly(e.target.checked);
            if (e.target.checked) setRejectedOnly(false);
          }}
        >
          On Hold only
        </Checkbox>
        <Checkbox
          checked={rejectedOnly}
          onChange={(e) => {
            setRejectedOnly(e.target.checked);
            if (e.target.checked) setOnHoldOnly(false);
          }}
        >
          Rejected only
        </Checkbox>
        <Checkbox checked={stuckOnly} onChange={(e) => setStuckOnly(e.target.checked)}>Stuck &gt; 10 days</Checkbox>
        <Tooltip title="Candidates you shortlisted — a view, not a permission. Clearing it always shows the full board.">
          <Checkbox checked={myCandidatesOnly} onChange={(e) => setMyCandidatesOnly(e.target.checked)}>My candidates</Checkbox>
        </Tooltip>
        <Tooltip title="Closed candidates are hidden by default — the board is for live work">
          <Checkbox checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)}>
            Show closed{closedCount > 0 ? ` (${closedCount})` : ''}
          </Checkbox>
        </Tooltip>
        {anyFilterActive && (
          <Button size="small" type="text" icon={<ClearOutlined />} onClick={clearFilters}>
            Clear filters
          </Button>
        )}
        <Text type="secondary">
          {anyFilterActive ? `${filteredTotal} of ${total} candidates` : `${total} candidates`}
        </Text>
      </Space>
      </Card>

      {/* Interviews that ended with no verdict. Deliberately a banner rather
          than a column on the board: these are not a pipeline stage, they are a
          blockage — every one is a round that cannot send its scorecard until a
          human says whether the interview happened. Clicking a row opens that
          candidate's drawer, where Mark as Held / Mark No-show already live. */}
      {unresolvedInterviews?.length > 0 && (
        <>
          <div style={{ height: 18 }} />
          <Alert
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            message={`${unresolvedInterviews.length} interview${unresolvedInterviews.length === 1 ? '' : 's'} awaiting confirmation`}
            description={
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  These rounds ended without anyone recording whether they happened. No scorecard
                  is requested until one is marked held.
                </Text>
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {unresolvedInterviews.map((iv) => (
                    <div key={iv.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Button
                        size="small"
                        type="link"
                        style={{ padding: 0, height: 'auto' }}
                        onClick={() => openDrawer(iv.pipeline_id)}
                      >
                        {iv.candidate_name || `Journey ${iv.pipeline_id}`}
                      </Button>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {iv.stage_label}
                        {iv.interviewer_name ? ` · ${iv.interviewer_name}` : ''}
                        {' · ended '}
                        {iv.hours_overdue < 24
                          ? `${iv.hours_overdue} h ago`
                          : `${Math.floor(iv.hours_overdue / 24)} d ago`}
                      </Text>
                      {iv.occurrence_status === 'unconfirmed' && (
                        <Tag color="default" style={{ marginInlineStart: 0 }}>never confirmed</Tag>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            }
          />
        </>
      )}

      <div style={{ height: 18 }} />

      {flexible && (
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }} data-testid="flexible-hint">
          <SwapOutlined style={{ marginInlineEnd: 4 }} />
          Drag a card to any stage the candidate has not passed, or use its Move to… menu. A card with a lock has started its current stage.
        </Text>
      )}

      <DndContext sensors={sensors} collisionDetection={boardCollision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveDragCard(null)}>
      <BoardScroller>
        {columns.map((col) => (
          <DroppableColumn key={col.stage_key} stageKey={col.stage_key} activeCard={flexible ? activeDragCard : null}>
            <Card
              size="small"
              title={(
                <Space size={6}>
                  <Tooltip title={STAGE_DESCRIPTIONS[col.stage_key]}>
                    <Text style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }} strong>{col.label}</Text>
                  </Tooltip>
                  {col.is_optional && <Tag style={{ fontSize: 10 }}>optional</Tag>}
                </Space>
              )}
              extra={(
                <Space size={6}>
                  {col.stage_key === 'assessment' && (
                    <Tooltip title="Import Evalground results (CSV) — matches by candidate email to journeys currently in this round">
                      <Button
                        size="small"
                        type="text"
                        icon={<ImportOutlined />}
                        onClick={(e) => { e.stopPropagation(); setImportModalOpen(true); }}
                      />
                    </Tooltip>
                  )}
                  <Badge count={col.cards.length} showZero color="var(--brand-primary)" />
                </Space>
              )}
              // Tier 2. `no-lift` is load-bearing: the base
              // `.ant-card:not(.no-lift):hover` rule raises the card, and a whole
              // board column bouncing as the pointer crosses it is wrong — the
              // cards inside it are the things you hover. Same reasoning as
              // `.dash-chart-card` on the dashboard.
              className="glass-card no-lift pipeline-column"
              styles={{ body: { padding: 10, background: 'transparent' } }}
              style={{ borderTop: 0, overflow: 'hidden' }}
            >
              <div style={{ height: 3, margin: '-1px -1px 10px', background: STAGE_ACCENT[col.stage_type] || 'var(--border)' }} />
              {col.cards.length === 0 ? (
                // Was a bare "No candidates". A column is empty for a reason the
                // reader can act on — usually a filter, not an empty pipeline —
                // so say which.
                <EmptyState
                  size="sm"
                  icon={<InboxOutlined />}
                  title="No candidates here"
                  body={anyFilterActive
                    ? 'No one in this stage matches the current filters.'
                    : 'Candidates appear in this stage as they progress.'}
                  style={{ padding: '18px 8px' }}
                />
              ) : (
                col.cards.map((card) => (flexible ? (
                  <DraggableCard key={card.id} card={card}>
                    <CandidateCard card={card} onOpen={openDrawer} flexible stages={boardStages} onMoveRequest={requestMove} />
                  </DraggableCard>
                ) : (
                  <CandidateCard key={card.id} card={card} onOpen={openDrawer} />
                )))
              )}
            </Card>
          </DroppableColumn>
        ))}
      </BoardScroller>
      {/* Rendered in a portal above the board, so the dragged card is never
          clipped by its column's overflow:hidden. */}
      {createPortal(
        <DragOverlay dropAnimation={null}>
          {activeDragCard ? (
            <div style={{ width: 260, cursor: 'grabbing' }}>
              <CandidateCard card={activeDragCard} onOpen={() => {}} />
            </div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}
      </DndContext>

      <MoveStageModal
        open={!!pendingMove}
        candidate={pendingMove?.card}
        fromStage={pendingMove ? boardStages.find((s) => s.stage_key === pendingMove.card.current_stage_key) || { stage_key: pendingMove.card.current_stage_key, label: pendingMove.card.current_stage_key } : null}
        toStage={pendingMove ? boardStages.find((s) => s.stage_key === pendingMove.toStageKey) : null}
        stages={boardStages}
        passedStageKeys={pendingMove?.card?.passed_stage_keys || []}
        onCancel={() => setPendingMove(null)}
        onConfirm={confirmMove}
      />

      <PipelineDrawer
        pipelineId={drawerPipelineId}
        open={openPipelineId != null}
        onAfterClose={() => setDrawerPipelineId(null)}
        focusRecordingId={Number(recordingParam) > 0 ? Number(recordingParam) : null}
        onClose={closeDrawer}
        onChanged={() => {
          refreshBoard();
          message.success('Pipeline updated.');
        }}
        // Refresh WITHOUT the success toast — used when the drawer closes itself
        // because the candidate turned out to have moved (409, defect D3). The
        // board is stale and must reload, but nothing the recruiter asked for
        // succeeded, so "Pipeline updated." would contradict the error message.
        onStaleConflict={handleStaleConflict}
        onRequestMove={flexible ? requestMove : undefined}
      />

      {/* Stale-conflict scrim (defect D3). Same treatment as LoadingOverlay —
          var(--overlay-scrim) + blur(4px), both theme-aware — so a blocked board
          looks the same here as everywhere else in the app.

          zIndex sits BELOW antd's message layer (which renders above 10^4) so the
          toast stays crisp and readable on top of the blur; pointer-events block
          clicks on a board the recruiter has just been told is out of date. */}
      {staleConflict && createPortal(
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--overlay-scrim)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            zIndex: 1500,
            transition: 'opacity 200ms ease',
          }}
        />,
        document.body,
      )}

      <AssessmentImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImported={() => {
          refreshBoard();
          queryClient.invalidateQueries({ queryKey: ['assessment-result'] });
        }}
      />
    </div>
  );
}
