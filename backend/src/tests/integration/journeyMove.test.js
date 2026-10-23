/**
 * L02 — Move to another JD (L02-A) and remove / switch a JD tag (L02-B),
 * database behaviour (staging DB).
 *
 *   node src/tests/run-block.mjs src/tests/integration/journeyMove.test.js
 *
 *   - a journey at Technical Round 1 moves to another JD at a chosen stage:
 *     the old one is closed as moved_to_other_jd (silent), its shortlist row
 *     reads 'moved', the new one starts there with the link, the tag and the
 *     old journey's vendor attribution
 *   - "Start from scratch" lands on the first stage; a stage-rejected
 *     candidate can still be moved (no cool-off)
 *   - "Earlier roles": the new journey lists the old one with its history
 *   - refused: no reason, same / closed / already-on JD, a closed journey;
 *     the closure route refuses moved_to_other_jd
 *   - re-adding to the old JD is skipped as moved_away
 *   - tags: the only tag and an in-pipeline tag cannot be removed; a tag can
 *     be switched; a second tag can be removed
 *
 * Requires DDL 2026-10-22-journey-move.sql. No email is sent (notify off).
 * Fixtures are tagged and torn down by explicit id.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import { shortlistCandidates } from '../../services/screening.service.js';
import { getMoveJdStatus, moveJourneyToMrf } from '../../services/journeyMove.service.js';
import { getRelatedJourneys } from '../../services/pipeline.service.js';
import { tagCandidates, listCandidateTags, untagCandidate, switchCandidateTag } from '../../services/candidateTag.service.js';

const TAG = 'L02-MOVE-FIXTURE';
const USER = { username: 'l02-move-test', id: null };
const made = { cvs: [], mrfs: [] };

async function cv(name, extra = {}) {
  const row = await prisma.rpa_cv.create({
    data: {
      Name: name, EmailID: `${name.toLowerCase().replace(/\s+/g, '.')}@example.invalid`,
      MetaData: TAG, statusActive: 'ACTIVE', createdAt: new Date(), ...extra,
    },
  });
  made.cvs.push(row.id);
  return row;
}

async function mrf(role, extra = {}) {
  const row = await prisma.rpa_mrf.create({
    data: { position_hiring_for: `L02 ${role} ${Date.now()}`, number_of_positions: 2, approval_status: 'approved', additional_information: TAG, ...extra },
  });
  made.mrfs.push(row.id);
  return row;
}

async function shortlisted(c, jd) {
  const r = await shortlistCandidates([{ id: Number(c.id) }], Number(jd.id), '', USER, { sendEmail: false, source: 'search_candidate' });
  assert.equal(r.shortlisted, 1, `fixture shortlist for ${c.Name}`);
  const shortlist = await prisma.rpa_shortlisted_candidates.findFirst({ where: { cv_id: c.id, mrf_id: jd.id } });
  const journey = await prisma.rpa_candidate_pipeline.findFirst({ where: { shortlist_id: shortlist.id } });
  return { shortlist, journey };
}

describe('L02 — move to another JD, remove / switch a tag', () => {
  let senior;
  let mid;
  let other;

  before(async () => {
    senior = await mrf('Senior Dev');
    mid = await mrf('Mid Dev');
    other = await mrf('Other Role');
  });

  after(async () => {
    const pipes = await prisma.rpa_candidate_pipeline.findMany({ where: { cv_id: { in: made.cvs } }, select: { id: true } });
    const pIds = pipes.map((p) => p.id);
    await prisma.rpa_pipeline_stage_state.deleteMany({ where: { pipeline_id: { in: pIds } } }).catch(() => {});
    await prisma.rpa_pipeline_stage_events.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_notifications.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_candidate_pipeline.deleteMany({ where: { id: { in: pIds } } });
    await prisma.rpa_shortlisted_candidates.deleteMany({ where: { cv_id: { in: made.cvs } } });
    await prisma.rpa_candidate_mrf_tags.deleteMany({ where: { cv_id: { in: made.cvs } } });
    await prisma.rpa_processing_log.deleteMany({ where: { source: 'JD_TAG', logMessage: { contains: 'cv ' }, actor_context: { contains: 'l02-move-test' } } }).catch(() => {});
    await prisma.rpa_cv.deleteMany({ where: { id: { in: made.cvs } } });
    await prisma.rpa_mrf.deleteMany({ where: { id: { in: made.mrfs } } });
    await prisma.$disconnect();
    await disconnectRedis().catch(() => {});
  });

  test('a Tech 1 journey moves at a chosen stage: old closed silently, new linked, tagged, vendor kept', async () => {
    const c = await cv('L02 Mover');
    const { shortlist, journey } = await shortlisted(c, senior);
    await prisma.rpa_candidate_pipeline.update({
      where: { id: journey.id },
      data: { current_stage_key: 'tech1', source: 'vendor', vendor_email: 'vendor@example.invalid' },
    });

    const status = await getMoveJdStatus(journey.id);
    assert.equal(status.allowed, true);
    assert.equal(status.current.stage_key, 'tech1');
    assert.ok(status.excluded_mrf_ids.includes(Number(senior.id)));
    assert.equal(status.first_stage_key, status.stages[0].stage_key);

    const r = await moveJourneyToMrf({ pipelineId: journey.id, targetMrfId: Number(mid.id), landingStageKey: 'tech1', reason: 'better fit', user: USER });
    assert.equal(r.email, 'not_requested');
    assert.equal(r.landing_stage_key, 'tech1');

    const old = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: journey.id } });
    assert.equal(old.final_outcome, 'moved_to_other_jd');
    const closeEvent = await prisma.rpa_pipeline_stage_events.findFirst({ where: { pipeline_id: journey.id, event_type: 'outcome', outcome: 'moved_to_other_jd' } });
    assert.equal(closeEvent.email_sent, false, 'no candidate email on the old record');
    assert.match(closeEvent.notes, /^Moved to ".+" \(MRF-\d+\), at Technical Round 1\. Reason: better fit$/);
    assert.equal((await prisma.rpa_shortlisted_candidates.findUnique({ where: { id: shortlist.id } })).pipeline_status, 'moved');

    const fresh = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(r.to_pipeline_id) } });
    assert.equal(fresh.mrf_id, mid.id);
    assert.equal(fresh.current_stage_key, 'tech1');
    assert.equal(fresh.moved_from_pipeline_id, journey.id);
    assert.equal(fresh.source, 'vendor');
    assert.equal(fresh.vendor_email, 'vendor@example.invalid');
    const entered = await prisma.rpa_pipeline_stage_events.findFirst({ where: { pipeline_id: fresh.id, event_type: 'entered' } });
    assert.match(entered.notes, /^Moved from ".+" \(MRF-\d+\) at Technical Round 1, at Technical Round 1\. Reason: better fit$/);
    assert.equal(await prisma.rpa_candidate_mrf_tags.count({ where: { cv_id: c.id, mrf_id: mid.id, source: 'move' } }), 1);

    // "Earlier roles": the old journey, labelled and with its history.
    const related = await getRelatedJourneys(r.to_pipeline_id);
    assert.equal(related.journeys.length, 1);
    assert.equal(String(related.journeys[0].pipeline_id), String(journey.id));
    assert.equal(related.journeys[0].final_outcome_label, 'Moved to Another JD');
    assert.equal(String(related.journeys[0].moved_to_pipeline_id), String(r.to_pipeline_id));
    assert.ok(related.journeys[0].events.some((e) => e.outcome === 'moved_to_other_jd'));

    // Re-adding to the old JD is skipped, not a new journey on top of the closed one.
    const again = await shortlistCandidates([{ id: Number(c.id) }], Number(senior.id), '', USER, { sendEmail: false, source: 'search_candidate' });
    assert.equal(again.shortlisted, 0);
    assert.equal(again.skipped_candidates?.[0]?.reason, 'moved_away');
  });

  test('start from scratch lands on the first stage; a stage-rejected candidate can still move', async () => {
    const c = await cv('L02 Scratch');
    const { journey } = await shortlisted(c, senior);
    await prisma.rpa_candidate_pipeline.update({ where: { id: journey.id }, data: { current_stage_key: 'tech2', current_stage_status: 'rejected' } });
    const { stages } = await getMoveJdStatus(journey.id);
    const r = await moveJourneyToMrf({ pipelineId: journey.id, targetMrfId: Number(mid.id), reason: 'junior role', user: USER });
    assert.equal(r.landing_stage_key, stages[0].stage_key);
    const fresh = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(r.to_pipeline_id) } });
    assert.equal(fresh.current_stage_key, stages[0].stage_key);
    assert.equal(fresh.current_stage_status, 'in_progress');
  });

  test('refusals leave everything as it was', async () => {
    const c = await cv('L02 Refusals');
    const { journey } = await shortlisted(c, senior);
    await shortlisted(c, other);
    const closed = await mrf('Closed Role', { closed_at: new Date(), closure_reason: 'role_withdrawn' });
    const move = (targetMrfId, reason = 'x', landingStageKey = null) => moveJourneyToMrf({ pipelineId: journey.id, targetMrfId, reason, landingStageKey, user: USER });

    await assert.rejects(() => move(Number(mid.id), '  '), (e) => e.statusCode === 400 && /reason is required/.test(e.message));
    await assert.rejects(() => move(Number(senior.id)), (e) => e.statusCode === 409 && /already on this JD/.test(e.message));
    await assert.rejects(() => move(Number(closed.id)), (e) => e.statusCode === 409 && /is closed/.test(e.message));
    await assert.rejects(() => move(Number(other.id)), (e) => e.statusCode === 409 && /already on/.test(e.message));
    await assert.rejects(() => move(Number(mid.id), 'x', 'no_such_stage'), (e) => e.statusCode === 400);
    const still = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: journey.id } });
    assert.equal(still.final_outcome, null, 'the journey is still open');
    assert.equal(await prisma.rpa_shortlisted_candidates.count({ where: { cv_id: c.id, mrf_id: mid.id } }), 0, 'no stray shortlist row');

    await prisma.rpa_candidate_pipeline.update({ where: { id: journey.id }, data: { final_outcome: 'closure_rejected', closed_at: new Date() } });
    await assert.rejects(() => move(Number(mid.id)), (e) => e.statusCode === 409 && /closed/.test(e.message));
  });

  test('tags: the only tag and an in-pipeline tag stay; switching works; a second tag can go', async () => {
    const c = await cv('L02 Tags');
    await tagCandidates({ cvIds: [c.id], mrfId: senior.id, source: 'hr_manual_upload', actor: USER });

    let list = await listCandidateTags(c.id);
    assert.deepEqual(list.tags.map((t) => [t.mrf_id, t.can_remove, t.switch_via]), [[Number(senior.id), false, 'tag']]);
    await assert.rejects(() => untagCandidate({ cvId: c.id, mrfId: senior.id, reason: 'wrong', user: USER }), (e) => e.statusCode === 409 && /only JD/.test(e.message));

    list = await switchCandidateTag({ cvId: c.id, fromMrfId: senior.id, toMrfId: mid.id, reason: 'uploaded against the wrong JD', user: USER });
    assert.deepEqual(list.tags.map((t) => [t.mrf_id, t.source]), [[Number(mid.id), 'change_jd']]);

    // In the pipeline for "other": that tag cannot be removed or switched directly.
    await shortlisted(c, other);
    list = await listCandidateTags(c.id);
    const otherTag = list.tags.find((t) => t.mrf_id === Number(other.id));
    assert.equal(otherTag.switch_via, 'move');
    assert.ok(otherTag.open_pipeline_id);
    await assert.rejects(() => untagCandidate({ cvId: c.id, mrfId: other.id, reason: 'x', user: USER }), (e) => e.statusCode === 409 && /in the pipeline/.test(e.message));
    await assert.rejects(() => switchCandidateTag({ cvId: c.id, fromMrfId: other.id, toMrfId: senior.id, reason: 'x', user: USER }), (e) => e.statusCode === 409);

    // Two tags now, "mid" not in the pipeline: it can be removed.
    list = await untagCandidate({ cvId: c.id, mrfId: mid.id, reason: 'not for this role', user: USER });
    assert.deepEqual(list.tags.map((t) => t.mrf_id), [Number(other.id)]);
  });
});
