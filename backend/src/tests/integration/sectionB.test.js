/**
 * Phase 3 "Do Now" section B — JD tagging and the Add to JD hardening
 * (database behaviour, staging DB).
 *
 *   node src/tests/run-block.mjs src/tests/integration/sectionB.test.js
 *
 *   N13  tagging is idempotent; a shortlist tags the candidate to the JD with
 *        the right source (Search Candidate's Add to JD vs a Screening tab)
 *   N14  a merged duplicate tags the candidate it resolves to with its
 *        upload's JD
 *   N21  hardening: an unknown id fails alone (R1); two adds at once write one
 *        row (R3); name and email come from the record (R4) and the role from
 *        the MRF (R5); an unapproved MRF is refused (R6); FinalStatus is not
 *        pulled back to "Stage 0" (R7); Add to JD takes at most 50 (R8)
 *
 * Emails are off (sendEmail: false) except where noted. Fixtures are tagged
 * and torn down by explicit id; tags go with their candidate (ON DELETE CASCADE).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import { shortlistCandidates, MAX_ADD_TO_JD_BATCH } from '../../services/screening.service.js';
import { tagCandidates } from '../../services/candidateTag.service.js';
import { mergeDuplicates } from '../../services/hrUpload.service.js';

const TAG = 'SECTION-B-FIXTURE';
const USER = { username: 'section-b-test', id: null };
const made = { cvs: [], mrfs: [], tmps: [] };

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

async function mrf(extra = {}) {
  const row = await prisma.rpa_mrf.create({
    data: { position_hiring_for: `B Test Role ${Date.now()}`, number_of_positions: 2, approval_status: 'approved', additional_information: TAG, ...extra },
  });
  made.mrfs.push(row.id);
  return row;
}

const asCand = (c) => ({ id: Number(c.id), Name: c.Name, EmailID: c.EmailID });
const tagsOf = (cvId) => prisma.rpa_candidate_mrf_tags.findMany({ where: { cv_id: cvId }, select: { mrf_id: true, source: true } });

describe('section B', () => {
  let jd;

  before(async () => {
    jd = await mrf();
  });

  after(async () => {
    const pipes = await prisma.rpa_candidate_pipeline.findMany({ where: { cv_id: { in: made.cvs } }, select: { id: true } });
    const pIds = pipes.map((p) => p.id);
    await prisma.rpa_pipeline_stage_state.deleteMany({ where: { pipeline_id: { in: pIds } } }).catch(() => {});
    await prisma.rpa_pipeline_stage_events.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_notifications.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_candidate_pipeline.deleteMany({ where: { id: { in: pIds } } });
    const sls = await prisma.rpa_shortlisted_candidates.findMany({ where: { cv_id: { in: made.cvs } }, select: { id: true } });
    await prisma.rpa_email_messages.deleteMany({ where: { shortlist_id: { in: sls.map((x) => x.id) } } }).catch(() => {});
    await prisma.rpa_shortlisted_candidates.deleteMany({ where: { cv_id: { in: made.cvs } } });
    await prisma.rpa_cv_tmp.deleteMany({ where: { id: { in: made.tmps } } }).catch(() => {});
    await prisma.rpa_processing_log.deleteMany({ where: { logMessage: { contains: TAG } } }).catch(() => {});
    await prisma.rpa_cv.deleteMany({ where: { id: { in: made.cvs } } });
    await prisma.rpa_mrf.deleteMany({ where: { id: { in: made.mrfs } } });
    await prisma.$disconnect();
    await disconnectRedis().catch(() => {});
  });

  test('N13: tagging twice keeps one tag, with the first source', async () => {
    const c = await cv('B Tag Twice');
    assert.equal(await tagCandidates({ cvIds: [c.id], mrfId: jd.id, source: 'hr_manual_upload', actor: USER }), 1);
    assert.equal(await tagCandidates({ cvIds: [c.id, c.id], mrfId: jd.id, source: 'shortlist', actor: USER }), 0);
    assert.deepEqual(await tagsOf(c.id), [{ mrf_id: jd.id, source: 'hr_manual_upload' }]);
    await assert.rejects(() => tagCandidates({ cvIds: [c.id], mrfId: jd.id, source: 'email_intake' }), /Unknown JD tag source/);
  });

  test('N13: Add to JD tags as search_candidate; a re-add stays one tag', async () => {
    const c = await cv('B Add To JD');
    const r = await shortlistCandidates([asCand(c)], Number(jd.id), 'ignored', USER, { sendEmail: false, source: 'search_candidate' });
    assert.equal(r.shortlisted, 1);
    assert.deepEqual(await tagsOf(c.id), [{ mrf_id: jd.id, source: 'search_candidate' }]);

    const again = await shortlistCandidates([asCand(c)], Number(jd.id), 'ignored', USER, { sendEmail: false, source: 'jd' });
    assert.equal(again.skipped_candidates[0].reason, 'already_shortlisted');
    assert.equal((await tagsOf(c.id)).length, 1);
  });

  test('N21 R4/R5: name and email from the record, role from the MRF', async () => {
    const c = await cv('B Record Wins');
    const r = await shortlistCandidates(
      [{ id: Number(c.id), Name: 'Stale Name', EmailID: 'stale@example.invalid' }],
      Number(jd.id), 'Wrong Role From Browser', USER, { sendEmail: false, source: 'search_candidate' },
    );
    assert.equal(r.shortlisted, 1);
    const row = await prisma.rpa_shortlisted_candidates.findFirst({ where: { cv_id: c.id, mrf_id: jd.id } });
    assert.equal(row.candidate_name, 'B Record Wins');
    assert.equal(row.candidate_email, c.EmailID);
    assert.equal(row.position_applied, jd.position_hiring_for);
  });

  test('N21 R1: an unknown candidate fails alone; the rest are added', async () => {
    const ok = await cv('B Batch Ok');
    const r = await shortlistCandidates(
      [{ id: 999999999999, Name: 'Ghost' }, asCand(ok)],
      Number(jd.id), '', USER, { sendEmail: false, source: 'search_candidate' },
    );
    assert.equal(r.shortlisted, 1);
    assert.equal(r.failed, 1);
    assert.deepEqual(r.failed_candidates.map((x) => [x.name, x.reason]), [['Ghost', 'not_found']]);
    assert.equal(r.pipeline_entries.length, 1);
  });

  test('N21 R3: two adds at once write one shortlist row and one journey', async () => {
    const c = await cv('B Double Add');
    const run = () => shortlistCandidates([asCand(c)], Number(jd.id), '', USER, { sendEmail: false, source: 'search_candidate' });
    const [a, b] = await Promise.all([run(), run()]);
    assert.equal(a.shortlisted + b.shortlisted, 1);
    assert.equal(a.skipped + b.skipped, 1);
    assert.equal(await prisma.rpa_shortlisted_candidates.count({ where: { cv_id: c.id, mrf_id: jd.id } }), 1);
    assert.equal(await prisma.rpa_candidate_pipeline.count({ where: { cv_id: c.id, mrf_id: jd.id } }), 1);
  });

  test('N21 R6: an unapproved MRF is refused before anything is written', async () => {
    const waiting = await mrf({ approval_status: 'waiting' });
    const c = await cv('B Unapproved');
    await assert.rejects(
      () => shortlistCandidates([asCand(c)], Number(waiting.id), '', USER, { sendEmail: false }),
      (err) => err.statusCode === 409 && /not approved/.test(err.message),
    );
    assert.equal(await prisma.rpa_shortlisted_candidates.count({ where: { cv_id: c.id } }), 0);
  });

  test('N21 R7: a later stage on another JD is not pulled back to "Stage 0"', async () => {
    const c = await cv('B Further Along', { FinalStatus: 'Stage 3 - Tech Round 1' });
    const other = await mrf();
    await prisma.rpa_candidate_pipeline.create({
      data: { cv_id: c.id, mrf_id: other.id, current_stage_key: 'tech1', current_stage_status: 'in_progress' },
    });
    const r = await shortlistCandidates([asCand(c)], Number(jd.id), '', USER, { sendEmail: false, source: 'search_candidate' });
    assert.equal(r.shortlisted, 1);
    assert.equal((await prisma.rpa_cv.findUnique({ where: { id: c.id } })).FinalStatus, 'Stage 3 - Tech Round 1');

    const fresh = await cv('B Only Journey', { FinalStatus: null });
    await shortlistCandidates([asCand(fresh)], Number(jd.id), '', USER, { sendEmail: false, source: 'search_candidate' });
    assert.equal((await prisma.rpa_cv.findUnique({ where: { id: fresh.id } })).FinalStatus, 'Stage 0 - Resume Shortlisted');
  });

  test('N21 R8: Add to JD takes at most 50 per request; Screening is not capped', async () => {
    const many = Array.from({ length: MAX_ADD_TO_JD_BATCH + 1 }, (_, i) => ({ id: 1_000_000_000 + i, Name: `X${i}` }));
    await assert.rejects(
      () => shortlistCandidates(many, Number(jd.id), '', USER, { sendEmail: false, source: 'search_candidate' }),
      (err) => err.statusCode === 400 && /up to 50/.test(err.message),
    );
    // The same list from a Screening tab is processed (every id is unknown, so all fail alone).
    const r = await shortlistCandidates(many, Number(jd.id), '', USER, { sendEmail: false, source: 'jd' });
    assert.equal(r.failed, MAX_ADD_TO_JD_BATCH + 1);
  });

  test('N14: a merged duplicate tags the candidate it resolves to', async () => {
    const existing = await cv('B Merge Target', { ContactNumber: '9876500011' });
    const tmp = await prisma.rpa_cv_tmp.create({
      data: {
        Name: 'B Merge Target', EmailID: existing.EmailID, ContactNumber: '9876500011',
        source: 'vendor_portal', last_action_context: 'vendor_portal', MetaData: TAG,
        mrf_id: jd.id, createdAt: new Date(), modifiedAt: new Date(),
      },
    });
    made.tmps.push(tmp.id);
    await mergeDuplicates([Number(tmp.id)], null, { email: 'section-b@example.invalid', username: 'section-b-test' });
    assert.deepEqual(await tagsOf(existing.id), [{ mrf_id: jd.id, source: 'vendor_portal' }]);
    assert.equal(await prisma.rpa_cv_tmp.count({ where: { id: tmp.id } }), 0, 'the duplicate row is gone');
  });
});
