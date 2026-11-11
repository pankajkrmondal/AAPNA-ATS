/**
 * Completed forms (U10): the pure rules behind Analytics → "Completed forms"
 * and the 09:00 IST bell note. No Prisma and no socket import, so node:test can
 * load it (the job and the service import notification.service.js, which
 * pulls in the Redis socket bridge).
 *
 * "Completed" means the candidate submitted the public missing-details form
 * with nothing left missing: rpa_cv.details_completed_at, set once, on the
 * first completion (candidate.controller.js submitPublicMissingData).
 */
import { istDay, makeRange, lastNDays, parseAnalyticsRange, rangeLabel } from '../utils/analyticsRange.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The tab's presets. A preset is resolved on the server, in India time. */
export const FORMS_RANGE_PRESETS = Object.freeze(['yesterday', 'today', '7']);
/** The longest custom range the tab accepts; anything longer falls back to yesterday. */
export const MAX_FORMS_RANGE_DAYS = 92;
/** The group for candidates with no tag, no "Position Applied" match and no journey. */
export const NO_JD_LABEL = 'No JD yet';
/** rpa_settings key holding the last day a bell note was sent for (the once-a-day claim). */
export const DIGEST_CLAIM_KEY = 'forms_digest.last_day';

/** Yesterday in India time, as a one-day range. India has no daylight saving. */
export function yesterdayRange(now = new Date()) {
  const day = istDay(new Date(now.getTime() - DAY_MS));
  return makeRange(day, day);
}

/**
 * The range from a query string: `range=yesterday|today|7`, or `from` / `to`
 * as YYYY-MM-DD. Anything else, including junk, a reversed range or one longer
 * than MAX_FORMS_RANGE_DAYS, gives yesterday (the default), never an error.
 *
 * @param {object} [query] req.query
 * @param {Date} [now]
 * @returns {ReturnType<typeof makeRange>}
 */
export function parseFormsRange(query = {}, now = new Date()) {
  const preset = String(query.range ?? '').trim().toLowerCase();
  if (preset === 'today') {
    const day = istDay(now);
    return makeRange(day, day);
  }
  if (preset === '7') return lastNDays(7, now);
  if (preset !== 'yesterday' && (query.from || query.to)) {
    const custom = parseAnalyticsRange({ from: query.from, to: query.to }, now);
    if (custom && custom.days <= MAX_FORMS_RANGE_DAYS) return custom;
  }
  return yesterdayRange(now);
}

const toIso = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const byTimeDesc = (a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || ''));

/**
 * One row per JD. Each candidate counts once, under one JD, so the group
 * counts add up to the total.
 *
 * @param {Array<{ cv_id, name?: string|null, completed_at, mrf_id?: bigint|number|string|null }>} rows
 *   one row per candidate; the JD already chosen (mrfApplicants.completedFormsWithMrf)
 * @param {(mrfId: string) => string|null} [titleOf] the JD title for an MRF id
 * @returns {{ total: number, jd_count: number, groups: Array<{ mrf_id: number|null, title: string, count: number,
 *   candidates: Array<{ cv_id: number, name: string, completed_at: string|null }> }> }}
 *   biggest JD first; "No JD yet" always last
 */
export function groupCompletedForms(rows = [], titleOf = () => null) {
  const groups = new Map();
  const seen = new Set();
  for (const r of rows) {
    const cvId = String(r.cv_id);
    if (seen.has(cvId)) continue;
    seen.add(cvId);
    const mrfKey = r.mrf_id === null || r.mrf_id === undefined ? null : String(r.mrf_id);
    const key = mrfKey ?? 'none';
    if (!groups.has(key)) {
      groups.set(key, {
        mrf_id: mrfKey === null ? null : Number(mrfKey),
        title: mrfKey === null ? NO_JD_LABEL : (String(titleOf(mrfKey) || '').trim() || `MRF-${mrfKey}`),
        count: 0,
        candidates: [],
      });
    }
    const g = groups.get(key);
    g.count += 1;
    g.candidates.push({
      cv_id: Number(cvId),
      name: String(r.name || '').trim() || 'Unnamed candidate',
      completed_at: toIso(r.completed_at),
    });
  }

  const list = [...groups.values()];
  for (const g of list) g.candidates.sort(byTimeDesc);
  list.sort((a, b) => {
    if ((a.mrf_id === null) !== (b.mrf_id === null)) return a.mrf_id === null ? 1 : -1;
    return b.count - a.count || a.title.localeCompare(b.title) || (b.mrf_id ?? 0) - (a.mrf_id ?? 0);
  });
  return { total: seen.size, jd_count: list.filter((g) => g.mrf_id !== null).length, groups: list };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The bell note's text.
 * Title: "12 forms completed yesterday across 4 JDs".
 * Description: "10 Nov 2026 · Java Developer (5), QA Engineer (3), Data Analyst (2) and 1 more JD · 2 with no JD yet".
 *
 * @param {{ total: number, jd_count: number, groups: Array<{ mrf_id, title, count }>, range: object }} params
 * @returns {{ title: string, description: string }}
 */
export function digestNote({ total, jd_count: jdCount, groups = [], range }) {
  const forms = plural(total, 'form');
  let title;
  if (jdCount === 0) title = `${forms} completed yesterday, none linked to a JD yet`;
  else if (jdCount === 1) title = `${forms} completed yesterday for 1 JD`;
  else title = `${forms} completed yesterday across ${jdCount} JDs`;

  const jds = groups.filter((g) => g.mrf_id !== null);
  const top = jds.slice(0, 3).map((g) => `${g.title} (${g.count})`).join(', ');
  const more = jds.length > 3 ? ` and ${plural(jds.length - 3, 'more JD')}` : '';
  const noJd = groups.find((g) => g.mrf_id === null)?.count || 0;
  const parts = [rangeLabel(range)];
  if (top) parts.push(`${top}${more}`);
  if (noJd && jdCount > 0) parts.push(`${noJd} with no JD yet`);
  return { title, description: parts.join(' · ') };
}

/**
 * Where the note opens: the tab for THAT day, as dates rather than
 * "range=yesterday", so a note read a day later still shows the forms it counted.
 */
export function formsTabLink(range) {
  return `/analytics?tab=completed-forms&from=${range.fromDay}&to=${range.toDay}`;
}

/**
 * What one 09:00 run should do with the day's numbers.
 *
 * @param {{ data: { total: number, jd_count: number, groups: Array }, range: object, roles: string[], type: string }} params
 * @returns {{ send: boolean, decision: 'nothing_completed'|'no_roles'|'send',
 *   note: null | { type, title, description, linkPath, meta, roles } }}
 */
export function planDigest({ data, range, roles = [], type }) {
  if (!data?.total) return { send: false, decision: 'nothing_completed', note: null };
  if (!roles.length) return { send: false, decision: 'no_roles', note: null };
  const { title, description } = digestNote({ ...data, range });
  return {
    send: true,
    decision: 'send',
    note: {
      type,
      title,
      description,
      linkPath: formsTabLink(range),
      meta: { day: range.fromDay, total: data.total, jdCount: data.jd_count },
      roles,
    },
  };
}

/**
 * Claims a day so the note goes out once, although the local backend and the
 * staging server both run jobs on the staging database. The conditional update
 * (value < day) and the insert (unique key, ON CONFLICT DO NOTHING) are each
 * atomic, so two processes can never both win. skipDuplicates rather than
 * catching P2002: the losing process must not log a Prisma error every day.
 *
 * @param {string} day YYYY-MM-DD, the day the note is about
 * @param {object} db a Prisma client (or a stub with rpa_settings.updateMany / createMany)
 * @returns {Promise<boolean>} true when this process may send
 */
export async function claimDigestDay(day, db) {
  const moved = await db.rpa_settings.updateMany({
    where: { key: DIGEST_CLAIM_KEY, value: { lt: day } },
    data: { value: day },
  });
  if (moved.count > 0) return true;
  const created = await db.rpa_settings.createMany({
    data: [{ key: DIGEST_CLAIM_KEY, value: day }],
    skipDuplicates: true,
  });
  return created.count > 0; // 0: the row exists and already holds this day (or a later one)
}

export default {
  FORMS_RANGE_PRESETS, MAX_FORMS_RANGE_DAYS, NO_JD_LABEL, DIGEST_CLAIM_KEY,
  yesterdayRange, parseFormsRange, groupCompletedForms, digestNote, formsTabLink, planDigest, claimDigestDay,
};
