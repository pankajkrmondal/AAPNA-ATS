/**
 * openPositions.helpers.js — the counting rules behind Analytics → Open
 * Positions and the role view (L06, design approved 22 Oct 2026).
 *
 * Pure: no Prisma, no Redis. The service loads rows; everything here is a
 * transformation of them, so each rule is unit tested
 * (tests/unit/openPositions.test.js).
 *
 * Which date each number uses (shown in its tooltip too):
 *   Applied        tag date, or the CV's added date when matched by Position Applied
 *   Responded      details-submitted date (see responseDateOf in the service)
 *   Shortlisted    the journey's start (rpa_candidate_pipeline.created_at)
 *   Rejected       the rejection event, a closure as rejected, or a screening reject
 *   Moved forward  the arrival event in a stage after the first
 *   Interviews     the interview's start (held Teams rounds, completed Zeko rounds)
 *   Offers         rpa_offers.approval_requested_at
 *   Joined         the journey's closed_at with a joined outcome
 * "Now" numbers (in pipeline, on hold, stuck, awaiting feedback, offers awaiting
 * approval) are a live snapshot and ignore the range (decision D6).
 */
import { FINAL_OUTCOMES, STAGE_OUTCOMES, isStageArrival } from '../config/pipelineStages.js';
import { MS_PER_DAY, JOINED_OUTCOMES, positionStatus, stageClockStart } from './pipelineAnalytics.helpers.js';
import { inRange } from '../utils/analyticsRange.js';

/** Health target: how long an open position may stay open before it is "At risk" (setting, D9). */
export const DEFAULT_POSITION_TARGET_DAYS = 45;
export const MIN_POSITION_TARGET_DAYS = 1;
export const MAX_POSITION_TARGET_DAYS = 365;
/** A candidate in the same stage this many days or more counts as stuck (the Pipeline Insights default). */
export const DEFAULT_STUCK_DAYS = 10;

/** A valid target in whole days, or null. */
export function parsePositionTargetDays(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= MIN_POSITION_TARGET_DAYS && n <= MAX_POSITION_TARGET_DAYS ? n : null;
}

/** Where an applicant came from, as the board splits it. */
export const SOURCE_KEYS = Object.freeze(['hr_upload', 'vendor', 'recruiter', 'other']);
export const SOURCE_LABELS = Object.freeze({
  hr_upload: 'HR upload',
  vendor: 'Vendor',
  recruiter: 'Added by recruiter',
  other: 'Mailbox, website & older uploads',
});

/**
 * The source bucket for one applicant link. Tagged links say how they were
 * made; an untagged CV matched by its Position Applied is a vendor upload when
 * the CV names a vendor, else "other" (mailbox, website, or an upload from
 * before JD tagging started on 21 Oct 2026).
 * @param {string|null} tagSource  rpa_candidate_mrf_tags.source, or null when matched by Position Applied
 * @param {boolean} [hasVendor]
 */
export function sourceBucket(tagSource, hasVendor = false) {
  if (tagSource === 'hr_manual_upload') return 'hr_upload';
  if (tagSource === 'vendor_portal') return 'vendor';
  if (tagSource) return 'recruiter'; // shortlist, search_candidate, change_jd, move, backfill
  return hasVendor ? 'vendor' : 'other';
}

/** Whole-number percentage, or null with nothing to divide by. */
export function percent(part, whole) {
  const w = Number(whole) || 0;
  return w > 0 ? Math.round(((Number(part) || 0) / w) * 100) : null;
}

const daysBetween = (from, to) => Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / MS_PER_DAY));

/**
 * What one journey contributes, in a range. Pure facts, no MRF context.
 * @param {object} j journey: created_at, closed_at, final_outcome, current_stage_key,
 *   current_stage_status, rpa_offers {approval_status, approval_requested_at, created_at},
 *   rpa_pipeline_stage_events [{event_type, stage_key, outcome, created_at}]
 * @param {{ range: object|null, firstStageKey?: string, now?: number, stuckDays?: number, awaiting?: boolean }} ctx
 */
export function journeyFacts(j, { range, firstStageKey, now = Date.now(), stuckDays = DEFAULT_STUCK_DAYS, awaiting = false }) {
  const events = j.rpa_pipeline_stage_events || [];
  const open = !j.final_outcome;
  const offer = j.rpa_offers || null;
  const stageDays = open ? daysBetween(stageClockStart(j), now) : 0;
  return {
    shortlisted: inRange(j.created_at, range),
    movedForward: events.some((ev) => isStageArrival(ev) && ev.stage_key !== firstStageKey && inRange(ev.created_at, range)),
    rejected: events.some((ev) => ev.outcome === STAGE_OUTCOMES.REJECTED && inRange(ev.created_at, range))
      || (j.final_outcome === FINAL_OUTCOMES.REJECTED && inRange(j.closed_at, range)),
    offer: Boolean(offer) && inRange(offer.approval_requested_at || offer.created_at, range),
    joined: JOINED_OUTCOMES.includes(j.final_outcome) && inRange(j.closed_at, range),
    joinedEver: JOINED_OUTCOMES.includes(j.final_outcome),
    // Now (D6)
    open,
    onHold: open && j.current_stage_status === STAGE_OUTCOMES.HOLD,
    stuck: open && stageDays >= stuckDays,
    stageDays,
    awaitingFeedback: open && awaiting,
    offerAwaitingApproval: open && Boolean(offer) && offer.approval_status === 'pending' && Boolean(offer.approval_requested_at),
  };
}

/**
 * The counts for one position in one range.
 *
 * @param {object} p
 * @param {Array}  p.journeys          this MRF's journeys (see journeyFacts)
 * @param {Array}  [p.screeningRejects] screening rejections with no journey: [{ shortlisted_at }]
 * @param {Array}  [p.interviews]       interview dates for this MRF: [Date|string]
 * @param {object} [p.applicants]       { applied, responded, sources: { hr_upload, vendor, recruiter, other } } for the range
 * @param {Set<string>} [p.awaitingIds] pipeline ids with feedback outstanding
 * @param {object|null} p.range
 * @param {string} [p.firstStageKey]
 * @param {number} [p.now]
 * @param {number} [p.stuckDays]
 */
export function positionCounts({
  journeys = [], screeningRejects = [], interviews = [], applicants = {}, awaitingIds = new Set(),
  range = null, firstStageKey, now = Date.now(), stuckDays = DEFAULT_STUCK_DAYS,
}) {
  const out = {
    applied: Number(applicants.applied) || 0,
    responded: Number(applicants.responded) || 0,
    sources: Object.fromEntries(SOURCE_KEYS.map((k) => [k, Number(applicants.sources?.[k]) || 0])),
    shortlisted: 0,
    rejected: 0,
    moved_forward: 0,
    interviews: interviews.filter((d) => inRange(d, range)).length,
    offers: 0,
    joined: 0,
    joined_ever: 0,
    in_pipeline: 0,
    on_hold: 0,
    stuck: 0,
    awaiting_feedback: 0,
    offers_awaiting_approval: 0,
  };
  for (const j of journeys) {
    const f = journeyFacts(j, { range, firstStageKey, now, stuckDays, awaiting: awaitingIds.has(String(j.id)) });
    if (f.shortlisted) out.shortlisted += 1;
    if (f.movedForward) out.moved_forward += 1;
    if (f.rejected) out.rejected += 1;
    if (f.offer) out.offers += 1;
    if (f.joined) out.joined += 1;
    if (f.joinedEver) out.joined_ever += 1;
    if (f.open) out.in_pipeline += 1;
    if (f.onHold) out.on_hold += 1;
    if (f.stuck) out.stuck += 1;
    if (f.awaitingFeedback) out.awaiting_feedback += 1;
    if (f.offerAwaitingApproval) out.offers_awaiting_approval += 1;
  }
  out.rejected += screeningRejects.filter((r) => inRange(r.shortlisted_at, range)).length;
  out.shortlist_pct = percent(out.shortlisted, out.applied);
  out.response_pct = percent(out.responded, out.applied);
  return out;
}

/**
 * Position health for the dot (W2), with the reasons behind it (D9). Always
 * judged on the last 7 days, whatever range the page shows: it is "how is
 * this role doing now".
 *
 * At risk  open longer than the target, or no applicants in 7 days with fewer than 3 in the pipeline
 * Watch    any stuck candidate or overdue feedback, no applicants in 7 days,
 *          or applicants down more than 50% on the 7 days before
 * On track none of the above
 *
 * @param {{ status: string, daysOpen: number|null, targetDays?: number, appliedLast7: number,
 *   appliedPrev7: number, inPipeline: number, stuck: number, awaitingFeedback: number, stuckStage?: string|null }} p
 * @returns {{ status: 'at_risk'|'watch'|'on_track'|'paused'|'closed', label: string, reasons: string[] }}
 */
export function positionHealth({
  status, daysOpen, targetDays = DEFAULT_POSITION_TARGET_DAYS, appliedLast7 = 0, appliedPrev7 = 0,
  inPipeline = 0, stuck = 0, awaitingFeedback = 0, stuckStage = null,
}) {
  if (status === 'Paused') return { status: 'paused', label: 'Paused', reasons: ['Hiring is paused'] };
  if (status === 'Filled' || status === 'Closed') return { status: 'closed', label: status, reasons: [] };

  const red = [];
  const amber = [];
  if (daysOpen != null && daysOpen > targetDays) red.push(`Open ${daysOpen} days · target ${targetDays}`);
  if (appliedLast7 === 0) {
    (inPipeline < 3 ? red : amber).push('No new applicants in 7 days');
  } else if (appliedPrev7 > 0 && appliedLast7 < appliedPrev7 * 0.5) {
    amber.push(`Applicants down ${Math.round((1 - appliedLast7 / appliedPrev7) * 100)}% on last week`);
  }
  if (stuck > 0) amber.push(`${stuck} stuck${stuckStage ? ` in ${stuckStage}` : ''}`);
  if (awaitingFeedback > 0) amber.push(`${awaitingFeedback} awaiting feedback`);

  if (red.length) return { status: 'at_risk', label: 'At risk', reasons: [...red, ...amber] };
  if (amber.length) return { status: 'watch', label: 'Watch', reasons: amber };
  return { status: 'on_track', label: 'On track', reasons: [] };
}

const HEALTH_ORDER = { at_risk: 0, watch: 1, on_track: 2, paused: 3, closed: 4 };

/** Board order: worst health first, then the longest open. */
export function comparePositions(a, b) {
  const h = (HEALTH_ORDER[a.health?.status] ?? 9) - (HEALTH_ORDER[b.health?.status] ?? 9);
  if (h !== 0) return h;
  return (b.days_open ?? -1) - (a.days_open ?? -1);
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The "This week" sentence at the top of the role view (W3). Rule-based, so it
 * costs nothing and always matches the numbers beside it. Also the text the
 * Copy button gives for the hiring-manager update.
 *
 * @param {object} p
 * @param {object} p.now        positionCounts for the range
 * @param {object} [p.previous] positionCounts for the previous period (null for All time)
 * @param {string} [p.periodWord] "last week" / "the previous 30 days" — what `previous` is
 * @param {string|null} [p.stuckStage]
 * @param {{ at: string, stage: string }|null} [p.nextInterview] at already formatted
 */
export function summaryText({ now, previous = null, periodWord = 'the previous period', stuckStage = null, nextInterview = null }) {
  const diff = previous ? now.applied - previous.applied : null;
  let applied = `${plural(now.applied, 'new applicant')}`;
  if (diff !== null && diff !== 0) applied += ` (${Math.abs(diff)} ${diff > 0 ? 'more' : 'fewer'} than ${periodWord})`;
  const parts = [applied, `${now.responded} responded`, `${now.shortlisted} shortlisted`];
  if (now.moved_forward) parts.push(`${now.moved_forward} moved forward`);
  if (now.offers) parts.push(plural(now.offers, 'offer') + ' made');
  if (now.joined) parts.push(`${now.joined} joined`);
  const last = parts.pop();
  const sentences = [`${parts.length ? `${parts.join(', ')} and ${last}` : last}.`];

  const waits = [];
  if (now.stuck) waits.push(`${plural(now.stuck, 'candidate has', 'candidates have')} waited${stuckStage ? ` in ${stuckStage}` : ''} for 10 days or more`);
  if (now.awaiting_feedback) waits.push(`${plural(now.awaiting_feedback, 'interview is', 'interviews are')} waiting for feedback`);
  if (now.offers_awaiting_approval) waits.push(`${plural(now.offers_awaiting_approval, 'offer is', 'offers are')} waiting for approval`);
  if (waits.length) {
    const w = waits.map((s, i) => (i === 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s));
    sentences.push(`${w.length > 1 ? `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}` : w[0]}.`);
  }
  if (nextInterview) sentences.push(`Next interview: ${nextInterview.at} (${nextInterview.stage}).`);
  return sentences.join(' ');
}

/**
 * The open-to-close milestones of one position (Anuj's "journey of a
 * position"), each with the days since the one before. A milestone not reached
 * yet has no date.
 *
 * @param {{ requestedAt?: unknown, approvedAt?: unknown, firstApplicantAt?: unknown, firstShortlistAt?: unknown,
 *   firstInterviewAt?: unknown, firstOfferAt?: unknown, firstJoinAt?: unknown, endedAt?: unknown,
 *   status: string, openings?: number|null, joined?: number }} p
 * @returns {Array<{ key: string, label: string, at: string|null, days_after_previous: number|null }>}
 */
export function positionMilestones(p) {
  const openings = Number(p.openings) || 0;
  const joined = Number(p.joined) || 0;
  const finalLabel = p.status === 'Closed' ? 'Closed' : 'Filled';
  const list = [
    ['requested', 'Requested', p.requestedAt],
    ['approved', 'Approved', p.approvedAt],
    ['first_applicant', 'First applicant', p.firstApplicantAt],
    ['first_shortlist', 'First shortlist', p.firstShortlistAt],
    ['first_interview', 'First interview', p.firstInterviewAt],
    ['first_offer', 'First offer', p.firstOfferAt],
    ['first_join', openings > 1 ? `${joined} of ${openings} joined` : 'Joined', p.firstJoinAt],
    ['end', finalLabel, p.status === 'Filled' || p.status === 'Closed' ? p.endedAt : null],
  ];
  let prev = null;
  return list.map(([key, label, at]) => {
    const iso = at ? new Date(at).toISOString() : null;
    const days = iso && prev ? daysBetween(prev, iso) : null;
    if (iso) prev = iso;
    return { key, label, at: iso, days_after_previous: days };
  });
}

/** Status and days open for one MRF, as the Positions tab (N39) has always computed them. */
export function mrfTiming(mrf, now = Date.now()) {
  const status = positionStatus(mrf);
  const openedAt = mrf.decided_at || mrf.created_at || null;
  const endedAt = status === 'Filled' || status === 'Closed' ? (mrf.closed_at || mrf.filled_at || null) : null;
  const daysOpen = openedAt ? daysBetween(openedAt, endedAt || now) : null;
  return { status, openedAt, endedAt, daysOpen };
}

export default {
  DEFAULT_POSITION_TARGET_DAYS, DEFAULT_STUCK_DAYS, parsePositionTargetDays, SOURCE_KEYS, SOURCE_LABELS, sourceBucket,
  percent, journeyFacts, positionCounts, positionHealth, comparePositions, summaryText, positionMilestones, mrfTiming,
};
