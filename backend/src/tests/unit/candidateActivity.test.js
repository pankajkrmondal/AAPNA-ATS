/**
 * Candidate activity for screening order (L01). Pure — no database.
 * Run: node --test src/tests/unit/candidateActivity.test.js
 *
 * The cases follow the worked examples on the approved design (22 Oct 2026,
 * 15-day window, so the window starts 07 Oct).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY, candidateActivity, compareActivity, compareResponseSpeed, countActivity,
  activitySummaryText, parseActiveWindowDays, DEFAULT_ACTIVE_WINDOW_DAYS,
} from '../../utils/candidateActivity.js';

const now = new Date('2026-10-22T06:30:00Z'); // 12:00 IST
const at = (s) => new Date(`${s}T06:30:00Z`);
const act = (c, windowDays = 15) => candidateActivity(c, { now, windowDays });

test('1 · requested and submitted inside the window is Active, with the response time', () => {
  const a = act({ createdAt: at('2026-10-12'), details_requested_at: at('2026-10-13'), details_completed_at: at('2026-10-15') });
  assert.equal(a.status, ACTIVITY.ACTIVE);
  assert.equal(a.label, 'Active');
  assert.equal(a.responseDays, 2);
  assert.equal(a.detail, 'responded in 2 days (15 Oct 2026)');
});

test('2 · requested inside the window, nothing submitted, is Pending response', () => {
  const a = act({ createdAt: at('2026-10-10'), details_requested_at: at('2026-10-18') });
  assert.equal(a.status, ACTIVITY.PENDING);
  assert.equal(a.detail, 'details requested 18 Oct 2026');
});

test('3 · a recent upload that was never asked is a New applicant (A1), ranked with Pending response', () => {
  const a = act({ createdAt: at('2026-10-15'), statusActive: 'ACTIVE' });
  assert.equal(a.status, ACTIVITY.NEW);
  assert.equal(a.detail, 'profile complete');
  assert.equal(a.rank, act({ details_requested_at: at('2026-10-18') }).rank);
  assert.equal(act({ createdAt: at('2026-10-15'), statusActive: 'INACTIVE' }).detail, 'details not yet requested');
});

test('4 · a response from before the window is Inactive', () => {
  const a = act({ createdAt: at('2026-09-12'), details_requested_at: at('2026-09-12'), details_completed_at: at('2026-09-20') });
  assert.equal(a.status, ACTIVITY.INACTIVE);
  assert.equal(a.detail, 'last response 20 Sep 2026');
});

test('5 · an old request with no response is Inactive', () => {
  const a = act({ createdAt: at('2024-02-14'), details_requested_at: at('2026-06-02') });
  assert.equal(a.status, ACTIVITY.INACTIVE);
  assert.equal(a.detail, 'no response since 02 Jun 2026');
});

test('6 · an old record never contacted is Inactive; so is a record with no dates at all', () => {
  assert.equal(act({ createdAt: at('2023-05-01') }).detail, 'never contacted');
  assert.equal(act({}).status, ACTIVITY.INACTIVE);
});

test('7 · submitted before dates were kept (RECEIVED, no date) follows the request date', () => {
  const recent = act({ details_requested_at: at('2026-10-10'), cvMissingTokenStatus: 'RECEIVED' });
  assert.equal(recent.status, ACTIVITY.ACTIVE);
  assert.equal(recent.detail, 'response date not recorded');
  assert.equal(recent.responseDays, null);
  const old = act({ details_requested_at: at('2026-09-20'), cvMissingTokenStatus: 'RECEIVED' });
  assert.equal(old.status, ACTIVITY.INACTIVE);
  assert.equal(act({ cvMissingTokenStatus: 'RECEIVED' }).status, ACTIVITY.INACTIVE);
});

test('a submission with no request date is still Active, worded without a wait time', () => {
  const a = act({ details_completed_at: at('2026-10-20') });
  assert.equal(a.status, ACTIVITY.ACTIVE);
  assert.equal(a.detail, 'responded 20 Oct 2026');
  assert.equal(a.responseDays, null);
});

test('the window boundary is inclusive and the window is configurable', () => {
  const edge = { details_requested_at: new Date(now.getTime() - 15 * 86400000) };
  assert.equal(act(edge).status, ACTIVITY.PENDING);
  assert.equal(act({ details_requested_at: new Date(now.getTime() - 15 * 86400000 - 1) }).status, ACTIVITY.INACTIVE);
  assert.equal(act({ details_requested_at: at('2026-09-20') }, 90).status, ACTIVITY.PENDING);
});

test('an invalid window falls back to the default', () => {
  assert.equal(DEFAULT_ACTIVE_WINDOW_DAYS, 15);
  assert.equal(parseActiveWindowDays('30'), 30);
  for (const bad of [0, 366, 2.5, 'x', null, '']) assert.equal(parseActiveWindowDays(bad), null);
  assert.equal(act({ details_requested_at: at('2026-09-20') }, 0).status, ACTIVITY.INACTIVE);
});

test('sorting: status first, then score, then quicker response among Active (A2)', () => {
  const card = (name, activity, score) => ({ name, activity, score });
  const cards = [
    card('inactive-9.4', act({ createdAt: at('2024-02-14') }), 9.4),
    card('pending-9.1', act({ details_requested_at: at('2026-10-18') }), 9.1),
    card('active-slow-8.4', act({ details_requested_at: at('2026-10-08'), details_completed_at: at('2026-10-15') }), 8.4),
    card('active-fast-8.4', act({ details_requested_at: at('2026-10-13'), details_completed_at: at('2026-10-15') }), 8.4),
    card('active-7.0', act({ details_requested_at: at('2026-10-20'), details_completed_at: at('2026-10-20') }), 7.0),
  ];
  cards.sort((a, b) => compareActivity(a.activity, b.activity) || b.score - a.score || compareResponseSpeed(a.activity, b.activity));
  assert.deepEqual(cards.map((c) => c.name), ['active-fast-8.4', 'active-slow-8.4', 'active-7.0', 'pending-9.1', 'inactive-9.4']);
});

test('response speed only orders Active candidates; unknown speed goes last', () => {
  const fast = { status: ACTIVITY.ACTIVE, responseDays: 1 };
  const unknown = { status: ACTIVITY.ACTIVE, responseDays: null };
  assert.ok(compareResponseSpeed(fast, unknown) < 0);
  assert.ok(compareResponseSpeed(unknown, fast) > 0);
  assert.equal(compareResponseSpeed({ status: ACTIVITY.PENDING }, fast), 0);
});

test('counts and summary text', () => {
  const counts = countActivity([
    { activity: { status: 'active' } }, { activity: { status: 'active' } },
    { activity: { status: 'new' } }, { activity: { status: 'inactive' } }, {},
  ]);
  assert.deepEqual(counts, { active: 2, pending: 0, new: 1, inactive: 1 });
  assert.equal(activitySummaryText(counts), '2 active · 1 new applicant · 1 inactive');
});
