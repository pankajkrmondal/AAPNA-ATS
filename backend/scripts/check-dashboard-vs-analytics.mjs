/**
 * Dashboard vs Analytics cross-check (N36) — "Done when: dashboard numbers
 * match Analytics and Search Candidate for the same period".
 *
 * READ-ONLY. Runs the dashboard's own service functions and the Analytics /
 * board / candidate counts they must agree with, prints both side by side and
 * exits 1 if any pair differs.
 *
 *   NODE_ENV=staging node scripts/check-dashboard-vs-analytics.mjs
 *   NODE_ENV=staging node scripts/check-dashboard-vs-analytics.mjs --range 90 --mrf 41
 *
 * Pairs checked:
 *   - Hired                 = Analytics source-of-hire, hired summed over every source
 *   - Entered pipeline      = Analytics source-of-hire, submitted summed
 *   - Shortlisted (open)    = Pipeline board total (closed hidden), same MRF
 *   - Time-to-hire (median) = Analytics time-to-hire
 *   - Added in the period   = rpa_cv rows in the same India-time window, counted plainly
 *   - Trends daily sum      = stats "added in the period"
 *
 * Release: run on staging after deploy; production in the final release.
 */
import prisma from '../src/config/database.js';
import { getStats, getTrends, getUpcomingInterviews } from '../src/services/dashboard.service.js';
import { getPipelineAnalytics, listPipeline } from '../src/services/pipeline.service.js';
import { periodBounds, parseDashboardParams } from '../src/utils/dashboardMetrics.js';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

async function main() {
  const [{ db }] = await prisma.$queryRawUnsafe('SELECT current_database() AS db');
  const { rangeDays, mrfId } = parseDashboardParams({ range: arg('--range'), mrfId: arg('--mrf') });
  console.log(`Database: ${db} · range ${rangeDays} days · MRF ${mrfId ?? 'all'}`);

  const [stats, trends, upcoming, analytics, board] = await Promise.all([
    getStats({ rangeDays, mrfId }),
    getTrends({ rangeDays, mrfId }),
    getUpcomingInterviews({ days: 7 }),
    getPipelineAnalytics({ topN: null }),
    listPipeline(mrfId ? { mrfId: String(mrfId) } : {}),
  ]);

  const { start } = periodBounds(rangeDays);
  const plainAdded = mrfId ? null : await prisma.rpa_cv.count({ where: { createdAt: { gte: start } } });
  const soh = analytics.sourceOfHire || [];
  const sum = (key) => soh.reduce((a, s) => a + (Number(s[key]) || 0), 0);

  const pairs = [
    ['Hired (funnel)', stats.funnel.hired, sum('hired')],
    ['Entered pipeline (funnel)', stats.funnel.shortlisted, sum('submitted')],
    ['Shortlisted, open (KPI)', stats.shortlisted, board.total],
    ['Time-to-hire, median days', stats.timeToHireDays, analytics.timeToHire?.median_days ?? null],
    ['Added in the period (trends sum)', trends.added.total, stats.period.added],
    ...(plainAdded === null ? [] : [['Added in the period (plain count)', stats.period.added, plainAdded]]),
  ];

  let bad = 0;
  for (const [label, dash, other] of pairs) {
    const ok = dash === other;
    if (!ok) bad += 1;
    console.log(`${ok ? 'OK  ' : 'DIFF'}  ${label.padEnd(36)} dashboard=${dash}  other=${other}`);
  }
  console.log(`\nShortlist rate ${stats.period.shortlistRate ?? '–'}% · top role ${trends.topRoles[0]?.name ?? '–'} · upcoming interviews ${upcoming.length} (${upcoming.filter((u) => u.type === 'teams').length} Teams)`);
  if (bad) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  // pipeline.service opens Redis, which would keep the process alive.
  .finally(() => prisma.$disconnect().then(() => process.exit()));
