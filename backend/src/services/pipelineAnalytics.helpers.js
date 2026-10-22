/**
 * pipelineAnalytics.helpers.js — the pure arithmetic behind the Recruitment
 * Analytics page (docs/Recruitment-Analytics.md).
 *
 * Deliberately dependency-free: no Prisma, no Redis, no sockets. These live
 * apart from pipeline.service.js because importing that service opens a shared
 * Redis connection that never closes, which hangs `node --test` — so anything
 * kept in there is effectively untestable. Every function below is a pure
 * transformation of rows the caller has already fetched.
 *
 * Two defect classes are encoded here, both of which produced silently wrong
 * numbers rather than errors:
 *
 *   TIME — durations and staleness must be measured between STAGE TRANSITIONS.
 *   Reading "the next event of any type" swept in 'note' rows, which the
 *   M3/M4/M5 services write liberally, so a scorecard email reset a stalled
 *   candidate's clock to zero.
 *
 *   BUCKETS — a journey belongs to exactly ONE conversion bucket. Independent
 *   per-column `if`s let a row be counted twice and columns exceed the total,
 *   which makes any rate derived from them meaningless.
 */
import {
  FINAL_OUTCOMES,
  STAGE_OUTCOMES,
  HIRED_OUTCOMES,
  isTransitionEvent,
  isStageArrival,
  isMrfFilled,
  MRF_CLOSURE_REASONS,
} from '../config/pipelineStages.js';
import { parseAnalyticsRange } from '../utils/analyticsRange.js';

export const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Parse one optional positive integer query param; undefined keeps the service default. */
function intParam(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Turn an analytics query string into getPipelineAnalytics() arguments.
 *
 * Used by BOTH the screen's controller and the CSV export, because the export
 * previously ignored the query entirely: it always fetched the unfiltered,
 * all-MRF set while the success toast told the user the file matched what they
 * were looking at. Two parsers is how that silently comes back.
 *
 * Every field is optional and falls through to the service's own defaults, so a
 * request with no query is byte-identical to the old behaviour. Junk values
 * yield `undefined` rather than NaN — a NaN threshold would make every
 * comparison false and silently empty the list.
 *
 * `range` (L06) is the page's date range: `from` / `to` (YYYY-MM-DD) or
 * `preset`. Null means "All time" — the behaviour of every call before L06.
 *
 * @param {object} [query] - req.query
 * @returns {{mrfId: number|null, rejectionWindowDays?: number, stuckThresholdDays?: number, holdThresholdDays?: number, range: object|null}}
 */
export function parseAnalyticsParams(query = {}) {
  return {
    mrfId: intParam(query.mrf_id) ?? null,
    rejectionWindowDays: intParam(query.rejection_window_days),
    stuckThresholdDays: intParam(query.stuck_threshold_days),
    holdThresholdDays: intParam(query.hold_threshold_days),
    range: parseAnalyticsRange(query),
  };
}

/**
 * The last event that MOVED this journey, ignoring notes.
 *
 * A 'note' (scorecard emailed, interview rescheduled, documents requested) is
 * activity ON a stalled journey, not an exit from the stall. Reading the last
 * event of ANY type meant a chatty stage looked freshly active — precisely
 * backwards, because the notes pile up while nobody decides.
 *
 * @param {{ rpa_pipeline_stage_events?: Array }} journey
 * @returns {object|null}
 */
export function lastTransitionOf(journey) {
  const events = journey?.rpa_pipeline_stage_events || [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (isTransitionEvent(events[i])) return events[i];
  }
  return null;
}

/**
 * When the clock on the journey's CURRENT stage started.
 *
 * Prefers the 'entered' event for the stage it is actually sitting in; falls
 * back to the last transition of any kind, then to the row's creation. That
 * last fallback is created_at and NOT modified_at on purpose: modified_at is
 * bumped by non-transition writes (dispatch stamps, pause toggles), which is
 * the same "activity looks like movement" bug one level down.
 *
 * @param {object} journey
 * @returns {Date|string|undefined}
 */
export function stageClockStart(journey) {
  const events = journey?.rpa_pipeline_stage_events || [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    // 'skip' counts: it is how a candidate ARRIVES in a stage they reached by
    // bypassing an optional one before it.
    if (ev.stage_key === journey.current_stage_key && isStageArrival(ev)) {
      return ev.created_at;
    }
  }
  return lastTransitionOf(journey)?.created_at || journey?.created_at;
}

/**
 * Days spent in each stage of one journey, keyed by stage_key.
 *
 * A stage begins at its 'entered' event and ends at the next TRANSITION —
 * never at the next note. Pairing 'entered' with the next event of any type
 * measured "time until someone typed something", which is why stage averages
 * collapsed toward zero as M3–M5 shipped more note-writers.
 *
 * Journeys whose events contain no arrival are skipped rather than measured
 * from whatever event happens to be first: attributing a note's timestamp to a
 * stage is a wrong number, and a missing one is honest.
 *
 * @param {Array} events - stage events, chronological
 * @param {Date|string} closedAt - end of the final still-open stage
 * @returns {Map<string, number>} stage_key -> days
 */
export function stageDurations(events, closedAt) {
  const transitions = (events || []).filter(isTransitionEvent);
  const out = new Map();
  for (let i = 0; i < transitions.length; i += 1) {
    const ev = transitions[i];
    if (!isStageArrival(ev)) continue;
    const next = transitions[i + 1];
    const start = new Date(ev.created_at).getTime();
    const end = next ? new Date(next.created_at).getTime() : new Date(closedAt).getTime();
    const days = Math.max(0, (end - start) / MS_PER_DAY);
    out.set(ev.stage_key, (out.get(ev.stage_key) || 0) + days);
  }
  return out;
}

/**
 * The ONE bucket a journey belongs to for conversion reporting.
 *
 * Mutually exclusive by construction: the buckets must sum to the number of
 * journeys, or the rate computed from them is not a rate. Previously each
 * column was an independent `if`, so an open journey counted as "shortlisted"
 * AND could appear under on-hold.
 *
 * Closed state wins over live state — a rejected journey's last stage status is
 * irrelevant once it is closed.
 *
 * @param {object} journey
 * @returns {'hired'|'rejected'|'on_hold'|'in_progress'|'closed_other'}
 */
export function bucketFor(journey) {
  if (journey.final_outcome) {
    if (HIRED_OUTCOMES.includes(journey.final_outcome)) return 'hired';
    if (journey.final_outcome === FINAL_OUTCOMES.REJECTED) return 'rejected';
    if (journey.final_outcome === FINAL_OUTCOMES.ON_HOLD) return 'on_hold';
    return 'closed_other';
  }
  if (journey.current_stage_status === STAGE_OUTCOMES.REJECTED) return 'rejected';
  if (journey.current_stage_status === STAGE_OUTCOMES.HOLD) return 'on_hold';
  return 'in_progress';
}

/** Middle value of a numeric array, averaging the two middles when even. */
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Time-to-hire: how long a hire actually takes, plus the per-stage breakdown.
 *
 * The headline was previously the SUM of the per-stage averages, presented as
 * "Average days, shortlist to offer". That number describes no real candidate:
 * each stage is averaged over a DIFFERENT population — someone rejected at
 * Tech-1 contributes to Tech-1's average and to no other — so adding them up
 * mixes cohorts. It is now measured end-to-end on the only journeys that have
 * an end: the hired ones, created_at → closed_at.
 *
 * MEDIAN, not mean. Hiring sets are small and long-tailed; one 200-day
 * requisition drags a mean somewhere no candidate has ever been.
 *
 * `median_days` is null — never 0 — when nothing has been hired yet. A
 * confident "0 days" over an empty set is the same class of defect as the one
 * this function replaces.
 *
 * The per-stage rows are kept: averaged within a single stage they are honest,
 * and the screen labels them separately. They now carry their own sample_size
 * so a stage averaged over one journey cannot be read as a settled figure, and
 * a stage that genuinely takes minutes reports 0 rather than being dropped.
 *
 * @param {Array} journeys - rpa_candidate_pipeline rows with rpa_pipeline_stage_events
 * @param {Array} stages - active rpa_pipeline_stages, in sort order
 * @returns {{median_days: number|null, sample_size: number, stages: Array}}
 */
export function timeToHireFor(journeys = [], stages = []) {
  // ── Headline: end-to-end, hired journeys only ──
  const hiredDurations = [];
  for (const j of journeys) {
    if (bucketFor(j) !== 'hired') continue;
    const start = new Date(j.created_at).getTime();
    const end = new Date(j.closed_at || j.modified_at).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    hiredDurations.push(Math.max(0, (end - start) / MS_PER_DAY));
  }
  const medianDays = median(hiredDurations);

  // ── Per-stage: averaged across every CLOSED journey, hired or not ──
  // Wider than the headline on purpose: a stage's duration is meaningful even
  // for a journey that ended in a rejection, and restricting it to hires would
  // leave most stages with a sample of nearly nothing.
  const totals = new Map(); // stage_key -> { totalDays, count }
  for (const j of journeys) {
    if (!j.final_outcome) continue;
    for (const [key, days] of stageDurations(j.rpa_pipeline_stage_events, j.closed_at || j.modified_at)) {
      if (!totals.has(key)) totals.set(key, { totalDays: 0, count: 0 });
      const agg = totals.get(key);
      agg.totalDays += days;
      agg.count += 1;
    }
  }

  const stageRows = stages
    .map((s) => {
      const agg = totals.get(s.stage_key);
      return {
        stage_key: s.stage_key,
        label: s.label,
        // Rounded to 0.1d for display. A stage measured in minutes lands on 0
        // and STAYS in the list — the old `avg_days > 0` filter deleted exactly
        // the stages that are working fastest.
        avg_days: agg && agg.count > 0 ? Math.round((agg.totalDays / agg.count) * 10) / 10 : 0,
        sample_size: agg ? agg.count : 0,
      };
    })
    .filter((row) => row.sample_size > 0);

  return {
    median_days: medianDays === null ? null : Math.round(medianDays * 10) / 10,
    sample_size: hiredDurations.length,
    stages: stageRows,
  };
}

/** Outcomes that mean the candidate actually started (N39 joining ratio). */
export const JOINED_OUTCOMES = Object.freeze([FINAL_OUTCOMES.JOINED, FINAL_OUTCOMES.JOINED_AND_LEFT]);

/**
 * Where a requisition stands, in one word for the Positions tab (N39).
 * Closed wins over Filled only when the business closed it for another reason.
 * @returns {'Open'|'Paused'|'Filled'|'Closed'}
 */
export function positionStatus(mrf) {
  if (!mrf) return 'Open';
  const filled = isMrfFilled(mrf) || mrf.closure_reason === MRF_CLOSURE_REASONS.ALL_OPENINGS_FILLED;
  if (mrf.closed_at != null && !filled) return 'Closed';
  if (filled) return 'Filled';
  if (mrf.paused_at != null) return 'Paused';
  return 'Open';
}

/**
 * The stages a journey reached: its arrival events ('entered' / 'skip'), or —
 * for a journey with none, predating the event log — every stage up to its
 * current one. The same rule as the single-MRF funnel in getPipelineAnalytics.
 * @returns {Set<string>} stage keys
 */
export function reachedStages(journey, stages) {
  const arrivals = (journey.rpa_pipeline_stage_events || []).filter(isStageArrival);
  if (arrivals.length) return new Set(arrivals.map((ev) => ev.stage_key));
  const current = stages.find((st) => st.stage_key === journey.current_stage_key);
  if (!current) return new Set();
  return new Set(stages.filter((s) => s.sort_order <= current.sort_order).map((s) => s.stage_key));
}

/**
 * One row per requisition for Analytics' Positions tab (N39): how long it has
 * been open, how far its candidates got, and how many offers turned into
 * joiners. Pure — the service loads the rows.
 *
 *   - shortlisted     every journey for the MRF
 *   - movedForward    journeys that reached any stage after the first board stage
 *   - stageCounts     journeys that reached each stage (arrival rule above)
 *   - offersMade      journeys with an offer record; accepted = candidate said yes
 *   - joined          final outcome joined (or joined and later left)
 *   - hired           HIRED_OUTCOMES (approved / joined), as Analytics counts hires
 *   - joiningRatio    joined ÷ accepted, as a whole percent; null with no acceptances
 *
 * @param {Array} journeys  rpa_candidate_pipeline rows with rpa_pipeline_stage_events and rpa_offers
 * @param {Array} mrfs      rpa_mrf rows (id, position_hiring_for, number_of_positions, created_at,
 *                          decided_at, filled_at, closed_at, closure_reason, paused_at, approval_status)
 * @param {Array} stages    active rpa_pipeline_stages, in sort order
 * @param {number} [now]    epoch ms
 */
export function positionsOverview(journeys = [], mrfs = [], stages = [], now = Date.now()) {
  const byMrf = new Map();
  for (const j of journeys) {
    if (!j.mrf_id) continue;
    const key = String(j.mrf_id);
    if (!byMrf.has(key)) byMrf.set(key, []);
    byMrf.get(key).push(j);
  }
  const firstStageKey = stages[0]?.stage_key;

  return mrfs.map((mrf) => {
    const list = byMrf.get(String(mrf.id)) || [];
    const stageCounts = Object.fromEntries(stages.map((s) => [s.stage_key, 0]));
    let movedForward = 0;
    let offersMade = 0;
    let accepted = 0;
    let joined = 0;
    let hired = 0;
    let open = 0;
    for (const j of list) {
      const reached = reachedStages(j, stages);
      for (const key of reached) if (key in stageCounts) stageCounts[key] += 1;
      if ([...reached].some((key) => key !== firstStageKey && key in stageCounts)) movedForward += 1;
      if (j.rpa_offers) {
        offersMade += 1;
        if (j.rpa_offers.candidate_decision === 'accepted') accepted += 1;
      }
      if (JOINED_OUTCOMES.includes(j.final_outcome)) joined += 1;
      if (bucketFor(j) === 'hired') hired += 1;
      if (!j.final_outcome) open += 1;
    }

    const status = positionStatus(mrf);
    const openedAt = mrf.decided_at || mrf.created_at || null;
    const endedAt = status === 'Filled' || status === 'Closed' ? (mrf.closed_at || mrf.filled_at || null) : null;
    const daysOpen = openedAt
      ? Math.max(0, Math.floor(((endedAt ? new Date(endedAt).getTime() : now) - new Date(openedAt).getTime()) / MS_PER_DAY))
      : null;

    return {
      mrf_id: Number(mrf.id),
      ref: `MRF-${Number(mrf.id)}`,
      role: mrf.position_hiring_for || 'Role not recorded',
      status,
      opened_at: openedAt,
      closed_at: endedAt,
      days_open: daysOpen,
      openings: mrf.number_of_positions == null ? null : Number(mrf.number_of_positions),
      shortlisted: list.length,
      in_pipeline: open,
      moved_forward: movedForward,
      stage_counts: stageCounts,
      offers_made: offersMade,
      offers_accepted: accepted,
      joined,
      hired,
      joining_ratio: accepted > 0 ? Math.round((joined / accepted) * 100) : null,
      closure_reason: mrf.closure_reason || null,
    };
  });
}

export default {
  lastTransitionOf,
  stageClockStart,
  stageDurations,
  bucketFor,
  timeToHireFor,
  positionsOverview,
  positionStatus,
  parseAnalyticsParams,
  MS_PER_DAY,
};
