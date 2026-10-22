/**
 * Phase 3 "Do Now" section G — Change JD (G3), database behaviour (staging DB).
 *
 *   node src/tests/run-block.mjs src/tests/integration/sectionG.test.js
 *
 *   - the shortlist row and its journey move to the new JD; the stage stays
 *   - the JD tag moves (an upload's tag on the old JD is kept); a note records it
 *   - "Set JD" on a keyword shortlist that had no JD
 *   - refused: same JD, closed JD, candidate already on the target, activity
 *     under the old JD (an interview), a missing reason
 *   - two changes at once: one wins, the other is told
 *
 * No email is sent (notifyCandidate is never ticked here). Fixtures are tagged
 * and torn down by explicit id.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import { shortlistCandidates } from '../../services/screening.service.js';
import { getChangeJdStatus, changeShortlistJd } from '../../services/changeJd.service.js';
import { tagCandidates } from '../../services/candidateTag.service.js';

const TAG = 'SECTION-G-FIXTURE';
const USER = { username: 'section-g-test', id: null };
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
    data: { position_hiring_for: `G ${role} ${Date.now()}`, number_of_positions: 2, approval_status: 'approved', additional_information: TAG, ...extra },
  });
  made.mrfs.push(row.id);
  return row;
}

/** Shortlist one candidate (Add to JD, no email) and return the shortlist + journey. */
async function shortlisted(c, jd) {
  const r = await shortlistCandidates([{ id: Number(c.id) }], jd ? Number(jd.id) : 0, '', USER, { sendEmail: false, source: jd ? 'search_candidate' : 'keyword' });
  assert.equal(r.shortlisted, 1, `fixture shortlist for ${c.Name}`);
  const shortlist = await prisma.rpa_shortlisted_candidates.findFirst({ where: { cv_id: c.id }, orderBy: { id: 'desc' } });
  const journey = await prisma.rpa_candidate_pipeline.findFirst({ where: { shortlist_id: shortlist.id } });
  return { shortlist, journey };
}

describe('section G — Change JD', () => {
  let wrong;
  let right;

  before(async () => {
    wrong = await mrf('Wrong Role');
    right = await mrf('Right Role');
  });

  after(async () => {
    const pipes = await prisma.rpa_candidate_pipeline.findMany({ where: { cv_id: { in: made.cvs } }, select: { id: true } });
    const pIds = pipes.map((p) => p.id);
    await prisma.rpa_interview_schedule.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_pipeline_stage_state.deleteMany({ where: { pipeline_id: { in: pIds } } }).catch(() => {});
    await prisma.rpa_pipeline_stage_events.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_notifications.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_candidate_pipeline.deleteMany({ where: { id: { in: pIds } } });
    await prisma.rpa_shortlisted_candidates.deleteMany({ where: { cv_id: { in: made.cvs } } });
    await prisma.rpa_cv.deleteMany({ where: { id: { in: made.cvs } } });
    await prisma.rpa_mrf.deleteMany({ where: { id: { in: made.mrfs } } });
    await prisma.$disconnect();
    await disconnectRedis().catch(() => {});
  });

  test('the shortlist and journey move to the right JD; the stage stays; tag and note follow', async () => {
    const c = await cv('G Moves', { FinalStatus: null });
    // Uploaded for the wrong JD as well: that tag records the upload and is kept.
    await tagCandidates({ cvIds: [c.id], mrfId: wrong.id, source: 'hr_manual_upload', actor: USER });
    const { shortlist, journey } = await shortlisted(c, wrong);

    const status = await getChangeJdStatus(shortlist.id);
    assert.equal(status.allowed, true);
    assert.equal(status.current_mrf.id, Number(wrong.id));
    assert.ok(status.excluded_mrf_ids.includes(Number(wrong.id)));

    const r = await changeShortlistJd({ shortlistId: shortlist.id, newMrfId: Number(right.id), reason: '  picked the wrong JD  ', user: USER });
    assert.equal(r.to_mrf_id, Number(right.id));
    assert.equal(r.email, 'not_requested');

    const s2 = await prisma.rpa_shortlisted_candidates.findUnique({ where: { id: shortlist.id } });
    assert.equal(s2.mrf_id, right.id);
    assert.equal(s2.position_applied, right.position_hiring_for);
    assert.equal(s2.pipeline_status, 'shortlisted');
    const j2 = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: journey.id } });
    assert.equal(j2.mrf_id, right.id);
    assert.equal(j2.current_stage_key, journey.current_stage_key, 'the stage does not change');

    const tags = await prisma.rpa_candidate_mrf_tags.findMany({ where: { cv_id: c.id }, orderBy: { mrf_id: 'asc' }, select: { mrf_id: true, source: true } });
    assert.deepEqual(
      tags.map((t) => [String(t.mrf_id), t.source]).sort(),
      [[String(right.id), 'change_jd'], [String(wrong.id), 'hr_manual_upload']].sort(),
      'the shortlist tag moved; the upload tag stayed',
    );
    const note = await prisma.rpa_pipeline_stage_events.findFirst({ where: { pipeline_id: journey.id, event_type: 'note' } });
    assert.match(note.notes, /^JD changed from ".+" \(MRF-\d+\) to ".+" \(MRF-\d+\)\. Reason: picked the wrong JD$/);
  });

  test('"Set JD" gives a keyword shortlist with no JD its JD', async () => {
    const c = await cv('G Set JD');
    const { shortlist, journey } = await shortlisted(c, null);
    assert.equal(shortlist.mrf_id, null);
    const status = await getChangeJdStatus(shortlist.id);
    assert.equal(status.current_mrf, null);
    await changeShortlistJd({ shortlistId: shortlist.id, newMrfId: Number(right.id), reason: 'set the JD', user: USER });
    assert.equal((await prisma.rpa_candidate_pipeline.findUnique({ where: { id: journey.id } })).mrf_id, right.id);
    assert.equal(await prisma.rpa_candidate_mrf_tags.count({ where: { cv_id: c.id, mrf_id: right.id, source: 'change_jd' } }), 1);
  });

  test('refusals: same JD, closed JD, already on the target, no reason', async () => {
    const c = await cv('G Refusals');
    const { shortlist } = await shortlisted(c, wrong);
    const closed = await mrf('Closed Role', { closed_at: new Date(), closure_reason: 'role_withdrawn' });
    const change = (newMrfId, reason = 'x') => changeShortlistJd({ shortlistId: shortlist.id, newMrfId, reason, user: USER });

    await assert.rejects(() => change(Number(wrong.id)), (e) => e.statusCode === 409 && /already on this JD/.test(e.message));
    await assert.rejects(() => change(Number(closed.id)), (e) => e.statusCode === 409 && /is closed/.test(e.message));
    await assert.rejects(() => change(Number(right.id), '   '), (e) => e.statusCode === 400 && /reason is required/.test(e.message));

    // Also shortlisted to the right JD already: can't be moved onto it.
    await shortlistCandidates([{ id: Number(c.id) }], Number(right.id), '', USER, { sendEmail: false, source: 'search_candidate' });
    await assert.rejects(() => change(Number(right.id)), (e) => e.statusCode === 409 && /already on/.test(e.message));
    assert.equal((await prisma.rpa_shortlisted_candidates.findUnique({ where: { id: shortlist.id } })).mrf_id, wrong.id, 'nothing changed');
  });

  test('an interview booked under the old JD blocks the change, and the dialog says why', async () => {
    const c = await cv('G Interview Booked');
    const { shortlist, journey } = await shortlisted(c, wrong);
    const start = new Date(Date.now() + 86400000);
    await prisma.rpa_interview_schedule.create({
      data: { pipeline_id: journey.id, stage_key: journey.current_stage_key, scheduled_start_at: start, scheduled_end_at: new Date(start.getTime() + 3600000) },
    });
    const status = await getChangeJdStatus(shortlist.id);
    assert.equal(status.allowed, false);
    assert.equal(status.block.code, 'activity');
    assert.match(status.block.message, /an interview is booked/);
    await assert.rejects(
      () => changeShortlistJd({ shortlistId: shortlist.id, newMrfId: Number(right.id), reason: 'x', user: USER }),
      (e) => e.statusCode === 409 && /an interview is booked/.test(e.message),
    );
  });

  test('two changes at once: one wins, the other is refused', async () => {
    const c = await cv('G Race');
    const { shortlist } = await shortlisted(c, wrong);
    const third = await mrf('Third Role');
    const results = await Promise.allSettled([
      changeShortlistJd({ shortlistId: shortlist.id, newMrfId: Number(right.id), reason: 'a', user: USER }),
      changeShortlistJd({ shortlistId: shortlist.id, newMrfId: Number(third.id), reason: 'b', user: USER }),
    ]);
    assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
    const loser = results.find((x) => x.status === 'rejected');
    assert.equal(loser.reason.statusCode, 409);
    const finalMrf = (await prisma.rpa_shortlisted_candidates.findUnique({ where: { id: shortlist.id } })).mrf_id;
    const winner = results.find((x) => x.status === 'fulfilled').value.to_mrf_id;
    assert.equal(Number(finalMrf), winner);
    assert.equal(await prisma.rpa_candidate_mrf_tags.count({ where: { cv_id: c.id, source: 'change_jd' } }), 1);
  });
});
