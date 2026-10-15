/**
 * Phase 3 "Do Now" section C — database behaviour (local / staging).
 *
 *   node src/tests/run-block.mjs src/tests/integration/sectionC.test.js
 *
 *   N20  shortlisting onto a closed MRF is refused by the server
 *   N21  cool-off and already-shortlisted candidates are skipped BY NAME, with
 *        no shortlist row and no email
 *   N22  a shortlist email to a candidate with no valid phone asks for it (the
 *        phone joins their missing-details list); the Schedule dialog saves a
 *        typed phone to the CV, and refuses a bad one
 *   N45  an outcome saved with "Send email" unticked records why no email went
 *   N18  the recruiter edit refuses a bad changed value, never an old one
 *
 * Emails cannot leave a local run (no Graph credentials): the shortlist email
 * attempt fails and is reported in email_failures, which is fine — every
 * decision tested here happens before the send. Fixtures are tagged and torn
 * down by explicit id.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import { shortlistCandidates } from '../../services/screening.service.js';
import {
  setStageOutcome, updateCandidatePhoneForPipeline, createPipelineJourney, OUTCOME_EMAIL_NOT_SENT,
} from '../../services/pipeline.service.js';
import * as candidateService from '../../services/candidate.service.js';

const TAG = 'SECTION-C-FIXTURE';
const USER = { username: 'section-c-test', id: null };
const made = { cvs: [], mrfs: [], pipelines: [] };

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
    data: { position_hiring_for: `C Test Role ${Date.now()}`, number_of_positions: 2, approval_status: 'approved', additional_information: TAG, ...extra },
  });
  made.mrfs.push(row.id);
  return row;
}

const asCand = (c) => ({ id: Number(c.id), Name: c.Name, EmailID: c.EmailID });

describe('section C', () => {
  let openMrf;

  before(async () => {
    openMrf = await mrf();
  });

  after(async () => {
    const pipes = await prisma.rpa_candidate_pipeline.findMany({ where: { cv_id: { in: made.cvs } }, select: { id: true } });
    const pIds = pipes.map((p) => p.id);
    await prisma.rpa_pipeline_stage_events.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_notifications.deleteMany({ where: { pipeline_id: { in: pIds } } });
    await prisma.rpa_candidate_pipeline.deleteMany({ where: { id: { in: pIds } } });
    const sls = await prisma.rpa_shortlisted_candidates.findMany({ where: { cv_id: { in: made.cvs } }, select: { id: true } });
    await prisma.rpa_email_messages.deleteMany({ where: { shortlist_id: { in: sls.map((x) => x.id) } } }).catch(() => {});
    await prisma.rpa_shortlisted_candidates.deleteMany({ where: { cv_id: { in: made.cvs } } });
    await prisma.rpa_email_log.deleteMany({ where: { recipient_email: { endsWith: '@example.invalid' }, subject: { contains: 'shortlist' } } }).catch(() => {});
    await prisma.rpa_cv.deleteMany({ where: { id: { in: made.cvs } } });
    await prisma.rpa_mrf.deleteMany({ where: { id: { in: made.mrfs } } });
    await prisma.$disconnect();
    await disconnectRedis().catch(() => {});
  });

  test('N20: a closed MRF takes no shortlist', async () => {
    const closed = await mrf({ closed_at: new Date(), closure_reason: 'role_withdrawn' });
    const c = await cv('C Closed Target');
    await assert.rejects(
      () => shortlistCandidates([asCand(c)], Number(closed.id), closed.position_hiring_for, USER, { sendEmail: false }),
      (err) => err.statusCode === 409 && /is closed/.test(err.message),
    );
    assert.equal(await prisma.rpa_shortlisted_candidates.count({ where: { cv_id: c.id } }), 0);
  });

  test('N21: cool-off and already-shortlisted are skipped by name, with nothing written', async () => {
    const fresh = await cv('C Fresh');
    const cooled = await cv('C Cooled');
    // A rejection 20 days ago on another journey puts "C Cooled" in the 6-month cool-off.
    const other = await mrf();
    const rejected = await prisma.rpa_candidate_pipeline.create({
      data: { cv_id: cooled.id, mrf_id: other.id, current_stage_key: 'tech1', current_stage_status: 'rejected', modified_at: new Date(Date.now() - 20 * 86400000) },
    });
    made.pipelines.push(rejected.id);

    const first = await shortlistCandidates([asCand(fresh), asCand(cooled)], Number(openMrf.id), openMrf.position_hiring_for, USER, { sendEmail: false, source: 'search_candidate' });
    assert.equal(first.shortlisted, 1);
    assert.equal(first.skipped, 1);
    assert.equal(first.skipped_candidates.length, 1);
    assert.equal(first.skipped_candidates[0].name, 'C Cooled');
    assert.equal(first.skipped_candidates[0].reason, 'cool_off');
    assert.match(first.skipped_candidates[0].message, /^Rejected on \d{2} [A-Z][a-z]{2} \d{4} \(.+\)\. Can be added again after \d{2} [A-Z][a-z]{2} \d{4}\.$/);
    assert.equal(await prisma.rpa_shortlisted_candidates.count({ where: { cv_id: cooled.id, mrf_id: openMrf.id } }), 0, 'no row for a cooled-off candidate');
    assert.equal(first.pipeline_entries.length, 1);

    // Again: the fresh one is now already shortlisted.
    const again = await shortlistCandidates([asCand(fresh)], Number(openMrf.id), openMrf.position_hiring_for, USER, { sendEmail: false });
    assert.equal(again.shortlisted, 0);
    assert.deepEqual(again.skipped_candidates.map((x) => [x.name, x.reason]), [['C Fresh', 'already_shortlisted']]);
  });

  test('N22: a candidate with no valid phone is asked for it in the shortlist email', async () => {
    const noPhone = await cv('C No Phone', { ContactNumber: '12345', missingData: JSON.stringify({ Gender: 'Null' }) });
    const withPhone = await cv('C Has Phone', { ContactNumber: '+91 98765 11111' });
    const r = await shortlistCandidates([asCand(noPhone), asCand(withPhone)], Number(openMrf.id), openMrf.position_hiring_for, USER, {
      sendEmail: true, source: 'jd', emailOverride: { subject: 'You have been shortlisted', body: '<p>Hi {{candidate_name}}</p>' },
    });
    assert.equal(r.shortlisted, 2);
    const a = await prisma.rpa_cv.findUnique({ where: { id: noPhone.id } });
    assert.deepEqual(JSON.parse(a.missingData), { Gender: 'Null', ContactNumber: 'Null' }, 'phone joins the missing list, others kept');
    assert.equal(a.cvMissingToken, Buffer.from(noPhone.EmailID).toString('base64'));
    const b = await prisma.rpa_cv.findUnique({ where: { id: withPhone.id } });
    assert.equal(b.missingData, null, 'a valid phone is never re-requested');
  });

  test('N22: the Schedule dialog phone is saved, a bad one refused', async () => {
    const c = await cv('C Schedule Phone', { ContactNumber: null });
    const j = await createPipelineJourney({ cvId: c.id, mrfId: null, shortlistId: null, source: 'screening_shortlist' });
    await assert.rejects(() => updateCandidatePhoneForPipeline(j.id, '98765'), (err) => err.statusCode === 400 && /10-digit/.test(err.message));
    const saved = await updateCandidatePhoneForPipeline(j.id, '+91 98765-22222');
    assert.deepEqual(saved, { changed: true, phone: '9876522222' });
    assert.equal((await prisma.rpa_cv.findUnique({ where: { id: c.id } })).ContactNumber, '9876522222');
    assert.equal((await updateCandidatePhoneForPipeline(j.id, '9876522222')).changed, false);
  });

  test('N45: an outcome saved without the candidate email says so', async () => {
    const c = await cv('C No Email Outcome');
    const j = await createPipelineJourney({ cvId: c.id, mrfId: null, shortlistId: null, source: 'screening_shortlist' });
    await setStageOutcome(j.id, { outcomeKey: 'approved', notes: 'Approved in the section C test without a score.', sendEmail: false, actedBy: 1 });
    const ev = await prisma.rpa_pipeline_stage_events.findFirst({ where: { pipeline_id: BigInt(j.id), event_type: 'outcome' } });
    assert.equal(ev.email_sent, false);
    assert.equal(ev.email_error, OUTCOME_EMAIL_NOT_SENT);
  });

  test('N18: recruiter edit refuses a bad changed value, never an unchanged old one', async () => {
    const c = await cv('C Edit Rules', { ContactNumber: '9876533333', TotalExperienceYears: '3 years' });
    await assert.rejects(() => candidateService.update(Number(c.id), { phone: '12345' }), (err) => err.statusCode === 400 && /10-digit/.test(err.message));
    await assert.rejects(() => candidateService.update(Number(c.id), { expectedCTC: '500' }), (err) => err.statusCode === 400 && /between 0 and 200/.test(err.message));
    // The legacy "3 years" goes back unchanged with the rest of the form: accepted.
    await candidateService.update(Number(c.id), { experience: '3 years', location: 'Noida' });
    assert.equal((await prisma.rpa_cv.findUnique({ where: { id: c.id } })).CurrentLocation, 'Noida');
  });
});
