/**
 * Dashboard counting rules (Phase 3 "Do Now", N36). Pure — no Prisma — so
 * node:test can load it.
 *
 * The dashboard used to aggregate the newest 200 candidates in the browser, so
 * a 30- or 90-day chart quietly stopped counting once more than 200 arrived.
 * The server now counts everything; these helpers hold the parts that need to
 * be exactly right: the period boundaries (India time), the zero-filled daily
 * series, the shortlist rate, and the role / skill tallies.
 */

export const IST = 'Asia/Kolkata';
/** India has no daylight saving, so a fixed offset is exact. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The range control's three choices; anything else falls back to 30. */
export const DASHBOARD_RANGES = Object.freeze([7, 30, 90]);
export const DEFAULT_RANGE_DAYS = 30;

/**
 * @param {object} query  req.query
 * @returns {{ rangeDays: number, mrfId: bigint|null }}
 */
export function parseDashboardParams(query = {}) {
  const range = Number.parseInt(query.range ?? query.rangeDays, 10);
  const rangeDays = DASHBOARD_RANGES.includes(range) ? range : DEFAULT_RANGE_DAYS;
  const rawMrf = String(query.mrfId ?? query.mrf_id ?? '').trim();
  const mrfId = /^\d{1,18}$/.test(rawMrf) && rawMrf !== '0' ? BigInt(rawMrf) : null;
  return { rangeDays, mrfId };
}

/** 'YYYY-MM-DD' of the India-time calendar day a moment falls on. */
export function istDayKey(value) {
  const d = new Date(new Date(value).getTime() + IST_OFFSET_MS);
  return d.toISOString().slice(0, 10);
}

/** The moment India-time midnight began on the day `now` falls on. */
export function istMidnight(now = new Date()) {
  const key = istDayKey(now);
  return new Date(new Date(`${key}T00:00:00.000Z`).getTime() - IST_OFFSET_MS);
}

/**
 * The selected period: `rangeDays` India-time days ending today (today
 * included, as the chart shows it), and the same-length period before it.
 * @returns {{ start: Date, previousStart: Date, end: Date }}
 */
export function periodBounds(rangeDays, now = new Date()) {
  const todayStart = istMidnight(now);
  const start = new Date(todayStart.getTime() - (rangeDays - 1) * DAY_MS);
  return { start, previousStart: new Date(start.getTime() - rangeDays * DAY_MS), end: now };
}

/**
 * A continuous daily series over the period, zero-filled, oldest first.
 * @param {Array<{ day: string, count: number|bigint }>} rows  'YYYY-MM-DD' (India time) -> count
 * @returns {Array<{ date: string, label: string, count: number }>}
 */
export function fillDaily(rows, rangeDays, now = new Date()) {
  const counts = new Map((rows || []).map((r) => [String(r.day).slice(0, 10), Number(r.count) || 0]));
  const { start } = periodBounds(rangeDays, now);
  const out = [];
  for (let i = 0; i < rangeDays; i++) {
    const key = istDayKey(new Date(start.getTime() + i * DAY_MS));
    const [, m, d] = key.split('-');
    out.push({ date: key, label: `${d} ${MONTHS[Number(m) - 1]}`, count: counts.get(key) || 0 });
  }
  return out;
}

/** Whole-number percentage, or null when there is nothing to divide by. */
export function percentOf(part, whole) {
  const w = Number(whole) || 0;
  if (w <= 0) return null;
  return Math.round(((Number(part) || 0) / w) * 100);
}

/**
 * Change from the previous period, in whole percent. 100 when growing from
 * zero; null when both are zero (no base, nothing to say).
 */
export function changePct(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) return c > 0 ? 100 : null;
  return Math.round(((c - p) / p) * 100);
}

/** Lower-cased, single-spaced, trimmed — how two spellings of one role are matched. */
export function normaliseLabel(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Top-N values by count, grouping case / spacing variants together and showing
 * the first spelling met.
 * @param {Iterable<string>} values
 * @returns {Array<{ name: string, value: number }>}
 */
export function topCounts(values, n) {
  const counts = new Map();
  for (const raw of values) {
    const label = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (!label) continue;
    const key = label.toLowerCase();
    const hit = counts.get(key);
    if (hit) hit.value += 1;
    else counts.set(key, { name: label, value: 1 });
  }
  return [...counts.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)).slice(0, n);
}

/**
 * A candidate's key skills. rpa_cv."Top5KeySkills" is free text: usually a
 * JSON array, sometimes a comma-separated list.
 * @returns {string[]}
 */
export function parseSkills(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (raw === null || raw === undefined) return [];
  const text = String(raw).trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch { /* fall through to the comma split */ }
  }
  return text.split(',');
}

/**
 * Top roles and skills over a set of candidates.
 * @param {Array<{ PositionApplied?: string, Top5KeySkills?: string }>} rows
 */
export function talentTallies(rows, { roles = 7, skills = 8 } = {}) {
  return {
    topRoles: topCounts((rows || []).map((r) => r.PositionApplied), roles),
    topSkills: topCounts((rows || []).flatMap((r) => parseSkills(r.Top5KeySkills)), skills),
  };
}

/** Zeko round names as recruiters say them. */
const ZEKO_ROUND_LABEL = { hr: 'HR screening (Zeko)', functional: 'Functional screening (Zeko)' };

/**
 * Merge Zeko interview windows and Teams interviews into one agenda, soonest
 * first. Rows are already limited to the window by the caller.
 * @returns {Array<{ key: string, type: 'zeko'|'teams', pipelineId: number|null, candidateName: string|null, role: string|null, round: string, startAt: Date }>}
 */
export function mergeUpcoming({ zeko = [], teams = [] }) {
  const rows = [
    ...zeko.map((z) => ({
      key: `zeko:${z.id}`,
      type: 'zeko',
      pipelineId: z.pipelineId ?? null,
      candidateName: z.candidateName ?? null,
      role: z.role ?? null,
      round: ZEKO_ROUND_LABEL[z.stage] || 'Zeko interview',
      startAt: new Date(z.startAt),
    })),
    ...teams.map((t) => ({
      key: `teams:${t.id}`,
      type: 'teams',
      pipelineId: t.pipelineId ?? null,
      candidateName: t.candidateName ?? null,
      role: t.role ?? null,
      round: t.round || 'Interview',
      startAt: new Date(t.startAt),
    })),
  ];
  return rows.sort((a, b) => a.startAt - b.startAt);
}
