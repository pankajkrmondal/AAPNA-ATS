/**
 * Evalground invite state shared by the board card and the drawer
 * (Phase 3 "Do Now", N35). Pure — no DB.
 * Run: node --test src/tests/unit/assessmentInviteState.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessmentInviteState, latestInviteByPipeline } from '../../utils/assessmentInviteState.js';

const NOW = new Date('2026-10-19T10:00:00Z');
const invite = (over = {}) => ({
  pipeline_id: 1n,
  sent_at: '2026-10-15T09:00:00Z',
  deadline_at: '2026-10-22T09:00:00Z',
  withdrawn_at: null,
  ...over,
});

test('no invite reads as "Test not sent"', () => {
  assert.deepEqual(assessmentInviteState(null, false, NOW), {
    sent: false, sentAt: null, dueAt: null, isOverdue: false, isWithdrawn: false,
  });
});

test('sent and inside the deadline: sent, due date carried, not overdue', () => {
  const s = assessmentInviteState(invite(), false, NOW);
  assert.equal(s.sent, true);
  assert.equal(s.isOverdue, false);
  assert.equal(s.dueAt.toISOString(), '2026-10-22T09:00:00.000Z');
  assert.equal(s.sentAt.toISOString(), '2026-10-15T09:00:00.000Z');
});

test('past the deadline with no result is overdue', () => {
  const s = assessmentInviteState(invite({ deadline_at: '2026-10-18T09:00:00Z' }), false, NOW);
  assert.equal(s.isOverdue, true);
});

test('a result clears overdue even after the deadline', () => {
  const s = assessmentInviteState(invite({ deadline_at: '2026-10-18T09:00:00Z' }), true, NOW);
  assert.equal(s.isOverdue, false);
});

test('a withdrawn latest invite reads as not sent and is never overdue', () => {
  const s = assessmentInviteState(invite({ deadline_at: '2026-10-18T09:00:00Z', withdrawn_at: '2026-10-17T09:00:00Z' }), false, NOW);
  assert.equal(s.sent, false);
  assert.equal(s.isWithdrawn, true);
  assert.equal(s.isOverdue, false);
});

test('latestInviteByPipeline keeps the first (newest) row per journey', () => {
  const rows = [
    invite({ pipeline_id: 1n, sent_at: '2026-10-18T00:00:00Z' }),
    invite({ pipeline_id: 2n, sent_at: '2026-10-17T00:00:00Z' }),
    invite({ pipeline_id: 1n, sent_at: '2026-10-10T00:00:00Z' }),
  ];
  const m = latestInviteByPipeline(rows);
  assert.equal(m.size, 2);
  assert.equal(m.get('1').sent_at, '2026-10-18T00:00:00Z');
  assert.equal(latestInviteByPipeline(null).size, 0);
});
