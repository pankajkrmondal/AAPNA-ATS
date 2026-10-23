/**
 * Recruitment Analytics → Open Positions and the role view (L06, approved
 * 22 Oct 2026). Loads the rows; the counting rules are pure and live in
 * openPositions.helpers.js (unit tested).
 *
 * Deliberately does NOT import pipeline.service.js: that module opens a shared
 * Redis connection on import, which hangs `node --test` (see
 * pipelineAnalytics.helpers.js).
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import { LEGACY_MRF_CLOSED_STATUS, EVENT_TYPES, STAGE_OUTCOMES, isStageArrival } from '../config/pipelineStages.js';
import { positionsOverview } from './pipelineAnalytics.helpers.js';
import {
  DEFAULT_POSITION_TARGET_DAYS, DEFAULT_STUCK_DAYS, parsePositionTargetDays, SOURCE_KEYS, SOURCE_LABELS,
  journeyFacts, positionCounts, positionHealth, comparePositions, summaryText, positionMilestones, mrfTiming, percent,
} from './openPositions.helpers.js';
import { applicantCountsByMrf, applicantDaily, applicantDailyByMrf, applicantList } from './mrfApplicants.service.js';
import {
  inRange, previousPeriod, lastNDays, makeRange, istDay, daysOf, rangeForResponse, rangeLabel,
} from '../utils/analyticsRange.js';
import { fmtDate, fmtDateTimeIst } from '../utils/dateFormat.js';
import { groupByMrf, withBoardNumbers } from '../utils/roleSummary.js';

export const POSITION_TARGET_DAYS_KEY = 'position_target_days';

// ── Setting: target days (W2 / D9) ──────────────────────────────────────────

/** The saved target, or the default. Never throws. */
export async function getPositionTargetDays() {
  try {
    const row = await prisma.rpa_settings.findUnique({ where: { key: POSITION_TARGET_DAYS_KEY } });
    return parsePositionTargetDays(row?.value) ?? DEFAULT_POSITION_TARGET_DAYS;
  } catch (err) {
    logger.warn(`[openPositions] target days read failed, using ${DEFAULT_POSITION_TARGET_DAYS}: ${err.message}`);
    return DEFAULT_POSITION_TARGET_DAYS;
  }
}

/** @param {number} days already validated with parsePositionTargetDays */
export async function savePositionTargetDays(days, actedBy = 'unknown') {
  const previous = await getPositionTargetDays();
  await prisma.rpa_settings.upsert({
    where: { key: POSITION_TARGET_DAYS_KEY },
    update: { value: String(days) },
    create: { key: POSITION_TARGET_DAYS_KEY, value: String(days) },
  });
  logger.info(`[openPositions] target days changed ${previous} -> ${days} by ${actedBy}`);
  return { targetDays: days };
}

// ── Loading ─────────────────────────────────────────────────────────────────

const JOURNEY_SELECT = {
  id: true,
  cv_id: true,
  mrf_id: true,
  shortlist_id: true,
  created_at: true,
  closed_at: true,
  final_outcome: true,
  current_stage_key: true,
  current_stage_status: true,
  rpa_shortlisted_candidates: { select: { candidate_name: true, candidate_email: true } },
  rpa_offers: { select: { approval_status: true, approval_requested_at: true, created_at: true, candidate_decision: true } },
  rpa_pipeline_stage_events: {
    select: { event_type: true, stage_key: true, outcome: true, created_at: true },
    orderBy: { created_at: 'asc' },
  },
};

/**
 * Everything the board needs, in a handful of queries. Same MRF set as the
 * Positions tab (N39): every approved MRF, open or closed, plus any MRF with a
 * journey.
 */
async function loadBoard() {
  const [stages, journeys, targetDays] = await Promise.all([
    prisma.rpa_pipeline_stages.findMany({ where: { is_active: true }, orderBy: { sort_order: 'asc' } }),
    prisma.rpa_candidate_pipeline.findMany({ where: { mrf_id: { not: null } }, select: JOURNEY_SELECT }),
    getPositionTargetDays(),
  ]);
  const journeyMrfIds = [...new Set(journeys.map((j) => String(j.mrf_id)))].map((k) => BigInt(k));
  const mrfs = await prisma.rpa_mrf.findMany({
    where: {
      OR: [
        { approval_status: { in: ['approved', 'completed', LEGACY_MRF_CLOSED_STATUS] } },
        ...(journeyMrfIds.length ? [{ id: { in: journeyMrfIds } }] : []),
      ],
    },
    select: {
      id: true, position_hiring_for: true, number_of_positions: true, created_at: true, decided_at: true,
      date_of_request: true, filled_at: true, closed_at: true, closure_reason: true, paused_at: true, approval_status: true,
    },
    orderBy: { id: 'desc' },
  });
  const mrfIds = mrfs.map((m) => m.id);

  const journeyShortlistIds = new Set(journeys.map((j) => j.shortlist_id).filter((id) => id != null).map(String));
  const [shortlistRows, teamsInterviews, zekoInterviews, awaitingRows] = await Promise.all([
    prisma.rpa_shortlisted_candidates.findMany({
      where: { mrf_id: { in: mrfIds } },
      select: { id: true, cv_id: true, mrf_id: true, candidate_name: true, pipeline_status: true, shortlisted_at: true, recruiter_notes: true, shortlisted_by: true },
    }),
    prisma.rpa_interview_schedule.findMany({
      where: { occurrence_status: 'held', cancelled_at: null, rpa_candidate_pipeline: { mrf_id: { in: mrfIds } } },
      select: { scheduled_start_at: true, rpa_candidate_pipeline: { select: { mrf_id: true } } },
    }),
    prisma.rpa_zeko_candidate_pipeline.findMany({
      where: { completed_at: { not: null }, rpa_shortlisted_candidates: { mrf_id: { in: mrfIds } } },
      select: { completed_at: true, rpa_shortlisted_candidates: { select: { mrf_id: true } } },
    }),
    // Same rule as the "Awaiting feedback" tile in getPipelineAnalytics.
    prisma.rpa_interview_scorecard.findMany({
      where: {
        status: 'pending',
        sent_at: { not: null },
        token_expires_at: { gt: new Date() },
        rpa_interview_schedule: { occurrence_status: 'held', cancelled_at: null },
        rpa_candidate_pipeline: { final_outcome: null, mrf_id: { in: mrfIds } },
      },
      select: { pipeline_id: true, sent_at: true, rpa_interview_schedule: { select: { stage_key: true, interviewer_name: true } } },
    }),
  ]);

  const group = (rows, keyOf) => {
    const map = new Map();
    for (const r of rows) {
      const key = keyOf(r);
      if (key == null) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return map;
  };

  return {
    stages,
    stageLabel: (key) => stages.find((s) => s.stage_key === key)?.label || key,
    firstStageKey: stages[0]?.stage_key,
    targetDays,
    mrfs,
    journeys,
    journeysByMrf: group(journeys, (j) => String(j.mrf_id)),
    shortlistByMrf: group(shortlistRows, (r) => String(r.mrf_id)),
    // A screening reject never got a journey: its shortlist row is the record.
    screeningRejectsByMrf: group(
      shortlistRows.filter((r) => r.pipeline_status === STAGE_OUTCOMES.REJECTED && !journeyShortlistIds.has(String(r.id))),
      (r) => String(r.mrf_id),
    ),
    interviewsByMrf: group(
      [
        ...teamsInterviews.map((t) => ({ mrf: t.rpa_candidate_pipeline?.mrf_id, at: t.scheduled_start_at })),
        ...zekoInterviews.map((z) => ({ mrf: z.rpa_shortlisted_candidates?.mrf_id, at: z.completed_at })),
      ],
      (r) => (r.mrf == null ? null : String(r.mrf)),
    ),
    awaitingRows,
    awaitingIds: new Set(awaitingRows.map((r) => String(r.pipeline_id))),
  };
}

const boardMrfs = (board) => board.mrfs.map((m) => ({ id: m.id, role: m.position_hiring_for, openedAt: m.created_at }));

/** The stage most of a position's stuck candidates sit in, for the health reason. */
function topStuckStage(journeys, board, now, stuckDays) {
  const counts = new Map();
  for (const j of journeys) {
    const f = journeyFacts(j, { range: null, firstStageKey: board.firstStageKey, now, stuckDays });
    if (f.stuck) counts.set(j.current_stage_key, (counts.get(j.current_stage_key) || 0) + 1);
  }
  let best = null;
  for (const [key, n] of counts) if (!best || n > best.n) best = { key, n };
  return best ? board.stageLabel(best.key) : null;
}

/** One board row: the N39 columns, the range counts, since-opened totals and health. */
function buildRow(mrf, board, applicants, { range, prev, now, stuckDays }) {
  const key = String(mrf.id);
  const journeys = board.journeysByMrf.get(key) || [];
  const base = {
    journeys,
    screeningRejects: board.screeningRejectsByMrf.get(key) || [],
    interviews: (board.interviewsByMrf.get(key) || []).map((i) => i.at),
    awaitingIds: board.awaitingIds,
    firstStageKey: board.firstStageKey,
    now,
    stuckDays,
  };
  const a = applicants.get(key);
  const cur = positionCounts({ ...base, applicants: a.range, range });
  const all = positionCounts({ ...base, applicants: a.all, range: null });
  const before = prev ? positionCounts({ ...base, applicants: a.prev, range: prev }) : null;
  const timing = mrfTiming(mrf, now);
  const stuckStage = topStuckStage(journeys, board, now, stuckDays);
  const health = positionHealth({
    status: timing.status,
    daysOpen: timing.daysOpen,
    targetDays: board.targetDays,
    appliedLast7: a.last7.applied,
    appliedPrev7: a.prev7.applied,
    inPipeline: cur.in_pipeline,
    stuck: cur.stuck,
    awaitingFeedback: cur.awaiting_feedback,
    stuckStage,
  });
  // Per-stage reach (N39): of the journeys that started in the range.
  const [n39] = positionsOverview(journeys.filter((j) => inRange(j.created_at, range)), [mrf], board.stages, now);

  return {
    mrf_id: Number(mrf.id),
    ref: `MRF-${Number(mrf.id)}`,
    role: mrf.position_hiring_for || 'Role not recorded',
    status: timing.status,
    opened_at: timing.openedAt,
    closed_at: timing.endedAt,
    days_open: timing.daysOpen,
    openings: mrf.number_of_positions == null ? null : Number(mrf.number_of_positions),
    filled: all.joined_ever,
    closure_reason: mrf.closure_reason || null,
    health,
    stuck_stage: stuckStage,
    ...cur,
    previous: before
      ? {
        applied: before.applied, responded: before.responded, shortlisted: before.shortlisted, rejected: before.rejected,
        moved_forward: before.moved_forward, interviews: before.interviews, offers: before.offers, joined: before.joined,
      }
      : null,
    since_opened: {
      applied: all.applied, responded: all.responded, shortlisted: all.shortlisted, rejected: all.rejected,
      moved_forward: all.moved_forward, interviews: all.interviews, offers: all.offers, joined: all.joined,
      sources: all.sources,
    },
    applied_last7: a.last7.applied,
    applied_prev7: a.prev7.applied,
    first_applied_at: a.first_applied_at,
    // N39 columns, kept for the CSV and the stage breakdown.
    stage_counts: n39.stage_counts,
    offers_accepted: n39.offers_accepted,
    joining_ratio: n39.joining_ratio,
  };
}

async function boardRows(board, range, { stuckDays = DEFAULT_STUCK_DAYS, now = Date.now() } = {}) {
  const prev = previousPeriod(range);
  const last7 = lastNDays(7, new Date(now));
  const prev7 = previousPeriod(last7);
  const applicants = await applicantCountsByMrf(boardMrfs(board), { range, prev, all: null, last7, prev7 });
  return board.mrfs.map((mrf) => buildRow(mrf, board, applicants, { range, prev, now, stuckDays }));
}

const isOpenRow = (r) => r.status === 'Open' || r.status === 'Paused';

/** The tiles above the board: open positions only. */
function boardSummary(rows) {
  const open = rows.filter(isOpenRow);
  const sum = (k) => open.reduce((n, r) => n + (Number(r[k]) || 0), 0);
  const applied = sum('applied');
  const hasPrev = open.some((r) => r.previous);
  const appliedPrev = hasPrev ? open.reduce((n, r) => n + (r.previous?.applied || 0), 0) : null;
  return {
    open_positions: open.length,
    openings: open.reduce((n, r) => n + (r.openings || 0), 0),
    filled: sum('filled'),
    paused: open.filter((r) => r.status === 'Paused').length,
    at_risk: open.filter((r) => r.health.status === 'at_risk').length,
    watch: open.filter((r) => r.health.status === 'watch').length,
    applied,
    applied_previous: appliedPrev,
    responded: sum('responded'),
    shortlisted: sum('shortlisted'),
    in_pipeline: sum('in_pipeline'),
    stuck: sum('stuck'),
    awaiting_feedback: sum('awaiting_feedback'),
    shortlist_pct: percent(sum('shortlisted'), applied),
    response_pct: percent(sum('responded'), applied),
  };
}

/**
 * The Open Positions board. Every MRF the Positions tab lists, with the
 * range's numbers, since-opened totals and health; the screen filters
 * Open / Closed / All.
 *
 * @param {{ range?: object|null, stuckDays?: number }} [opts]
 */
export async function getOpenPositions({ range = null, stuckDays = DEFAULT_STUCK_DAYS } = {}) {
  const board = await loadBoard();
  const rows = (await boardRows(board, range, { stuckDays })).sort(comparePositions);
  return {
    range: rangeForResponse(range),
    previous: rangeForResponse(previousPeriod(range)),
    target_days: board.targetDays,
    stuck_days: stuckDays,
    stages: board.stages.map((s) => ({ stage_key: s.stage_key, label: s.label })),
    source_labels: SOURCE_LABELS,
    summary: boardSummary(rows),
    rows,
  };
}

/** A small "Roles needing attention" figure for the Dashboard pulse: always the last 7 days. */
export async function getOpenPositionsPulse() {
  const range = lastNDays(7);
  const board = await loadBoard();
  const rows = (await boardRows(board, range)).sort(comparePositions);
  // Per-day counts for the sparklines, in one query over the same MRF set.
  let daily = new Map();
  try {
    daily = await applicantDailyByMrf(boardMrfs(board), range);
  } catch (err) {
    logger.warn(`[openPositions] pulse sparklines failed: ${err.message}`);
  }
  const days = daysOf(range);
  return {
    range: rangeForResponse(range),
    summary: boardSummary(rows),
    rows: rows.filter((r) => r.status === 'Open').map((r) => ({
      mrf_id: r.mrf_id, ref: r.ref, role: r.role, days_open: r.days_open, health: r.health,
      applied: r.applied, applied_previous: r.previous?.applied ?? null, in_pipeline: r.in_pipeline,
      attention: r.stuck + r.awaiting_feedback + r.offers_awaiting_approval,
      daily: days.map((d) => ({ day: d, value: daily.get(String(r.mrf_id))?.get(d) || 0 })),
    })),
  };
}

// ── Role Summary (L06) ─────────────────────────────────────────────────────

/**
 * Analytics "Role Summary": shortlist-row outcomes per MRF for decisions made
 * in the range (shortlisted_at, which a rejection also stamps), with Total
 * applied, Moved forward and Shortlist % from the board so the two tabs agree.
 *
 * @param {{ range?: object|null }} [opts]
 */
export async function getRoleSummary({ range = null } = {}) {
  const [board, candidates] = await Promise.all([
    getOpenPositions({ range }),
    prisma.rpa_shortlisted_candidates.findMany({
      where: range ? { shortlisted_at: { gte: range.from, lt: range.to } } : {},
      select: { mrf_id: true, position_applied: true, pipeline_status: true, mrf: { select: { id: true, position_hiring_for: true } } },
    }),
  ]);
  return {
    range: board.range,
    rows: withBoardNumbers(groupByMrf(candidates), board.rows),
  };
}

// ── Role view ───────────────────────────────────────────────────────────────

const candidateName = (j) => j.rpa_shortlisted_candidates?.candidate_name || 'Candidate';

/** Week buckets beyond two months, so an "All" chart stays readable. */
function seriesBuckets(range) {
  const days = daysOf(range, 1200);
  if (days.length <= 62) return days.map((d) => ({ key: d, from: d, to: d }));
  const out = [];
  for (let i = 0; i < days.length; i += 7) {
    out.push({ key: days[i], from: days[i], to: days[Math.min(i + 6, days.length - 1)] });
  }
  return out;
}

function dailySeries(range, applicantRows, journeys) {
  const buckets = seriesBuckets(range);
  const index = new Map();
  buckets.forEach((b, i) => {
    for (const d of daysOf(makeRange(b.from, b.to))) index.set(d, i);
  });
  const series = buckets.map((b) => ({
    key: b.key,
    from: b.from,
    to: b.to,
    weekly: b.from !== b.to,
    sources: Object.fromEntries(SOURCE_KEYS.map((k) => [k, 0])),
    applied: 0,
    shortlisted: 0,
  }));
  for (const r of applicantRows) {
    const i = index.get(r.day);
    if (i === undefined) continue;
    series[i].sources[r.bucket] = (series[i].sources[r.bucket] || 0) + r.n;
    series[i].applied += r.n;
  }
  for (const j of journeys) {
    const i = index.get(istDay(j.created_at));
    if (i !== undefined) series[i].shortlisted += 1;
  }
  return series;
}

/** Stage moves, rejections, offers and joins in the range, newest first. */
async function activityList(mrfKey, board, range, applicantRows) {
  const journeys = board.journeysByMrf.get(mrfKey) || [];
  const byId = new Map(journeys.map((j) => [String(j.id), j]));
  const events = journeys.length
    ? await prisma.rpa_pipeline_stage_events.findMany({
      where: {
        pipeline_id: { in: journeys.map((j) => j.id) },
        event_type: { not: EVENT_TYPES.NOTE },
        ...(range ? { created_at: { gte: range.from, lt: range.to } } : {}),
      },
      select: {
        pipeline_id: true, event_type: true, stage_key: true, from_stage_key: true, outcome: true, created_at: true,
        reason_text: true, rpa_outcome_reasons: { select: { reason_label: true } }, rpa_users: { select: { username: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 200,
    })
    : [];

  const items = events.map((ev) => {
    const j = byId.get(String(ev.pipeline_id));
    const name = j ? candidateName(j) : 'Candidate';
    let text;
    if (ev.event_type === EVENT_TYPES.OUTCOME) {
      const reason = ev.rpa_outcome_reasons?.reason_label || ev.reason_text;
      const stage = board.stageLabel(ev.stage_key);
      const OUTCOME_TEXT = {
        rejected: `rejected at ${stage}`,
        approved: `passed ${stage}`,
        hold: `put on hold at ${stage}`,
        future_prospect: `kept as a future prospect at ${stage}`,
        joined: 'joined',
        joined_and_left: 'joined, then left',
        did_not_join: 'did not join',
        backed_out: 'backed out',
        candidate_withdrawn: 'withdrew',
        moved_to_other_jd: 'moved to another JD',
        closure_rejected: `rejected at ${stage}`,
        closure_on_hold: `closed on hold at ${stage}`,
        closure_approved: 'hired',
      };
      text = `${name} ${OUTCOME_TEXT[ev.outcome] || `${stage}: ${String(ev.outcome || 'updated').replace(/_/g, ' ')}`}${reason ? ` · ${reason}` : ''}`;
    } else if (ev.event_type === EVENT_TYPES.MOVED && ev.from_stage_key) {
      text = `${name} moved ${board.stageLabel(ev.from_stage_key)} → ${board.stageLabel(ev.stage_key)}`;
    } else if (isStageArrival(ev)) {
      text = ev.stage_key === board.firstStageKey ? `${name} shortlisted` : `${name} moved to ${board.stageLabel(ev.stage_key)}`;
    } else {
      text = `${name}: ${ev.event_type}`;
    }
    return { at: ev.created_at, kind: ev.event_type, text, by: ev.rpa_users?.username || null, pipeline_id: Number(ev.pipeline_id) };
  });

  // Screening rejections (no journey) in the range.
  for (const r of board.screeningRejectsByMrf.get(mrfKey) || []) {
    if (!inRange(r.shortlisted_at, range)) continue;
    items.push({
      at: r.shortlisted_at,
      kind: 'screening_reject',
      text: `${r.candidate_name || 'Candidate'} rejected at screening${r.recruiter_notes ? ` · ${r.recruiter_notes}` : ''}`,
      by: r.shortlisted_by || null,
      cv_id: r.cv_id ? String(r.cv_id) : null,
    });
  }

  // One line per day for uploads and vendor submissions tagged to this JD.
  const uploads = new Map();
  for (const row of applicantRows) {
    if (row.bucket !== 'hr_upload' && row.bucket !== 'vendor') continue;
    const u = uploads.get(row.day) || { hr_upload: 0, vendor: 0 };
    u[row.bucket] += row.n;
    uploads.set(row.day, u);
  }
  for (const [day, u] of uploads) {
    const parts = [];
    if (u.hr_upload) parts.push(`HR upload ${u.hr_upload}`);
    if (u.vendor) parts.push(`vendor ${u.vendor}`);
    items.push({ at: new Date(`${day}T12:00:00+05:30`), kind: 'upload', day_only: true, text: `${u.hr_upload + u.vendor} uploaded for this JD (${parts.join(', ')})`, by: null });
  }

  items.sort((x, y) => new Date(y.at) - new Date(x.at));
  return { total: items.length, items: items.slice(0, 60) };
}

/** Interviews in the next 7 days for one MRF: Teams rounds and Zeko windows. */
async function upcomingInterviews(mrfId, board, now = new Date()) {
  const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const [teams, zeko] = await Promise.all([
    prisma.rpa_interview_schedule.findMany({
      where: {
        scheduled_start_at: { gte: now, lte: horizon }, status: { not: 'cancelled' }, cancelled_at: null, superseded_at: null,
        rpa_candidate_pipeline: { mrf_id: BigInt(mrfId) },
      },
      select: {
        pipeline_id: true, stage_key: true, scheduled_start_at: true,
        rpa_candidate_pipeline: { select: { rpa_shortlisted_candidates: { select: { candidate_name: true } } } },
      },
      orderBy: { scheduled_start_at: 'asc' },
      take: 20,
    }),
    prisma.rpa_zeko_candidate_pipeline.findMany({
      where: {
        interview_start_at: { gte: now, lte: horizon }, status: { not: 'cancelled' }, cancelled_at: null,
        rpa_shortlisted_candidates: { mrf_id: BigInt(mrfId) },
      },
      select: { stage: true, interview_start_at: true, rpa_shortlisted_candidates: { select: { candidate_name: true, id: true } } },
      orderBy: { interview_start_at: 'asc' },
      take: 20,
    }),
  ]);
  return [
    ...teams.map((t) => ({
      at: t.scheduled_start_at, stage: board.stageLabel(t.stage_key), kind: 'teams', pipeline_id: Number(t.pipeline_id),
      candidate_name: t.rpa_candidate_pipeline?.rpa_shortlisted_candidates?.candidate_name || 'Candidate',
    })),
    ...zeko.map((z) => ({
      at: z.interview_start_at, stage: /fn|functional/i.test(z.stage || '') ? 'Zeko functional' : 'Zeko HR', kind: 'zeko',
      candidate_name: z.rpa_shortlisted_candidates?.candidate_name || 'Candidate',
    })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));
}

/** The lists behind "Needs attention" (W4). All "now". */
function attentionLists(mrfKey, board, now, stuckDays) {
  const journeys = board.journeysByMrf.get(mrfKey) || [];
  const stuck = [];
  const offers = [];
  for (const j of journeys) {
    const f = journeyFacts(j, { range: null, firstStageKey: board.firstStageKey, now, stuckDays });
    if (f.stuck) stuck.push({ pipeline_id: Number(j.id), candidate_name: candidateName(j), stage: board.stageLabel(j.current_stage_key), days: f.stageDays });
    if (f.offerAwaitingApproval) offers.push({ pipeline_id: Number(j.id), candidate_name: candidateName(j), requested_at: j.rpa_offers.approval_requested_at });
  }
  const journeyIds = new Set(journeys.map((j) => String(j.id)));
  const byId = new Map(journeys.map((j) => [String(j.id), j]));
  const feedback = board.awaitingRows
    .filter((r) => journeyIds.has(String(r.pipeline_id)))
    .map((r) => ({
      pipeline_id: Number(r.pipeline_id),
      candidate_name: candidateName(byId.get(String(r.pipeline_id))),
      stage: board.stageLabel(r.rpa_interview_schedule?.stage_key),
      interviewer: r.rpa_interview_schedule?.interviewer_name || null,
      sent_at: r.sent_at,
    }));
  stuck.sort((a, b) => b.days - a.days);
  return { stuck, feedback, offers };
}

/**
 * The role view (L06): KPIs against the previous period, the "This week"
 * sentence, needs attention, applications per day by source, the funnel since
 * opened, what happened, upcoming interviews and the open-to-close journey.
 *
 * @param {number|string} mrfId
 * @param {{ range?: object|null, stuckDays?: number }} [opts]
 */
export async function getRoleDetail(mrfId, { range = null, stuckDays = DEFAULT_STUCK_DAYS } = {}) {
  const board = await loadBoard();
  const key = String(mrfId);
  const mrf = board.mrfs.find((m) => String(m.id) === key);
  if (!mrf) throw new AppError('Position not found.', 404);

  const now = Date.now();
  const prev = previousPeriod(range);
  const last7 = lastNDays(7, new Date(now));
  const applicants = await applicantCountsByMrf(boardMrfs(board), { range, prev, all: null, last7, prev7: previousPeriod(last7) });
  const row = buildRow(mrf, board, applicants, { range, prev, now, stuckDays });

  // An "All time" chart runs from the day the position opened.
  const chartRange = range || makeRange(istDay(row.opened_at || mrf.created_at || new Date()), istDay(new Date()));
  const journeys = board.journeysByMrf.get(key) || [];
  const [daily, upcoming, respondedList] = await Promise.all([
    applicantDaily(boardMrfs(board), mrf.id, chartRange),
    upcomingInterviews(mrf.id, board),
    applicantList(boardMrfs(board), mrf.id, 'responded', range),
  ]);
  // Upload lines come from the daily rows, so this waits for them.
  const activity = await activityList(key, board, range, daily);

  const attention = attentionLists(key, board, now, stuckDays);
  const shortlistedCvIds = new Set((board.shortlistByMrf.get(key) || []).map((s) => String(s.cv_id)));
  const notReviewed = respondedList.filter((r) => !shortlistedCvIds.has(r.cv_id)).length;
  const today = istDay(new Date(now));
  const interviewsToday = upcoming.filter((u) => istDay(u.at) === today);

  const interviewDates = (board.interviewsByMrf.get(key) || []).map((i) => i.at).filter(Boolean).sort((a, b) => new Date(a) - new Date(b));
  const minDate = (values) => values.filter(Boolean).sort((a, b) => new Date(a) - new Date(b))[0] || null;
  const milestones = positionMilestones({
    requestedAt: mrf.date_of_request || mrf.created_at,
    approvedAt: mrf.decided_at,
    firstApplicantAt: row.first_applied_at,
    firstShortlistAt: minDate(journeys.map((j) => j.created_at)),
    firstInterviewAt: interviewDates[0] || null,
    firstOfferAt: minDate(journeys.map((j) => j.rpa_offers?.approval_requested_at || j.rpa_offers?.created_at)),
    firstJoinAt: minDate(journeys.filter((j) => ['joined', 'joined_and_left'].includes(j.final_outcome)).map((j) => j.closed_at)),
    endedAt: row.closed_at,
    status: row.status,
    openings: row.openings,
    joined: row.filled,
  });

  const nextInterview = upcoming[0] ? { at: fmtDateTimeIst(upcoming[0].at), stage: upcoming[0].stage } : null;
  const periodWord = !range ? null : range.days === 7 ? 'last week' : `the previous ${range.days} days`;
  const summary = summaryText({
    now: row, previous: row.previous, periodWord: periodWord || 'the previous period', stuckStage: row.stuck_stage, nextInterview,
  });

  // Funnel since opened: applicants, then every stage reached.
  const reachedAll = positionsOverview(journeys, [mrf], board.stages, now)[0];
  const funnel = [
    { key: 'applied', label: 'Applied', count: row.since_opened.applied },
    { key: 'responded', label: 'Responded', count: row.since_opened.responded },
    ...board.stages.map((s) => ({ key: s.stage_key, label: s.label, count: reachedAll.stage_counts[s.stage_key] || 0 })),
    { key: 'joined', label: 'Joined', count: row.filled },
  ];

  return {
    range: rangeForResponse(range),
    previous: rangeForResponse(prev),
    period_word: periodWord,
    position: row,
    summary_text: summary,
    kpis: ['applied', 'responded', 'shortlisted', 'rejected', 'moved_forward', 'interviews', 'offers'].map((k) => ({
      key: k, value: row[k], previous: row.previous ? row.previous[k] : null,
    })),
    attention: {
      ...attention,
      responded_not_reviewed: notReviewed,
      interviews_today: interviewsToday,
    },
    series: dailySeries(chartRange, daily, journeys.filter((j) => inRange(j.created_at, chartRange))),
    source_labels: SOURCE_LABELS,
    funnel,
    activity,
    upcoming,
    milestones,
  };
}

// ── W1: the candidates behind a number ──────────────────────────────────────

export const METRICS = Object.freeze([
  'applied', 'responded', 'shortlisted', 'rejected', 'moved_forward', 'offers', 'joined', 'interviews',
  'in_pipeline', 'on_hold', 'stuck', 'awaiting_feedback', 'offers_awaiting_approval',
]);

const METRIC_LABELS = {
  applied: 'Applied', responded: 'Responded', shortlisted: 'Shortlisted', rejected: 'Rejected', moved_forward: 'Moved forward',
  offers: 'Offers', joined: 'Joined', interviews: 'Interviews', in_pipeline: 'In pipeline', on_hold: 'On hold', stuck: 'Stuck',
  awaiting_feedback: 'Awaiting feedback', offers_awaiting_approval: 'Offers awaiting approval',
};

/**
 * The candidates behind one number on the board or the role view (W1). Each
 * row carries a pipeline id when the candidate has a journey for this MRF (the
 * screen opens the Pipeline drawer), else the CV id (the candidate profile).
 *
 * @param {number|string} mrfId
 * @param {string} metric one of METRICS
 * @param {{ range?: object|null, stuckDays?: number }} [opts]
 */
export async function getMetricCandidates(mrfId, metric, { range = null, stuckDays = DEFAULT_STUCK_DAYS } = {}) {
  if (!METRICS.includes(metric)) throw new AppError(`Unknown metric "${metric}". Expected one of: ${METRICS.join(', ')}.`, 400);
  const board = await loadBoard();
  const key = String(mrfId);
  const mrf = board.mrfs.find((m) => String(m.id) === key);
  if (!mrf) throw new AppError('Position not found.', 404);
  const now = Date.now();
  const journeys = board.journeysByMrf.get(key) || [];
  const journeyByCv = new Map(journeys.map((j) => [String(j.cv_id), j]));
  const nowLabel = (j) => {
    if (!j) return null;
    if (j.final_outcome) return String(j.final_outcome).replace(/^closure_/, '').replace(/_/g, ' ');
    return board.stageLabel(j.current_stage_key);
  };

  let rows = [];
  if (metric === 'applied' || metric === 'responded') {
    const list = await applicantList(boardMrfs(board), mrf.id, metric, range);
    const cvs = list.length
      ? await prisma.rpa_cv.findMany({ where: { id: { in: list.map((l) => BigInt(l.cv_id)) } }, select: { id: true, Name: true, EmailID: true } })
      : [];
    const cvById = new Map(cvs.map((c) => [String(c.id), c]));
    const shortlisted = new Set((board.shortlistByMrf.get(key) || []).map((s) => String(s.cv_id)));
    rows = list.map((l) => {
      const j = journeyByCv.get(l.cv_id);
      const cv = cvById.get(l.cv_id);
      const when = metric === 'responded' ? l.responded_at : l.linked_at;
      return {
        cv_id: l.cv_id,
        pipeline_id: j ? Number(j.id) : null,
        name: cv?.Name || 'Candidate',
        email: cv?.EmailID || null,
        detail: `${SOURCE_LABELS[l.bucket] || l.bucket} · ${metric === 'responded' ? 'responded' : 'applied'} ${fmtDate(when)}`,
        now: nowLabel(j) || (shortlisted.has(l.cv_id) ? 'Screened' : 'Not reviewed'),
        at: when,
      };
    });
  } else if (metric === 'rejected' || metric === 'interviews') {
    if (metric === 'rejected') {
      for (const j of journeys) {
        const f = journeyFacts(j, { range, firstStageKey: board.firstStageKey, now, stuckDays });
        if (f.rejected) rows.push({ cv_id: j.cv_id ? String(j.cv_id) : null, pipeline_id: Number(j.id), name: candidateName(j), detail: 'rejected in the pipeline', now: nowLabel(j), at: j.closed_at });
      }
      for (const r of board.screeningRejectsByMrf.get(key) || []) {
        if (!inRange(r.shortlisted_at, range)) continue;
        rows.push({ cv_id: r.cv_id ? String(r.cv_id) : null, pipeline_id: null, name: r.candidate_name || 'Candidate', detail: `rejected at screening${r.recruiter_notes ? ` · ${r.recruiter_notes}` : ''}`, now: 'Rejected', at: r.shortlisted_at });
      }
    } else {
      const held = await prisma.rpa_interview_schedule.findMany({
        where: {
          occurrence_status: 'held', cancelled_at: null, rpa_candidate_pipeline: { mrf_id: mrf.id },
          ...(range ? { scheduled_start_at: { gte: range.from, lt: range.to } } : {}),
        },
        select: { pipeline_id: true, stage_key: true, scheduled_start_at: true },
        orderBy: { scheduled_start_at: 'desc' },
      });
      const byId = new Map(journeys.map((j) => [String(j.id), j]));
      rows = held.map((h) => {
        const j = byId.get(String(h.pipeline_id));
        return { cv_id: j?.cv_id ? String(j.cv_id) : null, pipeline_id: Number(h.pipeline_id), name: j ? candidateName(j) : 'Candidate', detail: `${board.stageLabel(h.stage_key)} · ${fmtDate(h.scheduled_start_at)}`, now: nowLabel(j), at: h.scheduled_start_at };
      });
    }
  } else {
    const flag = {
      shortlisted: 'shortlisted', moved_forward: 'movedForward', offers: 'offer', joined: 'joined', in_pipeline: 'open',
      on_hold: 'onHold', stuck: 'stuck', awaiting_feedback: 'awaitingFeedback', offers_awaiting_approval: 'offerAwaitingApproval',
    }[metric];
    for (const j of journeys) {
      const f = journeyFacts(j, { range, firstStageKey: board.firstStageKey, now, stuckDays, awaiting: board.awaitingIds.has(String(j.id)) });
      if (!f[flag]) continue;
      const detail = metric === 'stuck'
        ? `${board.stageLabel(j.current_stage_key)} for ${f.stageDays} days`
        : `shortlisted ${fmtDate(j.created_at)}`;
      rows.push({ cv_id: j.cv_id ? String(j.cv_id) : null, pipeline_id: Number(j.id), name: candidateName(j), detail, now: nowLabel(j), at: j.created_at });
    }
  }
  rows.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  return {
    mrf_id: Number(mrf.id),
    role: mrf.position_hiring_for || 'Role not recorded',
    metric,
    label: METRIC_LABELS[metric],
    range: rangeForResponse(range),
    count: rows.length,
    rows,
  };
}

/** Plain-text label of the range for file names and report headers. */
export const describeRange = (range) => rangeLabel(range);

export default {
  getPositionTargetDays, savePositionTargetDays, getOpenPositions, getOpenPositionsPulse, getRoleSummary, getRoleDetail, getMetricCandidates, METRICS,
};
