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
} from '../config/pipelineStages.js';

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
 * @param {object} [query] - req.query
 * @returns {{mrfId: number|null, rejectionWindowDays?: number, stuckThresholdDays?: number, holdThresholdDays?: number}}
 */
export function parseAnalyticsParams(query = {}) {
  return {
    mrfId: intParam(query.mrf_id) ?? null,
    rejectionWindowDays: intParam(query.rejection_window_days),
    stuckThresholdDays: intParam(query.stuck_threshold_days),
    holdThresholdDays: intParam(query.hold_threshold_days),
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

export default {
  lastTransitionOf,
  stageClockStart,
  stageDurations,
  bucketFor,
  timeToHireFor,
  parseAnalyticsParams,
  MS_PER_DAY,
};
