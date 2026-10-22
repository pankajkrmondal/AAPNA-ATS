/**
 * Change JD rules (Phase 3 section G, G3). Pure — no database.
 * Run: node --test src/tests/unit/changeJd.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeJdBlock, cleanChangeJdReason, changeJdNote, CHANGE_JD_REASON_MAX } from '../../utils/changeJd.js';

const shortlist = { pipeline_status: 'shortlisted' };
const journey = { final_outcome: null, current_stage_status: 'in_progress' };

test('a fresh shortlist with nothing set up under its JD can change', () => {
  assert.equal(changeJdBlock({ shortlist, journey, signals: {} }), null);
  // A keyword shortlist with no journey can too.
  assert.equal(changeJdBlock({ shortlist, journey: null, signals: {} }), null);
});

test('rejected, closed or stage-rejected records cannot change', () => {
  assert.equal(changeJdBlock({ shortlist: null, journey }).code, 'not_found');
  assert.equal(changeJdBlock({ shortlist: { pipeline_status: 'rejected' }, journey }).code, 'rejected');
  assert.equal(changeJdBlock({ shortlist, journey: { ...journey, final_outcome: 'joined' } }).code, 'closed');
  assert.equal(changeJdBlock({ shortlist, journey: { ...journey, current_stage_status: 'rejected' } }).code, 'stage_rejected');
});

test('anything set up under the old JD blocks, and every cause is named', () => {
  for (const key of ['offer', 'documentRequest', 'interview', 'assessmentInvite', 'assessmentResult', 'zekoInvite']) {
    const block = changeJdBlock({ shortlist, journey, signals: { [key]: true } });
    assert.equal(block?.code, 'activity', key);
  }
  const both = changeJdBlock({ shortlist, journey, signals: { interview: true, zekoInvite: true } });
  assert.match(both.message, /an interview is booked, a Zeko interview was set up/);
  assert.match(both.message, /Close the record instead/);
});

test('the reason is required, trimmed and capped', () => {
  assert.equal(cleanChangeJdReason('   '), null);
  assert.equal(cleanChangeJdReason(undefined), null);
  assert.equal(cleanChangeJdReason(42), null);
  assert.equal(cleanChangeJdReason('  wrong   JD picked '), 'wrong JD picked');
  assert.equal(cleanChangeJdReason('x'.repeat(900)).length, CHANGE_JD_REASON_MAX);
});

test('the history note names both JDs, or "no JD" for a keyword shortlist', () => {
  assert.equal(
    changeJdNote({ fromRole: 'QA', fromMrfId: 12, toRole: 'Dev', toMrfId: 15, reason: 'wrong pick' }),
    'JD changed from "QA" (MRF-12) to "Dev" (MRF-15). Reason: wrong pick',
  );
  assert.equal(
    changeJdNote({ fromRole: null, fromMrfId: null, toRole: 'Dev', toMrfId: 15, reason: 'set it' }),
    'JD changed from no JD to "Dev" (MRF-15). Reason: set it',
  );
});
