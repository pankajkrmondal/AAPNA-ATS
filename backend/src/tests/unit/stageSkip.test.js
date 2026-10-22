/**
 * Skip guard and multi-stage approve landing (Phase 3 "Do Now", N33 / N24),
 * plus the "approve without score" rule (N25). Pure — no DB.
 * Run: node --test src/tests/unit/stageSkip.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSkippable, resolveApproveLanding, skipNote, MANDATORY_SKIP_MESSAGE } from '../../utils/stageSkip.js';
import { scoreSourceFor, noScoreNoteError, MIN_NO_SCORE_NOTE_LENGTH } from '../../utils/stageScore.js';

// The production stage order once N24 is released (seed-pipeline-stages.js).
const STAGES = [
  ['zeko_hr', false], ['assessment', false], ['zeko_fn', false], ['tech1', false], ['tech2', false],
  ['tech3', true], ['hr_round', false], ['ceo', true], ['client', true], ['documents', false], ['offer', false],
].map(([stage_key, is_optional]) => ({ stage_key, label: stage_key.toUpperCase(), is_optional }));
const idx = (key) => STAGES.findIndex((s) => s.stage_key === key);
const is400 = (re) => (err) => err.statusCode === 400 && re.test(err.message);

test('advanceStage guard: only an optional stage can be left without an outcome (N33)', () => {
  assert.doesNotThrow(() => assertSkippable(STAGES[idx('tech3')]));
  assert.doesNotThrow(() => assertSkippable(STAGES[idx('ceo')]));
  assert.throws(() => assertSkippable(STAGES[idx('zeko_hr')]), is400(/mandatory/));
  assert.throws(() => assertSkippable(STAGES[idx('hr_round')]), is400(new RegExp(MANDATORY_SKIP_MESSAGE.replace('.', '\\.'))));
  assert.throws(() => assertSkippable(null), is400(/mandatory/));
});

test('plain approve lands on the next stage, skipping nothing', () => {
  const r = resolveApproveLanding(STAGES, idx('hr_round'));
  assert.equal(r.nextStage.stage_key, 'ceo');
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(resolveApproveLanding(STAGES, idx('offer')), { nextStage: null, skipped: [] }, 'final stage: nothing after');
});

test('HR Round can jump past CEO and Client straight to Documents (N24)', () => {
  const r = resolveApproveLanding(STAGES, idx('hr_round'), { skipToStageKey: 'documents' });
  assert.equal(r.nextStage.stage_key, 'documents');
  assert.deepEqual(r.skipped.map((s) => s.stage_key), ['ceo', 'client']);
  const toClient = resolveApproveLanding(STAGES, idx('hr_round'), { skipToStageKey: 'client' });
  assert.deepEqual(toClient.skipped.map((s) => s.stage_key), ['ceo']);
  // Naming the very next stage is just a normal approve.
  assert.deepEqual(resolveApproveLanding(STAGES, idx('hr_round'), { skipToStageKey: 'ceo' }).skipped, []);
});

test('a mandatory stage can never be jumped (N33)', () => {
  assert.throws(() => resolveApproveLanding(STAGES, idx('hr_round'), { skipToStageKey: 'offer' }), is400(/DOCUMENTS has to happen first/));
  assert.throws(() => resolveApproveLanding(STAGES, idx('zeko_hr'), { skipToStageKey: 'zeko_fn' }), is400(/ASSESSMENT has to happen first/));
  // Legacy one-stage flag on a mandatory next stage: refused, no longer silently ignored.
  assert.throws(() => resolveApproveLanding(STAGES, idx('zeko_hr'), { skipOptionalNext: true }), is400(/mandatory/));
});

test('legacy skipOptionalNext still bypasses exactly one optional stage (PIPE-16)', () => {
  const r = resolveApproveLanding(STAGES, idx('tech2'), { skipOptionalNext: true });
  assert.equal(r.nextStage.stage_key, 'hr_round');
  assert.deepEqual(r.skipped.map((s) => s.stage_key), ['tech3']);
});

test('bad targets are 400s, not silent no-ops', () => {
  assert.throws(() => resolveApproveLanding(STAGES, idx('hr_round'), { skipToStageKey: 'tech1' }), is400(/not a later active stage/));
  assert.throws(() => resolveApproveLanding(STAGES, idx('hr_round'), { skipToStageKey: 'nope' }), is400(/not a later active stage/));
  assert.throws(() => resolveApproveLanding(STAGES, idx('offer'), { skipToStageKey: 'documents' }), is400(/no later stage/));
  assert.throws(() => resolveApproveLanding(STAGES, idx('documents'), { skipOptionalNext: true }), is400(/no later stage/));
});

test('skip note: one stage keeps the old wording, a run lists them all', () => {
  assert.equal(skipNote([{ stage_key: 'tech3', label: 'Tech 3' }]), 'Skipped optional stage tech3 (Tech 3)');
  assert.equal(
    skipNote([{ stage_key: 'ceo', label: 'CEO / Final Round' }, { stage_key: 'client', label: 'Client Interview' }]),
    'Skipped optional stages ceo (CEO / Final Round), client (Client Interview)',
  );
});

test('score source per stage (N25)', () => {
  assert.equal(scoreSourceFor('zeko_hr'), 'zeko');
  assert.equal(scoreSourceFor('zeko_fn'), 'zeko');
  assert.equal(scoreSourceFor('assessment'), 'assessment');
  for (const k of ['tech1', 'tech2', 'tech3', 'hr_round', 'ceo', 'client']) assert.equal(scoreSourceFor(k), 'scorecard', k);
  for (const k of ['shortlist', 'documents', 'offer', 'unknown']) assert.equal(scoreSourceFor(k), null, k);
});

test('approve without score needs a real note; with a score (or none expected) it does not (N25)', () => {
  assert.match(noScoreNoteError({ hasScore: false, notes: null }), /no score yet/);
  assert.match(noScoreNoteError({ hasScore: false, notes: '   ok      ' }), new RegExp(`at least ${MIN_NO_SCORE_NOTE_LENGTH}`));
  assert.equal(noScoreNoteError({ hasScore: false, notes: 'Panel gave verbal go-ahead' }), null);
  assert.equal(noScoreNoteError({ hasScore: true, notes: null }), null);
  assert.equal(noScoreNoteError({ hasScore: null, notes: null }), null);
});
