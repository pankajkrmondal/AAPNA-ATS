/**
 * dashboardAggregations — pure, dependency-light helpers that turn the raw data the
 * existing endpoints already return into the series the advanced dashboard widgets need.
 *
 * Everything here is client-side (frontend-only upgrade): no new API calls.
 * Each function is defensive (handles missing/null fields) so a widget never crashes.
 */

/** Coerce a candidate's created date (legacy `createdAt` or `created_at`). */
function candidateDate(c) {
  const raw = c?.createdAt || c?.created_at || c?.CreatedAt || null;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A YYYY-MM-DD key in local time. */
function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Bucket candidates into a per-day count for the last `days` days (inclusive of today).
 * Returns an ordered array `[{ date: 'YYYY-MM-DD', label: 'DD Mon', count }]` with zero-fill,
 * so the trend chart always has a continuous x-axis.
 */
export function bucketByDay(candidates = [], days = 30) {
  const counts = new Map();
  for (const c of candidates) {
    const d = candidateDate(c);
    if (!d) continue;
    const k = dayKey(d);
    counts.set(k, (counts.get(k) || 0) + 1);
  }

  const out = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const k = dayKey(d);
    out.push({
      date: k,
      label: d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }),
      count: counts.get(k) || 0,
    });
  }
  return out;
}

/**
 * Top-N frequency counts of a simple string field (e.g. `position`).
 * Returns `[{ name, value }]` sorted desc.
 */
export function topByField(items = [], field = 'position', n = 6) {
  // Group on a NORMALISED key, not the raw string. Trimming alone (what this did
  // before) still treats "Product Sales Executive", "product sales executive" and
  // "Product  Sales Executive" as three different roles — which is exactly how the
  // same job title appeared as two separate bars in Talent Insights. Case and
  // internal whitespace are normalised for counting; the first spelling encountered
  // is kept for display, so the label still reads the way recruiters typed it.
  const counts = new Map(); // key -> { label, value }
  for (const it of items) {
    const raw = (it?.[field] ?? '').toString().trim().replace(/\s+/g, ' ');
    if (!raw) continue;
    const key = raw.toLowerCase();
    const hit = counts.get(key);
    if (hit) hit.value += 1;
    else counts.set(key, { label: raw, value: 1 });
  }
  return [...counts.values()]
    .map(({ label, value }) => ({ name: label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

/**
 * Top-N in-demand skills. `skills` may already be an array (mapped candidate) or a
 * comma/JSON string (defensive). Returns `[{ name, value }]` sorted desc.
 */
export function topSkills(candidates = [], n = 8) {
  const counts = new Map();
  for (const c of candidates) {
    let skills = c?.skills;
    if (typeof skills === 'string') {
      try { skills = JSON.parse(skills); }
      catch { skills = skills.split(','); }
    }
    if (!Array.isArray(skills)) continue;
    for (const s of skills) {
      const name = (s ?? '').toString().trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

/**
 * Stage-to-stage conversion for the funnel.
 * Input: `{ sourced, aiScreened, shortlisted, hired }`.
 * Returns ordered stages with absolute value, % of top-of-funnel, and step conversion %.
 */
export function conversionStages(funnel = {}) {
  const order = [
    { key: 'sourced', label: 'Sourced' },
    { key: 'aiScreened', label: 'AI Screened' },
    { key: 'shortlisted', label: 'Shortlisted' },
    { key: 'hired', label: 'Hired' },
  ];
  const top = Math.max(1, Number(funnel.sourced) || 0);
  let prev = null;
  return order.map((s) => {
    const value = Number(funnel[s.key]) || 0;
    const ofTop = Math.round((value / top) * 100);
    const stepPct = prev === null ? 100 : prev === 0 ? 0 : Math.round((value / prev) * 100);
    prev = value;
    return { ...s, value, ofTop, stepPct };
  });
}

/**
 * Period-over-period delta: count in the last `days` days vs the `days` before that.
 * Returns `{ current, previous, deltaPct }` (deltaPct null when there is no base to
 * compare against).
 *
 * Takes a window because the dashboard's range control is global — a delta pinned to
 * 7 days while the reader has selected 90 is comparing a different period from every
 * other number on the card.
 */
export function periodOverPeriod(items = [], days = 7) {
  const now = Date.now();
  const span = Math.max(1, days) * 24 * 60 * 60 * 1000;
  let current = 0;
  let previous = 0;
  for (const c of items) {
    const d = candidateDate(c);
    if (!d) continue;
    const age = now - d.getTime();
    if (age < 0) continue;
    if (age < span) current++;
    else if (age < 2 * span) previous++;
  }
  const deltaPct = previous === 0
    ? (current > 0 ? 100 : null)
    : Math.round(((current - previous) / previous) * 100);
  return { current, previous, deltaPct };
}

/** Week-over-week delta — `periodOverPeriod` over 7 days, in its original shape. */
export function weekOverWeek(candidates = []) {
  const { current, previous, deltaPct } = periodOverPeriod(candidates, 7);
  return { thisWeek: current, lastWeek: previous, deltaPct };
}

/**
 * A daily sparkline series (counts) for KPI cards, derived from record created dates.
 * Returns an array of numbers (oldest → newest).
 */
export function sparkSeries(candidates = [], points = 7) {
  return bucketByDay(candidates, points).map((b) => b.count);
}

/**
 * The same daily series, but LABELLED — `[{ date, label, value }]`, oldest → newest.
 *
 * The KPI sparklines take this rather than bare numbers so hovering a point can name
 * the day it belongs to. A graph the reader cannot interrogate is decoration.
 */
export function sparkPoints(items = [], points = 7) {
  return bucketByDay(items, points).map((b) => ({ date: b.date, label: b.label, value: b.count }));
}

/**
 * True when the sample reaches back past the start of a `days`-long window — i.e. the
 * oldest record we hold is older than the window, so every day inside it has a
 * complete count.
 *
 * Guards `cumulativePoints`: a running total walked back through a window the sample
 * only partly covers would understate the early days and draw a cliff that never
 * happened.
 */
export function sampleCoversWindow(items = [], days = 7) {
  if (!items.length) return false;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (Math.max(1, days) - 1));
  let oldest = Infinity;
  for (const c of items) {
    const d = candidateDate(c);
    if (d) oldest = Math.min(oldest, d.getTime());
  }
  return oldest < start.getTime();
}

/**
 * A RUNNING TOTAL series ending at `endTotal` — `[{ date, label, value }]`.
 *
 * Walks the known per-day additions backwards from today's real total, so the line is
 * the headline number's own history rather than the rate of new arrivals. Only valid
 * when the sample covers the window (see `sampleCoversWindow`) and the daily counts
 * are unfiltered relative to `endTotal`; the caller checks both.
 */
export function cumulativePoints(items = [], days = 7, endTotal = 0) {
  const daily = bucketByDay(items, days);
  const out = new Array(daily.length);
  let running = Number(endTotal) || 0;
  for (let i = daily.length - 1; i >= 0; i--) {
    out[i] = { date: daily[i].date, label: daily[i].label, value: Math.max(0, running) };
    running -= daily[i].count; // total as it stood at the end of the previous day
  }
  return out;
}

/**
 * Median time-to-hire (in days) from a Zeko pipeline, when join/offer timestamps exist.
 * Each row may carry `joined_at`/`offer_accepted_at` and a `created_at`/`shortlisted_at`.
 * Returns a rounded number of days, or null when not derivable.
 */
export function medianTimeToHire(pipeline = []) {
  const spans = [];
  for (const r of pipeline) {
    const end = r?.joined_at || r?.offer_accepted_at || null;
    const start = r?.shortlisted_at || r?.created_at || r?.createdAt || null;
    if (!end || !start) continue;
    const e = new Date(end).getTime();
    const s = new Date(start).getTime();
    if (Number.isNaN(e) || Number.isNaN(s) || e < s) continue;
    spans.push((e - s) / (24 * 60 * 60 * 1000));
  }
  if (!spans.length) return null;
  spans.sort((a, b) => a - b);
  const mid = Math.floor(spans.length / 2);
  const med = spans.length % 2 ? spans[mid] : (spans[mid - 1] + spans[mid]) / 2;
  return Math.round(med);
}

/**
 * Upcoming interviews from a Zeko pipeline: rows with a future `interview_start_at`,
 * within `days` days, sorted ascending. Returns the rows untouched (plus a parsed `_when`).
 */
export function upcomingInterviews(pipeline = [], days = 7) {
  const now = Date.now();
  const horizon = now + days * 24 * 60 * 60 * 1000;
  return pipeline
    .map((r) => {
      const t = r?.interview_start_at ? new Date(r.interview_start_at).getTime() : NaN;
      return Number.isNaN(t) ? null : { ...r, _when: t };
    })
    .filter((r) => r && r._when >= now && r._when <= horizon)
    .sort((a, b) => a._when - b._when);
}