/**
 * dashboardAggregations — small pure helpers that shape server data for the
 * dashboard widgets.
 *
 * N36: the counting itself moved to the server (GET /dashboard/stats and
 * /dashboard/trends). These used to bucket the newest 200 candidates in the
 * browser, which under-counted any period with more arrivals than that.
 */

/**
 * Server daily series ([{ date, label, count }]) as sparkline points
 * ([{ date, label, value }]), oldest first.
 */
export function toPoints(daily = []) {
  return daily.map((d) => ({ date: d.date, label: d.label, value: Number(d.count) || 0 }));
}

/**
 * A RUNNING TOTAL series ending at `endTotal` — `[{ date, label, value }]`.
 *
 * Walks the per-day additions backwards from today's real total, so the line is
 * the headline number's own history rather than the rate of new arrivals. The
 * daily series is a full server count, so this is exact as long as it is not
 * narrowed by a filter the total doesn't share (the caller checks that).
 */
export function runningTotal(daily = [], endTotal = 0) {
  const out = new Array(daily.length);
  let running = Number(endTotal) || 0;
  for (let i = daily.length - 1; i >= 0; i--) {
    out[i] = { date: daily[i].date, label: daily[i].label, value: Math.max(0, running) };
    running -= Number(daily[i].count) || 0; // total as it stood at the end of the previous day
  }
  return out;
}

/**
 * Stage-to-stage conversion for the funnel.
 * Input: `{ sourced, aiScreened, shortlisted, hired }`.
 * Returns ordered stages with absolute value, % of top-of-funnel, and step conversion %.
 *
 * "Entered pipeline", not "Shortlisted": this stage counts every journey ever
 * started, while the Shortlisted card counts the ones still open (N36). Two
 * numbers under one word was the bug this dashboard kept having.
 */
export function conversionStages(funnel = {}) {
  const order = [
    { key: 'sourced', label: 'Sourced' },
    { key: 'aiScreened', label: 'AI Screened' },
    { key: 'shortlisted', label: 'Entered pipeline' },
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
