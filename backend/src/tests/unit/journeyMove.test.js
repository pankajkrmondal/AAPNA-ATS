/**
 * Move to another JD (L02-A) — pure rules. No database.
 * Run: node --test src/tests/unit/journeyMove.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanMoveReason, moveJourneyBlock, landingStages, resolveLandingStage, moveNotes, movedEmailLeadHtml, MOVE_REASON_MAX,
} from '../../utils/journeyMove.js';
import {
  FINAL_OUTCOMES, SHORTLIST_STATUSES, TERMINAL_SHORTLIST_STATUSES, shortlistStatusFor, finalStatusLabelFor,
} from '../../config/pipelineStages.js';

const open = { cv_id: 7n, final_outcome: null, is_paused: false, current_stage_status: 'in_progress' };

test('an open journey can be moved, even when rejected at its stage', () => {
  assert.equal(moveJourneyBlock({ journey: open }), null);
  assert.equal(moveJourneyBlock({ journey: { ...open, current_stage_status: 'rejected' } }), null);
});

test('closed, paused, offered or orphan journeys cannot be moved', () => {
  assert.equal(moveJourneyBlock({ journey: null }).code, 'not_found');
  assert.equal(moveJourneyBlock({ journey: { ...open, cv_id: null } }).code, 'no_candidate');
  assert.equal(moveJourneyBlock({ journey: { ...open, final_outcome: 'closure_rejected' } }).code, 'closed');
  assert.equal(moveJourneyBlock({ journey: { ...open, is_paused: true } }).code, 'paused');
  assert.equal(moveJourneyBlock({ journey: open, hasOffer: true }).code, 'offer');
});

test('the reason is required, trimmed and capped', () => {
  assert.equal(cleanMoveReason('  '), null);
  assert.equal(cleanMoveReason(42), null);
  assert.equal(cleanMoveReason('  Better   fit  '), 'Better fit');
  assert.equal(cleanMoveReason('x'.repeat(900)).length, MOVE_REASON_MAX);
});

const stages = [
  { stage_key: 'tech1', label: 'Technical Round 1', sort_order: 40 },
  { stage_key: 'shortlist', label: 'Shortlisted', sort_order: 0 },
  { stage_key: 'zeko_hr', label: 'HR Screening (Zeko)', sort_order: 10 },
  { stage_key: 'tech3', label: 'Technical Round 3', sort_order: 60, is_active: false },
  { stage_key: 'assessment', label: 'Assessment', sort_order: 20 },
];

test('landing stages are the active board stages in order', () => {
  assert.deepEqual(landingStages(stages).map((s) => s.stage_key), ['zeko_hr', 'assessment', 'tech1']);
});

test('no stage asked = start from scratch; an unknown or inactive stage is refused', () => {
  const board = landingStages(stages);
  assert.equal(resolveLandingStage(board, null).stage_key, 'zeko_hr');
  assert.equal(resolveLandingStage(board, '').stage_key, 'zeko_hr');
  assert.equal(resolveLandingStage(board, 'tech1').label, 'Technical Round 1');
  assert.equal(resolveLandingStage(board, 'tech3'), null);
  assert.equal(resolveLandingStage(board, 'shortlist'), null);
  assert.equal(resolveLandingStage([], null), null);
});

test('both journeys get a note naming the other JD, the stage and the reason', () => {
  const n = moveNotes({
    fromRole: 'Senior .NET Developer', fromMrfId: 198, fromStageLabel: 'Technical Round 2',
    toRole: '.NET Developer', toMrfId: 212, toStageLabel: 'HR Screening (Zeko)', startFromScratch: true,
    reason: 'Better fit',
  });
  assert.equal(n.closeNote, 'Moved to ".NET Developer" (MRF-212), from the start (HR Screening (Zeko)). Reason: Better fit');
  assert.equal(n.entryNote, 'Moved from "Senior .NET Developer" (MRF-198) at Technical Round 2, from the start (HR Screening (Zeko)). Reason: Better fit');
  const later = moveNotes({ fromRole: 'A', fromMrfId: 1, fromStageLabel: 'X', toRole: 'B', toMrfId: 2, toStageLabel: 'Technical Round 1', startFromScratch: false, reason: 'r' });
  assert.match(later.closeNote, /, at Technical Round 1\. Reason: r$/);
});

test('the optional email line escapes the role', () => {
  assert.match(movedEmailLeadHtml('QA <Lead>'), /QA &lt;Lead&gt;/);
});

test('moved_to_other_jd closes the old shortlist row as "moved", a terminal status', () => {
  assert.equal(FINAL_OUTCOMES.MOVED_TO_OTHER_JD, 'moved_to_other_jd');
  assert.equal(shortlistStatusFor(FINAL_OUTCOMES.MOVED_TO_OTHER_JD), SHORTLIST_STATUSES.MOVED);
  assert.ok(TERMINAL_SHORTLIST_STATUSES.includes('moved'));
  assert.equal(finalStatusLabelFor('tech2', FINAL_OUTCOMES.MOVED_TO_OTHER_JD), 'Moved to Another JD');
});

// ── L02-B: remove or switch a JD tag ──────────────────────────────────
import { tagChangeBlock, tagActions } from '../../utils/candidateTag.js';

test('a tag can be removed only while another remains and the JD is not in the pipeline', () => {
  const two = [{ mrf_id: 1n }, { mrf_id: 2n }];
  assert.equal(tagChangeBlock({ action: 'remove', tags: two, mrfId: 1n }), null);
  assert.equal(tagChangeBlock({ action: 'remove', tags: [{ mrf_id: 1n }], mrfId: 1n }).code, 'only_tag');
  assert.equal(tagChangeBlock({ action: 'remove', tags: two, mrfId: 2n, openJourneyMrfIds: new Set(['2']) }).code, 'in_pipeline');
  assert.equal(tagChangeBlock({ action: 'remove', tags: two, mrfId: 9n }).status, 404);
});

test('the only tag can be switched; an in-pipeline tag goes through Move', () => {
  assert.equal(tagChangeBlock({ action: 'switch', tags: [{ mrf_id: 1n }], mrfId: 1n }), null);
  assert.equal(tagChangeBlock({ action: 'switch', tags: [{ mrf_id: 1n }], mrfId: 1n, openJourneyMrfIds: new Set(['1']) }).code, 'in_pipeline');
});

test('chip actions: × only with another tag and no open journey; otherwise switch', () => {
  const [a, b, c] = tagActions([{ mrf_id: 212 }, { mrf_id: 187 }, { mrf_id: 198 }], new Map([['198', 55]]));
  assert.deepEqual([a.can_remove, a.switch_via], [true, 'tag']);
  assert.deepEqual([b.can_remove, b.switch_via], [true, 'tag']);
  assert.deepEqual([c.can_remove, c.switch_via, c.open_pipeline_id], [false, 'move', 55]);
  const [only] = tagActions([{ mrf_id: 212 }]);
  assert.deepEqual([only.can_remove, only.switch_via], [false, 'tag']);
});
