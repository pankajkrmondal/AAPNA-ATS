/**
 * Unit tests for the "missing details completed" bell wording (N44).
 * Run: node --test src/tests/unit/missingDetails.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtIstDate, respondedIn, describeDetailsCompletion, completedSince } from '../../utils/missingDetails.js';

test('completedSince: today is the IST calendar day; 7/30 are rolling; anything else is no filter', () => {
  // 14 Oct 2026, 02:00 IST (= 13 Oct 20:30 UTC): "today" starts 14 Oct 00:00 IST.
  const now = new Date('2026-10-13T20:30:00Z');
  assert.equal(completedSince('today', now).toISOString(), '2026-10-13T18:30:00.000Z');
  assert.equal(completedSince('7', now).toISOString(), '2026-10-06T20:30:00.000Z');
  assert.equal(completedSince('30', now).toISOString(), '2026-09-13T20:30:00.000Z');
  for (const bad of [undefined, null, '', '5', 'yesterday', '7; drop table']) {
    assert.equal(completedSince(bad, now), null, String(bad));
  }
});

test('fmtIstDate prints DD Mon YYYY in IST, null for nothing', () => {
  assert.equal(fmtIstDate('2026-10-02T10:00:00Z'), '02 Oct 2026');
  // 20:00 UTC is already the next day in IST (+05:30).
  assert.equal(fmtIstDate('2026-10-02T20:00:00Z'), '03 Oct 2026');
  assert.equal(fmtIstDate(null), null);
  assert.equal(fmtIstDate('not a date'), null);
});

test('respondedIn counts whole days and reads naturally', () => {
  assert.equal(respondedIn('2026-10-02T10:00:00Z', '2026-10-14T11:00:00Z'), 'responded in 12 days');
  assert.equal(respondedIn('2026-10-13T10:00:00Z', '2026-10-14T10:30:00Z'), 'responded in 1 day');
  assert.equal(respondedIn('2026-10-14T01:00:00Z', '2026-10-14T09:00:00Z'), 'responded the same day');
  assert.equal(respondedIn(null, '2026-10-14T09:00:00Z'), null);
  // A request date after the completion is bad data, not "-3 days".
  assert.equal(respondedIn('2026-10-20T00:00:00Z', '2026-10-14T00:00:00Z'), null);
});

test('describeDetailsCompletion: full line', () => {
  const r = describeDetailsCompletion({
    name: 'Asha Verma',
    position: 'Java Developer',
    requestedAt: '2026-10-02T05:00:00Z',
    completedAt: '2026-10-14T06:00:00Z',
  });
  assert.equal(r.title, 'Asha Verma completed their missing details');
  assert.equal(r.description, 'Java Developer · requested 02 Oct 2026 · responded in 12 days');
});

test('describeDetailsCompletion drops unknown parts instead of printing n/a', () => {
  const r = describeDetailsCompletion({ name: '  ', position: null, requestedAt: null, completedAt: new Date() });
  assert.equal(r.title, 'A candidate completed their missing details');
  assert.equal(r.description, null);
  const p = describeDetailsCompletion({ name: 'Ravi', position: '.NET Developer', requestedAt: null, completedAt: new Date() });
  assert.equal(p.description, '.NET Developer');
});
