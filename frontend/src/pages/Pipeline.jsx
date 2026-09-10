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
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  // Button now comes from src/ui — see the import below.
  Alert, Badge, Card, Checkbox, Input, Select, Space, Tag, Tooltip, Typography, App as AntApp,
} from 'antd';
import { ClearOutlined, DownOutlined, FilterOutlined, ImportOutlined, InboxOutlined, LeftOutlined, PauseCircleOutlined, ReloadOutlined, RightOutlined, RobotOutlined, SearchOutlined, ShopOutlined, TeamOutlined, UpOutlined, UserOutlined, WarningOutlined } from '@ant-design/icons';
import pipelineService from '../services/pipeline';
import PipelineDrawer from '../components/pipeline/PipelineDrawer';
import AssessmentImportModal from '../components/pipeline/AssessmentImportModal';
import ExportButton from '../components/common/ExportButton';
import EmptyState from '../components/common/EmptyState';
import ErrorState from '../components/common/ErrorState';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import { DesignScope, PageShell, PageHeader, Surface, Button } from '../ui';
// After '../ui' so page rules win on equal specificity.
import '../styles/pages/pipeline.css';

const { Text, Title } = Typography;

/** Aging badge thresholds — green -> amber -> red, per 02-BUSINESS-DESIGN.md §1.1. */
const ageColor = (d) => (d <= 5 ? 'green' : d <= 10 ? 'gold' : 'red');

/* Per-browser preferences for the board's two collapsible chrome pieces (2026-09-01).
   Both are view state, not data: nothing here changes what the board contains, so it
   belongs in localStorage next to the sidebar's collapse flag rather than on the
   server or in the URL. */
const FILTERS_OPEN_KEY = 'pipeline_filters_open';
const UNRESOLVED_DISMISSED_KEY = 'pipeline_unresolved_dismissed';

/** Same shape as DesignContext's `persist` — a preference is never worth a thrown
 *  render, so private mode just loses the choice at reload. */
const readPref = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; /* storage unavailable (private mode) */
  }
};
const writePref = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) — the choice just won't survive reload */
  }
};

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
 * Real card status chip + left-border accent, derived only from fields the
 * backend actually returns — current_stage_status, final_outcome, and (for
 * Zeko stages only) whether a score has synced yet (ready_for_decision).
 * Deliberately a smaller state set than the prototype's 5-chip mock model
 * (pending/invited/await/feedback/hold) since Modules 2/3 (scheduling,
 * scorecards) don't exist yet to honestly support those extra states for
 * non-Zeko stages.
 */
function cardStatus(card) {
  if (card.final_outcome) return { label: card.final_outcome.replace(/_/g, ' '), color: 'default', accent: 'var(--status-closed)' };
  if (card.current_stage_status === 'rejected') return { label: 'Rejected', color: 'red', accent: 'var(--status-rejected)' };
  if (card.current_stage_status === 'hold') return { label: 'On Hold', color: 'gold', accent: 'var(--status-hold)' };
  if (card.current_stage_status === 'approved') return { label: 'Approved', color: 'green', accent: 'var(--status-approved)' };
  if (card.ready_for_decision) return { label: 'Ready for decision', color: 'green', accent: 'var(--status-approved)' };
  // Technical rounds: a booked interview reads as "Scheduled" (distinct from the
  // Zeko "Invited"). Both use the same blue accent as the active-but-not-done look.
  if (card.scheduled) return { label: 'Scheduled', color: 'blue', accent: 'var(--status-active)' };
  if (card.invited) return { label: 'Invited', color: 'blue', accent: 'var(--status-active)' };
  // Phase 3 M2 — Evalground bulk-CSV import: no result has landed for this
  // journey yet. Never expires/clears itself; only an import (or a decision)
  // moves the card past this state (RT: "test pending" is shown indefinitely).
  if (card.assessment_pending) return { label: 'Evalground test pending', color: 'gold', accent: 'var(--status-hold)' };
  return { label: 'In progress', color: 'blue', accent: 'var(--status-active)' };
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
      // The left border encodes STATUS — it is data, not decoration. It used to
      // be painted here as an inline `borderInlineStart`, which a stylesheet can
      // only beat with `!important`; the hover rule in index.css did exactly
      // that with the `border-color` shorthand and silently wiped the status
      // colour off every hovered card. Passing it as a custom property hands the
      // property to CSS, which can then set the other three sides without ever
      // touching this one. Same pattern as --stat-color / --kpi-color.
      style={{ marginBottom: 8, '--cp-accent': status.accent }}
    >
      <div className="pl-card-row">
        <div className="cp-avatar" style={{ '--pl-avatar': avatarColor(card.candidate_name) }}>{initials(card.candidate_name)}</div>
        <div className="pl-card-main">
          <div className="pl-card-head">
            <Text strong className="pl-card-name pl-truncate">
              {card.candidate_name || 'Unnamed candidate'}
            </Text>
            <Tooltip title="Days in current stage">
              {card.days_in_stage > 10
                ? <Tag color="red" className="tag-attention pl-tag--days">{card.days_in_stage}d</Tag>
                : <Text type="secondary" className="pl-caption pl-truncate">{card.days_in_stage}d</Text>}
            </Tooltip>
          </div>
          <Text type="secondary" className="pl-card-sub pl-truncate">
            {card.position || 'No position on file'} · {sourceLabel(card)}{card.owner ? ` · ${card.owner}` : ''}
          </Text>
          <Space size={4} wrap className="pl-mb-1-5">
            <Tag color={status.color} className="pl-tag">{status.label}</Tag>
            {card.concurrent_journeys > 1 && (
              <Tooltip title="Active on more than one MRF at once (Q13)">
                <Tag color="purple" icon={<TeamOutlined />} className="pl-tag">{card.concurrent_journeys} MRFs</Tag>
              </Tooltip>
            )}
            {/* Still running against a requisition that has already been
                filled — the recruiter is working a role with no opening
                left. Only shown while the journey is genuinely open. */}
            {card.mrf_closed && !card.final_outcome && (
              <Tooltip title="All openings on this requisition are filled — this candidate is still in progress. Continue only if you intend to re-open the role or are holding them as a backup.">
                <Tag color="orange" className="tag-attention pl-tag" icon={<WarningOutlined />}>Role filled</Tag>
              </Tooltip>
            )}
            {/* Held by a recruiter (Q33). Sits next to "Role filled" because
                that is the case it exists for: the role filled underneath this
                candidate and someone chose to hold rather than close them.
                is_paused has been on the card payload all along; nothing wrote
                it until 2026-08-26. */}
            {card.is_paused && !card.final_outcome && (
              <Tooltip title="This journey is paused — interview reminders, occurrence chase-ups and assessment deadline bells are all suspended until it is resumed.">
                <Tag color="orange" icon={<PauseCircleOutlined />} className="pl-tag">Paused</Tag>
              </Tooltip>
            )}
            {card.source === 'vendor' && <ShopOutlined className="pl-muted" />}
          </Space>
          <Tooltip title={segTooltip}>
            <div className="pl-chips" aria-label={segTooltip}>
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

  if (refreshing) return <Text type="secondary" className="pl-caption">Refreshing…</Text>;
  if (!at) return null;

  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  const label = secs < 45
    ? 'just now'
    : secs < 3600
      ? `${Math.round(secs / 60)} min ago`
      : `${Math.round(secs / 3600)} hr ago`;
  return <Text type="secondary" className="pl-caption">Updated {label}</Text>;
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

  // Only the measured viewport offset stays inline — it is computed from the board's
  // bounds at runtime, so no stylesheet could hold it. The brand gradient, the glow
  // and the white icon all moved to `.board-scroll-arrow` in styles/pages/pipeline.css,
  // which is deliberately NOT scoped to `.ats-v3`: these portal to <body>.
  const arrowStyle = (side) => ({ [side]: `${Math.max(bounds[side] + 4, 8)}px` });

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
        className="stagger-children pl-board"
      >
        {children}
      </div>
    </>
  );
}

/**
 * The page header. Lifted out of the toolbar card on 2026-08-31 — it was a
 * `Title level={3}`, which resolves to 20px against the lab's 32px, and a title nested
 * inside a tier-2 Surface reads as that card's label rather than the page's.
 *
 * Extracted into its own component because this route returns from THREE places —
 * loading, error, and the board — and the header has to be identical in all three.
 * Inlining it three times is how they would drift.
 */
function PipelineHeader() {
  return (
    <PageHeader
      eyebrow="Pipeline"
      title="Candidate Pipeline"
      subtitle="Candidates enter here when shortlisted from Candidate Screening."
    />
  );
}

export default function Pipeline() {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
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
  const [nlQuery, setNlQuery] = useState('');
  const [nlRead, setNlRead] = useState(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  // Dims and blurs the board for as long as the stale-conflict error toast is up
  // (defect D3). Lives here rather than in PipelineDrawer because the drawer
  // unmounts itself the moment the conflict is detected.
  const [staleConflict, setStaleConflict] = useState(false);

  // The filter pane collapses, and starts collapsed (2026-09-01). Reported as
  // "these 2 popups are occupying the space": measured at 1560x900, the toolbar's
  // search + seven filter controls and the unresolved-interview banner put the
  // board's first pixel at 559px, leaving 341px — less than one card row plus the
  // column header — for the board itself. Folding the pane returns 100px and
  // dismissing the banner another 146px.
  //
  // Collapsed, the toolbar keeps only what is useful on every visit (freshness,
  // refresh, export, the count) and folds the controls used occasionally. The choice
  // persists per browser, like the sidebar's, so someone who filters all day opens
  // it once.
  const [filtersOpen, setFiltersOpen] = useState(() => readPref(FILTERS_OPEN_KEY) === 'true');
  const toggleFilters = () => {
    setFiltersOpen((open) => {
      writePref(FILTERS_OPEN_KEY, String(!open));
      return !open;
    });
  };

  // Dismissal of the unresolved-interview banner, keyed to WHICH rounds are
  // unresolved rather than to a boolean. Closing it acknowledges the rounds that
  // were on screen; the next round to end unconfirmed produces a different key and
  // the banner comes back by itself. A plain `hidden: true` would have silently
  // swallowed every future blockage, and this banner is the only place one is
  // reported.
  const [dismissedUnresolved, setDismissedUnresolved] = useState(() => readPref(UNRESOLVED_DISMISSED_KEY) || '');

  // Deep link: /pipeline?candidate=<pipelineId> opens straight into that
  // candidate's drawer. This is how the notification bell hands off — clicking
  // "Feedback received" should land on the candidate, not just the board.
  const [searchParams, setSearchParams] = useSearchParams();
  const candidateParam = searchParams.get('candidate');
  useEffect(() => {
    const id = Number(candidateParam);
    if (Number.isFinite(id) && id > 0) setOpenPipelineId(id);
  }, [candidateParam]);

  /** Closes the drawer and drops the deep-link param so a refresh doesn't reopen it. */
  const closeDrawer = useCallback(() => {
    setOpenPipelineId(null);
    if (candidateParam) {
      const next = new URLSearchParams(searchParams);
      next.delete('candidate');
      setSearchParams(next, { replace: true });
    }
  }, [candidateParam, searchParams, setSearchParams]);

  const filters = {
    position,
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

  /* The identity of the CURRENT blockage set. Sorted so the key does not change
     when the backend returns the same rounds in a different order — an unstable
     key would un-dismiss the banner on every poll. */
  const unresolvedKey = useMemo(
    () => (unresolvedInterviews || []).map((iv) => iv.id).sort().join(','),
    [unresolvedInterviews],
  );
  const unresolvedHidden = Boolean(unresolvedKey) && dismissedUnresolved === unresolvedKey;
  const dismissUnresolved = () => {
    writePref(UNRESOLVED_DISMISSED_KEY, unresolvedKey);
    setDismissedUnresolved(unresolvedKey);
  };
  const restoreUnresolved = () => {
    writePref(UNRESOLVED_DISMISSED_KEY, '');
    setDismissedUnresolved('');
  };

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

  /* Counted, not just tested, because the badge on the collapsed Filters button is
     the only thing on screen saying how much of the board is being hidden. */
  const activeFilterCount = [
    position, source, onHoldOnly, rejectedOnly, stuckOnly, showClosed, myCandidatesOnly, nlQuery.trim(),
  ].filter(Boolean).length;
  const anyFilterActive = activeFilterCount > 0;
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
    if (parsed.hold) setRejectedOnly(false);
    setStuckOnly(parsed.stuck);
    setNlRead(parsed.read);
  };

  if (isLoading) {
    // A board-shaped skeleton, not a centred spinner: the columns' horizontal
    // rhythm is there before the data is, so the board does not snap into
    // existence and shift the page under the pointer.
    return (
      <DesignScope>
        <PageShell width="wide">
          {/* The header renders in the loading and error branches too — 2026-08-31.
              These returned early with only a skeleton, so for the seconds the board
              takes to arrive the page had no title at all, and then one appeared: the
              same "screen begins with no anchor" defect this whole pass is about, just
              confined to a transient state. A header is page furniture, not content,
              so it should be there before the content is. Caught by composition.mjs,
              which happened to probe mid-load. */}
          <PipelineHeader />
          <LoadingSkeleton type="board" columns={5} rows={3} />
        </PageShell>
      </DesignScope>
    );
  }

  if (isError) {
    return (
      <DesignScope>
        <PageShell width="wide">
        <PipelineHeader />
        <Surface tier={2} padding="relaxed">
          <ErrorState
            title="Failed to load the Candidate Pipeline"
            body="The board could not be fetched. Nothing has changed — retry, or check that the backend is reachable."
            error={error?.response?.data?.message || error?.message}
            onRetry={refreshBoard}
          />
        </Surface>
        </PageShell>
      </DesignScope>
    );
  }

  const columns = data?.columns || [];
  const total = data?.total ?? 0;
  const filteredTotal = data?.filteredTotal ?? total;
  const closedCount = data?.closedCount ?? 0;

  return (
    <DesignScope>
      <PageShell width="wide">
      {/* One tier-2 toolbar card holding the header, the freshness/refresh/export
          controls, the NL search and the filters.

          These sat bare on the page before. That worked on a flat background, but
          on the aurora every AntD control paints its own opaque fill, so a dozen
          of them floated unanchored over the gradient with nothing tying them
          together. Grouping them onto one pane also states what they are: the
          board's controls, distinct from the board. */}
      <PipelineHeader />

      <Surface
        tier={2}
        padding="default"
        className={`pipeline-toolbar${filtersOpen ? '' : ' pipeline-toolbar--collapsed'}`}
      >
      {/* `.pl-toolbar-head` is `space-between`. It briefly held only one group (the
          title having been lifted into the PageHeader), and both sides are back as of
          2026-09-01: the board's ACTIONS on the left, the board's STATUS on the right.
          The split is what makes the row work collapsed — the count and the clear-filters
          escape hatch stay on screen when the pane below them is folded away. */}
      <div className="pl-toolbar-head">
        <Space size={10}>
          <LastUpdated at={dataUpdatedAt} refreshing={isFetching} />
          <Tooltip title="Refresh the board">
            <Button emphasis="soft" icon={<ReloadOutlined spin={isFetching} />} onClick={refreshBoard} disabled={isFetching}>
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
          {/* The badge, not the chevron, is the load-bearing part: collapsed with a
              filter still on, it is the only cue that the board is showing a subset.
              Badge OUTSIDE Tooltip — Tooltip clones its child to attach a ref, and
              AntD's Badge is not a forwardRef, so the other nesting drops the ref. */}
          <Badge count={activeFilterCount} size="small" offset={[-6, 2]}>
            <Tooltip title={filtersOpen ? 'Hide the search and filters' : 'Search the board and filter it'}>
              <Button
                emphasis="soft"
                icon={<FilterOutlined />}
                onClick={toggleFilters}
                aria-expanded={filtersOpen}
                aria-controls="pl-filter-pane"
              >
                Filters
                {filtersOpen ? <UpOutlined className="pl-chevron" /> : <DownOutlined className="pl-chevron" />}
              </Button>
            </Tooltip>
          </Badge>
        </Space>

        {/* Board status. The count and Clear filters sat inside the filter row until
            2026-09-01 — they cannot stay there now that the row folds, or a collapsed
            pane could leave the board filtered with nothing on screen saying so and no
            way to undo it. Same reason the dismissed-banner chip lands here: a
            blockage that has been acknowledged still has to be reachable. */}
        <Space size={10}>
          {unresolvedHidden && (
            <Tooltip title="Show the interviews awaiting confirmation again">
              <Button
                size="sm"
                emphasis="text"
                icon={<WarningOutlined />}
                onClick={restoreUnresolved}
              >
                {unresolvedInterviews.length} awaiting confirmation
              </Button>
            </Tooltip>
          )}
          <Text type="secondary">
            {anyFilterActive ? `${filteredTotal} of ${total} candidates` : `${total} candidates`}
          </Text>
          {anyFilterActive && (
            <Button size="sm" emphasis="text" icon={<ClearOutlined />} onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </Space>
      </div>

      {/* The fold. Conditionally rendered rather than hidden with CSS: the pane holds
          seven focusable controls, and a `display:none` pane keeps them in the tab
          order of a screen that is deliberately showing less. */}
      {filtersOpen && (
      <div id="pl-filter-pane" className="pl-filter-pane">
      <Input.Search
        allowClear
        placeholder='Ask the board — e.g. "vendor candidates stuck on hold"'
        prefix={<RobotOutlined className="pl-brand" />}
        className="pl-search"
        value={nlQuery}
        onChange={(e) => { setNlQuery(e.target.value); if (!e.target.value.trim()) handleNlSearch(''); }}
        onSearch={handleNlSearch}
        enterButton={<SearchOutlined />}
      />
      {nlRead && (
        <div className="pl-mb-2-5">
          <Text type="secondary" className="pl-caption">
            <RobotOutlined className="pl-tag--gap" />Read as: {nlRead}
          </Text>
        </div>
      )}

      <Space wrap>
        <Select
          allowClear
          placeholder="Position"
          className="pl-select-wide"
          value={position}
          onChange={setPosition}
          options={positions.map((p) => ({ value: p, label: p }))}
        />
        <Select
          allowClear
          placeholder="Source"
          className="pl-select"
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
        {/* `Clear filters` and the candidate count were the last two children here.
            Not removed — moved up into `.pl-toolbar-head` on 2026-09-01 so they survive
            this pane being collapsed. See the comment on that group. */}
      </Space>
      </div>
      )}
      </Surface>

      {/* Interviews that ended with no verdict. Deliberately a banner rather
          than a column on the board: these are not a pipeline stage, they are a
          blockage — every one is a round that cannot send its scorecard until a
          human says whether the interview happened. Clicking a row opens that
          candidate's drawer, where Mark as Held / Mark No-show already live.

          Closable as of 2026-09-01, because permanent is not the same as important:
          a banner that cannot be put away is one a recruiter learns to read past.
          Closing it is an acknowledgement of THESE rounds (see `unresolvedKey`), it
          leaves a chip in the toolbar that reopens it, and a new unconfirmed round
          raises it again on its own. */}
      {unresolvedInterviews?.length > 0 && !unresolvedHidden && (
        <>
          <div className="pl-gap" />
          <Alert
            type="warning"
            showIcon
            closable
            onClose={dismissUnresolved}
            icon={<WarningOutlined />}
            message={`${unresolvedInterviews.length} interview${unresolvedInterviews.length === 1 ? '' : 's'} awaiting confirmation`}
            description={
              <div>
                <Text type="secondary" className="pl-caption">
                  These rounds ended without anyone recording whether they happened. No scorecard
                  is requested until one is marked held.
                </Text>
                <div className="pl-card-meta">
                  {unresolvedInterviews.map((iv) => (
                    <div key={iv.id} className="pl-controls">
                      <Button
                        size="sm"
                        emphasis="text"
                        className="pl-flat"
                        onClick={() => setOpenPipelineId(iv.pipeline_id)}
                      >
                        {iv.candidate_name || `Journey ${iv.pipeline_id}`}
                      </Button>
                      <Text type="secondary" className="pl-caption">
                        {iv.stage_label}
                        {iv.interviewer_name ? ` · ${iv.interviewer_name}` : ''}
                        {' · ended '}
                        {iv.hours_overdue < 24
                          ? `${iv.hours_overdue}h ago`
                          : `${Math.floor(iv.hours_overdue / 24)}d ago`}
                      </Text>
                      {iv.occurrence_status === 'unconfirmed' && (
                        <Tag color="default" className="pl-tag--flush">never confirmed</Tag>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            }
          />
        </>
      )}

      <div className="pl-gap" />

      <BoardScroller>
        {columns.map((col) => (
          <div key={col.stage_key} className="pl-column">
            <Surface
              as={Card}
              tier={2}
              padding="none"
              size="small"
              title={(
                <Space size={6}>
                  <Text className="pl-col-label" strong>{col.label}</Text>
                  {col.is_optional && <Tag className="pl-optional">optional</Tag>}
                </Space>
              )}
              extra={(
                <Space size={6}>
                  {col.stage_key === 'assessment' && (
                    <Tooltip title="Import Evalground results (CSV) — matches by candidate email to journeys currently in this round">
                      <Button
                        size="sm"
                        emphasis="text"
                        iconOnly
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
              className="pipeline-column pl-column-card"
            >
              <div className="pl-stage-rail" style={{ '--pl-stage': STAGE_ACCENT[col.stage_type] }} />
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
                  className="pl-empty-pad"
                />
              ) : (
                col.cards.map((card) => (
                  <CandidateCard key={card.id} card={card} onOpen={setOpenPipelineId} />
                ))
              )}
            </Surface>
          </div>
        ))}
      </BoardScroller>

      <PipelineDrawer
        pipelineId={openPipelineId}
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
      />

      {/* Stale-conflict scrim (defect D3). Same treatment as LoadingOverlay —
          var(--overlay-scrim) + blur(4px), both theme-aware — so a blocked board
          looks the same here as everywhere else in the app.

          zIndex sits BELOW antd's message layer (which renders above 10^4) so the
          toast stays crisp and readable on top of the blur; pointer-events block
          clicks on a board the recruiter has just been told is out of date. */}
      {staleConflict && createPortal(
        <div aria-hidden="true" className="pl-scrim" />,
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
      </PageShell>
    </DesignScope>
  );
}
