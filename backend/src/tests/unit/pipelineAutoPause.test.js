/**
 * Idle-journey auto-pause settings and the board's three views (23 Oct 2026).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AUTO_PAUSE_DAYS,
  parseAutoPauseDays,
  parseAutoPauseEnabled,
  autoPauseNote,
} from '../../utils/pipelineAutoPause.js';
import { buildBoardViewWhere } from '../../utils/pipelineBoardView.js';

test('auto-pause days: whole numbers 1..365 only', () => {
  assert.equal(DEFAULT_AUTO_PAUSE_DAYS, 10);
  assert.equal(parseAutoPauseDays('10'), 10);
  assert.equal(parseAutoPauseDays(1), 1);
  assert.equal(parseAutoPauseDays(365), 365);
  for (const bad of [0, 366, 2.5, 'x', null, undefined, '', -3]) assert.equal(parseAutoPauseDays(bad), null);
});

test('auto-pause is on unless explicitly stored as false', () => {
  assert.equal(parseAutoPauseEnabled(undefined), true);
  assert.equal(parseAutoPauseEnabled('true'), true);
  assert.equal(parseAutoPauseEnabled('false'), false);
});

test('auto-pause note names the window', () => {
  assert.match(autoPauseNote(10), /10 days/);
  assert.match(autoPauseNote(1), /1 day\b/);
});

test('board views: live work by default, closed-only, paused-only', () => {
  assert.deepEqual(buildBoardViewWhere(), { final_outcome: null, is_paused: false });
  assert.deepEqual(buildBoardViewWhere({ closedOnly: true }), { final_outcome: { not: null } });
  assert.deepEqual(buildBoardViewWhere({ pausedOnly: true }), { final_outcome: null, is_paused: true });
  // Both set: closed wins (the UI makes them exclusive).
  assert.deepEqual(buildBoardViewWhere({ closedOnly: true, pausedOnly: true }), { final_outcome: { not: null } });
});
