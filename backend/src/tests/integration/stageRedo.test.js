/**
 * L02-C — re-do a passed stage (staging DB, FLEXIBLE_STAGES_ENABLED=true).
 *
 *   node src/tests/run-block.mjs src/tests/integration/stageRedo.test.js
 *
 *   - Tech 1 passed, candidate on HR Round: moving back to Tech 1 needs a
 *     reason; the old booking is superseded (kept, real status), the stage is
 *     not locked and has no score; HR Round stays not-passed
 *   - a new booking is allowed, and its scorecard is the stage's score
 *   - Approve goes back to HR Round, with no email when the box is unticked
 *   - Assessment re-do: the earlier result does not count; a new one does
 *   - Zeko re-do: the earlier attempt's job is refused, a different job is not
 *   - Documents can never be re-done
 *
 * Requires DDL 2026-10-22-stage-redo.sql. No email is sent. Fixtures are
 * tagged and torn down by explicit id.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import config from '../../config/index.js';
import { disconnectRedis } from '../../config/redis.js';
import { shortlistCandidates, assignCandidateToZekoJob } from '../../services/screening.service.js';
import { moveToStage, setStageOutcome, stageHasScore, getPipelineDetail } from '../../services/pipeline.service.js';
import { getStageLock, writeStageStates } from '../../services/stageState.service.js';
import { getInviteState } from '../../services/assessmentInvite.service.js';

const TAG = 'L02C-REDO-FIXTURE';
const USER = { username: 'l02c-redo-test', id: null };
const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY);
const made = { cvs: [], mrfs: [], imports: [] };

async function journeyAt({ name, place, passed = [], skipped = [] }) {
  const mrf = await prisma.rpa_mrf.create({
    data: { position_hiring_for: `L02C ${name} ${Date.now()}`, number_of_positions: 1, approval_status: 'approved', additional_information: TAG },
  });
  made.mrfs.push(mrf.id);
  const cv = await prisma.rpa_cv.create({
    data: { Name: `L02C ${name}`, EmailID: `l02c.${name.toLowerCase().replace(/\s+/g, '.')}@example.invalid`, MetaData: TAG, statusActive: 'ACTIVE', createdAt: new Date() },
  });
  made.cvs.push(cv.id);
  const r = await shortlistCandidates([{ id: Number(cv.id) }], Number(mrf.id), '', USER, { sendEmail: false, source: 'search_candidate' });
  assert.equal(r.shortlisted, 1);
  const shortlist = await prisma.rpa_shortlisted_candidates.findFirst({ where: { cv_id: cv.id, mrf_id: mrf.id } });
  const journey = await prisma.rpa_candidate_pipeline.findFirst({ where: { shortlist_id: shortlist.id } });
  // Put the journey on `place` with its history, completed 5 days ago.
  await prisma.$transaction(async (tx) => {
    await tx.rpa_candidate_pipeline.update({ where: { id: journey.id }, data: { current_stage_key: place, current_stage_status: 'in_progress' } });
    for (const key of passed) {
      await tx.rpa_pipeline_stage_events.create({ data: { pipeline_id: journey.id, stage_key: key, event_type: 'outcome', outcome: 'approved', notes: TAG, created_at: ago(5) } });
    }
    await tx.rpa_pipeline_stage_events.create({ data: { pipeline_id: journey.id, stage_key: place, event_type: 'entered', notes: TAG, created_at: ago(4) } });
    await writeStageStates(tx, journey.id, [
      ...passed.map((k) => ({ stageKey: k, status: 'completed' })),
      ...skipped.map((k) => ({ stageKey: k, status: 'skipped' })),
      { stageKey: place, status: 'active' },
    ]);
    // Their timestamps say "passed 5 days ago".
    await tx.rpa_pipeline_stage_state.updateMany({ where: { pipeline_id: journey.id, stage_key: { in: passed } }, data: { completed_at: ago(5), entered_at: ago(6) } });
  });
  return { journey, shortlist, cv };
}

async function booking(pipelineId, stageKey, { status = 'completed', start = ago(6) } = {}) {
  return prisma.rpa_interview_schedule.create({
    data: {
      pipeline_id: pipelineId, stage_key: stageKey, interviewer_name: 'Fixture Panel', interviewer_email: 'panel@example.invalid',
      scheduled_start_at: start, scheduled_end_at: new Date(start.getTime() + 3600000), status, notes: TAG,
    },
  });
}

async function submittedCard(pipelineId, scheduleId, stageKey, submittedAt) {
  return prisma.rpa_interview_scorecard.create({
    data: {
      schedule_id: scheduleId, pipeline_id: pipelineId, stage_key: stageKey, recipient_email: 'panel@example.invalid',
      token_expires_at: new Date(Date.now() + DAY), status: 'submitted', submitted_at: submittedAt, recommendation: 'hire',
    },
  });
}

describe('L02-C — re-do a passed stage', { skip: !config.pipeline.flexibleStagesEnabled && 'needs FLEXIBLE_STAGES_ENABLED=true' }, () => {
  after(async () => {
    const pipes = await prisma.rpa_candidate_pipeline.findMany({ where: { cv_id: { in: made.cvs } }, select: { id: true } });
    const pIds = pipes.map((p) => p.id);
    await prisma.rpa_interview_scorecard.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_interview_schedule.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_assessment_results.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_assessment_imports.deleteMany({ where: { id: { in: made.imports } } });
    await prisma.rpa_pipeline_stage_state.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_pipeline_stage_events.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_notifications.deleteMany({ where: { pipeline_id: { in: pIds } } });
    const shortlists = await prisma.rpa_shortlisted_candidates.findMany({ where: { cv_id: { in: made.cvs } }, select: { id: true } });
    await prisma.rpa_zeko_candidate_pipeline.deleteMany({ where: { candidate_id: { in: shortlists.map((s) => s.id) } } });
    await prisma.rpa_candidate_pipeline.deleteMany({ where: { id: { in: pIds } } });
    await prisma.rpa_shortlisted_candidates.deleteMany({ where: { cv_id: { in: made.cvs } } });
    await prisma.rpa_cv.deleteMany({ where: { id: { in: made.cvs } } });
    await prisma.rpa_mrf.deleteMany({ where: { id: { in: made.mrfs } } });
    await prisma.$disconnect();
    await disconnectRedis().catch(() => {});
  });

  test('Tech 1 re-done from HR Round: reason required, old booking superseded, fresh attempt, Approve goes back', async () => {
    const { journey } = await journeyAt({ name: 'Interview Redo', place: 'hr_round', passed: ['zeko_hr', 'assessment', 'zeko_fn', 'tech1', 'tech2'] });
    const old = await booking(journey.id, 'tech1');
    await submittedCard(journey.id, old.id, 'tech1', ago(6));

    await assert.rejects(() => moveToStage(journey.id, { targetStageKey: 'tech1', actedBy: null }), (e) => e.statusCode === 400 && /Give a reason/.test(e.message));
    const moved = await moveToStage(journey.id, { targetStageKey: 'tech1', fromStageKey: 'hr_round', actedBy: null, reason: 'panel wants a second round' });
    assert.equal(moved.move.redo, true);

    const ev = await prisma.rpa_pipeline_stage_events.findFirst({ where: { pipeline_id: journey.id, event_type: 'moved' }, orderBy: { id: 'desc' } });
    assert.equal(ev.reason_text, 'panel wants a second round');
    assert.match(ev.notes, / to re-do it$/);
    const oldNow = await prisma.rpa_interview_schedule.findUnique({ where: { id: old.id } });
    assert.ok(oldNow.superseded_at, 'the earlier booking is superseded');
    assert.equal(oldNow.status, 'completed', 'and keeps its real status');
    const left = await prisma.rpa_pipeline_stage_state.findUnique({ where: { pipeline_id_stage_key: { pipeline_id: journey.id, stage_key: 'hr_round' } } });
    assert.equal(left.status, 'skipped', 'HR Round was not passed, so it is skipped (can come back)');

    const pipeline = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: journey.id }, include: { rpa_shortlisted_candidates: true } });
    assert.equal((await getStageLock(pipeline)).locked, false, 'the earlier booking does not lock the re-done stage');
    assert.equal(await stageHasScore(pipeline, 'tech1'), false, 'the earlier scorecard is not this attempt\'s score');

    const detail = await getPipelineDetail(journey.id);
    assert.equal(detail.currentStageRedo, true);
    assert.equal(detail.redoReturnStageKey, 'hr_round');
    assert.equal(detail.earlierAttempts.tech1.bookings.length, 1);
    assert.equal(detail.interviewSchedules.tech1, undefined, 'no live booking yet');

    // A new booking is allowed (the old one no longer counts as live) and locks the stage.
    const fresh = await booking(journey.id, 'tech1', { status: 'scheduled', start: new Date(Date.now() + 2 * DAY) });
    assert.equal((await getStageLock(pipeline)).locked, true);
    await prisma.rpa_interview_schedule.update({ where: { id: fresh.id }, data: { status: 'completed' } });
    await submittedCard(journey.id, fresh.id, 'tech1', new Date());
    assert.equal(await stageHasScore(pipeline, 'tech1'), true, 'the new scorecard is the score');

    const approved = await setStageOutcome(journey.id, { outcomeKey: 'approved', sendEmail: false, expectedStageKey: 'tech1', actedBy: null });
    const after = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: journey.id } });
    assert.equal(after.current_stage_key, 'hr_round', 'Approve goes back to where the candidate came from');
    const outcome = await prisma.rpa_pipeline_stage_events.findFirst({ where: { pipeline_id: journey.id, event_type: 'outcome', stage_key: 'tech1' }, orderBy: { id: 'desc' } });
    assert.equal(outcome.email_sent, false);
    assert.ok(approved);
  });

  test('Assessment re-do: the earlier result does not count, a new one does', async () => {
    const { journey } = await journeyAt({ name: 'Assessment Redo', place: 'tech1', passed: ['zeko_hr', 'assessment'] });
    const imp = await prisma.rpa_assessment_imports.create({ data: { file_name: TAG } });
    made.imports.push(imp.id);
    const result = (createdAt) => prisma.rpa_assessment_results.create({
      data: {
        import_id: imp.id, pipeline_id: journey.id, test_name: 'Fixture Test', section_label_map: {},
        overall_result: 'Pass', overall_percentage: 72, email_matched: 'x@example.invalid', status: 'matched', created_at: createdAt,
      },
    });
    await result(ago(5));
    await moveToStage(journey.id, { targetStageKey: 'assessment', fromStageKey: 'tech1', actedBy: null, reason: 'retake requested' });
    const pipeline = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: journey.id }, include: { rpa_shortlisted_candidates: true } });
    assert.equal(await stageHasScore(pipeline, 'assessment'), false);
    const state = await getInviteState(journey.id);
    assert.equal(state.invite, null, 'the earlier invite (none here) is not offered as current');
    assert.equal(state.hasResult, false);
    const detail = await getPipelineDetail(journey.id);
    assert.equal(detail.earlierAttempts.assessment.assessment.length, 1);
    await result(new Date());
    assert.equal(await stageHasScore(pipeline, 'assessment'), true);
  });

  test('Zeko re-do: the earlier job is refused, a different job is accepted', async () => {
    const { journey, shortlist } = await journeyAt({ name: 'Zeko Redo', place: 'tech1', passed: ['zeko_hr'] });
    await prisma.rpa_zeko_candidate_pipeline.create({
      data: { candidate_id: shortlist.id, zeko_job_id: 'JOB-A', pipeline_id: 'JOB-A', stage: 'hr', status: 'completed', candidate_email: shortlist.candidate_email, created_at: ago(6), link_sent_at: ago(6) },
    });
    await moveToStage(journey.id, { targetStageKey: 'zeko_hr', fromStageKey: 'tech1', actedBy: null, reason: 'second screening' });
    await assert.rejects(() => assignCandidateToZekoJob(shortlist.id, 'JOB-A', 'hr'), (e) => e.statusCode === 409 && /different Zeko job/.test(e.message));
    const row = await assignCandidateToZekoJob(shortlist.id, 'JOB-B', 'hr');
    assert.equal(row.zeko_job_id, 'JOB-B');
    const pipeline = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: journey.id }, include: { rpa_shortlisted_candidates: true } });
    assert.equal((await getStageLock(pipeline)).locked, false, 'the earlier round row (link sent) does not lock the re-done round');
  });

  test('Documents can never be re-done', async () => {
    const { journey } = await journeyAt({ name: 'Docs No Redo', place: 'offer', passed: ['zeko_hr', 'documents'] });
    await assert.rejects(
      () => moveToStage(journey.id, { targetStageKey: 'documents', fromStageKey: 'offer', actedBy: null, reason: 'x' }),
      (e) => e.statusCode === 400 && /cannot be re-done/.test(e.message),
    );
  });
});
