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
  // req.query is caller-controlled; only the four recognised params may pass.
  const parsed = parseAnalyticsParams({ table: 'stuck', topN: '9999', evil: '1' });
  assert.deepEqual(Object.keys(parsed).sort(), [
    'holdThresholdDays', 'mrfId', 'rejectionWindowDays', 'stuckThresholdDays',
  ]);
  assert.equal(parsed.mrfId, null);
});
