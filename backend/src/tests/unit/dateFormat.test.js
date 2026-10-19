/**
 * The one date format every email and server-written page uses (N34).
 * Run: node --test src/tests/unit/dateFormat.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fmtDate, fmtTime, fmtDateTime, fmtDateTimeIst, fmtRelative } from '../../utils/dateFormat.js';

test('dates are the IST calendar day, DD Mon YYYY, never "Sept"', () => {
  assert.equal(fmtDate('2026-10-07T11:00:00Z'), '07 Oct 2026');
  assert.equal(fmtDate('2026-10-06T18:29:00Z'), '06 Oct 2026');
  assert.equal(fmtDate('2026-10-06T18:30:00Z'), '07 Oct 2026', 'midnight IST is 18:30 UTC the day before');
  assert.equal(fmtDate('2026-09-05T06:00:00Z'), '05 Sep 2026');
  assert.equal(fmtDate('2026-10-06T20:00:00Z', { timeZone: 'UTC' }), '06 Oct 2026');
});

test('times are 12-hour with AM/PM, midnight and noon correct', () => {
  assert.equal(fmtTime('2026-10-07T11:00:00Z'), '4:30 PM');
  assert.equal(fmtTime('2026-10-06T18:30:00Z'), '12:00 AM');
  assert.equal(fmtTime('2026-10-07T06:30:00Z'), '12:00 PM');
  assert.equal(fmtDateTime('2026-10-07T11:00:00Z'), '07 Oct 2026, 4:30 PM');
  assert.equal(fmtDateTimeIst('2026-10-07T11:00:00Z'), '07 Oct 2026, 4:30 PM IST');
});

test('nothing usable prints nothing (these go into emails)', () => {
  for (const v of [null, undefined, '', 'not a date']) {
    assert.equal(fmtDate(v), '');
    assert.equal(fmtDateTime(v), '');
    assert.equal(fmtDateTimeIst(v), '');
    assert.equal(fmtRelative(v), '');
  }
});

test('relative time, falling back to the date after a week', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  assert.equal(fmtRelative(now - 20_000, now), 'just now');
  assert.equal(fmtRelative(now - 5 * 60_000, now), '5 min ago');
  assert.equal(fmtRelative(now - 3 * 3_600_000, now), '3 h ago');
  assert.equal(fmtRelative(now - 2 * 86_400_000, now), '2 d ago');
  assert.equal(fmtRelative(now - 30 * 86_400_000, now), '16 Sep 2026');
  assert.equal(fmtRelative(now + 86_400_000, now), '17 Oct 2026', 'a future time shows its date');
});
