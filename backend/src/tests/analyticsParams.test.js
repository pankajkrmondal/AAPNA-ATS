/**
 * Unit tests for the analytics query-param parser (no network, no DB).
 * Run: npm run test:unit
 *
 * This parser is shared by the screen's controller and the CSV export on
 * purpose. The export previously ignored req.query entirely and always fetched
 * the unfiltered, all-MRF set, while the success toast told the user the file
 * matched what they were looking at. A second, drifting copy of this parsing is
 * exactly how that silently returns.
 *
 * The invariant that matters most: an EMPTY query must produce no overrides, so
 * every existing caller keeps the service's own defaults and today's output is
 * unchanged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// From the dependency-free helpers module. NOT via pipelineAnalytics.export.js,
// which re-exports this but also imports pipeline.service.js — that opens a
// Redis connection which never closes and hangs `node --test`.
import { parseAnalyticsParams } from '../services/pipelineAnalytics.helpers.js';

test('an empty query overrides nothing', () => {
  const parsed = parseAnalyticsParams({});
  // undefined (not 0, not null) is what lets the service defaults apply.
  assert.equal(parsed.rejectionWindowDays, undefined);
  assert.equal(parsed.stuckThresholdDays, undefined);
  assert.equal(parsed.holdThresholdDays, undefined);
  assert.equal(parsed.mrfId, null);
});

test('no argument at all is safe', () => {
  // The export spec calls this with a defaulted {} — make sure a bare call works.
  const parsed = parseAnalyticsParams();
  assert.equal(parsed.mrfId, null);
  assert.equal(parsed.stuckThresholdDays, undefined);
});

test('numeric strings from the query string are parsed', () => {
  const parsed = parseAnalyticsParams({
    mrf_id: '110',
    rejection_window_days: '7',
    stuck_threshold_days: '5',
    hold_threshold_days: '60',
  });
  assert.deepEqual(parsed, {
    mrfId: 110,
    rejectionWindowDays: 7,
    stuckThresholdDays: 5,
    holdThresholdDays: 60,
    range: null,
  });
});

test('junk and hostile values fall back to defaults rather than NaN', () => {
  // A NaN threshold would make every comparison false and silently empty the
  // stuck list — worse than ignoring the parameter.
  for (const bad of ['abc', '', '  ', null, undefined, '-3', '0', 'NaN', '1e999']) {
    const parsed = parseAnalyticsParams({ stuck_threshold_days: bad });
    assert.ok(
      parsed.stuckThresholdDays === undefined || Number.isFinite(parsed.stuckThresholdDays),
      `"${bad}" produced ${parsed.stuckThresholdDays}`,
    );
    assert.notEqual(parsed.stuckThresholdDays, 0, `"${bad}" must not yield 0`);
  }
});

test('a non-positive or unparseable mrf_id becomes null, never NaN', () => {
  for (const bad of ['abc', '0', '-1', '']) {
    assert.equal(parseAnalyticsParams({ mrf_id: bad }).mrfId, null, `mrf_id="${bad}"`);
  }
});

test('unknown query keys are ignored', () => {
  // req.query is caller-controlled; only the recognised params may pass.
  const parsed = parseAnalyticsParams({ table: 'stuck', topN: '9999', evil: '1' });
  assert.deepEqual(Object.keys(parsed).sort(), [
    'holdThresholdDays', 'mrfId', 'range', 'rejectionWindowDays', 'stuckThresholdDays',
  ]);
  assert.equal(parsed.mrfId, null);
  assert.equal(parsed.range, null, 'no date params means All time, as before L06');
});

// ── L06 date range ──────────────────────────────────────────────────────────
import {
  parseAnalyticsRange, inRange, previousPeriod, rangeLabel, rangeFileTag, lastNDays, daysOf, istDay,
} from '../utils/analyticsRange.js';

const NOW = new Date('2026-10-22T06:30:00Z'); // 12:00 IST, 22 Oct

test('L06 · from/to are whole India-time days, both included', () => {
  const r = parseAnalyticsRange({ from: '2026-10-16', to: '2026-10-22' }, NOW);
  assert.equal(r.fromDay, '2026-10-16');
  assert.equal(r.toDay, '2026-10-22');
  assert.equal(r.days, 7);
  assert.equal(r.from.toISOString(), '2026-10-15T18:30:00.000Z'); // 16 Oct 00:00 IST
  assert.equal(r.to.toISOString(), '2026-10-22T18:30:00.000Z');   // 23 Oct 00:00 IST, exclusive
  assert.equal(inRange(new Date('2026-10-15T18:30:00Z'), r), true, 'first instant is inside');
  assert.equal(inRange(new Date('2026-10-22T18:29:59Z'), r), true, 'last second of 22 Oct IST is inside');
  assert.equal(inRange(new Date('2026-10-22T18:30:00Z'), r), false, '23 Oct IST is outside');
  assert.equal(inRange(null, r), false, 'a missing date is never inside a range');
  assert.equal(inRange(null, null), true, 'everything is inside All time');
});

test('L06 · presets count back from today, today included', () => {
  const r = parseAnalyticsRange({ preset: '7' }, NOW);
  assert.equal(r.fromDay, '2026-10-16');
  assert.equal(r.toDay, '2026-10-22');
  assert.deepEqual(lastNDays(30, NOW).fromDay, '2026-09-23');
  assert.equal(parseAnalyticsRange({ preset: 'all' }, NOW), null);
  assert.equal(parseAnalyticsRange({ preset: '45' }, NOW), null, 'only the page presets');
});

test('L06 · junk, reversed or over-long ranges mean All time, never an error', () => {
  for (const q of [
    { from: 'yesterday' }, { from: '2026-02-30', to: '2026-03-02' }, { from: '2026-10-22', to: '2026-10-01' },
    { from: '2020-01-01', to: '2026-10-22' }, {},
  ]) {
    assert.equal(parseAnalyticsRange(q, NOW), null, JSON.stringify(q));
  }
  assert.equal(parseAnalyticsRange({ from: '2026-10-20' }, NOW).toDay, '2026-10-22', 'a lone from runs to today');
});

test('L06 · previous period, labels, file tags and days', () => {
  const r = parseAnalyticsRange({ from: '2026-10-16', to: '2026-10-22' }, NOW);
  const p = previousPeriod(r);
  assert.equal(p.fromDay, '2026-10-09');
  assert.equal(p.toDay, '2026-10-15');
  assert.equal(previousPeriod(null), null);
  assert.equal(rangeLabel(r), '16 Oct 2026 – 22 Oct 2026');
  assert.equal(rangeLabel(null), 'All time');
  assert.equal(rangeFileTag(r), '_2026-10-16_to_2026-10-22');
  assert.equal(daysOf(r).length, 7);
  assert.equal(istDay(new Date('2026-10-21T19:00:00Z')), '2026-10-22', '00:30 IST is the next day');
});
