/**
 * Role Summary grouping (L06). Pure — no database.
 * Run: node --test src/tests/unit/roleSummary.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleSummaryBucket, groupByMrf, withBoardNumbers } from '../../utils/roleSummary.js';

test('1 · buckets: the final else catches every closure status', () => {
  assert.equal(roleSummaryBucket('shortlisted'), 'shortlisted');
  assert.equal(roleSummaryBucket(null), 'shortlisted');
  assert.equal(roleSummaryBucket('On Hold'), 'on_hold');
  assert.equal(roleSummaryBucket('joined'), 'closed');
  assert.equal(roleSummaryBucket('moved'), 'closed');
});

test('2 · one row per MRF: same-name requisitions no longer merge', () => {
  const rows = groupByMrf([
    { mrf_id: 212, mrf: { id: 212, position_hiring_for: '.NET Developer' }, pipeline_status: 'shortlisted' },
    { mrf_id: 212, mrf: { id: 212, position_hiring_for: '.NET Developer' }, pipeline_status: 'rejected' },
    { mrf_id: 187, mrf: { id: 187, position_hiring_for: '.NET Developer' }, pipeline_status: 'joined' },
    { mrf_id: null, position_applied: 'Data Analyst', pipeline_status: 'shortlisted' },
    { mrf_id: null, position_applied: 'data analyst ', pipeline_status: 'shortlisted' },
  ]);
  assert.equal(rows.length, 3);
  const a = rows.find((r) => r.mrf_id === 212);
  assert.deepEqual([a.shortlisted, a.rejected, a.total], [1, 1, 2]);
  assert.equal(rows.find((r) => r.mrf_id === 187).closed, 1);
  assert.equal(rows.find((r) => r.mrf_id === null).total, 2, 'keyword shortlists group by role text');
  for (const r of rows) assert.equal(r.shortlisted + r.rejected + r.on_hold + r.future_prospect + r.closed, r.total);
});

test('3 · board numbers attach by MRF; open MRFs with no rows still appear; open first', () => {
  const grouped = groupByMrf([
    { mrf_id: 187, mrf: { id: 187, position_hiring_for: '.NET Developer' }, pipeline_status: 'joined' },
  ]);
  const rows = withBoardNumbers(grouped, [
    { mrf_id: 187, role: '.NET Developer', status: 'Filled', applied: 2, moved_forward: 0, shortlist_pct: 0 },
    { mrf_id: 212, role: '.NET Developer', status: 'Open', applied: 31, moved_forward: 0, shortlist_pct: 6 },
  ]);
  assert.deepEqual(rows.map((r) => r.mrf_id), [212, 187]);
  assert.equal(rows[0].total_applied, 31);
  assert.equal(rows[0].total, 0);
  assert.equal(rows[1].status, 'Filled');
});
