/**
 * Flexible stage movement rules (docs/phase3/pipeline/FLEXIBLE-STAGE-MOVEMENT-DRAG-DROP-PLAN.md):
 * per-stage state, the move plan, the Approve landing and the lock rule. Pure — no DB.
 * Run: node --test src/tests/unit/stageState.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGE_STATES as S,
  deriveStageStates,
  resolveStageStates,
  planMove,
  moveNote,
  resolveFlexibleApproveLanding,
  computeStageLock,
  LOCK_CODES,
  isMoveTarget,
  stageActorsFromEvents,
} from '../../utils/stageState.js';
import { stagePendingLabelFor, isStageArrival, isTransitionEvent } from '../../config/pipelineStages.js';
import { parseMoveNote, parseFilters, buildWhere } from '../../exports/moveHistory.export.js';

const LABELS = {
  shortlist: 'Shortlisted', zeko_hr: 'HR Screening (Zeko)', assessment: 'IQ / Tech Assessment', zeko_fn: 'Functional Screening (Zeko)',
  tech1: 'Technical Round 1', tech2: 'Technical Round 2', tech3: 'Technical Round 3', hr_round: 'HR Round',
  ceo: 'CEO / Final Round', client: 'Client Interview', documents: 'Documents', offer: 'Offer',
};
const ALL = Object.keys(LABELS).map((stage_key, i) => ({
  stage_key, label: LABELS[stage_key], sort_order: (i + 1) * 10, is_active: stage_key !== 'shortlist',
}));
const ACTIVE = ALL.filter((s) => s.is_active);
const idx = (k) => ACTIVE.findIndex((s) => s.stage_key === k);
const on = (key, status = 'in_progress') => ({ current_stage_key: key, current_stage_status: status });
const is = (code, re) => (err) => err.statusCode === code && (!re || re.test(err.message));

test('derive: forward history = passed where approved, skipped where bypassed, nothing ahead', () => {
  const events = [
    { stage_key: 'zeko_hr', event_type: 'outcome', outcome: 'approved' },
    { stage_key: 'assessment', event_type: 'outcome', outcome: 'approved' },
    { stage_key: 'zeko_fn', event_type: 'outcome', outcome: 'approved' },
    { stage_key: 'tech1', event_type: 'outcome', outcome: 'hold' },
    { stage_key: 'tech1', event_type: 'outcome', outcome: 'approved' },
    { stage_key: 'tech2', event_type: 'outcome', outcome: 'approved' },
  ];
  const st = deriveStageStates({ stages: ALL, pipeline: on('hr_round'), events });
  assert.deepEqual(st, {
    zeko_hr: S.COMPLETED, assessment: S.COMPLETED, zeko_fn: S.COMPLETED, tech1: S.COMPLETED, tech2: S.COMPLETED,
    tech3: S.SKIPPED, hr_round: S.ACTIVE,
  });
  assert.equal(st.shortlist, undefined, 'shortlist is never a board stage');
});

test('derive: the current stage follows the journey status', () => {
  assert.equal(deriveStageStates({ stages: ALL, pipeline: on('tech1', 'rejected') }).tech1, S.REJECTED);
  assert.equal(deriveStageStates({ stages: ALL, pipeline: on('tech1', 'hold') }).tech1, S.HOLD);
  assert.equal(deriveStageStates({ stages: ALL, pipeline: on('offer', 'approved') }).offer, S.COMPLETED);
  assert.deepEqual(deriveStageStates({ stages: ALL, pipeline: on('zeko_hr') }), { zeko_hr: S.ACTIVE });
});

test('resolve: stored rows win, but the current stage always mirrors the journey', () => {
  const rows = [{ stage_key: 'zeko_hr', status: S.SKIPPED }, { stage_key: 'tech1', status: S.COMPLETED }, { stage_key: 'tech2', status: 'active' }];
  const st = resolveStageStates(rows, () => assert.fail('no derive when rows exist'), on('tech2', 'hold'));
  assert.deepEqual(st, { zeko_hr: S.SKIPPED, tech1: S.COMPLETED, tech2: S.HOLD });
  assert.deepEqual(resolveStageStates([], () => ({ a: S.SKIPPED }), on('b')), { a: S.SKIPPED, b: S.ACTIVE });
});

test('scenario 1: HR Screening -> Tech 1 is FORWARD and skips 2 stages', () => {
  const plan = planMove({ stages: ALL, states: { zeko_hr: S.ACTIVE }, pipeline: on('zeko_hr'), targetStageKey: 'tech1' });
  assert.equal(plan.direction, 'forward');
  assert.equal(plan.skippedCount, 2);
  assert.deepEqual(plan.between.map((s) => s.stage_key), ['assessment', 'zeko_fn']);
  assert.equal(moveNote(plan), 'Moved forward from HR Screening (Zeko) to Technical Round 1 (skipped 2 stages)');
});

test('backward moves skip nothing; one skipped stage reads in the singular', () => {
  const back = planMove({ stages: ALL, states: { zeko_hr: S.SKIPPED, tech2: S.ACTIVE }, pipeline: on('tech2'), targetStageKey: 'zeko_hr' });
  assert.equal(back.direction, 'backward');
  assert.equal(back.skippedCount, 0);
  assert.equal(moveNote(back), 'Moved backward from Technical Round 2 to HR Screening (Zeko)');
  const one = planMove({ stages: ALL, states: {}, pipeline: on('tech1'), targetStageKey: 'tech3' });
  assert.equal(moveNote(one), 'Moved forward from Technical Round 1 to Technical Round 3 (skipped 1 stage)');
});

test('passed stages in between are not counted as skipped by the move', () => {
  const plan = planMove({ stages: ALL, states: { zeko_hr: S.ACTIVE, assessment: S.COMPLETED }, pipeline: on('zeko_hr'), targetStageKey: 'tech1' });
  assert.equal(plan.skippedCount, 1);
});

test('scenario 7: HR Screening -> Offer in one move is allowed (D4, D7)', () => {
  const plan = planMove({ stages: ALL, states: {}, pipeline: on('zeko_hr'), targetStageKey: 'offer' });
  assert.equal(plan.direction, 'forward');
  assert.equal(plan.skippedCount, 9);
});

test('scenario 6 (D2 as amended by L02-C): a passed stage needs a reason to re-enter; a skipped one does not', () => {
  const states = { zeko_fn: S.COMPLETED, assessment: S.SKIPPED, tech2: S.ACTIVE };
  assert.throws(() => planMove({ stages: ALL, states, pipeline: on('tech2'), targetStageKey: 'zeko_fn' }), is(400, /already passed Functional Screening/));
  assert.doesNotThrow(() => planMove({ stages: ALL, states, pipeline: on('tech2'), targetStageKey: 'assessment' }));
  assert.equal(isMoveTarget(undefined), true);
  assert.equal(isMoveTarget(S.SKIPPED), true);
  assert.equal(isMoveTarget(S.COMPLETED), false);
});

test('bad move targets are 400s', () => {
  assert.throws(() => planMove({ stages: ALL, states: {}, pipeline: on('tech1'), targetStageKey: 'tech1' }), is(400, /already on Technical Round 1/));
  assert.throws(() => planMove({ stages: ALL, states: {}, pipeline: on('tech1'), targetStageKey: 'shortlist' }), is(400, /not an active pipeline stage/));
  assert.throws(() => planMove({ stages: ALL, states: {}, pipeline: on('tech1'), targetStageKey: 'nope' }), is(400, /not an active/));
  assert.throws(() => planMove({ stages: ALL, states: {}, pipeline: on('tech1'), targetStageKey: '' }), is(400));
});

test('scenario 4 / C4: Approve lands on the next stage not yet passed', () => {
  // Tech 1 -> Functional happened earlier: approving Functional must not land on Tech 1 again.
  const states = { zeko_hr: S.SKIPPED, tech1: S.COMPLETED, zeko_fn: S.ACTIVE };
  const r = resolveFlexibleApproveLanding(ACTIVE, idx('zeko_fn'), states);
  assert.equal(r.nextStage.stage_key, 'tech2');
  assert.deepEqual(r.skipped, []);
  // Nothing ahead left -> null (approved where they stand).
  const done = Object.fromEntries(ACTIVE.slice(idx('tech2')).map((s) => [s.stage_key, S.COMPLETED]));
  assert.equal(resolveFlexibleApproveLanding(ACTIVE, idx('tech1'), done).nextStage, null);
});

test('C4: the picker may land on any not-passed stage, backward included; passed ones refused', () => {
  const states = { zeko_hr: S.SKIPPED, tech1: S.ACTIVE, assessment: S.COMPLETED };
  const fwd = resolveFlexibleApproveLanding(ACTIVE, idx('tech1'), states, { skipToStageKey: 'offer' });
  assert.equal(fwd.nextStage.stage_key, 'offer');
  assert.deepEqual(fwd.skipped.map((s) => s.stage_key), ['tech2', 'tech3', 'hr_round', 'ceo', 'client', 'documents'], 'mandatory stages may be jumped under the flag');
  const back = resolveFlexibleApproveLanding(ACTIVE, idx('tech1'), states, { skipToStageKey: 'zeko_hr' });
  assert.equal(back.nextStage.stage_key, 'zeko_hr');
  assert.deepEqual(back.skipped, []);
  assert.throws(() => resolveFlexibleApproveLanding(ACTIVE, idx('tech1'), states, { skipToStageKey: 'assessment' }), is(400, /already passed/));
  assert.throws(() => resolveFlexibleApproveLanding(ACTIVE, idx('tech1'), states, { skipToStageKey: 'tech1' }), is(400));
});

test('lock: not started = movable', () => {
  assert.deepEqual(computeStageLock({ pipeline: on('tech1') }), { locked: false, code: null, reason: null });
});

test('lock: journey-level reasons come first', () => {
  assert.equal(computeStageLock({ pipeline: { ...on('tech1'), final_outcome: 'joined' } }).code, LOCK_CODES.CLOSED);
  assert.equal(computeStageLock({ pipeline: { ...on('tech1'), is_paused: true } }).code, LOCK_CODES.PAUSED);
  assert.equal(computeStageLock({ pipeline: on('tech1', 'rejected') }).code, LOCK_CODES.REJECTED);
  assert.match(computeStageLock({ pipeline: on('tech1', 'hold') }).reason, /off hold/);
});

test('scenario 2: every started activity locks, with a reason', () => {
  const d = new Date('2026-10-18T06:30:00Z');
  const cases = [
    [{ zekoInvite: { link_sent_at: d } }, LOCK_CODES.ZEKO_INVITED, /Zeko invite sent on 18 Oct 2026/],
    [{ zekoScored: true }, LOCK_CODES.ZEKO_RESULT, /awaiting a decision/],
    [{ interview: { scheduled_start_at: d, stage_key: 'tech1' } }, LOCK_CODES.INTERVIEW_BOOKED, /Interview booked for 18 Oct 2026/],
    [{ interview: { scheduled_start_at: d, stage_key: 'client' } }, LOCK_CODES.INTERVIEW_BOOKED, /Client interview arranged/],
    [{ assessmentInvite: { sent_at: d } }, LOCK_CODES.ASSESSMENT_INVITED, /Withdraw the invite/],
    [{ assessmentResult: true }, LOCK_CODES.ASSESSMENT_RESULT, /Evalground result/],
    [{ documentRequest: { requested_at: d } }, LOCK_CODES.DOCUMENTS_REQUESTED, /Cancel the document request/],
    [{ offerShared: { shared_at: d } }, LOCK_CODES.OFFER_SHARED, /Offer shared on 18 Oct 2026/],
  ];
  for (const [signals, code, re] of cases) {
    const l = computeStageLock({ pipeline: on('x'), signals });
    assert.equal(l.locked, true, code);
    assert.equal(l.code, code);
    assert.match(l.reason, re);
  }
});

test('C2 watch-out: an Assessment card with no invite is NOT locked', () => {
  assert.equal(computeStageLock({ pipeline: on('assessment'), signals: { assessmentInvite: null, assessmentResult: false } }).locked, false);
});

test('C6: a move writes a "<stage> Pending" legacy label', () => {
  assert.equal(stagePendingLabelFor('tech1'), 'Technical Round 1 Pending');
  assert.equal(stagePendingLabelFor('assessment'), 'Evalground Test Pending');
});

test('C12: the Move history report reads direction and skips back out of the note', () => {
  const plan = planMove({ stages: ALL, states: {}, pipeline: on('zeko_hr'), targetStageKey: 'tech1' });
  assert.deepEqual(parseMoveNote(moveNote(plan)), { direction: 'forward', skipped: 2 });
  assert.deepEqual(parseMoveNote('Moved backward from Technical Round 2 to HR Screening (Zeko)'), { direction: 'backward', skipped: 0 });
  assert.deepEqual(parseMoveNote('Moved forward from A to B (skipped 1 stage)'), { direction: 'forward', skipped: 1 });
  assert.deepEqual(parseMoveNote(null), { direction: '', skipped: 0 });
});

test('C12: Move history filters are validated, days are IST', () => {
  const f = parseFilters({ query: { date_from: '2026-10-16', date_to: 'bad', moved_by: '7', mrf_id: '137; drop' } });
  assert.deepEqual(f, { dateFrom: '2026-10-16', dateTo: undefined, movedBy: 7, mrfId: undefined });
  const w = buildWhere({ dateFrom: '2026-10-16', dateTo: '2026-10-16', movedBy: 7, mrfId: '137' });
  assert.equal(w.event_type, 'moved');
  assert.equal(w.created_at.gte.toISOString(), '2026-10-15T18:30:00.000Z');
  assert.equal(w.created_at.lte.toISOString(), '2026-10-16T18:29:59.999Z');
  assert.equal(w.acted_by, 7);
  assert.equal(w.rpa_candidate_pipeline.mrf_id, 137n);
});

test('updated_by for history rows: whoever put the stage in its state, latest first', () => {
  const t = (m) => new Date(`2026-10-0${m}T10:00:00Z`);
  const events = [
    { stage_key: 'zeko_hr', event_type: 'entered', acted_by: 4, created_at: t(1) },
    { stage_key: 'zeko_hr', event_type: 'outcome', outcome: 'hold', acted_by: 5, created_at: t(2) },
    { stage_key: 'zeko_hr', event_type: 'outcome', outcome: 'approved', acted_by: 6, created_at: t(3) },
    { stage_key: 'tech1', event_type: 'entered', acted_by: 6, created_at: t(3) },
    { stage_key: 'tech1', event_type: 'moved', acted_by: 7, created_at: t(4) },
    { stage_key: 'tech2', event_type: 'outcome', outcome: 'rejected', acted_by: null, created_at: t(5) },
  ];
  const actors = stageActorsFromEvents({ zeko_hr: S.COMPLETED, tech1: S.ACTIVE, tech2: S.REJECTED, assessment: S.SKIPPED }, events);
  assert.deepEqual(actors, { zeko_hr: 6, tech1: 7, tech2: null, assessment: null });
  assert.equal(stageActorsFromEvents({ zeko_hr: S.HOLD }, events).zeko_hr, 5, 'hold -> the hold outcome, not the later approve');
});

test('C9: a moved event is an arrival and a transition (funnel, days-in-stage)', () => {
  assert.equal(isStageArrival({ event_type: 'moved' }), true);
  assert.equal(isTransitionEvent({ event_type: 'moved' }), true);
  assert.equal(isTransitionEvent({ event_type: 'note' }), false);
});

// ── L02-C: re-do a passed stage ───────────────────────────────────────
import { redoVisitStart, inVisit, isRedoable, REDO_EXCLUDED_STAGE_KEYS } from '../../utils/stageState.js';

test('L02-C: a passed stage can be re-done with a reason; Documents and Offer never', () => {
  const states = { tech1: S.COMPLETED, tech2: S.COMPLETED, hr_round: S.ACTIVE, documents: S.COMPLETED, offer: S.COMPLETED };
  const plan = planMove({ stages: ALL, states, pipeline: on('hr_round'), targetStageKey: 'tech1', reason: 'panel wants a second round' });
  assert.equal(plan.redo, true);
  assert.equal(plan.direction, 'backward');
  assert.throws(() => planMove({ stages: ALL, states, pipeline: on('hr_round'), targetStageKey: 'tech1', reason: '  ' }), is(400, /Give a reason/));
  for (const key of REDO_EXCLUDED_STAGE_KEYS) {
    assert.equal(isRedoable(key), false);
    assert.throws(
      () => planMove({ stages: ALL, states: { ...states, hr_round: S.SKIPPED, ceo: S.ACTIVE }, pipeline: on('ceo'), targetStageKey: key, reason: 'x' }),
      is(400, /cannot be re-done/),
    );
  }
  assert.equal(planMove({ stages: ALL, states: { tech2: S.ACTIVE }, pipeline: on('tech2'), targetStageKey: 'zeko_hr' }).redo, false);
});

test('L02-C: the re-do note keeps the parseable "Moved backward" prefix', () => {
  const plan = planMove({ stages: ALL, states: { tech1: S.COMPLETED, hr_round: S.ACTIVE }, pipeline: on('hr_round'), targetStageKey: 'tech1', reason: 'r' });
  const note = moveNote(plan);
  assert.match(note, /^Moved backward from .+ to Technical Round 1 to re-do it$/);
  assert.equal(parseMoveNote(note).direction, 'backward');
});

test('L02-C: a visit is a re-do only when entered after it was completed', () => {
  const t = (s) => new Date(`2026-10-${s}T10:00:00Z`);
  assert.equal(redoVisitStart(null), null);
  assert.equal(redoVisitStart({ entered_at: t('01'), completed_at: null }), null, 'first visit, not passed yet');
  assert.equal(redoVisitStart({ entered_at: t('01'), completed_at: t('05') }), null, 'passed, not re-entered');
  assert.deepEqual(redoVisitStart({ entered_at: t('10'), completed_at: t('05') }), t('10'));
  assert.equal(inVisit(t('09'), t('10')), false);
  assert.equal(inVisit(t('11'), t('10')), true);
  assert.equal(inVisit(null, t('10')), false);
  assert.equal(inVisit(t('01'), null), true, 'no re-do = everything counts');
});

test('L02-C: Approve after a re-do goes back to where the candidate came from', () => {
  // Tech 1 re-done from HR Round: Tech 2 and HR Round passed earlier? HR Round was left mid-way (skipped).
  const states = { zeko_hr: S.COMPLETED, tech1: S.ACTIVE, tech2: S.COMPLETED, hr_round: S.SKIPPED };
  const back = resolveFlexibleApproveLanding(ACTIVE, idx('tech1'), states, { returnToStageKey: 'hr_round' });
  assert.equal(back.nextStage.stage_key, 'hr_round');
  // The stage they came from was passed meanwhile: fall back to the next not-passed one.
  const passedBack = resolveFlexibleApproveLanding(ACTIVE, idx('tech1'), { ...states, hr_round: S.COMPLETED }, { returnToStageKey: 'hr_round' });
  assert.equal(passedBack.nextStage.stage_key, 'tech3');
  // An explicit pick still wins.
  const pick = resolveFlexibleApproveLanding(ACTIVE, idx('tech1'), states, { returnToStageKey: 'hr_round', skipToStageKey: 'ceo' });
  assert.equal(pick.nextStage.stage_key, 'ceo');
});
