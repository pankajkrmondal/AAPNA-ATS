/**
 * Candidate activity for screening order (L01, approved 22 Oct 2026).
 *
 * RT wants candidates who are actually interested at the top. Interest is read
 * from the missing-details form: when we REQUESTED details
 * (rpa_cv.details_requested_at) and when the candidate SUBMITTED them
 * (rpa_cv.details_completed_at). Completions before 14 Oct 2026 have no date,
 * only cvMissingTokenStatus = 'RECEIVED'.
 *
 * Statuses, best first (Option A, A1 on):
 *   1 Active           submitted within the active window
 *   2 Pending response requested within the window, not submitted yet
 *   2 New applicant    never requested, added within the window (A1)
 *   3 Inactive         everything else: old response, no response since an
 *                      old request, or never contacted
 *
 * Within a status the match score decides; among Active candidates with equal
 * scores the faster responder goes first (A2, compareResponseSpeed).
 *
 * Pure: no Prisma, so every rule is unit tested (tests/unit/candidateActivity.test.js).
 */
import { fmtDate } from './dateFormat.js';
import { respondedIn } from './missingDetails.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const ACTIVITY = Object.freeze({
  ACTIVE: 'active',
  PENDING: 'pending',
  NEW: 'new',
  INACTIVE: 'inactive',
});

export const ACTIVITY_LABELS = Object.freeze({
  active: 'Active',
  pending: 'Pending response',
  new: 'New applicant',
  inactive: 'Inactive',
});

/** Sort rank: lower first. Pending response and New applicant share a rank. */
export const ACTIVITY_RANK = Object.freeze({ active: 1, pending: 2, new: 2, inactive: 3 });

/** The active window: admin setting `candidate_active_window_days`. */
export const DEFAULT_ACTIVE_WINDOW_DAYS = 15;
export const MIN_ACTIVE_WINDOW_DAYS = 1;
export const MAX_ACTIVE_WINDOW_DAYS = 365;

/**
 * A valid window in whole days, or null.
 * @param {unknown} value
 * @returns {number|null}
 */
export function parseActiveWindowDays(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < MIN_ACTIVE_WINDOW_DAYS || n > MAX_ACTIVE_WINDOW_DAYS) return null;
  return n;
}

function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {object} c candidate row: details_requested_at, details_completed_at,
 *   cvMissingTokenStatus, createdAt, statusActive
 * @param {{ now?: Date, windowDays?: number }} [opts]
 * @returns {{ status: string, rank: number, label: string, detail: string,
 *   requestedAt: string|null, respondedAt: string|null, responseDays: number|null }}
 */
export function candidateActivity(c, { now = new Date(), windowDays = DEFAULT_ACTIVE_WINDOW_DAYS } = {}) {
  const cutoff = now.getTime() - (parseActiveWindowDays(windowDays) ?? DEFAULT_ACTIVE_WINDOW_DAYS) * DAY_MS;
  const requested = toDate(c?.details_requested_at);
  const completed = toDate(c?.details_completed_at);
  const added = toDate(c?.createdAt);
  const receivedNoDate = !completed && String(c?.cvMissingTokenStatus || '').toUpperCase() === 'RECEIVED';
  const recent = (d) => d != null && d.getTime() >= cutoff;

  const out = (status, detail, extra = {}) => ({
    status,
    rank: ACTIVITY_RANK[status],
    label: ACTIVITY_LABELS[status],
    detail,
    requestedAt: requested ? requested.toISOString() : null,
    respondedAt: completed ? completed.toISOString() : null,
    responseDays: null,
    ...extra,
  });

  if (completed) {
    if (!recent(completed)) return out(ACTIVITY.INACTIVE, `last response ${fmtDate(completed)}`);
    const waited = respondedIn(requested, completed);
    const days = requested ? Math.max(0, Math.floor((completed.getTime() - requested.getTime()) / DAY_MS)) : null;
    return out(
      ACTIVITY.ACTIVE,
      waited ? `${waited} (${fmtDate(completed)})` : `responded ${fmtDate(completed)}`,
      { responseDays: days },
    );
  }
  if (receivedNoDate) {
    // Submitted before the dates were kept: the request date is the best clue.
    return recent(requested)
      ? out(ACTIVITY.ACTIVE, 'response date not recorded')
      : out(ACTIVITY.INACTIVE, 'last response date not recorded');
  }
  if (requested) {
    return recent(requested)
      ? out(ACTIVITY.PENDING, `details requested ${fmtDate(requested)}`)
      : out(ACTIVITY.INACTIVE, `no response since ${fmtDate(requested)}`);
  }
  if (recent(added)) {
    const complete = String(c?.statusActive || '').toUpperCase() === 'ACTIVE';
    return out(ACTIVITY.NEW, complete ? 'profile complete' : 'details not yet requested');
  }
  return out(ACTIVITY.INACTIVE, 'never contacted');
}

/**
 * "Active candidates first" request flag: on unless the request says false
 * (JSON false, or 'false' / '0' from a query string).
 * @param {unknown} v
 */
export const parseActiveFirst = (v) => !(v === false || v === 'false' || v === 0 || v === '0');

/** Status order only: Active, then Pending response / New applicant, then Inactive. */
export function compareActivity(a, b) {
  return (a?.rank ?? 3) - (b?.rank ?? 3);
}

/**
 * A2: among Active candidates, the quicker responder first. 0 for anything
 * else, so it only breaks ties left by the match score.
 */
export function compareResponseSpeed(a, b) {
  if (a?.status !== ACTIVITY.ACTIVE || b?.status !== ACTIVITY.ACTIVE) return 0;
  const x = a.responseDays;
  const y = b.responseDays;
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return x - y;
}

/** { active, pending, new, inactive } for the summary bar. */
export function countActivity(cards) {
  const counts = { active: 0, pending: 0, new: 0, inactive: 0 };
  for (const card of cards) {
    const s = card?.activity?.status;
    if (s in counts) counts[s]++;
  }
  return counts;
}

/** "12 active · 40 pending response · 3 new applicants · 300 inactive" — zero groups left out. */
export function activitySummaryText(counts) {
  const parts = [];
  if (counts.active) parts.push(`${counts.active} active`);
  if (counts.pending) parts.push(`${counts.pending} pending response`);
  if (counts.new) parts.push(`${counts.new} new applicant${counts.new === 1 ? '' : 's'}`);
  if (counts.inactive) parts.push(`${counts.inactive} inactive`);
  return parts.join(' · ');
}

export default {
  ACTIVITY,
  ACTIVITY_LABELS,
  ACTIVITY_RANK,
  DEFAULT_ACTIVE_WINDOW_DAYS,
  MIN_ACTIVE_WINDOW_DAYS,
  MAX_ACTIVE_WINDOW_DAYS,
  parseActiveWindowDays,
  parseActiveFirst,
  candidateActivity,
  compareActivity,
  compareResponseSpeed,
  countActivity,
  activitySummaryText,
};
