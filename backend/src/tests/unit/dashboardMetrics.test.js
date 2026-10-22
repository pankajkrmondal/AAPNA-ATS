/**
 * Dashboard counting rules (Phase 3 "Do Now", N36). Pure — no DB.
 * Run: node --test src/tests/unit/dashboardMetrics.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDashboardParams, istDayKey, istMidnight, periodBounds, fillDaily, percentOf, changePct,
  normaliseLabel, topCounts, parseSkills, talentTallies, mergeUpcoming,
} from '../../utils/dashboardMetrics.js';

// 19 Oct 2026, 01:00 IST = 18 Oct 19:30 UTC — the India day differs from the UTC day.
const NOW = new Date('2026-10-18T19:30:00Z');

test('parseDashboardParams: only 7 / 30 / 90, default 30; MRF id must be a positive integer', () => {
  assert.deepEqual(parseDashboardParams({}), { rangeDays: 30, mrfId: null });
  assert.equal(parseDashboardParams({ range: '7' }).rangeDays, 7);
  assert.equal(parseDashboardParams({ range: '90' }).rangeDays, 90);
  assert.equal(parseDashboardParams({ range: '45' }).rangeDays, 30);
  assert.equal(parseDashboardParams({ mrfId: '41' }).mrfId, 41n);
  assert.equal(parseDashboardParams({ mrfId: '0' }).mrfId, null);
  assert.equal(parseDashboardParams({ mrfId: '1; drop' }).mrfId, null);
  assert.equal(parseDashboardParams({ mrfId: '' }).mrfId, null);
});

test('days follow India time, not UTC', () => {
  assert.equal(istDayKey(NOW), '2026-10-19');
  assert.equal(istMidnight(NOW).toISOString(), '2026-10-18T18:30:00.000Z');
});

test('periodBounds: N India days ending today, and the N days before', () => {
  const { start, previousStart } = periodBounds(7, NOW);
  assert.equal(istDayKey(start), '2026-10-13');
  assert.equal(start.toISOString(), '2026-10-12T18:30:00.000Z');
  assert.equal(istDayKey(previousStart), '2026-10-06');
});

test('fillDaily: one entry per day, zero-filled, oldest first, labelled "DD Mon"', () => {
  const series = fillDaily([{ day: '2026-10-19', count: 3n }, { day: '2026-10-15', count: 2 }], 7, NOW);
  assert.equal(series.length, 7);
  assert.deepEqual(series.map((d) => d.date), ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19']);
  assert.deepEqual(series.map((d) => d.count), [0, 0, 2, 0, 0, 0, 3]);
  assert.equal(series[6].label, '19 Oct');
  assert.equal(fillDaily([], 30, NOW).length, 30);
});

test('percentOf / changePct: no base means null, never a made-up 0%', () => {
  assert.equal(percentOf(5, 20), 25);
  assert.equal(percentOf(5, 0), null);
  assert.equal(changePct(12, 10), 20);
  assert.equal(changePct(3, 0), 100);
  assert.equal(changePct(0, 0), null);
  assert.equal(changePct(5, 10), -50);
});

test('roles: case and spacing variants count as one, first spelling shown', () => {
  assert.equal(normaliseLabel('  Java  Developer '), 'java developer');
  const top = topCounts(['Java Developer', 'java  developer', 'QA', '', null, 'QA', 'Java Developer'], 5);
  assert.deepEqual(top, [{ name: 'Java Developer', value: 3 }, { name: 'QA', value: 2 }]);
  assert.equal(topCounts(['a', 'b', 'c'], 2).length, 2);
});

test('skills: JSON array or comma list; broken JSON falls back to the comma split', () => {
  assert.deepEqual(parseSkills('["React","Node.js"]'), ['React', 'Node.js']);
  assert.deepEqual(parseSkills('React, Node.js'), ['React', ' Node.js']);
  assert.deepEqual(parseSkills('[React, Node'), ['[React', ' Node']);
  assert.deepEqual(parseSkills(null), []);
  const t = talentTallies([
    { PositionApplied: 'QA', Top5KeySkills: '["Selenium","Java"]' },
    { PositionApplied: 'qa', Top5KeySkills: 'java, SQL' },
  ]);
  assert.deepEqual(t.topRoles, [{ name: 'QA', value: 2 }]);
  assert.deepEqual(t.topSkills[0], { name: 'Java', value: 2 });
});

test('mergeUpcoming: Zeko and Teams in one agenda, soonest first, with the pipeline id', () => {
  const rows = mergeUpcoming({
    zeko: [{ id: 1, stage: 'hr', startAt: '2026-10-20T05:00:00Z', pipelineId: 11, candidateName: 'A', role: 'QA' }],
    teams: [{ id: 2, startAt: '2026-10-19T09:00:00Z', pipelineId: 22, candidateName: 'B', role: 'Dev', round: 'Technical Round 1' }],
  });
  assert.deepEqual(rows.map((r) => r.key), ['teams:2', 'zeko:1']);
  assert.equal(rows[1].round, 'HR screening (Zeko)');
  assert.equal(rows[0].pipelineId, 22);
  assert.equal(rows[1].type, 'zeko');
});
